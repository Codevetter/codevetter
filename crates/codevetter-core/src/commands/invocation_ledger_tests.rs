use super::*;
use serde_json::json;

// Canonicalize only the trusted temporary parent before creating our fixture.
// Production ledger paths and symlink attack paths are never canonicalized.
fn fixture_directory() -> tempfile::TempDir {
    let parent = std::env::temp_dir().canonicalize().unwrap();
    tempfile::Builder::new()
        .prefix("codevetter-invocation-")
        .tempdir_in(parent)
        .unwrap()
}

fn id(n: usize) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}
fn record(n: usize, state: &str) -> Value {
    json!({"schema_version":"codevetter.skill-invocation/v1", "invocation_id":id(n), "skill":"codevetter-testing", "repo_path":"/synthetic/repository", "task_id":id(90), "command":"scope", "agent":"codex", "started_at":"2026-10-02T12:00:00Z", "state":state, "exit_code":0, "cli_exit_code": if state == "failed" { json!(1) } else { Value::Null }, "raw_args":["PRIVATE_SENTINEL"], "stderr":"PRIVATE_SENTINEL"})
}
fn write(root: &Path, n: usize, value: &Value) -> PathBuf {
    let dir = root.join(id(n));
    std::fs::create_dir(&dir).unwrap();
    std::fs::write(
        dir.join("invocation.json"),
        serde_json::to_vec(value).unwrap(),
    )
    .unwrap();
    dir
}
fn source(root: &Path) -> InvocationLedgerSource {
    InvocationLedgerSource {
        path: root.into(),
        synthetic_fixture: true,
    }
}
fn read(root: &Path) -> InvocationLedgerReceipt {
    read_invocation_ledger(&source(root), &InvocationFilter::default(), 0, 100).unwrap()
}

#[test]
fn malformed_truncated_wrong_schema_and_identity_are_counted_without_losing_failures() {
    let root = fixture_directory();
    write(root.path(), 1, &record(1, "failed"));
    write(root.path(), 2, &record(2, "interrupted"));
    let truncated = write(root.path(), 3, &record(3, "completed"));
    std::fs::write(truncated.join("invocation.json"), b"{\"schema_version\":").unwrap();
    let mut unknown = record(4, "completed");
    unknown["schema_version"] = json!(2);
    write(root.path(), 4, &unknown);
    write(root.path(), 5, &record(6, "completed"));
    let receipt = read(root.path());
    assert_eq!(receipt.projection.total, 2);
    assert_eq!(receipt.projection.unreadable_records, 3);
    assert_eq!(receipt.projection.invocations[0].state, "interrupted");
    assert_eq!(receipt.projection.invocations[1].cli_exit_code, Some(1));
    assert_eq!(receipt.evidence_origin, "synthetic_fixture");
    let encoded = serde_json::to_string(&receipt).unwrap();
    assert!(!encoded.contains("PRIVATE_SENTINEL"));
    assert!(receipt
        .projection
        .invocations
        .iter()
        .all(|event| event.provider.is_none() && event.independently_verified_benefit.is_none()));
}

#[test]
fn deterministic_pages_and_all_filters_use_pre_pagination_totals() {
    let root = fixture_directory();
    for n in [2, 3, 1] {
        write(root.path(), n, &record(n, "failed"));
    }
    let filter = InvocationFilter {
        repo_path: Some("/synthetic/repository".into()),
        task_id: Some(id(90)),
        skill: Some("codevetter-testing".into()),
        state: Some("failed".into()),
        assessment: Some("unassessed".into()),
    };
    let a = read_invocation_ledger(&source(root.path()), &filter, 0, 1).unwrap();
    let b = read_invocation_ledger(&source(root.path()), &filter, 1, 1).unwrap();
    assert_eq!(a.projection.total, 3);
    assert_eq!(b.projection.total, 3);
    assert_eq!(a.projection.invocations[0].invocation_id, id(3));
    assert_eq!(b.projection.invocations[0].invocation_id, id(2));
    assert_eq!(
        a.projection,
        read_invocation_ledger(&source(root.path()), &filter, 0, 1)
            .unwrap()
            .projection
    );
    assert!(
        read_invocation_ledger(&source(root.path()), &filter, usize::MAX, 1)
            .unwrap()
            .projection
            .invocations
            .is_empty()
    );
    let other = InvocationFilter {
        repo_path: Some("/another/repo".into()),
        ..Default::default()
    };
    assert_eq!(
        read_invocation_ledger(&source(root.path()), &other, 0, 1)
            .unwrap()
            .projection
            .total,
        0
    );
    let data = crate::mcp::invocations::invocation_list(
        Some(&source(root.path())),
        "/synthetic/repository",
        json!({"state":"failed", "offset":1, "limit":1})
            .as_object()
            .unwrap()
            .clone(),
    )
    .unwrap();
    assert_eq!(
        data.projection,
        read_invocation_ledger(
            &source(root.path()),
            &InvocationFilter {
                repo_path: Some("/synthetic/repository".into()),
                state: Some("failed".into()),
                ..Default::default()
            },
            1,
            1
        )
        .unwrap()
        .projection
    );
}

