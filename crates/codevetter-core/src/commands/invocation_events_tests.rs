use super::*;
use serde_json::json;

fn id(number: u64) -> String {
    format!("00000000-0000-4000-8000-{number:012}")
}

fn session(number: u64) -> InvocationSession {
    InvocationSession {
        invocation: json!({
            "schema_version": RECORD_SCHEMA,
            "invocation_id": id(number),
            "skill": "codevetter-testing",
            "repo_path": "/synthetic/repository",
            "command": "scope",
            "operation": null,
            "agent": "codex",
            "started_at": "2026-10-02T12:00:00Z",
            "state": "completed",
            "exit_code": 0,
            "cli_exit_code": 0
        }),
        assessments: Vec::new(),
        receipt_bytes: None,
    }
}

fn bind_receipt(session: &mut InvocationSession) {
    let bytes = serde_json::to_vec(&json!({"schema_version": 1, "candidates": ["synthetic test"]}))
        .unwrap();
    session.invocation["receipt_sha256"] = json!(format!("{:x}", Sha256::digest(&bytes)));
    session.invocation["receipt_path"] = json!("/synthetic/ledger/receipt.json");
    session.invocation["receipt_schema_version"] = json!(1);
    session.receipt_bytes = Some(bytes);
}

fn observation(session: &InvocationSession, number: u64, outcome: &str) -> Value {
    json!({
        "schema_version": ASSESSMENT_SCHEMA,
        "invocation_id": session.invocation["invocation_id"],
        "assessment_id": id(number),
        "recorded_at": "2026-10-02T12:10:00Z",
        "outcome": outcome,
        "provenance": "agent_reported",
        "independently_verified": false,
        "measured_cost_usd": null,
        "evidence": [{"receipt_sha256": session.invocation["receipt_sha256"], "json_pointer": "/candidates"}]
    })
}

fn project(sessions: &[InvocationSession]) -> InvocationEventsReceipt {
    project_invocation_events(sessions, &InvocationFilter::default(), 0, 100).unwrap()
}

#[test]
fn command_and_provider_provenance_are_separate_from_originating_agent() {
    let mut review = session(1);
    review.invocation["command"] = json!("check");
    review.invocation["operation"] = json!("preflight");
    review.invocation["provider"] = json!("anthropic");
    let report = project(&[review, session(2)]);
    let scope = &report.invocations[0];
    assert_eq!(scope.command, "scope");
    assert_eq!(scope.source_schema_version, RECORD_SCHEMA);
    assert_eq!(scope.command_provenance, "invocation_metadata");
    assert_eq!(scope.agent.as_deref(), Some("codex"));
    assert_eq!(scope.provider, None);
    assert_eq!(scope.provider_provenance, None);
    let review = &report.invocations[1];
    assert_eq!(review.command, "check");
    assert_eq!(review.operation.as_deref(), Some("preflight"));
    assert_eq!(review.agent.as_deref(), Some("codex"));
    assert_eq!(review.provider.as_deref(), Some("anthropic"));
    assert_eq!(
        review.provider_provenance.as_deref(),
        Some("invocation_metadata")
    );
}

#[test]
fn missing_values_stay_null_and_observed_zero_stays_zero() {
    let mut known = session(2);
    known.invocation["duration_ms"] = json!(0);
    known.invocation["context_capture_ms"] = json!(0);
    let mut legacy = session(1);
    legacy.invocation.as_object_mut().unwrap().remove("agent");
    let report = project(&[legacy, known]);
    assert_eq!(report.invocations[0].duration_ms, Some(0));
    let unknown = &report.invocations[1];
    assert_eq!(unknown.agent, None);
    assert_eq!(unknown.duration_ms, None);
    assert_eq!(unknown.context_capture_ms, None);
    assert_eq!(unknown.finished_at, None);
    assert_eq!(unknown.receipt_schema_version, None);
    assert_eq!(unknown.receipt_integrity, ReceiptIntegrity::NotRecorded);
    assert_eq!(unknown.assessment, "unassessed");
    assert_eq!(unknown.independently_verified_benefit, None);
    let serialized = serde_json::to_value(unknown).unwrap();
    assert!(serialized["provider"].is_null());
    assert!(serialized["duration_ms"].is_null());
}

#[test]
fn orders_by_instant_then_identity_not_input_order_or_offset_spelling() {
    let mut oldest = session(9);
    oldest.invocation["started_at"] = json!("2026-10-02T13:00:00+02:00");
    let a = session(1);
    let mut b = session(2);
    b.invocation["started_at"] = json!("2026-10-02T14:00:00+02:00");
    let report = project(&[a, oldest, b]);
    assert_eq!(
        report
            .invocations
            .iter()
            .map(|e| &e.invocation_id)
            .collect::<Vec<_>>(),
        vec![&id(2), &id(1), &id(9)]
    );
    assert_eq!(
        project(&[session(1), session(2)]),
        project(&[session(2), session(1)])
    );
}

