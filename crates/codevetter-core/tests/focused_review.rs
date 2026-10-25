#![cfg(all(unix, feature = "browser-agent"))]

use serde_json::Value;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;

fn git(repo: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(repo)
        .output()
        .expect("git fixture");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn focused_review_executes_correctness_skips_measurement_and_blocks_recursive_review() {
    let root = tempfile::tempdir().expect("fixture");
    let repo = root.path().join("repo");
    let bin = root.path().join("bin");
    std::fs::create_dir_all(repo.join("test")).unwrap();
    std::fs::create_dir(&bin).unwrap();
    std::fs::write(repo.join("source.mjs"), "export const value = 1;\n").unwrap();
    std::fs::write(repo.join("test/source.test.mjs"),
        "import test from 'node:test'; import assert from 'node:assert/strict'; import {value} from '../source.mjs'; test('candidate value', () => assert.equal(value, 2));\n").unwrap();
    std::fs::write(repo.join("test/source.performance.test.mjs"),
        "import {writeFileSync} from 'node:fs'; writeFileSync('PERF_RAN', 'unexpected'); throw new Error('must not profile');\n").unwrap();
    git(&repo, &["init", "--initial-branch", "main"]);
    git(&repo, &["config", "user.name", "Fixture"]);
    git(&repo, &["config", "user.email", "fixture@example.test"]);
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "-m", "baseline"]);
    std::fs::write(repo.join("source.mjs"), "export const value = 2;\n").unwrap();
    git(&repo, &["add", "source.mjs"]);
    git(&repo, &["commit", "-m", "candidate"]);

    // A local fixture executor verifies the worker role without any provider call.
    let calls = root.path().join("provider-calls");
    let fake = bin.join("claude");
    std::fs::write(&fake, r#"#!/bin/sh
[ "$CODEVETTER_REVIEWER" = "1" ] || exit 19
printf 'called\n' >> "$CODEVETTER_TEST_CALLS"
printf '%s\n' '{"findings":[],"score":100,"summary":"Fixture review complete","talk":{"files_read":["source.mjs"],"files_modified":[],"actions_summary":"Read fixture","unfinished_work":null,"key_decisions":"No defects","recommended_next_steps":"None"}}'
"#).unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let path = std::env::join_paths(std::iter::once(bin).chain(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    )))
    .unwrap();
    let command = || {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_codevetter"));
        // This isolated author fixture uses only the fake executor above. The
        // blocked cases explicitly restore the worker marker below.
        cmd.current_dir(&repo)
            .env_remove("CODEVETTER_REVIEWER")
            .env("PATH", &path)
            .env("CODEVETTER_APP_DATA_DIR", root.path().join("data"))
            .env("CODEVETTER_TEST_CALLS", &calls)
            .args([
                "check",
                "--range",
                "HEAD^..HEAD",
                "--task",
                "Preserve the candidate value",
                "--test-adapter",
                "node-test",
                "--test-target",
                "test/source.test.mjs",
                "--skip-performance",
                "--agent",
                "claude",
                "--json",
            ]);
        cmd
    };
    let output = command().output().expect("focused check");
    assert!(
        output.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let receipt: Value = serde_json::from_slice(&output.stdout).expect("canonical receipt");
    assert_eq!(receipt["verdict"], "passed_with_limits");
    assert_eq!(receipt["stages"]["correctness"]["status"], "passed");
    assert_eq!(receipt["stages"]["performance"]["status"], "skipped");
    assert_eq!(receipt["stages"]["optimization"]["status"], "skipped");
    assert!(receipt["stages"]["performance"]["target"].is_null());
    assert!(!repo.join("PERF_RAN").exists());
    let prior_calls = std::fs::read(&calls).expect("fixture review executed");
    assert!(!prior_calls.is_empty());

    let blocked = command().env("CODEVETTER_REVIEWER", "1").output().unwrap();
    assert!(!blocked.status.success());
    assert!(String::from_utf8_lossy(&blocked.stderr).contains("cannot launch nested"));
    assert_eq!(std::fs::read(&calls).unwrap(), prior_calls);

    let fix_data = root.path().join("blocked-fix-data");
    let blocked_fix = Command::new(env!("CARGO_BIN_EXE_codevetter"))
        .current_dir(&repo)
        .env("PATH", &path)
        .env("CODEVETTER_APP_DATA_DIR", &fix_data)
        .env("CODEVETTER_TEST_CALLS", &calls)
        .env("CODEVETTER_REVIEWER", "1")
        .args([
            "fix",
            "--operation",
            "execute",
            "--run-id",
            "fixture-run",
            "--finding",
            "fixture-finding",
            "--agent",
            "claude",
            "--confirm-run",
            "--json",
        ])
        .output()
        .unwrap();
    assert!(!blocked_fix.status.success());
    assert!(String::from_utf8_lossy(&blocked_fix.stderr).contains("cannot launch nested"));
    assert!(
        !fix_data.exists(),
        "guard must precede database/worktree creation"
    );
    assert_eq!(std::fs::read(&calls).unwrap(), prior_calls);
}