#[test]
fn receipts_are_fixed_filename_hash_bound_and_malformed_assessments_fail_closed() {
    use sha2::{Digest, Sha256};
    let root = fixture_directory();
    let bytes = br#"{"schema_version":1,"candidates":["fixture"]}"#;
    let mut value = record(1, "completed");
    value["receipt_path"] = json!("/ignored/outside/receipt.json");
    value["receipt_sha256"] = json!(format!("{:x}", Sha256::digest(bytes)));
    value["receipt_schema_version"] = json!(1);
    let dir = write(root.path(), 1, &value);
    std::fs::write(dir.join("receipt.json"), bytes).unwrap();
    std::fs::create_dir(dir.join("assessments")).unwrap();
    std::fs::write(
        dir.join("assessments").join(format!("{}.json", id(80))),
        b"{",
    )
    .unwrap();
    let receipt = read(root.path());
    assert_eq!(
        receipt.projection.invocations[0].receipt_integrity,
        super::super::invocation_events::ReceiptIntegrity::HashMatched
    );
    assert_eq!(receipt.projection.invocations[0].assessment, "unavailable");
    assert_eq!(receipt.projection.unreadable_assessments, 1);
    std::fs::write(dir.join("receipt.json"), b"{}").unwrap();
    assert_eq!(
        read(root.path()).projection.invocations[0].receipt_integrity,
        super::super::invocation_events::ReceiptIntegrity::Changed
    );
}

#[cfg(unix)]
#[test]
fn symlink_directories_metadata_receipts_and_assessments_never_escape() {
    use std::os::unix::fs::symlink;
    let root = fixture_directory();
    let outside = fixture_directory();
    symlink(outside.path(), root.path().join(id(1))).unwrap();
    let dir = root.path().join(id(2));
    std::fs::create_dir(&dir).unwrap();
    std::fs::write(outside.path().join("private"), b"PRIVATE_SENTINEL").unwrap();
    symlink(outside.path().join("private"), dir.join("invocation.json")).unwrap();
    let mut value = record(3, "interrupted");
    value["receipt_path"] = json!("/ignored");
    value["receipt_sha256"] = json!("0".repeat(64));
    let dir = write(root.path(), 3, &value);
    symlink(outside.path().join("private"), dir.join("receipt.json")).unwrap();
    symlink(outside.path(), dir.join("assessments")).unwrap();
    let receipt = read(root.path());
    assert_eq!(receipt.projection.unreadable_records, 2);
    assert_eq!(receipt.projection.total, 1);
    assert_eq!(receipt.projection.invocations[0].state, "interrupted");
    assert_eq!(receipt.projection.invocations[0].assessment, "unavailable");
    assert_eq!(
        receipt.projection.invocations[0].receipt_integrity,
        super::super::invocation_events::ReceiptIntegrity::Unavailable
    );
    assert!(!serde_json::to_string(&receipt)
        .unwrap()
        .contains("PRIVATE_SENTINEL"));
    let linked_root = outside.path().join("linked-root");
    symlink(root.path(), &linked_root).unwrap();
    assert!(
        read_invocation_ledger(&source(&linked_root), &InvocationFilter::default(), 0, 1).is_err()
    );
}

#[test]
fn bounded_files_and_scans_do_not_claim_complete_history() {
    let root = fixture_directory();
    let dir = write(root.path(), 1, &record(1, "failed"));
    std::fs::write(dir.join("invocation.json"), vec![b' '; MAX_METADATA + 1]).unwrap();
    assert_eq!(read(root.path()).projection.unreadable_records, 1);
    let dir = write(root.path(), 2, &record(2, "failed"));
    std::fs::create_dir(dir.join("assessments")).unwrap();
    for n in 0..=MAX_ASSESSMENTS {
        std::fs::write(
            dir.join("assessments").join(format!("{}.json", id(n))),
            b"{}",
        )
        .unwrap();
    }
    assert!(
        read_invocation_ledger(&source(root.path()), &InvocationFilter::default(), 0, 1).is_err()
    );
    assert!(read_invocation_ledger(
        &source(&root.path().join("missing")),
        &InvocationFilter::default(),
        0,
        1
    )
    .is_err());
    assert!(read_invocation_ledger(
        &source(&root.path().join("..")),
        &InvocationFilter::default(),
        0,
        1
    )
    .is_err());
}

