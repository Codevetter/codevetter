import json
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from mcp import Server


class PluginContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.ledger = self.root / "ledger"
        self.cli = self.root / "fake-cli"
        self.cli.write_text('#!/usr/bin/env python3\nimport json, sys\nprint(json.dumps({"schema_version":"fixture/v1","candidates":[{"target":"unit.test.mjs"}],"argv":sys.argv[1:]}))\n')
        self.cli.chmod(0o700)
        self.server = Server(self.ledger, str(self.cli))
        self.args = {"repo": str(self.repo), "consumer": "testing", "flow": "plugin behavior",
                     "task_id": str(uuid4()), "agent": "codex"}

    def test_recorded_discovery_surgical_access_assessment_and_tamper(self):
        result = self.server.call("discover_targets", self.args)
        identity = result["invocation"]["invocation_id"]
        self.assertEqual(result["exit_code"], 0)
        self.assertEqual(result["invocation"]["skill"], "codevetter-testing")
        self.assertNotIn("plugin behavior", (self.ledger / identity / "invocation.json").read_text())
        detail = self.server.call("inspect_invocation", {"invocation_id": identity, "pointer": "/candidates"})
        self.assertIn("unit.test.mjs", json.dumps(detail))
        assessment = self.server.call("assess_invocation", {
            "invocation_id": identity, "outcome": "did_not_help", "reason": "noise",
            "summary": "Fixture discovery is qualification only, not an agent benefit."})
        self.assertFalse(assessment["independently_verified"])
        page = self.server.call("list_invocations", {"task_id": self.args["task_id"], "assessment": "did_not_help", "offset": 1, "limit": 1})
        self.assertEqual(page["total"], 1)
        self.assertEqual(page["invocations"], [])
        receipt = self.ledger / identity / "receipt.json"
        receipt.write_text('{"candidates":["changed"]}')
        with self.assertRaises(ValueError):
            self.server.call("inspect_invocation", {"invocation_id": identity})
        with self.assertRaises(ValueError):
            self.server.call("assess_invocation", {"invocation_id": identity, "outcome": "helped",
                             "reason": "target_discovered", "summary": "invalid", "evidence_pointers": ["/candidates"]})

    def test_missing_executor_stays_visible_and_can_be_closed_as_blocked(self):
        self.server.cli = str(self.root / "missing")
        result = self.server.call("discover_targets", self.args)
        self.assertEqual(result["invocation"]["state"], "unavailable")
        identity = result["invocation"]["invocation_id"]
        self.server.call("assess_invocation", {"invocation_id": identity, "outcome": "blocked",
                         "reason": "setup_blocked", "summary": "Fixture executable unavailable."})
        self.assertEqual(self.server.call("list_invocations", {"state": "unavailable"})["total"], 1)

    def test_closed_schema_refuses_execution_flags_and_invalid_selectors(self):
        for extra in ({"operation": "diagnose"}, {"flow": "--operation"}, {"change": "main..HEAD"}, {"consumer": "review"}, {"agent": "invented"}):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                self.server.call("discover_targets", {**self.args, **extra})
        for limit in (True, 0, 101, "5"):
            with self.assertRaises(ValueError):
                self.server.call("list_invocations", {"limit": limit})
        self.assertFalse(self.ledger.exists())

    def test_performance_plan_contains_no_runtime_operation_and_rejects_escape(self):
        target = self.repo / "unit.test.mjs"
        target.write_text("// fixture")
        args = {"repo": str(self.repo), "target": target.name, "adapter": "node-test",
                "task_id": str(uuid4()), "agent": "codex"}
        result = self.server.call("plan_performance", args)
        self.assertEqual(result["receipt"]["argv"][:3], ["performance", "--operation", "plan"])
        for path in ("../fake-cli", str(self.cli), "--operation"):
            with self.assertRaises(ValueError):
                self.server.call("plan_performance", {**args, "target": path})
        (self.repo / "escape").symlink_to(self.cli)
        with self.assertRaises(ValueError):
            self.server.call("plan_performance", {**args, "target": "escape"})

    def test_protocol_notifications_unknown_tools_and_private_errors(self):
        self.assertIsNone(self.server.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}))
        self.assertEqual(self.server.handle({"jsonrpc": "2.0", "id": 0, "method": "initialize"})["id"], 0)
        request = {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                   "params": {"name": "shell", "arguments": {"command": "private-prompt"}}}
        response = self.server.handle(request)
        self.assertTrue(response["result"]["isError"])
        self.assertNotIn("private-prompt", json.dumps(response))
        self.assertEqual(self.server.handle({"jsonrpc": "2.0", "id": 4, "method": "exec"})["error"]["code"], -32601)


if __name__ == "__main__":
    unittest.main()
