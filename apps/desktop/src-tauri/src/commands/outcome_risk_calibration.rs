use crate::commands::unpack_types::UnpackOutcomeRiskCalibration;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

const SNAPSHOT_LIMIT: i64 = 24;
const DESCRIPTIVE_SUPPORT: usize = 3;
const QUALIFIED_SUPPORT: usize = 8;

#[derive(Debug, Clone)]
struct Snapshot {
    id: String,
    commit_sha: Option<String>,
    created_at: String,
    metrics: BTreeMap<String, f64>,
}

#[derive(Debug, Clone)]
struct Outcome {
    id: String,
    kind: String,
    state: String,
    created_at: String,
}

#[derive(Debug, Clone)]
struct Observation {
    id: String,
    repository_identity: String,
    before_id: String,
    after_id: String,
    feature_key: String,
    feature_delta: f64,
    outcome: Outcome,
    metadata_json: String,
}

pub(crate) fn build_outcome_risk_calibrations(
    conn: &Connection,
    repo_path: &str,
) -> Result<(Vec<UnpackOutcomeRiskCalibration>, Vec<String>), rusqlite::Error> {
    let (snapshots, mut exclusions) = load_snapshots(conn, repo_path)?;
    if snapshots.len() < 2 {
        exclusions
            .push("At least two compatible Repo Unpacked snapshots are required.".to_string());
        return Ok((Vec::new(), exclusions));
    }
    let outcomes = load_outcomes(conn, repo_path)?;
    if outcomes.is_empty() {
        exclusions
            .push("No qualified review, QA, or procedure outcomes are available.".to_string());
        return Ok((Vec::new(), exclusions));
    }

    let repository_identity = format!("repo:sha256:{:x}", Sha256::digest(repo_path.as_bytes()));
    let observations =
        join_observations(&repository_identity, &snapshots, &outcomes, &mut exclusions);
    persist_observations(conn, repo_path, &observations)?;
    let calibrations = summarize_observations(conn, repo_path, &observations, &exclusions)?;
    Ok((calibrations, exclusions))
}