#[test]
fn invalid_filters_fail_before_loading_and_repository_scope_hides_unrelated_errors() {
    let root = fixture_directory();
    let invalid = InvocationFilter {
        state: Some("success-guessed".into()),
        ..Default::default()
    };
    assert_eq!(
        read_invocation_ledger(&source(&root.path().join("missing")), &invalid, 0, 1).unwrap_err(),
        "Unsupported invocation filter"
    );
    let mut value = record(1, "failed");
    value["repo_path"] = json!("/another/repository");
    value["receipt_path"] = json!("/ignored");
    write(root.path(), 1, &value);
    let filter = InvocationFilter {
        repo_path: Some("/synthetic/repository".into()),
        ..Default::default()
    };
    let receipt = read_invocation_ledger(&source(root.path()), &filter, 0, 1).unwrap();
    assert_eq!(receipt.projection.total, 0);
    assert!(receipt.ingestion_issues.is_empty());
}

#[cfg(unix)]
#[test]
fn hard_links_and_trailing_slash_symlink_roots_are_rejected() {
    use std::os::unix::fs::symlink;
    let root = fixture_directory();
    let outside = fixture_directory();
    let dir = root.path().join(id(1));
    std::fs::create_dir(&dir).unwrap();
    let file = outside.path().join("outside.json");
    std::fs::write(&file, serde_json::to_vec(&record(1, "failed")).unwrap()).unwrap();
    std::fs::hard_link(&file, dir.join("invocation.json")).unwrap();
    assert_eq!(read(root.path()).projection.unreadable_records, 1);
    let link = outside.path().join("ledger-link");
    symlink(root.path(), &link).unwrap();
    let slash = PathBuf::from(format!("{}/", link.display()));
    assert!(read_invocation_ledger(&source(&slash), &InvocationFilter::default(), 0, 1).is_err());
}

#[test]
fn scoped_ingestion_separates_unknown_failures_and_excludes_malformed_foreign_metadata() {
    let root = fixture_directory();
    write(root.path(), 1, &record(1, "failed"));
    let mut foreign = record(2, "completed");
    foreign["repo_path"] = json!("/another/repository");
    foreign["schema_version"] = json!("unsupported");
    foreign["invocation_id"] = json!(id(99));
    foreign["receipt_path"] = json!("/ignored");
    write(root.path(), 2, &foreign);
    let mut missing_repo = record(3, "failed");
    missing_repo.as_object_mut().unwrap().remove("repo_path");
    write(root.path(), 3, &missing_repo);
    let truncated = write(root.path(), 4, &record(4, "completed"));
    std::fs::write(truncated.join("invocation.json"), b"{").unwrap();
    let mut in_scope_mismatch = record(5, "failed");
    in_scope_mismatch["invocation_id"] = json!(id(99));
    write(root.path(), 5, &in_scope_mismatch);
    let filter = InvocationFilter {
        repo_path: Some("/synthetic/repository".into()),
        ..Default::default()
    };
    let receipt = read_invocation_ledger(&source(root.path()), &filter, 0, 1).unwrap();
    assert_eq!(receipt.projection.total, 1);
    assert_eq!(receipt.projection.invocations[0].state, "failed");
    assert_eq!(receipt.projection.unreadable_records, 1);
    assert_eq!(receipt.projection.unattributed_records, 2);
    assert_eq!(receipt.ingestion_issues.len(), 1);
    assert_eq!(receipt.ingestion_issues[0].invocation_id, Some(id(5)));
    assert_eq!(
        receipt.ingestion_issues[0].code,
        "session_identity_mismatch"
    );
    assert_eq!(receipt.unattributed_ingestion_issues.len(), 2);
    assert!(receipt
        .unattributed_ingestion_issues
        .iter()
        .all(|issue| issue.invocation_id.is_none()));
    assert!(receipt
        .unattributed_ingestion_issues
        .iter()
        .any(|issue| issue.code == "unknown_repository_identity"));
    assert!(receipt
        .unattributed_ingestion_issues
        .iter()
        .any(|issue| issue.code == "malformed_json"));
    assert!(!serde_json::to_string(&receipt)
        .unwrap()
        .contains("another/repository"));
}

#[cfg(unix)]
#[test]
fn intermediate_symlink_root_components_are_rejected_without_canonicalizing_input() {
    use std::os::unix::fs::symlink;
    let root = fixture_directory();
    let outside = fixture_directory();
    let ledger = outside.path().join("ledger");
    std::fs::create_dir(&ledger).unwrap();
    write(&ledger, 1, &record(1, "failed"));
    let link = root.path().join("ancestor-link");
    symlink(outside.path(), &link).unwrap();
    for path in [link.join("ledger"), link.join(".").join("ledger")] {
        assert_eq!(
            read_invocation_ledger(&source(&path), &InvocationFilter::default(), 0, 1).unwrap_err(),
            "unavailable_or_unsafe_ledger_directory"
        );
    }
    assert_eq!(read(&ledger).projection.total, 1);
}