#[test]
fn filters_before_count_and_pagination_and_retains_failed_attempts() {
    let mut sessions = (1..=4).map(session).collect::<Vec<_>>();
    for s in &mut sessions {
        s.invocation["task_id"] = json!(id(50));
        s.invocation["state"] = json!("failed");
        s.invocation["exit_code"] = json!(0);
        s.invocation["cli_exit_code"] = json!(1);
    }
    sessions[0].invocation["repo_path"] = json!("/synthetic/other");
    sessions[1].invocation["state"] = json!("completed");
    let filter = InvocationFilter {
        repo_path: Some("/synthetic/repository".into()),
        task_id: Some(id(50)),
        skill: Some("codevetter-testing".into()),
        state: Some("failed".into()),
        assessment: Some("unassessed".into()),
    };
    let report = project_invocation_events(&sessions, &filter, 1, 1).unwrap();
    assert_eq!(report.total, 2);
    assert_eq!(report.invocations.len(), 1);
    assert_eq!(report.invocations[0].invocation_id, id(3));
    assert_eq!(report.invocations[0].exit_code, Some(0));
    assert_eq!(report.invocations[0].cli_exit_code, Some(1));
    assert_eq!(report.invocations[0].independently_verified_benefit, None);
    assert!(project_invocation_events(&sessions, &filter, usize::MAX, 1)
        .unwrap()
        .invocations
        .is_empty());
}

#[test]
fn failed_launch_interrupt_timeout_and_running_are_visible_without_success() {
    let mut sessions = Vec::new();
    for (index, state) in [
        "unavailable",
        "interrupted",
        "timed_out",
        "output_limit",
        "running",
    ]
    .iter()
    .enumerate()
    {
        let mut s = session(index as u64 + 1);
        s.invocation["state"] = json!(state);
        s.invocation["exit_code"] = Value::Null;
        s.invocation["cli_exit_code"] = Value::Null;
        sessions.push(s);
    }
    let report = project(&sessions);
    assert_eq!(report.total, 5);
    assert!(report
        .invocations
        .iter()
        .all(|e| e.cli_exit_code.is_none() && e.independently_verified_benefit.is_none()));
}

#[test]
fn malformed_and_duplicate_identities_are_disclosed_without_backfill() {
    let mut missing_id = session(1);
    missing_id
        .invocation
        .as_object_mut()
        .unwrap()
        .remove("invocation_id");
    let mut unsupported = session(2);
    unsupported.invocation["schema_version"] = json!("historical.session/v1");
    let mut bad_time = session(3);
    bad_time.invocation["started_at"] = json!("not a timestamp");
    let report = project(&[
        missing_id,
        unsupported,
        bad_time,
        session(4),
        session(4),
        session(5),
    ]);
    assert_eq!(report.unreadable_records, 5);
    assert_eq!(report.total, 1);
    assert_eq!(report.invocations[0].invocation_id, id(5));
}

#[test]
fn index_never_copies_arguments_environment_transcript_or_provider_output() {
    let mut s = session(1);
    for key in [
        "arguments",
        "stderr",
        "environment",
        "prompt",
        "provider_output",
        "context",
    ] {
        s.invocation[key] = json!("synthetic-private-marker");
    }
    let output = serde_json::to_string(&project(&[s])).unwrap();
    assert!(!output.contains("synthetic-private-marker"));
}

#[test]
fn latest_usefulness_is_an_observation_not_a_qualified_benefit() {
    let mut s = session(1);
    bind_receipt(&mut s);
    let a = observation(&s, 10, "helped");
    let b = observation(&s, 11, "did_not_help");
    s.assessments = vec![b.clone(), a.clone()];
    let first = project(&[s]);
    assert_eq!(first.unreadable_assessments, 0);
    let event = &first.invocations[0];
    assert_eq!(event.receipt_integrity, ReceiptIntegrity::HashMatched);
    assert_eq!(event.receipt_schema_version, Some(json!(1)));
    assert_eq!(event.assessment, "did_not_help");
    assert_eq!(event.usefulness.as_ref().unwrap().measured_cost_usd, None);
    assert_eq!(event.independently_verified_benefit, None);
    let mut s = session(1);
    bind_receipt(&mut s);
    s.assessments = vec![a.clone(), b];
    assert_eq!(first, project(&[s]));
    let mut s = session(1);
    bind_receipt(&mut s);
    s.assessments = vec![a];
    let report = project(&[s]);
    assert_eq!(report.invocations[0].assessment, "helped");
    assert_eq!(report.invocations[0].independently_verified_benefit, None);
}