fn load_snapshots(
    conn: &Connection,
    repo_path: &str,
) -> Result<(Vec<Snapshot>, Vec<String>), rusqlite::Error> {
    let mut statement = conn.prepare(
        "SELECT id, commit_sha, inventory_json, created_at
         FROM (
             SELECT id, commit_sha, inventory_json, created_at
             FROM repo_unpacked_reports
             WHERE repo_path = ?1 AND inventory_json IS NOT NULL
             ORDER BY created_at DESC
             LIMIT ?2
         )
         ORDER BY created_at ASC, id ASC",
    )?;
    let rows = statement.query_map(params![repo_path, SNAPSHOT_LIMIT], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    let mut snapshots = Vec::new();
    let mut exclusions = Vec::new();
    for row in rows {
        let (id, commit_sha, inventory_json, created_at) = row?;
        match serde_json::from_str::<Value>(&inventory_json) {
            Ok(value) => {
                let metrics = snapshot_metrics(&value);
                if metrics.is_empty() {
                    exclusions.push(format!(
                        "{id}: inventory has no compatible calibration metrics"
                    ));
                } else {
                    snapshots.push(Snapshot {
                        id,
                        commit_sha,
                        created_at,
                        metrics,
                    });
                }
            }
            Err(_) => exclusions.push(format!("{id}: inventory JSON is invalid")),
        }
    }
    Ok((snapshots, exclusions))
}

fn snapshot_metrics(value: &Value) -> BTreeMap<String, f64> {
    let mut metrics = BTreeMap::new();
    insert_number(&mut metrics, "inventory.files", value.get("files_scanned"));
    insert_number(&mut metrics, "inventory.bytes", value.get("bytes_scanned"));
    insert_len(&mut metrics, "inventory.languages", value.get("languages"));
    insert_len(&mut metrics, "inventory.manifests", value.get("manifests"));
    insert_len(
        &mut metrics,
        "inventory.entrypoints",
        value.get("entrypoints"),
    );
    insert_number(
        &mut metrics,
        "qa.readiness_score",
        value.pointer("/qa_readiness/score"),
    );
    insert_len(
        &mut metrics,
        "graph.nodes",
        value.pointer("/repo_graph/nodes"),
    );
    insert_len(
        &mut metrics,
        "graph.edges",
        value.pointer("/repo_graph/edges"),
    );
    insert_number(
        &mut metrics,
        "health.average_score",
        value.pointer("/repo_health/average_score"),
    );
    insert_number(
        &mut metrics,
        "health.hotspots",
        value.pointer("/repo_health/hotspot_count"),
    );
    let analyzed = value
        .pointer("/repo_health/files_analyzed")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let tested = value
        .pointer("/repo_health/files_with_test_signal")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    if analyzed > 0.0 {
        metrics.insert("health.test_signal_ratio".to_string(), tested / analyzed);
    }
    metrics
}

fn insert_number(metrics: &mut BTreeMap<String, f64>, key: &str, value: Option<&Value>) {
    if let Some(number) = value
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
    {
        metrics.insert(key.to_string(), number);
    }
}

fn insert_len(metrics: &mut BTreeMap<String, f64>, key: &str, value: Option<&Value>) {
    if let Some(values) = value.and_then(Value::as_array) {
        metrics.insert(key.to_string(), values.len() as f64);
    }
}

fn load_outcomes(conn: &Connection, repo_path: &str) -> Result<Vec<Outcome>, rusqlite::Error> {
    let mut outcomes = Vec::new();
    {
        let mut statement = conn.prepare(
            "SELECT id, status, COALESCE(findings_count, 0), created_at
             FROM local_reviews WHERE repo_path = ?1",
        )?;
        let rows = statement.query_map([repo_path], |row| {
            let status = row.get::<_, String>(1)?;
            let findings = row.get::<_, i64>(2)?;
            let state = if is_failure(&status) || findings > 0 {
                "failure"
            } else if is_success(&status) {
                "success"
            } else {
                "excluded"
            };
            Ok(Outcome {
                id: format!("review:{}", row.get::<_, String>(0)?),
                kind: "review".to_string(),
                state: state.to_string(),
                created_at: row.get(3)?,
            })
        })?;
        outcomes.extend(rows.collect::<Result<Vec<_>, _>>()?);
    }
    {
        let mut statement = conn.prepare(
            "SELECT id, pass, created_at
             FROM synthetic_qa_runs WHERE repo_path = ?1",
        )?;
        let rows = statement.query_map([repo_path], |row| {
            Ok(Outcome {
                id: format!("qa:{}", row.get::<_, String>(0)?),
                kind: "qa".to_string(),
                state: if row.get::<_, bool>(1)? {
                    "success".to_string()
                } else {
                    "failure".to_string()
                },
                created_at: row.get(2)?,
            })
        })?;
        outcomes.extend(rows.collect::<Result<Vec<_>, _>>()?);
    }
    {
        let mut statement = conn.prepare(
            "SELECT event.id, event.status, event.created_at
             FROM review_procedure_events event
             JOIN local_reviews review ON review.id = event.review_id
             WHERE review.repo_path = ?1",
        )?;
        let rows = statement.query_map([repo_path], |row| {
            let status = row.get::<_, String>(1)?;
            let state = if is_failure(&status) {
                "failure"
            } else if is_success(&status) {
                "success"
            } else {
                "excluded"
            };
            Ok(Outcome {
                id: format!("procedure:{}", row.get::<_, String>(0)?),
                kind: "procedure".to_string(),
                state: state.to_string(),
                created_at: row.get(2)?,
            })
        })?;
        outcomes.extend(rows.collect::<Result<Vec<_>, _>>()?);
    }
    outcomes.retain(|outcome| outcome.state != "excluded");
    outcomes.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(outcomes)
}

fn join_observations(
    repository_identity: &str,
    snapshots: &[Snapshot],
    outcomes: &[Outcome],
    exclusions: &mut Vec<String>,
) -> Vec<Observation> {
    let mut observations = Vec::new();
    for (index, pair) in snapshots.windows(2).enumerate() {
        let before = &pair[0];
        let after = &pair[1];
        if before.commit_sha == after.commit_sha && before.metrics == after.metrics {
            exclusions.push(format!(
                "{} -> {}: unchanged compatible snapshot",
                before.id, after.id
            ));
            continue;
        }
        let end = snapshots
            .get(index + 2)
            .map(|snapshot| snapshot.created_at.as_str());
        let window_outcomes = outcomes.iter().filter(|outcome| {
            outcome.created_at >= after.created_at
                && end.is_none_or(|window_end| outcome.created_at.as_str() < window_end)
        });
        let mut matched = 0usize;
        for outcome in window_outcomes {
            matched += 1;
            for (feature_key, after_value) in &after.metrics {
                let Some(before_value) = before.metrics.get(feature_key) else {
                    exclusions.push(format!(
                        "{} -> {}: {feature_key} missing from prior snapshot",
                        before.id, after.id
                    ));
                    continue;
                };
                let delta = after_value - before_value;
                if !delta.is_finite() || delta.abs() < f64::EPSILON {
                    continue;
                }
                let identity = json!({
                    "repositoryIdentity": repository_identity,
                    "before": before.id,
                    "after": after.id,
                    "feature": feature_key,
                    "delta": delta,
                    "outcome": outcome.id,
                });
                observations.push(Observation {
                    id: format!(
                        "calibration-observation:{:x}",
                        Sha256::digest(identity.to_string().as_bytes())
                    ),
                    repository_identity: repository_identity.to_string(),
                    before_id: before.id.clone(),
                    after_id: after.id.clone(),
                    feature_key: feature_key.clone(),
                    feature_delta: delta,
                    outcome: outcome.clone(),
                    metadata_json: json!({
                        "beforeCommit": before.commit_sha,
                        "afterCommit": after.commit_sha,
                        "windowStart": after.created_at,
                        "windowEnd": end,
                    })
                    .to_string(),
                });
            }
        }
        if matched == 0 {
            exclusions.push(format!(
                "{} -> {}: no later outcome before the next snapshot",
                before.id, after.id
            ));
        }
    }
    observations
}

fn persist_observations(
    conn: &Connection,
    repo_path: &str,
    observations: &[Observation],
) -> Result<(), rusqlite::Error> {
    for observation in observations {
        conn.execute(
            "INSERT INTO outcome_calibration_observations(
                id, repo_path, repository_identity, snapshot_before_id,
                snapshot_after_id, feature_key, feature_delta, outcome_kind,
                outcome_state, outcome_id, observed_at, metadata_json
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(
                repository_identity, snapshot_after_id, feature_key,
                outcome_kind, outcome_id
             ) DO UPDATE SET
                feature_delta = excluded.feature_delta,
                outcome_state = excluded.outcome_state,
                observed_at = excluded.observed_at,
                metadata_json = excluded.metadata_json",
            params![
                observation.id,
                repo_path,
                observation.repository_identity,
                observation.before_id,
                observation.after_id,
                observation.feature_key,
                observation.feature_delta,
                observation.outcome.kind,
                observation.outcome.state,
                observation.outcome.id,
                observation.outcome.created_at,
                observation.metadata_json,
            ],
        )?;
    }
    Ok(())
}

fn summarize_observations(
    conn: &Connection,
    repo_path: &str,
    observations: &[Observation],
    exclusions: &[String],
) -> Result<Vec<UnpackOutcomeRiskCalibration>, rusqlite::Error> {
    let mut grouped = BTreeMap::<String, Vec<&Observation>>::new();
    for observation in observations {
        grouped
            .entry(observation.feature_key.clone())
            .or_default()
            .push(observation);
    }

    let mut summaries = Vec::new();
    for (feature_key, rows) in grouped {
        let unique_outcomes = rows
            .iter()
            .map(|row| row.outcome.id.clone())
            .collect::<BTreeSet<_>>();
        let failures = rows
            .iter()
            .filter(|row| row.outcome.state == "failure")
            .collect::<Vec<_>>();
        let successes = rows
            .iter()
            .filter(|row| row.outcome.state == "success")
            .collect::<Vec<_>>();
        let support = unique_outcomes.len();
        let state = if support >= QUALIFIED_SUPPORT && failures.len() >= 2 && successes.len() >= 2 {
            "qualified"
        } else if support >= DESCRIPTIVE_SUPPORT {
            "descriptive"
        } else {
            "insufficient"
        };
        let fail_mean = mean_delta(&failures);
        let success_mean = mean_delta(&successes);
        let direction = match (fail_mean, success_mean) {
            (Some(fail), Some(success)) if fail > success + f64::EPSILON => "increases_risk",
            (Some(fail), Some(success)) if success > fail + f64::EPSILON => "decreases_risk",
            _ => "mixed",
        };
        let failure_count = failures
            .iter()
            .map(|row| row.outcome.id.as_str())
            .collect::<BTreeSet<_>>()
            .len();
        let failure_rate = if support == 0 {
            0.0
        } else {
            failure_count as f64 / support as f64
        };
        let (confidence_low, confidence_high) = wilson_interval(failure_count, support);
        let source_ids = unique_outcomes.into_iter().collect::<Vec<_>>();
        let window_start = rows
            .iter()
            .map(|row| &row.outcome.created_at)
            .min()
            .cloned();
        let window_end = rows
            .iter()
            .map(|row| &row.outcome.created_at)
            .max()
            .cloned();
        let summary = format!(
            "{state} {direction} relationship from {support} independent outcome{}; failure rate {:.0}% (95% interval {:.0}-{:.0}%). Correlation is inspection guidance, not a verdict.",
            if support == 1 { "" } else { "s" },
            failure_rate * 100.0,
            confidence_low * 100.0,
            confidence_high * 100.0,
        );
        let identity_payload = json!({
            "feature": feature_key,
            "state": state,
            "direction": direction,
            "sources": source_ids,
            "failureRate": failure_rate,
        });
        let summary_identity = format!(
            "sha256:{:x}",
            Sha256::digest(identity_payload.to_string().as_bytes())
        );
        let summary_id = format!("calibration-summary:{}", Uuid::new_v4());
        let created_at = Utc::now().to_rfc3339();
        let rerun_command = format!("Reopen Repo Unpacked for {repo_path} and refresh outcomes");
        conn.execute(
            "INSERT INTO outcome_calibration_summaries(
                id, summary_identity, repo_path, feature_key, outcome_kind,
                state, direction, sample_size, independent_outcomes,
                success_rate, failure_rate, confidence_low, confidence_high,
                window_start, window_end, source_ids_json, exclusions_json,
                rerun_command, created_at
             ) VALUES(?1, ?2, ?3, ?4, 'combined', ?5, ?6, ?7, ?8, ?9, ?10,
                      ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
             ON CONFLICT(summary_identity) DO NOTHING",
            params![
                summary_id,
                summary_identity,
                repo_path,
                feature_key,
                state,
                direction,
                rows.len() as i64,
                support as i64,
                1.0 - failure_rate,
                failure_rate,
                confidence_low,
                confidence_high,
                window_start,
                window_end,
                serde_json::to_string(&source_ids).unwrap_or_else(|_| "[]".to_string()),
                serde_json::to_string(exclusions).unwrap_or_else(|_| "[]".to_string()),
                rerun_command,
                created_at,
            ],
        )?;
        summaries.push(UnpackOutcomeRiskCalibration {
            feature_key,
            state: state.to_string(),
            direction: direction.to_string(),
            sample_size: rows.len(),
            independent_outcomes: support,
            failure_rate,
            confidence_low,
            confidence_high,
            window_start,
            window_end,
            source_ids,
            exclusions: exclusions.to_vec(),
            rerun_command,
            summary,
        });
    }
    summaries.sort_by(|left, right| {
        calibration_rank(&right.state)
            .cmp(&calibration_rank(&left.state))
            .then_with(|| {
                right
                    .failure_rate
                    .partial_cmp(&left.failure_rate)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| left.feature_key.cmp(&right.feature_key))
    });
    Ok(summaries)
}

fn mean_delta(rows: &[&&Observation]) -> Option<f64> {
    (!rows.is_empty())
        .then(|| rows.iter().map(|row| row.feature_delta).sum::<f64>() / rows.len() as f64)
}

fn wilson_interval(failures: usize, total: usize) -> (f64, f64) {
    if total == 0 {
        return (0.0, 1.0);
    }
    let z = 1.959_963_984_540_054_f64;
    let n = total as f64;
    let p = failures as f64 / n;
    let denominator = 1.0 + z * z / n;
    let center = (p + z * z / (2.0 * n)) / denominator;
    let margin = z * ((p * (1.0 - p) / n + z * z / (4.0 * n * n)).sqrt()) / denominator;
    ((center - margin).max(0.0), (center + margin).min(1.0))
}

fn calibration_rank(state: &str) -> u8 {
    match state {
        "qualified" => 3,
        "descriptive" => 2,
        _ => 1,
    }
}

fn is_success(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "satisfied" | "passed" | "pass" | "completed" | "success" | "verified"
    )
}

fn is_failure(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "blocked" | "failed" | "fail" | "error" | "errored" | "timeout" | "cancelled"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;

    fn inventory(files: i64, hotspots: i64, score: f64) -> String {
        json!({
            "files_scanned": files,
            "bytes_scanned": files * 100,
            "languages": [{"language": "Rust"}],
            "manifests": [],
            "entrypoints": [],
            "qa_readiness": {"score": 50},
            "repo_graph": {"nodes": [], "edges": []},
            "repo_health": {
                "average_score": score,
                "hotspot_count": hotspots,
                "files_analyzed": files,
                "files_with_test_signal": files / 2
            }
        })
        .to_string()
    }

    fn fixture(outcome_count: usize, failures: usize) -> Connection {
        let conn = Connection::open_in_memory().expect("database");
        schema::run_migrations(&conn).expect("schema");
        for (index, (files, hotspots, score)) in [(10, 1, 8.0), (12, 3, 7.0), (14, 5, 6.0)]
            .into_iter()
            .enumerate()
        {
            let created_at = format!("2026-01-0{}T00:00:00Z", index * 3 + 1);
            conn.execute(
                "INSERT INTO repo_unpacked_reports(
                    id, repo_path, repo_name, status, inventory_json, created_at
                 ) VALUES(?1, '/tmp/repo', 'repo', 'scan_only', ?2, ?3)",
                params![
                    format!("snapshot:{index}"),
                    inventory(files, hotspots, score),
                    created_at
                ],
            )
            .expect("snapshot");
        }
        for index in 0..outcome_count {
            let pass = index >= failures;
            let created_at = format!("2026-01-05T{:02}:00:00Z", index);
            conn.execute(
                "INSERT INTO synthetic_qa_runs(
                    id, repo_path, loop_id, runner_type, pass, duration_ms, created_at
                 ) VALUES(?1, '/tmp/repo', 'loop', 'playwright', ?2, 10, ?3)",
                params![format!("qa:{index}"), pass, created_at],
            )
            .expect("qa");
        }
        conn
    }

    #[test]
    fn sparse_outcomes_remain_insufficient() {
        let conn = fixture(2, 1);
        let (calibrations, _) =
            build_outcome_risk_calibrations(&conn, "/tmp/repo").expect("calibration");
        assert!(!calibrations.is_empty());
        assert!(calibrations
            .iter()
            .all(|calibration| calibration.state == "insufficient"));
    }

    #[test]
    fn mixed_supported_outcomes_become_qualified_without_verdicts() {
        let conn = fixture(10, 5);
        let (calibrations, _) =
            build_outcome_risk_calibrations(&conn, "/tmp/repo").expect("calibration");
        assert!(calibrations
            .iter()
            .any(|calibration| calibration.state == "qualified"));
        assert!(calibrations
            .iter()
            .all(|calibration| calibration.summary.contains("not a verdict")));
    }

    #[test]
    fn incompatible_or_unchanged_snapshots_are_excluded() {
        let conn = fixture(4, 2);
        conn.execute(
            "INSERT INTO repo_unpacked_reports(
                id, repo_path, repo_name, status, inventory_json, created_at
             ) VALUES('invalid', '/tmp/repo', 'repo', 'scan_only', '{',
                      '2026-01-10T00:00:00Z')",
            [],
        )
        .expect("invalid snapshot");
        let (_, exclusions) =
            build_outcome_risk_calibrations(&conn, "/tmp/repo").expect("calibration");
        assert!(exclusions
            .iter()
            .any(|reason| reason.contains("inventory JSON is invalid")));
    }

    #[test]
    fn wilson_interval_stays_bounded() {
        for failures in 0..=10 {
            let (low, high) = wilson_interval(failures, 10);
            assert!((0.0..=1.0).contains(&low));
            assert!((0.0..=1.0).contains(&high));
            assert!(low <= high);
        }
    }

    fn directional_observations(failure_delta: f64, success_delta: f64) -> Vec<Observation> {
        (0..8)
            .map(|index| {
                let failure = index < 4;
                Observation {
                    id: format!("observation:{index}"),
                    repository_identity: "repo:test".to_string(),
                    before_id: "before".to_string(),
                    after_id: "after".to_string(),
                    feature_key: "health.hotspots".to_string(),
                    feature_delta: if failure {
                        failure_delta
                    } else {
                        success_delta
                    },
                    outcome: Outcome {
                        id: format!("outcome:{index}"),
                        kind: "qa".to_string(),
                        state: if failure { "failure" } else { "success" }.to_string(),
                        created_at: format!("2026-01-05T{:02}:00:00Z", index),
                    },
                    metadata_json: "{}".to_string(),
                }
            })
            .collect()
    }

    #[test]
    fn larger_failure_delta_is_qualified_as_increasing_risk() {
        let conn = Connection::open_in_memory().expect("database");
        schema::run_migrations(&conn).expect("schema");
        let summaries =
            summarize_observations(&conn, "/tmp/repo", &directional_observations(5.0, 1.0), &[])
                .expect("summaries");
        assert_eq!(summaries[0].state, "qualified");
        assert_eq!(summaries[0].direction, "increases_risk");
    }

    #[test]
    fn smaller_failure_delta_is_qualified_as_decreasing_risk() {
        let conn = Connection::open_in_memory().expect("database");
        schema::run_migrations(&conn).expect("schema");
        let summaries =
            summarize_observations(&conn, "/tmp/repo", &directional_observations(1.0, 5.0), &[])
                .expect("summaries");
        assert_eq!(summaries[0].state, "qualified");
        assert_eq!(summaries[0].direction, "decreases_risk");
    }
}
