#![cfg(feature = "browser-agent")]
use serde_json::{json, Value};
use std::process::Command;

#[test]
fn runs_reads_only_explicit_synthetic_ledger_and_fails_without_success_receipt() {
    let parent = std::env::temp_dir().canonicalize().unwrap();
    let root = tempfile::Builder::new()
        .prefix("codevetter-invocation-cli-")
        .tempdir_in(parent)
        .unwrap();
    let ledger = root.path().join("ledger");
    std::fs::create_dir(&ledger).unwrap();
    for n in [1, 2] {
        let id = format!("00000000-0000-4000-8000-{n:012}");
        let dir = ledger.join(&id);
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("invocation.json"), serde_json::to_vec(&json!({
            "schema_version":"codevetter.skill-invocation/v1", "invocation_id":id,
            "skill":"codevetter-testing", "repo_path":"/synthetic/repository", "command":"scope",
            "started_at":"2026-10-02T12:00:00Z", "state":if n == 1 {"failed"} else {"interrupted"},
            "raw_args":["PRIVATE_SENTINEL"], "stderr":"PRIVATE_SENTINEL"
        })).unwrap()).unwrap();
    }
    let invoke = |path: &std::path::Path, extra: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_codevetter"))
            .env_clear()
            .current_dir(root.path())
            .args(["runs", "--ledger"])
            .arg(path)
            .args(["--fixture", "--json"])
            .args(extra)
            .output()
            .unwrap()
    };
    let result = invoke(&ledger, &["--offset", "1", "--limit", "1"]);
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let data: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(data["schema_version"], "codevetter.invocation-events/v1");
    assert_eq!(data["total"], 2);
    assert_eq!(data["invocations"][0]["state"], "failed");
    assert_eq!(data["evidence_origin"], "synthetic_fixture");
    assert!(data["invocations"][0]["provider"].is_null());
    assert!(data["invocations"][0]["independently_verified_benefit"].is_null());
    assert!(!String::from_utf8_lossy(&result.stdout).contains("PRIVATE_SENTINEL"));
    let filtered = invoke(&ledger, &["--state", "interrupted"]);
    assert_eq!(
        serde_json::from_slice::<Value>(&filtered.stdout).unwrap()["total"],
        1
    );
    let failed = invoke(&root.path().join("missing"), &[]);
    assert!(!failed.status.success());
    assert!(failed.stdout.is_empty());
    assert!(
        String::from_utf8_lossy(&failed.stderr).contains("unavailable_or_unsafe_ledger_directory")
    );
    assert!(!root.path().join("codevetter.db").exists());
}
