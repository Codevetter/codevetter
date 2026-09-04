//! One bounded, Rust-owned projection of persisted verification history.
//!
//! The originating receipt remains untouched in `receipt`. Metadata here only
//! gives CLI and native clients a stable way to render unlike receipt families
//! without reinterpreting their verdicts or opening SQLite themselves.

use std::collections::HashMap;

use rusqlite::{params, params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MAX_RUN_HISTORY_LIMIT: usize = 100;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunKind {
    LocalCheck,
    Preview,
    TrexPr,
    SyntheticQa,
    WarmVerification,
    DifferentialVerification,
    AudienceValidation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RunHistoryRecord {
    pub schema_version: String,
    pub id: String,
    pub kind: RunKind,
    pub repo_path: Option<String>,
    pub recorded_at: String,
    pub title: String,
    pub outcome: String,
    pub receipt_schema: String,
    pub source_label: Option<String>,
    pub limitations: Vec<String>,
    pub receipt: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RunHistoryReceipt {
    pub schema_version: String,
    pub generated_at: String,
    pub repo_path: Option<String>,
    pub limit: usize,
    pub returned: usize,
    pub runs: Vec<RunHistoryRecord>,
}

pub fn list_run_history(
    connection: &Connection,
    repo_path: Option<&str>,
    limit: usize,
) -> Result<RunHistoryReceipt, String> {
    let limit = limit.clamp(1, MAX_RUN_HISTORY_LIMIT);
    let mut runs = Vec::new();
    runs.extend(list_local_checks(connection, repo_path, limit)?);
    runs.extend(list_preview_runs(connection, repo_path, limit)?);
    runs.extend(list_trex_pr_runs(connection, repo_path, limit)?);
    runs.extend(list_synthetic_qa_runs(connection, repo_path, limit)?);
    runs.extend(list_warm_runs(connection, repo_path, limit)?);
    runs.extend(list_differential_runs(connection, repo_path, limit)?);
    runs.extend(list_audience_runs(connection, repo_path, limit)?);
    runs.sort_by(|left, right| {
        right
            .recorded_at
            .cmp(&left.recorded_at)
            .then_with(|| right.id.cmp(&left.id))
    });
    runs.truncate(limit);

    Ok(RunHistoryReceipt {
        schema_version: "codevetter.run-history/v1".into(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        repo_path: repo_path.map(ToOwned::to_owned),
        limit,
        returned: runs.len(),
        runs,
    })
}

fn list_trex_pr_runs(
    connection: &Connection,
    repo_path: Option<&str>,
    limit: usize,
) -> Result<Vec<RunHistoryRecord>, String> {
    let sql = filtered_sql(
        "SELECT id, repo_path, ran_at, pr_number, head_sha, verdict, confidence,
                summary, status_state, status_error, duration_ms
         FROM trex_pr_runs",
        repo_path,
        "ran_at",
        "id",
    );
    query_rows(connection, &sql, repo_path, limit, "T-Rex PR", |row| {
        let id: String = row.get(0)?;
        let repo_path: String = row.get(1)?;
        let recorded_at: String = row.get(2)?;
        let pr_number: i64 = row.get(3)?;
        let head_sha: String = row.get(4)?;
        let verdict: String = row.get(5)?;
        let confidence: f64 = row.get(6)?;
        let summary: String = row.get(7)?;
        let status_state: Option<String> = row.get(8)?;
        let status_error: Option<String> = row.get(9)?;
        let duration_ms: i64 = row.get(10)?;
        let limitations = status_error
            .iter()
            .map(|error| format!("PR status could not be resolved: {error}"))
            .collect();
        let receipt = json!({
            "schema_version": "codevetter.trex-pr-run/v1",
            "id": id,
            "repo_path": repo_path,
            "pr_number": pr_number,
            "head_sha": head_sha,
            "verdict": verdict,
            "confidence": confidence,
            "summary": summary,
            "status_state": status_state,
            "status_error": status_error,
            "duration_ms": duration_ms,
            "ran_at": recorded_at,
        });
        Ok(RunHistoryRecord {
            schema_version: "codevetter.run-record/v1".into(),
            id,
            kind: RunKind::TrexPr,
            repo_path: Some(repo_path),
            recorded_at,
            title: format!("PR #{pr_number}: {summary}"),
            outcome: verdict,
            receipt_schema: "codevetter.trex-pr-run/v1".into(),
            source_label: Some(short_identity(&head_sha)),
            limitations,
            receipt,
        })
    })
}

fn list_synthetic_qa_runs(
    connection: &Connection,
    repo_path: Option<&str>,
    limit: usize,
) -> Result<Vec<RunHistoryRecord>, String> {
    let sql = filtered_sql(
        "SELECT id, repo_path, created_at, goal, route, runner_type, review_id,
                loop_id, base_url, pass, duration_ms, notes, screenshot_path,
                artifacts, console_errors, error, trace_json
         FROM synthetic_qa_runs",
        repo_path,
        "created_at",
        "id",
    );
    query_rows(connection, &sql, repo_path, limit, "synthetic QA", |row| {
        let id: String = row.get(0)?;
        let repo_path: Option<String> = row.get(1)?;
        let recorded_at: String = row.get(2)?;
        let goal: Option<String> = row.get(3)?;
        let route: Option<String> = row.get(4)?;
        let runner_type: String = row.get(5)?;
        let review_id: Option<String> = row.get(6)?;
        let loop_id: String = row.get(7)?;
        let base_url: Option<String> = row.get(8)?;
        let passed = row.get::<_, i64>(9)? != 0;
        let duration_ms: i64 = row.get(10)?;
        let notes: Option<String> = row.get(11)?;
        let screenshot_path: Option<String> = row.get(12)?;
        let artifacts_json: Option<String> = row.get(13)?;
        let console_errors: i64 = row.get(14)?;
        let error: Option<String> = row.get(15)?;
        let trace_json: Option<String> = row.get(16)?;
        let title = non_empty(goal.as_deref())
            .or_else(|| non_empty(route.as_deref()))
            .unwrap_or("Synthetic QA")
            .to_owned();
        let mut limitations = Vec::new();
        if !passed {
            limitations.push(
                error
                    .clone()
                    .unwrap_or_else(|| "Synthetic QA did not pass".into()),
            );
        }
        if console_errors > 0 {
            limitations.push(format!("{console_errors} console error(s) recorded"));
        }
        let receipt = json!({
            "schema_version": "codevetter.synthetic-qa-run/v1",
            "id": id,
            "review_id": review_id,
            "repo_path": repo_path,
            "loop_id": loop_id,
            "runner_type": runner_type,
            "base_url": base_url,
            "route": route,
            "goal": goal,
            "pass": passed,
            "duration_ms": duration_ms,
            "notes": notes,
            "screenshot_path": screenshot_path,
            "artifacts": decode_json_or_raw(artifacts_json),
            "console_errors": console_errors,
            "error": error,
            "trace": decode_json_or_raw(trace_json.clone()),
            "trace_json": trace_json,
            "created_at": recorded_at,
        });
        Ok(RunHistoryRecord {
            schema_version: "codevetter.run-record/v1".into(),
            id,
            kind: RunKind::SyntheticQa,
            repo_path,
            recorded_at,
            title,
            outcome: if passed { "passed" } else { "failed" }.into(),
            receipt_schema: "codevetter.synthetic-qa-run/v1".into(),
            source_label: Some(runner_type),
            limitations,
            receipt,
        })
    })
}

fn list_local_checks(
    connection: &Connection,
    repo_path: Option<&str>,
    limit: usize,
) -> Result<Vec<RunHistoryRecord>, String> {
    let sql = filtered_sql(
        "SELECT run_id, repo_path, ran_at, task, verdict, head_sha, receipt_json
         FROM local_check_runs",
        repo_path,
        "ran_at",
        "run_id",
    );
    query_rows(connection, &sql, repo_path, limit, "local check", |row| {
        let receipt: Value = decode_json(row.get(6)?, "local check")?;
        Ok(RunHistoryRecord {
            schema_version: "codevetter.run-record/v1".into(),
            id: row.get(0)?,
            kind: RunKind::LocalCheck,
            repo_path: Some(row.get(1)?),
            recorded_at: row.get(2)?,
            title: row.get(3)?,
            outcome: row.get(4)?,
            receipt_schema: string_field(&receipt, "schema_version")
                .unwrap_or("codevetter.local-check/v1")
                .into(),
            source_label: Some(short_identity(&row.get::<_, String>(5)?)),
            limitations: string_array(&receipt, "limitations"),
            receipt,
        })
    })
}

fn list_preview_runs(
    connection: &Connection,
    repo_path: Option<&str>,
    limit: usize,
) -> Result<Vec<RunHistoryRecord>, String> {
    let sql = filtered_sql(
        "SELECT id, repo_path, ran_at, summary, verdict, head_sha, receipt_json
         FROM trex_preview_runs",
        repo_path,
        "ran_at",
        "id",
    );
    query_rows(connection, &sql, repo_path, limit, "preview", |row| {
        let receipt: Value = decode_json(row.get(6)?, "preview")?;
        Ok(RunHistoryRecord {
            schema_version: "codevetter.run-record/v1".into(),
            id: row.get(0)?,
            kind: RunKind::Preview,
            repo_path: Some(row.get(1)?),
            recorded_at: row.get(2)?,
            title: row.get(3)?,
            outcome: row.get(4)?,
            receipt_schema: "codevetter.trex-preview/v1".into(),
            source_label: Some(short_identity(&row.get::<_, String>(5)?)),
            limitations: string_array(&receipt, "limitations"),
            receipt,
        })
    })
}

fn list_warm_runs(
    connection: &Connection,
    repo_path: Option<&str>,
    limit: usize,
) -> Result<Vec<RunHistoryRecord>, String> {
    let sql = filtered_sql(
        "SELECT id, repo_path, created_at, outcome, target_sha, result_json
         FROM warm_verification_runs",
        repo_path,
        "created_at",
        "id",
    );
    query_rows(
        connection,
        &sql,
        repo_path,
        limit,
        "warm verification",
        |row| {
            let receipt: Value = decode_json(row.get(5)?, "warm verification")?;
            let warm = receipt
                .get("warm")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            Ok(RunHistoryRecord {
                schema_version: "codevetter.run-record/v1".into(),
                id: row.get(0)?,
                kind: RunKind::WarmVerification,
                repo_path: Some(row.get(1)?),
                recorded_at: row.get(2)?,
                title: if warm {
                    "Warm browser verification".into()
                } else {
                    "Browser verification".into()
                },
                outcome: row.get(3)?,
                receipt_schema: "codevetter.warm-verification/v1".into(),
                source_label: Some(short_identity(&row.get::<_, String>(4)?)),
                limitations: string_array(&receipt, "limitations"),
                receipt,
            })
        },
    )
}

fn list_differential_runs(
    connection: &Connection,
    repo_path: Option<&str>,
    limit: usize,
) -> Result<Vec<RunHistoryRecord>, String> {
    let sql = filtered_sql(
        "SELECT id, repo_path, created_at, classification, reference_sha, summary_json
         FROM differential_verification_runs",
        repo_path,
        "created_at",
        "id",
    );
    query_rows(
        connection,
        &sql,
        repo_path,
        limit,
        "differential verification",
        |row| {
            let receipt: Value = decode_json(row.get(5)?, "differential verification")?;
            let source: Option<String> = row.get(4)?;
            Ok(RunHistoryRecord {
                schema_version: "codevetter.run-record/v1".into(),
                id: row.get(0)?,
                kind: RunKind::DifferentialVerification,
                repo_path: Some(row.get(1)?),
                recorded_at: row.get(2)?,
                title: "Differential verification".into(),
                outcome: row.get(3)?,
                receipt_schema: "codevetter.differential-verification/v1".into(),
                source_label: source.as_deref().map(short_identity),
                limitations: string_array(&receipt, "limitations"),
                receipt,
            })
        },
    )
}

fn list_audience_runs(
    connection: &Connection,
    repo_path: Option<&str>,
    limit: usize,
) -> Result<Vec<RunHistoryRecord>, String> {
    let sql = filtered_sql(
        "SELECT id, repo_path, created_at, task, status, audience, review_id,
                candidate_a, candidate_b, criteria_json, min_responses, required,
                waived_reason, updated_at
         FROM audience_validation_runs",
        repo_path,
        "created_at",
        "id",
    );
    let mut runs = query_rows(
        connection,
        &sql,
        repo_path,
        limit,
        "audience validation",
        |row| {
            let criteria_json: String = row.get(9)?;
            let criteria: Value = decode_json(criteria_json, "audience criteria")?;
            let required = row.get::<_, i64>(11)? != 0;
            let status: String = row.get(4)?;
            let waived_reason: Option<String> = row.get(12)?;
            let mut limitations = Vec::new();
            if status != "complete" && status != "waived" {
                limitations.push(format!("Audience validation is {status}"));
            }
            if let Some(reason) = waived_reason.as_ref() {
                limitations.push(format!("Audience validation was waived: {reason}"));
            }
            let id: String = row.get(0)?;
            let repo_path: Option<String> = row.get(1)?;
            let recorded_at: String = row.get(2)?;
            let title: String = row.get(3)?;
            let audience: String = row.get(5)?;
            let review_id: String = row.get(6)?;
            let candidate_a: String = row.get(7)?;
            let candidate_b: Option<String> = row.get(8)?;
            let min_responses: i64 = row.get(10)?;
            let updated_at: String = row.get(13)?;
            let receipt = json!({
                "schema_version": "codevetter.audience-validation-run/v1",
                "id": id,
                "review_id": review_id,
                "repo_path": repo_path,
                "audience": audience,
                "task": title,
                "candidate_a": candidate_a,
                "candidate_b": candidate_b,
                "criteria": criteria,
                "min_responses": min_responses,
                "required": required,
                "status": status,
                "waived_reason": waived_reason,
                "created_at": recorded_at,
                "updated_at": updated_at,
            });
            Ok(RunHistoryRecord {
                schema_version: "codevetter.run-record/v1".into(),
                id,
                kind: RunKind::AudienceValidation,
                repo_path,
                recorded_at,
                title,
                outcome: status,
                receipt_schema: "codevetter.audience-validation-run/v1".into(),
                source_label: Some(audience),
                limitations,
                receipt,
            })
        },
    )?;
    let run_ids = runs.iter().map(|run| run.id.clone()).collect::<Vec<_>>();
    let mut responses_by_run = audience_responses(connection, &run_ids)?;
    for run in &mut runs {
        let responses = responses_by_run.remove(&run.id).unwrap_or_default();
        if let Some(receipt) = run.receipt.as_object_mut() {
            receipt.insert("response_count".into(), json!(responses.len()));
            receipt.insert("responses".into(), Value::Array(responses));
        }
    }
    Ok(runs)
}

fn audience_responses(
    connection: &Connection,
    run_ids: &[String],
) -> Result<HashMap<String, Vec<Value>>, String> {
    if run_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = (1..=run_ids.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT run_id, id, participant_id, provenance, criterion, candidate_a, candidate_b,
                preferred_candidate, reverse_preferred_candidate, confidence, task_passed,
                feedback, evidence_ref, elapsed_ms, created_at
         FROM audience_validation_responses
         WHERE run_id IN ({placeholders})
         ORDER BY run_id ASC, created_at ASC, id ASC"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("prepare audience response history: {error}"))?;
    let rows = statement
        .query_map(params_from_iter(run_ids), |row| {
            let run_id: String = row.get(0)?;
            let task_passed: Option<i64> = row.get(10)?;
            Ok((
                run_id.clone(),
                json!({
                    "id": row.get::<_, String>(1)?,
                    "run_id": run_id,
                    "participant_id": row.get::<_, String>(2)?,
                    "provenance": row.get::<_, String>(3)?,
                    "criterion": row.get::<_, String>(4)?,
                    "candidate_a": row.get::<_, String>(5)?,
                    "candidate_b": row.get::<_, Option<String>>(6)?,
                    "preferred_candidate": row.get::<_, Option<String>>(7)?,
                    "reverse_preferred_candidate": row.get::<_, Option<String>>(8)?,
                    "confidence": row.get::<_, f64>(9)?,
                    "task_passed": task_passed.map(|value| value != 0),
                    "feedback": row.get::<_, Option<String>>(11)?,
                    "evidence_ref": row.get::<_, Option<String>>(12)?,
                    "elapsed_ms": row.get::<_, Option<i64>>(13)?,
                    "created_at": row.get::<_, String>(14)?,
                }),
            ))
        })
        .map_err(|error| format!("read audience response history: {error}"))?;
    let mut responses = HashMap::<String, Vec<Value>>::new();
    for row in rows {
        let (run_id, response) =
            row.map_err(|error| format!("decode audience response history: {error}"))?;
        responses.entry(run_id).or_default().push(response);
    }
    Ok(responses)
}

fn filtered_sql(
    base: &str,
    repo_path: Option<&str>,
    order_column: &str,
    identity_column: &str,
) -> String {
    let filter = if repo_path.is_some() {
        " WHERE repo_path = ?1"
    } else {
        ""
    };
    let limit_parameter = if repo_path.is_some() { "?2" } else { "?1" };
    format!(
        "{base}{filter} ORDER BY {order_column} DESC, {identity_column} DESC LIMIT {limit_parameter}"
    )
}

fn query_rows<F>(
    connection: &Connection,
    sql: &str,
    repo_path: Option<&str>,
    limit: usize,
    label: &str,
    map: F,
) -> Result<Vec<RunHistoryRecord>, String>
where
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<RunHistoryRecord>,
{
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| format!("prepare {label} history: {error}"))?;
    let rows = match repo_path {
        Some(repo_path) => statement.query_map(params![repo_path, limit as i64], map),
        None => statement.query_map(params![limit as i64], map),
    }
    .map_err(|error| format!("read {label} history: {error}"))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("decode {label} history: {error}"))
}

fn decode_json(text: String, label: &str) -> rusqlite::Result<Value> {
    serde_json::from_str(&text).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            format!("invalid stored {label} JSON: {error}").into(),
        )
    })
}

