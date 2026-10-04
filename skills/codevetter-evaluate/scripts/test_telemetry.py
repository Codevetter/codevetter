import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from invoke import invoke, list_invocations, now, write_metadata
from outcomes import record_assessment
from telemetry import inspect_invocation, source_context

SCRIPT = Path(__file__).with_name("invoke.py")


class TelemetryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.ledger = self.root / "ledger"
        self.cli = self.root / "codevetter"
        self.cli.write_text("#!" + sys.executable + '\nprint(\'{"schema_version":"fixture/v1",'
                            '"result":{"value":false,"empty":[],"a/b":{"~key":[42]}}}\')\n')
        self.cli.chmod(0o700)
        self.task_id = str(uuid4())

    def tearDown(self):
        self.temporary.cleanup()

    def record(self, **kwargs):
        code, record, _ = invoke("codevetter-testing", self.repo, ["scope", "--json"],
                                  self.ledger, str(self.cli), task_id=self.task_id, **kwargs)
        self.assertEqual(code, 0)
        return record

    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), "--ledger-dir", str(self.ledger),
                               *args], capture_output=True, text=True, timeout=10)

    def test_fingerprints_disclose_source_changes_without_retaining_contents(self):
        def git(*args):
            return subprocess.check_output(["git", "-C", str(self.repo), *args], stderr=subprocess.DEVNULL)
        git("init", "-b", "main")
        source = self.repo / "private-filename"
        source.write_text("private-source-content")
        git("add", ".")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
            "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture")
        self.cli.write_text(self.cli.read_text() + '\nfrom pathlib import Path\nPath("private-filename").write_text("modified")\n')
        record = self.record(agent="codex")
        context = record["context"]
        self.assertEqual(context["source_before"]["head"], git("rev-parse", "HEAD").decode().strip())
        self.assertFalse(context["source_before"]["dirty"])
        self.assertTrue(context["source_after"]["dirty"])
        self.assertEqual(context["source_after"]["dirty_entry_count"], 1)
        self.assertFalse(context["source_after"]["dirty_contents_captured"])
        self.assertEqual(context["cli"]["sha256"], hashlib.sha256(self.cli.read_bytes()).hexdigest())
        self.assertEqual(len(context["recorder_sha256"]), 64)
        self.assertEqual(context["timeout_seconds"], 1200)
        self.assertGreaterEqual(record["context_capture_ms"], 0)
        self.assertEqual(record["agent"], "codex")
        self.assertNotIn("private-filename", json.dumps(record))
        self.assertNotIn("private-source-content", json.dumps(record))

    def test_non_git_repository_keeps_unknown_source_explicit(self):
        context = source_context(self.repo)
        self.assertEqual(context["status"], "unavailable")
        self.assertIsNone(context["head"])
        self.assertIsNone(context["dirty"])

    def test_parent_links_require_same_task_repo_and_valid_identity(self):
        parent = self.record()
        child = self.record(parent_id=parent["invocation_id"])
        self.assertEqual(child["parent_invocation_id"], parent["invocation_id"])
        for task_id in (None, str(uuid4())):
            with self.subTest(task=task_id), self.assertRaises(ValueError):
                invoke("codevetter-testing", self.repo, ["scope", "--json"], self.ledger,
                       str(self.cli), task_id=task_id, parent_id=parent["invocation_id"])
        with self.assertRaises(ValueError):
            self.record(parent_id="../other")
        other = self.root / "other"
        other.mkdir()
        with self.assertRaises(ValueError):
            invoke("codevetter-testing", other, ["scope", "--json"], self.ledger,
                   str(self.cli), task_id=self.task_id, parent_id=parent["invocation_id"])
        self.assertEqual(list_invocations(self.ledger)["total"], 2)

    def test_filters_use_total_before_pagination_and_keep_unassessed(self):
        first, second = self.record(), self.record()
        record_assessment(self.ledger, first["invocation_id"], "did_not_help", "duplicate_information",
                          "Discovery repeated the target already selected.", [], now, write_metadata)
        self.task_id = str(uuid4())
        self.record()
        rows = list_invocations(self.ledger, task_id=first["task_id"], skill="codevetter-testing",
                                state="completed", limit=1)
        self.assertEqual(rows["total"], 2)
        self.assertEqual(len(rows["invocations"]), 1)
        self.assertEqual(list_invocations(self.ledger, task_id=first["task_id"],
                                         assessment="unassessed")["invocations"][0]["invocation_id"],
                         second["invocation_id"])
        result = self.run_cli("--list", "--task-id", first["task_id"], "--skill", "codevetter-testing",
                              "--state", "completed", "--assessment-filter", "did_not_help")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["total"], 1)

    def test_surgical_access_resolves_escaped_keys_false_and_empty_values(self):
        record = self.record()
        for pointer, value in [("/result/a~1b/~0key/0", 42), ("/result/value", False), ("/result/empty", [])]:
            with self.subTest(pointer=pointer):
                result = self.run_cli("--show", record["invocation_id"], "--pointer", pointer)
                self.assertEqual(result.returncode, 0, result.stderr)
                detail = json.loads(result.stdout)
                self.assertEqual(detail["value"], value)
                self.assertEqual(detail["receipt_integrity"], "verified")
                self.assertNotIn("receipt", detail)
                self.assertNotIn("invocation", detail)
        for pointer in ("/missing", "/result/a~1b/~0key/00", "/result/a~2b", "result/value"):
            with self.subTest(pointer=pointer):
                self.assertEqual(self.run_cli("--show", record["invocation_id"], "--pointer", pointer).returncode, 2)

    def test_detail_preserves_revision_history_and_original_record(self):
        record = self.record()
        for outcome in ("inconclusive", "did_not_help"):
            record_assessment(self.ledger, record["invocation_id"], outcome, "other",
                              "No new actionable information was identified.", [], now, write_metadata)
        detail = inspect_invocation(self.ledger, record["invocation_id"])
        self.assertEqual([row["outcome"] for row in detail["assessments"]], ["did_not_help", "inconclusive"])
        self.assertEqual(detail["invocation"], record)
        self.assertEqual(detail["receipt_integrity"], "verified")
        self.assertEqual(detail["assessments"][0]["context_capture_ms"], record["context_capture_ms"])

    def test_legacy_missing_context_remains_unknown(self):
        record = self.record()
        for key in ("context", "context_capture_ms", "task_id", "agent", "parent_invocation_id"):
            del record[key]
        write_metadata(self.ledger / record["invocation_id"] / "invocation.json", record)
        self.assertNotIn("context", inspect_invocation(self.ledger, record["invocation_id"])["invocation"])
        self.assertEqual(list_invocations(self.ledger)["total"], 1)
        self.assertEqual(list_invocations(self.ledger, task_id=self.task_id)["total"], 0)

    def test_changed_or_symlinked_receipts_and_invalid_identity_rejected(self):
        record = self.record()
        path = Path(record["receipt_path"])
        raw = path.read_bytes()
        path.write_bytes(raw + b"\n")
        with self.assertRaisesRegex(ValueError, "identity changed"):
            inspect_invocation(self.ledger, record["invocation_id"], "/result/value")
        path.unlink()
        target = self.root / "external.json"
        target.write_bytes(raw)
        path.symlink_to(target)
        with self.assertRaisesRegex(ValueError, "unsafe"):
            inspect_invocation(self.ledger, record["invocation_id"])
        self.assertEqual(self.run_cli("--show", "../external.json").returncode, 2)

    def test_missing_cli_context_and_no_receipt_detail_remain_visible(self):
        code, record, _ = invoke("codevetter-review", self.repo, ["check", "--json"], self.ledger,
                                  str(self.root / "missing"), task_id=self.task_id)
        self.assertEqual(code, 127)
        self.assertIsNone(record["context"]["cli"])
        detail = inspect_invocation(self.ledger, record["invocation_id"])
        self.assertEqual(detail["receipt_integrity"], "not_recorded")
        self.assertEqual(self.run_cli("--show", record["invocation_id"], "--pointer", "/result").returncode, 2)

    def test_conflicting_modes_and_orphan_filters_rejected(self):
        for args in [("--list", "--show", str(uuid4())), ("--pointer", "/result"),
                     ("--show", str(uuid4()), "--", "scope", "--json"),
                     ("--state", "failed"), ("--list", "--task-id", "private-task-text")]:
            with self.subTest(args=args):
                self.assertEqual(self.run_cli(*args).returncode, 2)
        self.assertFalse(self.ledger.exists())

    def test_unrecognized_operation_values_do_not_leak_into_metadata(self):
        code, record, _ = invoke("codevetter-testing", self.repo,
                                  ["qa", "--operation", "private-operation-marker", "--json"],
                                  self.ledger, str(self.cli))
        self.assertEqual(code, 0)
        self.assertEqual(record["operation"], "unrecognized")
        self.assertNotIn("private-operation-marker", json.dumps(record))
        self.assertEqual(record["receipt_schema_version"], "fixture/v1")

    def test_invalid_receipt_schema_is_not_retained(self):
        self.cli.write_text("#!" + sys.executable + '\nprint(\'{"schema_version":{"nested":"invalid"}}\')\n')
        code, record, _ = invoke("codevetter-testing", self.repo, ["scope", "--json"],
                                  self.ledger, str(self.cli))
        self.assertEqual(code, 2)
        self.assertIsNone(record["receipt_path"])
        self.assertIsNone(record["receipt_schema_version"])

    def test_numeric_schema_version_from_installed_scope_contract_is_retained(self):
        self.cli.write_text("#!" + sys.executable + '\nprint(\'{"schema_version":1,"candidates":[]}\')\n')
        record = self.record()
        self.assertEqual(record["receipt_schema_version"], 1)
        self.assertEqual(inspect_invocation(self.ledger, record["invocation_id"])["receipt"]["schema_version"], 1)

    def test_denied_group_signal_reaps_owned_child_and_finalizes_failure(self):
        self.cli.write_text("#!" + sys.executable + '\nimport time\nprint("x" * (2 * 1024 * 1024 + 1), flush=True)\ntime.sleep(30)\n')
        with patch("invoke.os.killpg", side_effect=PermissionError("fixture denial")):
            code, record, _ = invoke("codevetter-testing", self.repo, ["scope", "--json"],
                                      self.ledger, str(self.cli))
        self.assertEqual(code, 2)
        self.assertEqual(record["state"], "output_limit")
        self.assertIsNotNone(record["finished_at"])
        self.assertEqual(len(record["supervision_warnings"]), 1)
        self.assertEqual(list_invocations(self.ledger)["invocations"][0]["state"], "output_limit")


if __name__ == "__main__":
    unittest.main()
