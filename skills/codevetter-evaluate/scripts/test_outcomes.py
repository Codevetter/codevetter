import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from invoke import list_invocations, now, write_metadata
from outcomes import record_assessment


class UsefulnessTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.identity = str(uuid4())
        self.directory = self.root / self.identity
        self.directory.mkdir()
        raw = b'{"schema_version":"fixture/v1","result":{"failure":{"test":"checkout rejects invalid input"}},"limitations":[]}'
        (self.directory / "receipt.json").write_bytes(raw)
        self.metadata = {"schema_version": "codevetter.skill-invocation/v1", "invocation_id": self.identity,
                         "started_at": now(), "state": "failed", "duration_ms": 123,
                         "receipt_sha256": hashlib.sha256(raw).hexdigest(), "assessment": "unassessed"}
        write_metadata(self.directory / "invocation.json", self.metadata)

    def tearDown(self):
        self.temporary.cleanup()

    def assess(self, outcome="helped", pointers=None):
        return record_assessment(self.root, self.identity, outcome, "bug_caught",
                                 "The check reproduced the invalid-input failure and identified its assertion.",
                                 ["/result/failure"] if pointers is None else pointers, now, write_metadata)

    def test_failed_check_can_report_useful_reproduction_without_independent_credit(self):
        assessment = self.assess()
        self.assertEqual(assessment["provenance"], "agent_reported")
        self.assertFalse(assessment["independently_verified"])
        self.assertEqual(assessment["invocation_duration_ms"], 123)
        self.assertIsNone(assessment["measured_cost_usd"])
        self.assertEqual(assessment["evidence"][0]["receipt_sha256"], self.metadata["receipt_sha256"])
        listing = list_invocations(self.root)
        self.assertEqual(listing["invocations"][0]["assessment"], "helped")
        self.assertEqual(listing["invocations"][0]["usefulness"]["summary"], assessment["summary"])

    def test_helped_requires_nonempty_resolving_evidence(self):
        for pointers in [[], ["/missing"], ["/limitations"]]:
            with self.subTest(pointers=pointers), self.assertRaises(ValueError):
                self.assess(pointers=pointers)
        self.assertFalse((self.directory / "assessments").exists())

    def test_changed_receipt_rejects_claim(self):
        (self.directory / "receipt.json").write_text('{"result":{"failure":"changed"}}')
        with self.assertRaisesRegex(ValueError, "identity changed"):
            self.assess()

    def test_blocked_without_receipt_can_log_a_reason(self):
        (self.directory / "receipt.json").unlink()
        assessment = self.assess(outcome="blocked", pointers=[])
        self.assertEqual(assessment["evidence"], [])
        self.assertEqual(assessment["outcome"], "blocked")

    def test_revision_appends_history_and_preserves_invocation(self):
        original = (self.directory / "invocation.json").read_bytes()
        first = self.assess()
        second = self.assess(outcome="did_not_help", pointers=[])
        self.assertNotEqual(first["assessment_id"], second["assessment_id"])
        self.assertEqual(len(list((self.directory / "assessments").glob("*.json"))), 2)
        self.assertEqual((self.directory / "invocation.json").read_bytes(), original)
        self.assertEqual(list_invocations(self.root)["invocations"][0]["assessment"], "did_not_help")

    def test_incomplete_execution_cannot_be_counted_as_helped(self):
        for state in ["running", "unavailable", "timed_out", "interrupted", "output_limit"]:
            self.metadata["state"] = state
            write_metadata(self.directory / "invocation.json", self.metadata)
            with self.subTest(state=state), self.assertRaises(ValueError):
                self.assess()

    def test_empty_or_oversized_explanation_rejected(self):
        for summary in ["", "x" * 2001]:
            with self.subTest(summary_size=len(summary)), self.assertRaises(ValueError):
                record_assessment(self.root, self.identity, "inconclusive", "other", summary, [], now, write_metadata)

    def test_invalid_identity_does_not_read_outside_the_ledger(self):
        with self.assertRaises(ValueError):
            record_assessment(self.root, "../other", "blocked", "setup_blocked", "Blocked", [], now, write_metadata)


if __name__ == "__main__":
    unittest.main()
