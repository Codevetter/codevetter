#!/usr/bin/env python3
"""Record skill-mediated CodeVetter invocations without inventing benefit verdicts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from uuid import uuid4

from outcomes import OUTCOMES, REASONS, latest_assessment, record_assessment
from telemetry import execution_context, inspect_invocation, source_context, validate_id, validate_parent

MAX_RECEIPT_BYTES = 2 * 1024 * 1024
SKILLS = {"codevetter-review", "codevetter-testing", "codevetter-performance", "codevetter-evaluate"}
COMMANDS = {"check", "scope", "qa", "trex", "warm", "differential", "scenario", "performance", "runs", "capabilities", "collect"}
MUTATING_OPERATIONS = {"cleanup", "discard", "accept", "reject", "save-workflow", "delete-workflow", "save-target", "delete-target"}
STATES = {"running", "completed", "failed", "unavailable", "interrupted", "timed_out", "output_limit"}
AGENTS = {"codex", "claude", "gemini", "other", "unknown"}
RECORDED_OPERATIONS = {"preflight", "inspect", "plan", "diagnose", "verify-paired", "prepare",
                       "run", "cancel", "status", "start", "stop", "current", "generate",
                       "validate", "dry-run"}


def now():
    return datetime.now(timezone.utc).isoformat()


def default_ledger():
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/CodeVetter/skill-invocations"
    return Path.home() / ".local/share/codevetter/skill-invocations"


def write_metadata(path, record):
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as output:
        os.chmod(temporary, 0o600)
        json.dump(record, output, indent=2)
        output.write("\n")
    temporary.replace(path)


def list_invocations(root, repo=None, offset=0, limit=50, task_id=None, skill=None,
                     state=None, assessment=None):
    assessment_filter = assessment
    if offset < 0 or not 1 <= limit <= 100:
        raise ValueError("offset must be nonnegative and limit must be 1-100")
    if root.is_symlink():
        raise ValueError("ledger directory must not be a symlink")
    root = root.resolve()
    validate_id(task_id)
    repo = repo.resolve() if repo else None
    records, unreadable, unreadable_assessments = [], 0, 0
    for path in root.glob("*/invocation.json"):
        if path.is_symlink() or path.parent.is_symlink():
            unreadable += 1
            continue
        try:
            if path.stat().st_size > 16 * 1024:
                raise ValueError("oversized invocation metadata")
            record = json.loads(path.read_text())
            if not isinstance(record, dict) or any(not isinstance(record.get(key), str)
                                                   for key in ("started_at", "invocation_id", "state")):
                raise ValueError("invalid invocation metadata")
            if record.get("schema_version") != "codevetter.skill-invocation/v1":
                raise ValueError("unsupported invocation schema")
            validate_id(record["invocation_id"])
            if record["invocation_id"] != path.parent.name or record["state"] not in STATES:
                raise ValueError("invocation identity or state mismatch")
            if repo is None or record.get("repo_path") == str(repo):
                assessment, errors = latest_assessment(path.parent)
                unreadable_assessments += errors
                record["usefulness"] = assessment
                record["assessment"] = assessment["outcome"] if assessment else "unassessed"
                records.append(record)
        except (OSError, ValueError, AttributeError):
            unreadable += 1
    records = [row for row in records if (task_id is None or row.get("task_id") == task_id)
               and (skill is None or row.get("skill") == skill)
               and (state is None or row["state"] == state)
               and (assessment_filter is None or row["assessment"] == assessment_filter)]
    records.sort(key=lambda row: (row["started_at"], row["invocation_id"]), reverse=True)
    return {"schema_version": "codevetter.skill-invocation-list/v1", "total": len(records),
            "offset": offset, "limit": limit, "invocations": records[offset:offset + limit],
            "unreadable_records": unreadable, "unreadable_assessments": unreadable_assessments,
            "limitations": ["Only commands run through the skill recorder are counted; historical and direct invocations are not backfilled.",
                            "Usefulness entries are agent-reported observations; they do not establish independent or causal agent benefit."]}


def invoke(skill, repo, command, root, cli="codevetter", timeout_seconds=1200,
           task_id=None, parent_id=None, agent="unknown"):
    validate_id(task_id)
    validate_id(parent_id)
    if parent_id and not task_id:
        raise ValueError("parent correlation requires a task identifier")
    if agent not in AGENTS:
        raise ValueError("unsupported originating agent")
    if skill not in SKILLS or not command or command[0] not in COMMANDS:
        raise ValueError("unsupported skill or CodeVetter command")
    if "--json" not in command:
        raise ValueError("recorded commands require --json")
    if "--repo" in command or any(value.startswith("--repo=") for value in command):
        raise ValueError("pass --repo to the recorder, not the child command")
    if command.count("--operation") > 1 or any(value.startswith("--operation=") for value in command):
        raise ValueError("use one separated --operation flag")
    if "--operation" in command:
        position = command.index("--operation")
        if position + 1 >= len(command):
            raise ValueError("--operation requires a value")
        operation = command[position + 1]
    else:
        operation = "preflight" if "--preflight" in command else None
    if operation in MUTATING_OPERATIONS or "--apply-cleanup" in command:
        raise ValueError("mutation/cleanup operations require their separate explicit workflow")
    if not 1 <= timeout_seconds <= 3600:
        raise ValueError("timeout must be 1-3600 seconds")
    repo = repo.resolve(strict=True)
    if not repo.is_dir():
        raise ValueError("repository must be a directory")
    if root.is_symlink():
        raise ValueError("ledger directory must not be a symlink")
    root = root.resolve()
    validate_parent(root, parent_id, repo, task_id)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    invocation_id = str(uuid4())
    directory = root / invocation_id
    directory.mkdir(mode=0o700)
    metadata = directory / "invocation.json"
    record = {"schema_version": "codevetter.skill-invocation/v1", "invocation_id": invocation_id,
              "skill": skill, "repo_path": str(repo), "command": command[0],
              "operation": operation if operation is None or operation in RECORDED_OPERATIONS else "unrecognized",
              "started_at": now(), "finished_at": None, "duration_ms": None, "state": "running",
              "exit_code": None, "cli_exit_code": None, "receipt_path": None, "receipt_sha256": None,
              "assessment": "unassessed", "failure_reason": None, "limitation": None,
              "receipt_schema_version": None, "supervision_warnings": []}
    record.update(task_id=task_id, parent_invocation_id=parent_id, agent=agent, context=None,
                  context_capture_ms=None)
    write_metadata(metadata, record)
    context_started = time.monotonic()
    executable = shutil.which(cli)
    try:
        executable = Path(executable).resolve(strict=True) if executable else None
    except OSError:
        executable = None
    record["context"] = execution_context(repo, executable, timeout_seconds)
    record["context_capture_ms"] = round((time.monotonic() - context_started) * 1000)
    write_metadata(metadata, record)
    if executable is None:
        record.update(state="unavailable", finished_at=now(), duration_ms=0, exit_code=127,
                      limitation="CodeVetter CLI is not installed or executable.")
        write_metadata(metadata, record)
        return 127, record, None
    capture = directory / "capture.tmp"
    error_capture = directory / "stderr.tmp"
    started = time.monotonic()
    interrupted = []
    previous = {}

    def handle_signal(number, _frame):
        interrupted.append(number)

    for number in (signal.SIGINT, signal.SIGTERM):
        previous[number] = signal.signal(number, handle_signal)
    data = None
    child = None
    exit_code = 127

    def signal_child(number):
        if child.poll() is not None:
            return
        try:
            os.killpg(child.pid, number)
        except ProcessLookupError:
            pass
        except PermissionError:
            # macOS can deny signalling a process group while a short-lived child exits.
            # Popen checks its owned child's identity before signalling its PID.
            if child.poll() is None:
                warning = "Process-group signalling was unavailable; signalled only the owned CLI process."
                if warning not in record["supervision_warnings"]:
                    record["supervision_warnings"].append(warning)
                child.send_signal(number)
    try:
        # macOS current_exe may preserve a launcher symlink, breaking sibling-resource lookup.
        executable = str(executable)
        args = [executable, *command]
        if command[0] != "capabilities":
            args.extend(["--repo", str(repo)])
        with capture.open("xb") as output, error_capture.open("xb") as error_output:
            os.chmod(capture, 0o600)
            os.chmod(error_capture, 0o600)
            child = subprocess.Popen(args, cwd=repo, stdout=output, stderr=error_output,
                                     stdin=subprocess.DEVNULL, start_new_session=True)
            termination_started = None
            while child.poll() is None:
                elapsed = time.monotonic() - started
                reason = ("interrupted" if interrupted else
                          "timed_out" if elapsed >= timeout_seconds else
                          "output_limit" if max(capture.stat().st_size, error_capture.stat().st_size) > MAX_RECEIPT_BYTES else None)
                if reason and termination_started is None:
                    record["state"] = reason
                    termination_started = time.monotonic()
                    signal_child(signal.SIGTERM)
                elif termination_started is not None and time.monotonic() - termination_started > 10:
                    signal_child(signal.SIGKILL)
                    child.wait()
                time.sleep(0.05)
            exit_code = child.wait()
            record["cli_exit_code"] = exit_code
        if max(capture.stat().st_size, error_capture.stat().st_size) > MAX_RECEIPT_BYTES:
            record.update(state="output_limit", limitation="Canonical receipt exceeded the capture bound.")
        else:
            raw = capture.read_bytes()
            try:
                parsed = json.loads(raw)
                schema = parsed.get("schema_version") if isinstance(parsed, dict) else None
                valid_schema = ((isinstance(schema, str) and 1 <= len(schema) <= 128)
                                or (type(schema) is int and 0 <= schema <= 2**31 - 1))
                if not valid_schema:
                    raise ValueError("canonical output must be a versioned object")
                data = raw
                receipt_path = directory / "receipt.json"
                capture.replace(receipt_path)
                record.update(receipt_path=str(receipt_path), receipt_sha256=hashlib.sha256(raw).hexdigest(),
                              receipt_schema_version=schema)
            except (ValueError, UnicodeError):
                record["limitation"] = "CLI returned no complete canonical JSON receipt. Raw output was not retained."
        if exit_code != 0:
            with error_capture.open("rb") as errors:
                error_text = errors.read(8192).decode("utf-8", errors="replace")
            record["failure_reason"] = classify_failure(error_text)
        if record["state"] == "running":
            record["state"] = "completed" if exit_code == 0 and data else "failed"
        if record["state"] == "interrupted":
            exit_code = 128 + interrupted[0]
        elif record["state"] == "timed_out":
            exit_code = 124
        elif record["state"] == "output_limit":
            exit_code = 2
        elif exit_code < 0:
            exit_code = 128 - exit_code
        elif exit_code == 0 and data is None:
            exit_code = 2
    except OSError:
        exit_code = 127
        record.update(state="unavailable", limitation="Could not launch or supervise the CodeVetter CLI.")
    finally:
        if child is not None and child.poll() is None:
            try:
                signal_child(signal.SIGTERM)
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                signal_child(signal.SIGKILL)
                child.wait()
            except ProcessLookupError:
                child.wait()
            except OSError:
                exit_code = 127
                record.update(state="unavailable", limitation="Owned CLI could not be fully reaped.")
        for number, handler in previous.items():
            signal.signal(number, handler)
        # This is only the recorder-owned incomplete capture; canonical receipts are retained.
        capture.unlink(missing_ok=True)
        error_capture.unlink(missing_ok=True)
    duration_ms = round((time.monotonic() - started) * 1000)
    context_started = time.monotonic()
    record["context"]["source_after"] = source_context(repo)
    record["context_capture_ms"] += round((time.monotonic() - context_started) * 1000)
    record.update(finished_at=now(), duration_ms=duration_ms, exit_code=exit_code)
    write_metadata(metadata, record)
    return exit_code, record, data


def classify_failure(text):
    # Only fixed allowlisted messages enter metadata; raw stderr/paths/arguments never do.
    reasons = [
        ("requires a clean checkout", "dirty_checkout", "A clean immutable checkout is required."),
        ("packaged local performance runtime is unavailable", "runtime_unavailable", "The installed performance runtime could not be located."),
        ("Node.js is required", "node_unavailable", "Node.js is required for this runtime."),
        ("unknown argument", "invalid_arguments", "The installed CLI rejected an argument."),
        ("unknown option", "invalid_arguments", "The installed CLI rejected an option."),
    ]
    for marker, code, message in reasons:
        if marker in text:
            return {"code": code, "message": message}
    return {"code": "cli_failure", "message": "The CLI failed; no safe specific blocker was recognized."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skill", choices=sorted(SKILLS))
    parser.add_argument("--repo", type=Path)
    parser.add_argument("--ledger-dir", type=Path, default=default_ledger())
    parser.add_argument("--cli", default="codevetter")
    parser.add_argument("--timeout-seconds", type=int, default=1200)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--show", metavar="INVOCATION_ID")
    parser.add_argument("--pointer", help="Inspect one JSON pointer in the canonical receipt")
    parser.add_argument("--task-id", help="Opaque UUID shared by invocations for one task")
    parser.add_argument("--parent-id", help="Preceding invocation in the same task/repository")
    parser.add_argument("--agent", choices=sorted(AGENTS), default="unknown")
    parser.add_argument("--state", choices=sorted(STATES))
    parser.add_argument("--assessment-filter", choices=sorted(OUTCOMES | {"unassessed"}))
    parser.add_argument("--assess", metavar="INVOCATION_ID")
    parser.add_argument("--outcome", choices=sorted(OUTCOMES))
    parser.add_argument("--reason", choices=sorted(REASONS))
    parser.add_argument("--summary")
    parser.add_argument("--evidence-pointer", action="append", default=[])
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        if sum(bool(value) for value in (args.list, args.assess, args.show)) > 1:
            parser.error("choose one of --list, --show or --assess")
        if (args.list or args.show or args.assess) and args.command:
            parser.error("read/assessment modes cannot execute a command")
        if args.pointer is not None and not args.show:
            parser.error("--pointer requires --show")
        if (args.state or args.assessment_filter) and not args.list:
            parser.error("state and assessment filters require --list")
        if args.parent_id and (args.list or args.show or args.assess):
            parser.error("--parent-id is only used when recording")
        if args.assess:
            if args.list or args.command or not args.outcome or not args.reason or not args.summary:
                parser.error("assessment requires --outcome, --reason and --summary without execution/list flags")
            assessment = record_assessment(args.ledger_dir, args.assess, args.outcome, args.reason,
                                           args.summary, args.evidence_pointer, now, write_metadata)
            print(json.dumps(assessment, indent=2))
            return 0
        if args.outcome or args.reason or args.summary or args.evidence_pointer:
            parser.error("usefulness flags require --assess")
        if args.show:
            print(json.dumps(inspect_invocation(args.ledger_dir, args.show, args.pointer), indent=2))
            return 0
        if args.list:
            print(json.dumps(list_invocations(args.ledger_dir, args.repo.resolve() if args.repo else None,
                                              args.offset, args.limit, args.task_id, args.skill,
                                              args.state, args.assessment_filter), indent=2))
            return 0
        if not args.skill or not args.repo:
            parser.error("recording requires --skill and --repo")
        command = args.command[1:] if args.command[:1] == ["--"] else args.command
        code, record, data = invoke(args.skill, args.repo, command, args.ledger_dir, args.cli,
                                    args.timeout_seconds, args.task_id, args.parent_id, args.agent)
        if data:
            sys.stdout.buffer.write(data)
        if record["failure_reason"]:
            print(record["failure_reason"]["message"], file=sys.stderr)
        print("CodeVetter invocation " + record["invocation_id"] + ": " + record["state"], file=sys.stderr)
        print("Evidence: " + str(args.ledger_dir / record["invocation_id"] / "invocation.json"), file=sys.stderr)
        return code
    except (OSError, ValueError) as error:
        print("Invocation recorder: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