#[test]
fn tampered_missing_or_empty_evidence_cannot_report_helped() {
    for case in [
        "tampered",
        "missing",
        "empty",
        "unbound",
        "interrupted",
        "claimed_verified",
    ] {
        let mut s = session(1);
        bind_receipt(&mut s);
        let mut a = observation(&s, 10, "helped");
        match case {
            "tampered" => s.receipt_bytes = Some(b"changed".to_vec()),
            "missing" => s.receipt_bytes = None,
            "empty" => a["evidence"] = json!([]),
            "unbound" => a["evidence"][0]["receipt_sha256"] = json!("different"),
            "interrupted" => s.invocation["state"] = json!("interrupted"),
            "claimed_verified" => a["independently_verified"] = json!(true),
            _ => unreachable!(),
        }
        s.assessments = vec![a];
        let report = project(&[s]);
        assert_eq!(report.unreadable_assessments, 1, "{case}");
        assert_eq!(report.invocations[0].assessment, "unavailable", "{case}");
        assert_eq!(report.invocations[0].unreadable_assessments, 1, "{case}");
    }
}

#[test]
fn bounds_invalid_identity_and_unsupported_command_fail_explicitly() {
    let sessions = [session(1)];
    for limit in [0, 101] {
        assert!(
            project_invocation_events(&sessions, &InvocationFilter::default(), 0, limit).is_err()
        );
    }
    let filter = InvocationFilter {
        task_id: Some("../invalid".into()),
        ..InvocationFilter::default()
    };
    assert!(project_invocation_events(&sessions, &filter, 0, 1).is_err());
    let mut s = session(2);
    s.invocation["command"] = json!("synthetic-raw-command");
    let report = project(&[s]);
    assert_eq!(report.unreadable_records, 1);
    assert_eq!(report.total, 0);
}

#[test]
fn conflicting_assessment_identities_never_depend_on_input_order() {
    let mut s = session(1);
    bind_receipt(&mut s);
    let a = observation(&s, 10, "helped");
    let b = observation(&s, 10, "did_not_help");
    s.assessments = vec![a.clone(), b.clone()];
    let report = project(&[s]);
    assert_eq!(report.unreadable_assessments, 2);
    assert_eq!(report.invocations[0].assessment, "unavailable");
    let mut s = session(1);
    bind_receipt(&mut s);
    s.assessments = vec![b, a];
    assert_eq!(report, project(&[s]));
}

#[test]
fn malformed_pointers_and_missing_receipt_schema_fail_closed() {
    for pointer in ["/candidates/~2", "/candidates/01", "", "/missing"] {
        let mut s = session(1);
        bind_receipt(&mut s);
        let mut a = observation(&s, 10, "helped");
        a["evidence"][0]["json_pointer"] = json!(pointer);
        s.assessments = vec![a];
        let report = project(&[s]);
        assert_eq!(report.unreadable_assessments, 1, "{pointer}");
    }
    let mut s = session(1);
    bind_receipt(&mut s);
    s.invocation
        .as_object_mut()
        .unwrap()
        .remove("receipt_schema_version");
    assert_eq!(
        project(&[s]).invocations[0].receipt_integrity,
        ReceiptIntegrity::Invalid
    );
}

#[test]
fn scoped_metadata_failures_exclude_known_foreign_records_and_separate_unknowns() {
    let mut failed = session(1);
    failed.invocation["state"] = json!("failed");
    failed.invocation["cli_exit_code"] = json!(1);
    let mut foreign = session(1); // Foreign duplicates cannot poison scoped identities.
    foreign.invocation["repo_path"] = json!("/synthetic/other");
    foreign.invocation["schema_version"] = json!("unsupported");
    foreign.assessments.push(Value::Null);
    let mut malformed = session(2);
    malformed.invocation["command"] = json!("raw-command PRIVATE_SENTINEL");
    let mut missing_repo = session(3);
    missing_repo
        .invocation
        .as_object_mut()
        .unwrap()
        .remove("repo_path");
    let sessions = [
        failed,
        foreign,
        malformed,
        missing_repo,
        InvocationSession {
            invocation: Value::Null,
            assessments: vec![],
            receipt_bytes: None,
        },
    ];
    let filter = InvocationFilter {
        repo_path: Some("/synthetic/repository".into()),
        ..Default::default()
    };
    let report = project_invocation_events(&sessions, &filter, 0, 1).unwrap();
    assert_eq!(report.total, 1);
    assert_eq!(report.unreadable_records, 1);
    assert_eq!(report.unattributed_records, 2);
    assert_eq!(report.unreadable_assessments, 0);
    assert_eq!(report.invocations[0].state, "failed");
    assert_eq!(report.invocations[0].cli_exit_code, Some(1));
    let page = project_invocation_events(&sessions, &filter, 1, 1).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.unreadable_records, 1);
    assert_eq!(page.unattributed_records, 2);
    assert!(page.invocations.is_empty());
}

#[test]
fn matching_hash_still_requires_the_recorded_receipt_schema() {
    let mut s = session(1);
    bind_receipt(&mut s);
    s.invocation["receipt_schema_version"] = json!("different-schema/v1");
    assert_eq!(
        project(&[s]).invocations[0].receipt_integrity,
        ReceiptIntegrity::Invalid
    );
}
