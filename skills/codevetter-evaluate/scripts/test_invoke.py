import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor

SCRIPT = Path(__file__).with_name("invoke.py")
spec = importlib.util.spec_from_file_location("invoke", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InvocationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.ledger = self.root / "ledger"

    def tearDown(self):
        self.temporary.cleanup()

    def fake_cli(self, body):
        path = self.root / "codevetter"
        path.write_text("#!" + sys.executable + "\n" + body)
        path.chmod(0o700)
        return str(path)

    def run_recorder(self, cli, extra=None, command=None):
        return subprocess.run([sys.executable, str(SCRIPT), "--skill", "codevetter-review",
                               "--repo", str(self.repo), "--ledger-dir", str(self.ledger),
                               "--cli", cli, *(extra or []), "--", *(command or ["check", "--json"])],
                              capture_output=True, text=True, timeout=15)

    def rows(self):
        return module.list_invocations(self.ledger)["invocations"]

    def test_preserves_receipt_and_excludes_task_and_arguments_from_index(self):
        cli = self.fake_cli('import json\nprint(json.dumps({"schema_version":"fixture/v1", "verdict":"needs_attention"}))\n')
        result = self.run_recorder(cli, command=["check", "--task", "private-task-marker", "--json"])
        self.assertEqual(result.returncode, 0)
        row = self.rows()[0]
        self.assertEqual(row["state"], "completed")
        self.assertEqual(row["assessment"], "unassessed")
        self.assertEqual(Path(row["receipt_path"]).read_text(), result.stdout)
        self.assertNotIn("private-task-marker", json.dumps(row))
        self.assertEqual(Path(row["receipt_path"]).stat().st_mode & 0o777, 0o600)

    def test_failure_receipt_is_retained_and_exit_status_preserved(self):
        cli = self.fake_cli('import sys\nprint(\'{"schema_version":"fixture/v1","verdict":"failed"}\')\nsys.exit(1)\n')
        result = self.run_recorder(cli)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.rows()[0]["state"], "failed")
        self.assertIsNotNone(self.rows()[0]["receipt_sha256"])

    def test_missing_cli_remains_visible(self):
        result = self.run_recorder(str(self.root / "missing"))
        self.assertEqual(result.returncode, 127)
        self.assertEqual(self.rows()[0]["state"], "unavailable")
        self.assertIsNone(self.rows()[0]["receipt_path"])

    def test_invalid_output_is_not_retained(self):
        cli = self.fake_cli('print("private-non-receipt-output")\n')
        result = self.run_recorder(cli)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.rows()[0]["state"], "failed")
        self.assertEqual(self.rows()[0]["cli_exit_code"], 0)
        self.assertEqual(result.stdout, "")
        self.assertFalse(list(self.ledger.glob("*/*.tmp")))
        self.assertNotIn("private-non-receipt-output", json.dumps(self.rows()))

    def test_timeout_reaps_owned_cli_and_persists_terminal_state(self):
        cli = self.fake_cli('import os,time\nfrom pathlib import Path\nPath("pid").write_text(str(os.getpid()))\ntime.sleep(30)\n')
        result = self.run_recorder(cli, extra=["--timeout-seconds", "1"])
        self.assertEqual(result.returncode, 124)
        self.assertEqual(self.rows()[0]["state"], "timed_out")
        with self.assertRaises(ProcessLookupError):
            os.kill(int((self.repo / "pid").read_text()), 0)

    def test_interruption_is_recorded(self):
        cli = self.fake_cli('import time\nfrom pathlib import Path\nPath("ready").write_text("ready")\ntime.sleep(30)\n')
        process = subprocess.Popen([sys.executable, str(SCRIPT), "--skill", "codevetter-testing",
                                    "--repo", str(self.repo), "--ledger-dir", str(self.ledger),
                                    "--cli", cli, "--", "scope", "--json"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 5
            while not (self.repo / "ready").exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue((self.repo / "ready").exists())
            process.send_signal(signal.SIGINT)
            process.communicate(timeout=12)
            self.assertEqual(process.returncode, 130)
            self.assertEqual(self.rows()[0]["state"], "interrupted")
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_concurrent_invocations_and_pagination(self):
        cli = self.fake_cli('print(\'{"schema_version":"fixture/v1"}\')\n')
        with ThreadPoolExecutor(max_workers=3) as executor:
            results = list(executor.map(lambda _: self.run_recorder(cli), range(5)))
        self.assertTrue(all(result.returncode == 0 for result in results))
        first = module.list_invocations(self.ledger, self.repo, limit=2)
        second = module.list_invocations(self.ledger, self.repo, offset=2, limit=3)
        self.assertEqual(first["total"], 5)
        identities = [row["invocation_id"] for row in first["invocations"] + second["invocations"]]
        self.assertEqual(len(set(identities)), 5)
        self.assertEqual(module.list_invocations(self.ledger, self.root / "other")["total"], 0)

    def test_incomplete_metadata_stays_explicit(self):
        bad = self.ledger / "bad"
        bad.mkdir(parents=True)
        (bad / "invocation.json").write_text('{"schema_version":"codevetter.skill-invocation/v1"}')
        self.assertEqual(module.list_invocations(self.ledger)["unreadable_records"], 1)

    def test_launcher_symlink_executes_the_canonical_binary(self):
        cli = self.fake_cli('import json,sys\nprint(json.dumps({"schema_version":"fixture/v1", "executable":sys.argv[0]}))\n')
        launcher = self.root / "launcher"
        launcher.symlink_to(cli)
        result = self.run_recorder(str(launcher))
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["executable"], str(Path(cli).resolve()))

    def test_duplicate_and_equals_operations_are_rejected(self):
        cli = self.fake_cli('raise RuntimeError("must not execute")\n')
        for command in [["scenario", "--operation", "inspect", "--operation", "cleanup", "--json"],
                        ["warm", "--operation=cleanup", "--json"]]:
            with self.subTest(command=command):
                self.assertEqual(self.run_recorder(cli, command=command).returncode, 2)
                self.assertFalse(self.ledger.exists())

    def test_structured_failure_does_not_retain_stderr(self):
        cli = self.fake_cli('import sys\nprint("codevetter: Local check requires a clean checkout private-stderr-marker", file=sys.stderr)\nsys.exit(2)\n')
        result = self.run_recorder(cli)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.rows()[0]["failure_reason"]["code"], "dirty_checkout")
        self.assertNotIn("private-stderr-marker", json.dumps(self.rows()) + result.stderr)
        self.assertFalse(list(self.ledger.glob("*/*.tmp")))

    def test_oversized_output_is_rejected(self):
        cli = self.fake_cli('print("x" * (2 * 1024 * 1024 + 1))\n')
        self.assertEqual(self.run_recorder(cli).returncode, 2)
        self.assertEqual(self.rows()[0]["state"], "output_limit")
        self.assertIsNone(self.rows()[0]["receipt_path"])

    def test_assessment_cli_closes_the_log_and_listing_projects_it(self):
        cli = self.fake_cli('print(\'{"schema_version":"fixture/v1","result":{"selected":"checkout.test.mjs"}}\')\n')
        self.assertEqual(self.run_recorder(cli).returncode, 0)
        identity = self.rows()[0]["invocation_id"]
        result = subprocess.run([sys.executable, str(SCRIPT), "--ledger-dir", str(self.ledger),
                                 "--assess", identity, "--outcome", "helped", "--reason", "target_discovered",
                                 "--summary", "Located the relevant checkout test, which was selected for verification.",
                                 "--evidence-pointer", "/result/selected"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["outcome"], "helped")
        self.assertEqual(self.rows()[0]["assessment"], "helped")
        self.assertEqual(self.rows()[0]["usefulness"]["provenance"], "agent_reported")

    def test_cleanup_rejected_before_execution(self):
        cli = self.fake_cli('raise RuntimeError("must not execute")\n')
        result = self.run_recorder(cli, command=["warm", "--operation", "cleanup", "--json"])
        self.assertEqual(result.returncode, 2)
        self.assertFalse(self.ledger.exists())


if __name__ == "__main__":
    unittest.main()
