#![cfg(feature = "browser-agent")]

use std::path::Path;
use std::process::Command;

fn git(repo: &Path, args: &[&str]) {
    assert!(Command::new("git")
        .args(args)
        .current_dir(repo)
        .status()
        .unwrap()
        .success());
}

fn preflight(repo: &Path) -> serde_json::Value {
    let output = Command::new(env!("CARGO_BIN_EXE_codevetter"))
        // This inert preflight fixture never launches a reviewer or project code.
        .env_remove("CODEVETTER_REVIEWER")
        .args([
            "check",
            "--preflight",
            "--range",
            "HEAD^..HEAD",
            "--task",
            "check portable prerequisites",
            "--agent",
            "codex",
            "--test-adapter",
            "vitest",
            "--test-target",
            "target.test.mjs",
            "--json",
            "--repo",
        ])
        .arg(repo)
        .output()
        .unwrap();
    serde_json::from_slice(&output.stdout).expect("canonical preflight receipt")
}

#[test]
fn missing_runner_is_no_confidence_and_inert_runner_can_be_resolved_without_execution() {
    let fixture = tempfile::tempdir().unwrap();
    let repo = fixture.path();
    git(repo, &["init", "-q"]);
    git(repo, &["config", "user.name", "Contract Fixture"]);
    git(repo, &["config", "user.email", "fixture@example.invalid"]);
    std::fs::write(
        repo.join("target.test.mjs"),
        "throw new Error('must not run');\n",
    )
    .unwrap();
    git(repo, &["add", "."]);
    git(repo, &["commit", "-qm", "baseline"]);
    std::fs::write(
        repo.join("target.test.mjs"),
        "throw new Error('still must not run');\n",
    )
    .unwrap();
    git(repo, &["add", "."]);
    git(repo, &["commit", "-qm", "candidate"]);
    let missing = preflight(repo);
    assert_eq!(missing["status"], "no_confidence");
    assert!(missing["limitations"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value.as_str().unwrap().contains("Executable prerequisites")));
    std::fs::create_dir_all(repo.join("node_modules/vitest")).unwrap();
    std::fs::write(
        repo.join("node_modules/vitest/vitest.mjs"),
        "throw new Error('runner must not run');\n",
    )
    .unwrap();
    git(repo, &["add", "-f", "node_modules/vitest/vitest.mjs"]);
    git(repo, &["commit", "-qm", "inert runner fixture"]);
    let ready = preflight(repo);
    assert_eq!(ready["status"], "ready");
}