fn decode_json_or_raw(text: Option<String>) -> Value {
    match text {
        Some(text) => serde_json::from_str(&text).unwrap_or(Value::String(text)),
        None => Value::Null,
    }
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn string_field<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Value::as_str)
}

fn string_array(value: &Value, field: &str) -> Vec<String> {
    value
        .get(field)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect()
}

fn short_identity(identity: &str) -> String {
    identity.chars().take(12).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn projects_all_retained_run_families_in_one_bounded_order() {
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("migrations");
        seed_run_families(&connection);

        let history = list_run_history(&connection, Some("/repo"), 7).expect("history");

        assert_eq!(history.schema_version, "codevetter.run-history/v1");
        assert_eq!(history.returned, 7);
        assert_eq!(history.runs[0].kind, RunKind::TrexPr);
        assert_eq!(history.runs[1].kind, RunKind::SyntheticQa);
        assert_eq!(history.runs[2].kind, RunKind::AudienceValidation);
        assert_eq!(history.runs[3].kind, RunKind::DifferentialVerification);
        assert_eq!(history.runs[4].kind, RunKind::WarmVerification);
        assert_eq!(history.runs[5].kind, RunKind::Preview);
        assert_eq!(history.runs[6].kind, RunKind::LocalCheck);
        assert_eq!(history.runs[2].receipt["response_count"], 1);
        assert_eq!(
            history.runs[2].receipt["responses"][0]["participant_id"],
            "participant-1"
        );
        assert!(history
            .runs
            .iter()
            .all(|run| run.repo_path.as_deref() == Some("/repo")));
    }

    #[test]
    fn global_history_includes_null_repo_audience_rows_without_weakening_filtering() {
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("migrations");
        seed_run_families(&connection);
        connection
            .execute(
                "UPDATE audience_validation_runs SET repo_path = NULL WHERE id = 'audience-1'",
                [],
            )
            .expect("null repo audience");

        let global = list_run_history(&connection, None, 100).expect("global history");
        let filtered = list_run_history(&connection, Some("/repo"), 100).expect("filtered history");

        assert!(global.runs.iter().any(|run| run.id == "audience-1"));
        assert!(!filtered.runs.iter().any(|run| run.id == "audience-1"));
    }

    #[test]
    #[ignore = "release-mode performance evidence; run explicitly with --nocapture"]
    fn benchmark_seven_family_projection_over_seven_hundred_rows() {
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("migrations");
        seed_large_ledger(&connection);

        for _ in 0..20 {
            assert_eq!(
                list_run_history(&connection, Some("/repo"), 100)
                    .expect("warm projection")
                    .returned,
                100
            );
        }

        let mut samples_us = Vec::with_capacity(250);
        for _ in 0..250 {
            let started = Instant::now();
            let history =
                list_run_history(&connection, Some("/repo"), 100).expect("measured projection");
            samples_us.push(started.elapsed().as_micros() as u64);
            assert_eq!(history.returned, 100);
        }
        samples_us.sort_unstable();
        let median_us = samples_us[samples_us.len() / 2];
        let p95_us = samples_us[(samples_us.len() * 95 / 100).min(samples_us.len() - 1)];
        println!(
            "RUN_HISTORY_BENCHMARK_JSON {}",
            json!({
                "schema_version": "codevetter.native-run-history-benchmark/v1",
                "stored_run_rows": 700,
                "stored_audience_response_rows": 100,
                "returned_rows": 100,
                "families": 7,
                "warmups": 20,
                "samples": 250,
                "median_us": median_us,
                "p95_us": p95_us,
            })
        );
    }

    fn seed_run_families(connection: &Connection) {
        connection
            .execute_batch(
                r#"
            INSERT INTO local_reviews(id, review_type, source_label, repo_path, repo_full_name,
                pr_number, status, created_at)
            VALUES('review-1', 'pull_request', 'PR #1', '/repo', 'fleet/codevetter', 1, 'complete',
                '2026-08-31T00:00:00Z');
            INSERT INTO local_check_runs(run_id, schema_version, repo_path, base_sha, head_sha,
                verdict, task, receipt_json, ran_at)
            VALUES('local-1', 'codevetter.local-check/v1', '/repo',
                'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'passed_with_limits', 'Local check',
                '{"schema_version":"codevetter.local-check/v1","limitations":["bounded"]}',
                '2026-08-31T01:00:00Z');
            INSERT INTO trex_preview_runs(id, repo_path, source_kind, source_input, base_sha,
                head_sha, preview_url, preview_identity, verdict, summary, receipt_json,
                duration_ms, ran_at)
            VALUES('preview-1', '/repo', 'range', 'main...HEAD',
                'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'https://preview.test', 'identity',
                'passed_with_limits', 'Preview check', '{"limitations":[]}', 1,
                '2026-08-31T02:00:00Z');
            INSERT INTO warm_verification_runs(id, repo_path, run_id, schema_version,
                protocol_version, outcome, target_sha, change_set_kind, change_set_id, started_at,
                finished_at, warm, stale, result_json, created_at)
            VALUES('warm-1', '/repo', 'warm-run-1', 1, 1, 'passed',
                'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'range', 'identity',
                '2026-08-31T03:00:00Z', '2026-08-31T03:00:01Z', 1, 0,
                '{"warm":true,"limitations":[]}', '2026-08-31T03:00:01Z');
            INSERT INTO differential_verification_runs(id, repo_path, run_id, schema_version,
                status, classification, reference_sha, candidate_kind, candidate_identity,
                plan_identity, duration_ms, cleanup_complete, summary_json, created_at)
            VALUES('differential-1', '/repo', 'diff-run-1', 1, 'complete', 'unchanged',
                'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'worktree', 'identity', 'plan', 1, 1,
                '{"limitations":[]}', '2026-08-31T04:00:00Z');
            INSERT INTO audience_validation_runs(id, review_id, repo_path, audience, task,
                candidate_a, candidate_b, criteria_json, min_responses, required, status,
                created_at, updated_at)
            VALUES('audience-1', 'review-1', '/repo', 'maintainers', 'Audience check', 'a', 'b',
                '["correctness"]', 3, 1, 'collecting', '2026-08-31T05:00:00Z',
                '2026-08-31T05:00:00Z');
            INSERT INTO audience_validation_responses(id, run_id, participant_id, provenance,
                criterion, candidate_a, candidate_b, preferred_candidate, confidence, task_passed,
                feedback, created_at)
            VALUES('response-1', 'audience-1', 'participant-1', 'human', 'correctness', 'a', 'b',
                'a', 0.9, 1, 'Clearer evidence', '2026-08-31T05:00:01Z');
            INSERT INTO synthetic_qa_runs(id, review_id, repo_path, loop_id, runner_type, base_url,
                route, goal, pass, duration_ms, notes, screenshot_path, artifacts, console_errors,
                error, trace_json, created_at)
            VALUES('synthetic-1', 'review-1', '/repo', 'loop-1', 'playwright_builtin',
                'http://127.0.0.1:1420', '/review', 'Verify the review flow', 0, 240, 'blocked',
                NULL, '["trace.zip"]', 1, 'Expected evidence was missing',
                '{"final_url":"http://127.0.0.1:1420/review"}', '2026-08-31T06:00:00Z');
            INSERT INTO trex_pr_runs(id, repo_path, pr_number, head_sha, verdict, confidence,
                summary, status_state, duration_ms, ran_at)
            VALUES('trex-pr-1', '/repo', 201,
                'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'NEEDS_REVIEW', 0.82,
                'One evidence gap remains', 'pending', 320, '2026-08-31T07:00:00Z');
            "#,
            )
            .expect("seed run families");
    }

    fn seed_large_ledger(connection: &Connection) {
        connection
            .execute_batch(
                r#"
                INSERT INTO local_reviews(id, review_type, source_label, repo_path,
                    repo_full_name, pr_number, status, created_at)
                VALUES('review-1', 'pull_request', 'PR #1', '/repo', 'fleet/codevetter', 1,
                    'complete', '2026-08-31T00:00:00Z');

                WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 100)
                INSERT INTO local_check_runs(run_id, schema_version, repo_path, base_sha,
                    head_sha, verdict, task, receipt_json, ran_at)
                SELECT printf('local-%03d', x), 'codevetter.local-check/v1', '/repo',
                    printf('%040d', x), printf('%040d', x + 1), 'passed_with_limits',
                    printf('Local check %03d', x),
                    '{"schema_version":"codevetter.local-check/v1","limitations":[]}',
                    printf('2026-08-31T01:%02d:%02dZ', x / 60, x % 60) FROM n;

                WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 100)
                INSERT INTO trex_preview_runs(id, repo_path, source_kind, source_input, base_sha,
                    head_sha, preview_url, preview_identity, verdict, summary, receipt_json,
                    duration_ms, ran_at)
                SELECT printf('preview-%03d', x), '/repo', 'range', 'main...HEAD',
                    printf('%040d', x), printf('%040d', x + 1), 'https://preview.test',
                    printf('preview-identity-%03d', x), 'passed_with_limits',
                    printf('Preview %03d', x), '{"limitations":[]}', 1,
                    printf('2026-08-31T02:%02d:%02dZ', x / 60, x % 60) FROM n;

                WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 100)
                INSERT INTO warm_verification_runs(id, repo_path, run_id, schema_version,
                    protocol_version, outcome, target_sha, change_set_kind, change_set_id,
                    started_at, finished_at, warm, stale, result_json, created_at)
                SELECT printf('warm-%03d', x), '/repo', printf('warm-run-%03d', x), 1, 1,
                    'passed', printf('%040d', x + 1), 'range', printf('warm-change-%03d', x),
                    printf('2026-08-31T03:%02d:%02dZ', x / 60, x % 60),
                    printf('2026-08-31T03:%02d:%02dZ', x / 60, x % 60), 1, 0,
                    '{"warm":true,"limitations":[]}',
                    printf('2026-08-31T03:%02d:%02dZ', x / 60, x % 60) FROM n;

                WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 100)
                INSERT INTO differential_verification_runs(id, repo_path, run_id,
                    schema_version, status, classification, reference_sha, candidate_kind,
                    candidate_identity, plan_identity, duration_ms, cleanup_complete,
                    summary_json, created_at)
                SELECT printf('differential-%03d', x), '/repo', printf('diff-run-%03d', x), 1,
                    'complete', 'unchanged', printf('%040d', x), 'worktree',
                    printf('candidate-%03d', x), printf('plan-%03d', x), 1, 1,
                    '{"limitations":[]}',
                    printf('2026-08-31T04:%02d:%02dZ', x / 60, x % 60) FROM n;

                WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 100)
                INSERT INTO audience_validation_runs(id, review_id, repo_path, audience, task,
                    candidate_a, candidate_b, criteria_json, min_responses, required, status,
                    created_at, updated_at)
                SELECT printf('audience-%03d', x), 'review-1', '/repo', 'maintainers',
                    printf('Audience check %03d', x), 'a', 'b', '["correctness"]', 3, 1,
                    'complete', printf('2026-08-31T05:%02d:%02dZ', x / 60, x % 60),
                    printf('2026-08-31T05:%02d:%02dZ', x / 60, x % 60) FROM n;

                WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 100)
                INSERT INTO audience_validation_responses(id, run_id, participant_id, provenance,
                    criterion, candidate_a, candidate_b, preferred_candidate, confidence,
                    task_passed, created_at)
                SELECT printf('response-%03d', x), printf('audience-%03d', x),
                    printf('participant-%03d', x), 'human', 'correctness', 'a', 'b', 'a', 0.9, 1,
                    printf('2026-08-31T05:%02d:%02dZ', x / 60, x % 60) FROM n;

                WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 100)
                INSERT INTO synthetic_qa_runs(id, review_id, repo_path, loop_id, runner_type,
                    route, goal, pass, duration_ms, artifacts, console_errors, trace_json, created_at)
                SELECT printf('synthetic-%03d', x), 'review-1', '/repo',
                    printf('loop-%03d', x), 'playwright_builtin', '/review',
                    printf('Synthetic QA %03d', x), 1, 10, '[]', 0,
                    '{"final_url":"http://127.0.0.1/review"}',
                    printf('2026-08-31T06:%02d:%02dZ', x / 60, x % 60) FROM n;

                WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 100)
                INSERT INTO trex_pr_runs(id, repo_path, pr_number, head_sha, verdict, confidence,
                    summary, status_state, duration_ms, ran_at)
                SELECT printf('trex-pr-%03d', x), '/repo', x, printf('%040d', x + 1),
                    'APPROVE', 0.9, printf('PR run %03d', x), 'success', 10,
                    printf('2026-08-31T07:%02d:%02dZ', x / 60, x % 60) FROM n;
                "#,
            )
            .expect("seed 700-run ledger");
    }
}
