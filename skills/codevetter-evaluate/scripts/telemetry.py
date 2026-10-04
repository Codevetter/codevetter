"""Bounded execution context and hash-checked, narrowly addressed evidence."""
import hashlib
import json
import platform
from pathlib import Path
import subprocess
from uuid import UUID

from outcomes import assessment_history, invocation_directory, read_record, resolve_pointer

MAX_RECEIPT_BYTES = 2 * 1024 * 1024


def validate_id(value):
    if value is not None and str(UUID(value)) != value:
        raise ValueError("correlation identifiers must be canonical UUIDs")
    return value


def source_context(repo):
    """Observe Git identity without retaining filenames, diffs or file contents."""
    context = {"head": None, "dirty": None, "dirty_entry_count": None,
               "status": "unavailable", "dirty_contents_captured": False}
    try:
        def git(*args):
            return subprocess.run(["git", "--no-optional-locks", "-c", "core.fsmonitor=false",
                                   "-C", str(repo), *args], capture_output=True, timeout=2,
                                  stdin=subprocess.DEVNULL)
        head = git("rev-parse", "--verify", "HEAD")
        if head.returncode == 0:
            value = head.stdout.decode("ascii").strip()
            if len(value) in (40, 64) and all(char in "0123456789abcdef" for char in value):
                context["head"] = value
        status = git("status", "--porcelain=v1", "-z", "--untracked-files=normal")
        if status.returncode == 0:
            entries = status.stdout.split(b"\0")
            count, position = 0, 0
            while position < len(entries) and entries[position]:
                entry = entries[position]
                count += 1
                position += 2 if b"R" in entry[:2] or b"C" in entry[:2] else 1
            context.update(dirty=bool(count), dirty_entry_count=count, status="observed")
    except (OSError, subprocess.TimeoutExpired, UnicodeError):
        pass
    return context


def file_fingerprint(path):
    """Hash a bounded executable; disclose unavailable fingerprints explicitly."""
    result = {"path": str(path), "sha256": None, "size_bytes": None, "status": "unavailable"}
    try:
        result["size_bytes"] = path.stat().st_size
        if result["size_bytes"] > 64 * 1024 * 1024:
            result["status"] = "size_limit"
            return result
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for _ in range(1025):
                chunk = source.read(64 * 1024)
                if not chunk:
                    result.update(sha256=digest.hexdigest(), status="observed")
                    return result
                digest.update(chunk)
        result["status"] = "size_limit"
    except OSError:
        pass
    return result


def execution_context(repo, executable, timeout_seconds):
    folder = Path(__file__).parent
    digest = hashlib.sha256()
    for name in ("invoke.py", "outcomes.py", "telemetry.py"):
        digest.update(name.encode())
        digest.update((folder / name).read_bytes())
    return {"source_before": source_context(repo), "source_after": None,
            "cli": file_fingerprint(executable) if executable else None,
            "recorder_sha256": digest.hexdigest(), "platform": platform.system(),
            "architecture": platform.machine(), "python_version": platform.python_version(),
            "timeout_seconds": timeout_seconds, "capture_limit_bytes": MAX_RECEIPT_BYTES,
            "shell": False, "arguments_retained": False}


def validate_parent(root, parent_id, repo, task_id):
    if parent_id is None:
        return
    directory = invocation_directory(root, parent_id)
    parent = read_record(directory / "invocation.json")
    if (parent.get("schema_version") != "codevetter.skill-invocation/v1"
            or parent.get("invocation_id") != parent_id
            or parent.get("repo_path") != str(repo)
            or parent.get("task_id") != task_id):
        raise ValueError("parent must belong to the same repository and task")


def inspect_invocation(root, invocation_id, pointer=None):
    directory = invocation_directory(root, invocation_id)
    record = read_record(directory / "invocation.json")
    if (record.get("schema_version") != "codevetter.skill-invocation/v1"
            or record.get("invocation_id") != invocation_id):
        raise ValueError("invocation identity or schema mismatch")
    receipt, integrity = None, "not_recorded"
    if record.get("receipt_sha256") is not None:
        path = directory / "receipt.json"
        if path.is_symlink() or path.stat().st_size > MAX_RECEIPT_BYTES:
            raise ValueError("unsafe or oversized canonical receipt")
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != record["receipt_sha256"]:
            raise ValueError("canonical receipt identity changed")
        receipt = json.loads(raw)
        integrity = "verified"
    if pointer is not None:
        if receipt is None:
            raise ValueError("invocation has no canonical receipt to inspect")
        try:
            value = resolve_pointer(receipt, pointer, require_nonempty=False)
        except (KeyError, IndexError, TypeError) as error:
            raise ValueError("evidence pointer does not resolve") from error
        return {"schema_version": "codevetter.skill-evidence-field/v1",
                "invocation_id": invocation_id, "receipt_sha256": record["receipt_sha256"],
                "receipt_integrity": integrity, "json_pointer": pointer, "value": value}
    history, errors = assessment_history(directory)
    return {"schema_version": "codevetter.skill-invocation-detail/v1", "invocation": record,
            "receipt_integrity": integrity, "receipt": receipt, "assessments": history,
            "unreadable_assessments": errors,
            "limitations": ["Usefulness is agent-reported; receipt integrity does not independently verify the claim.",
                            "Legacy context is unknown; dirty file contents and raw arguments are not captured."]}
