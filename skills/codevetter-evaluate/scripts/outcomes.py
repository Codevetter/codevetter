"""Agent-reported usefulness, kept separate from canonical CodeVetter verdicts."""
import hashlib
import json
import re
from pathlib import Path
from uuid import UUID, uuid4

OUTCOMES = {"helped", "did_not_help", "inconclusive", "blocked"}
REASONS = {"bug_caught", "missing_test_found", "fix_verified", "performance_measured",
           "regression_detected", "unsupported_claim_rejected", "target_discovered",
           "duplicate_information", "noise", "unactionable_result", "setup_blocked",
           "incomplete_evidence", "other"}
MAX_METADATA_BYTES = 16 * 1024


def invocation_directory(root, invocation_id):
    if str(UUID(invocation_id)) != invocation_id or root.is_symlink():
        raise ValueError("invalid invocation identity or ledger path")
    directory = root.resolve() / invocation_id
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("invocation is unavailable")
    return directory


def read_record(path):
    if path.is_symlink() or path.stat().st_size > MAX_METADATA_BYTES:
        raise ValueError("unsafe or oversized metadata")
    record = json.loads(path.read_text())
    if not isinstance(record, dict):
        raise ValueError("metadata must be an object")
    return record


def resolve_pointer(value, pointer, require_nonempty=True):
    if not pointer.startswith("/") or len(pointer) > 512:
        raise ValueError("evidence pointer must be a bounded JSON pointer")
    for component in pointer[1:].split("/"):
        if re.search(r"~(?![01])", component):
            raise ValueError("invalid evidence pointer escape")
        component = component.replace("~1", "/").replace("~0", "~")
        if isinstance(value, list):
            if not re.fullmatch(r"0|[1-9][0-9]*", component):
                raise ValueError("invalid evidence array index")
            value = value[int(component)]
        elif isinstance(value, dict):
            value = value[component]
        else:
            raise ValueError("evidence pointer does not resolve")
    if require_nonempty and (value is None or value == [] or value == {} or value == ""):
        raise ValueError("evidence pointer resolves to empty evidence")
    return value


def record_assessment(root, invocation_id, outcome, reason, summary, pointers, now, write_metadata):
    if outcome not in OUTCOMES or reason not in REASONS:
        raise ValueError("unsupported usefulness outcome or reason")
    summary = summary.strip()
    if not summary or len(summary.encode()) > 2000:
        raise ValueError("a short usefulness explanation is required (1-2000 bytes)")
    if len(pointers) > 8 or len(set(pointers)) != len(pointers):
        raise ValueError("use at most eight unique evidence pointers")
    directory = invocation_directory(root, invocation_id)
    invocation = read_record(directory / "invocation.json")
    if invocation.get("schema_version") != "codevetter.skill-invocation/v1" or invocation.get("invocation_id") != invocation_id:
        raise ValueError("invocation identity or schema mismatch")
    if invocation.get("state") == "running":
        raise ValueError("usefulness is assessed only after execution finishes")
    evidence = []
    if pointers:
        receipt_path = directory / "receipt.json"
        if receipt_path.is_symlink() or receipt_path.stat().st_size > 2 * 1024 * 1024:
            raise ValueError("unsafe or oversized canonical receipt")
        raw = receipt_path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest != invocation.get("receipt_sha256"):
            raise ValueError("canonical receipt identity changed")
        receipt = json.loads(raw)
        try:
            for pointer in pointers:
                resolve_pointer(receipt, pointer)
                evidence.append({"receipt_sha256": digest, "json_pointer": pointer})
        except (KeyError, IndexError, TypeError) as error:
            raise ValueError("evidence pointer does not resolve") from error
    if outcome == "helped" and not evidence:
        raise ValueError("helped requires a pointer to nonempty canonical evidence")
    if outcome == "helped" and invocation.get("state") in {"unavailable", "interrupted", "timed_out", "output_limit"}:
        raise ValueError("an incomplete invocation cannot be reported as helped")
    assessments = directory / "assessments"
    if assessments.is_symlink():
        raise ValueError("assessment directory must not be a symlink")
    assessments.mkdir(mode=0o700, exist_ok=True)
    assessment = {"schema_version": "codevetter.skill-usefulness/v1", "assessment_id": str(uuid4()),
                  "invocation_id": invocation_id, "recorded_at": now(), "outcome": outcome,
                  "reason": reason, "summary": summary, "provenance": "agent_reported",
                  "independently_verified": False, "evidence": evidence,
                  "invocation_duration_ms": invocation.get("duration_ms"),
                  "context_capture_ms": invocation.get("context_capture_ms"),
                  "measured_cost_usd": None}
    write_metadata(assessments / (assessment["assessment_id"] + ".json"), assessment)
    return assessment


def assessment_history(directory):
    """Read retained revisions, newest first; disclose unreadable annotations."""
    records, unreadable = [], 0
    folder = directory / "assessments"
    if folder.is_symlink():
        return [], 1
    for path in folder.glob("*.json"):
        try:
            record = read_record(path)
            if (record.get("schema_version") != "codevetter.skill-usefulness/v1"
                    or record.get("invocation_id") != directory.name
                    or record.get("outcome") not in OUTCOMES
                    or not isinstance(record.get("recorded_at"), str)
                    or not isinstance(record.get("assessment_id"), str)):
                raise ValueError("invalid assessment record")
            records.append(record)
        except (OSError, ValueError):
            unreadable += 1
    records.sort(key=lambda row: (row["recorded_at"], row["assessment_id"]), reverse=True)
    return records, unreadable


def latest_assessment(directory):
    records, unreadable = assessment_history(directory)
    return (records[0] if records else None), unreadable
