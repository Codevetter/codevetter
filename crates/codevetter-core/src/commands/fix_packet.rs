//! Deterministic local agent handoff derived from one persisted local-check receipt.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

use super::local_check::LocalCheckReceipt;

const SCHEMA_VERSION: &str = "codevetter.agent-fix-packet/v1";
const MAX_FINDINGS: usize = 100;
const MAX_EVIDENCE_REFS: usize = 24;
const MAX_MARKDOWN_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentFixPacketReceipt {
    pub schema_version: String,
    pub created_at: String,
    pub run_id: String,
    pub repo_path: String,
    pub source: FixPacketSource,
    pub agent: String,
    pub task: FixPacketTask,
    pub route_advice: String,
    pub findings: Vec<FixPacketFinding>,
    pub evidence: Vec<FixPacketEvidence>,
    pub limitations: Vec<String>,
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FixPacketSource {
    pub input: String,
    pub base_sha: String,
    pub head_sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FixPacketTask {
    pub goal: String,
    pub acceptance_criteria: Vec<String>,
    pub non_goals: Vec<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FixPacketFinding {
    pub id: String,
    pub severity: String,
    pub title: String,
    pub summary: String,
    pub suggestion: Option<String>,
    pub file_path: String,
    pub line: Option<i64>,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FixPacketEvidence {
    pub kind: String,
    pub status: String,
    pub label: String,
    pub artifact: Option<String>,
    pub qualification: String,
}

pub fn build_agent_fix_packet(
    connection: &Connection,
    run_id: &str,
    selected_finding_ids: &[String],
) -> Result<AgentFixPacketReceipt, String> {
    validate_identity(run_id, "run id")?;
    if selected_finding_ids.len() > MAX_FINDINGS {
        return Err(format!(
            "At most {MAX_FINDINGS} findings can enter one fix packet"
        ));
    }
    let selected = selected_finding_ids
        .iter()
        .map(|id| {
            validate_identity(id, "finding id")?;
            Ok(id.clone())
        })
        .collect::<Result<HashSet<_>, String>>()?;
    if selected.len() != selected_finding_ids.len() {
        return Err("Finding selection contains duplicate identities".into());
    }

    let receipt_json: Option<String> = connection
        .query_row(
            "SELECT receipt_json FROM local_check_runs WHERE run_id = ?1",
            [run_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Read local-check receipt: {error}"))?;
    let receipt_json = receipt_json.ok_or_else(|| "Local-check run was not found".to_string())?;
    let receipt: Value = serde_json::from_str(&receipt_json)
        .map_err(|error| format!("Decode local-check receipt: {error}"))?;
    if string(&receipt, "schema_version") != Some("codevetter.local-check/v1") {
        return Err("Only completed codevetter.local-check/v1 receipts support fix packets".into());
    }

    let repo_path = required_string(&receipt, "repo_path")?;
    let source = receipt
        .get("source")
        .ok_or_else(|| "Local-check receipt has no source identity".to_string())?;
    let source = FixPacketSource {
        input: required_string(source, "input")?,
        base_sha: required_string(source, "base_sha")?,
        head_sha: required_string(source, "head_sha")?,
    };
    let task_goal = required_string(&receipt, "task")?;
    let review_evidence = receipt
        .pointer("/stages/review/evidence")
        .unwrap_or(&Value::Null);
    let all_findings = review_evidence
        .get("findings")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut matched = HashSet::new();
    let mut findings = Vec::new();
    for (index, finding) in all_findings.into_iter().take(MAX_FINDINGS).enumerate() {
        let persisted_id = string(&finding, "id").map(ToOwned::to_owned);
        if !selected.is_empty()
            && !persisted_id
                .as_ref()
                .is_some_and(|id| selected.contains(id))
        {
            continue;
        }
        let file_path = string(&finding, "filePath")
            .or_else(|| string(&finding, "file_path"))
            .unwrap_or_default()
            .to_string();
        if file_path.is_empty() || std::path::Path::new(&file_path).is_absolute() {
            continue;
        }
        let id = persisted_id.unwrap_or_else(|| format!("receipt-finding-{}", index + 1));
        matched.insert(id.clone());
        findings.push(FixPacketFinding {
            id,
            severity: string(&finding, "severity")
                .unwrap_or("unknown")
                .to_string(),
            title: required_string(&finding, "title")?,
            summary: required_string(&finding, "summary")?,
            suggestion: string(&finding, "suggestion")
                .filter(|value| !value.trim().is_empty())
                .map(ToOwned::to_owned),
            file_path,
            line: finding.get("line").and_then(Value::as_i64),
            confidence: finding.get("confidence").and_then(Value::as_f64),
        });
    }
    if !selected.is_empty() && !selected.is_subset(&matched) {
        let missing = selected.difference(&matched).cloned().collect::<Vec<_>>();
        return Err(format!(
            "Selected findings are unavailable or not source-qualified: {}",
            missing.join(", ")
        ));
    }
    if findings.is_empty() {
        return Err("The local-check receipt has no source-qualified findings to hand off".into());
    }

    let acceptance_criteria = receipt
        .pointer("/spec_coverage/requirements")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|requirement| {
            requirement
                .get("supplied_to_review")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || requirement
                    .get("selected_for_execution")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
        })
        .filter_map(|requirement| {
            let title = string(requirement, "title")?;
            let text = string(requirement, "text").unwrap_or_default();
            Some(if text.is_empty() {
                title.to_string()
            } else {
                format!("{title}: {text}")
            })
        })
        .take(32)
        .collect::<Vec<_>>();

    let agent = string(review_evidence, "agent")
        .or_else(|| {
            review_evidence
                .pointer("/review_manifest/executor_id")?
                .as_str()
        })
        .unwrap_or("coding-agent")
        .to_string();
    let evidence = collect_evidence(&receipt, review_evidence);
    let high_risk = findings
        .iter()
        .any(|finding| matches!(finding.severity.as_str(), "critical" | "high"));
    let route_advice = if high_risk {
        "Use a full coding agent in an isolated worktree; require executable proof before merge."
    } else if findings.len() <= 2 {
        "Keep the patch tightly scoped, then rerun the exact verification receipt."
    } else {
        "Split this broad batch by file or behavior before starting the first fix attempt."
    }
    .to_string();
    let mut limitations = string_array(&receipt, "limitations");
    limitations.push(
        "This packet is a deterministic handoff, not proof that a proposed fix is correct.".into(),
    );
    if acceptance_criteria.is_empty() {
        limitations.push(
            "No explicit acceptance requirements were attached; the task goal is the only intent contract."
                .into(),
        );
    }
    let mut packet = AgentFixPacketReceipt {
        schema_version: SCHEMA_VERSION.into(),
        created_at: chrono::Utc::now().to_rfc3339(),
        run_id: run_id.to_string(),
        repo_path,
        source,
        agent,
        task: FixPacketTask {
            goal: task_goal,
            acceptance_criteria,
            non_goals: Vec::new(),
            source: "persisted_local_check_receipt".into(),
        },
        route_advice,
        findings,
        evidence,
        limitations,
        markdown: String::new(),
    };
    packet.markdown = render_markdown(&packet);
    if packet.markdown.len() > MAX_MARKDOWN_BYTES {
        return Err("Agent fix packet exceeds the bounded Markdown size".into());
    }
    Ok(packet)
}

pub fn load_local_check_receipt(
    connection: &Connection,
    run_id: &str,
) -> Result<LocalCheckReceipt, String> {
    validate_identity(run_id, "run id")?;
    let receipt_json: Option<String> = connection
        .query_row(
            "SELECT receipt_json FROM local_check_runs WHERE run_id = ?1",
            [run_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Read local-check receipt: {error}"))?;
    let receipt_json = receipt_json.ok_or_else(|| "Local-check run was not found".to_string())?;
    let receipt: LocalCheckReceipt = serde_json::from_str(&receipt_json)
        .map_err(|error| format!("Decode local-check receipt: {error}"))?;
    if receipt.schema_version != "codevetter.local-check/v1" || receipt.run_id != run_id {
        return Err(
            "Only the exact completed codevetter.local-check/v1 receipt is supported".into(),
        );
    }
    Ok(receipt)
}

fn collect_evidence(receipt: &Value, review_evidence: &Value) -> Vec<FixPacketEvidence> {
    let mut rows = Vec::new();
    for stage in ["correctness", "performance"] {
        let Some(value) = receipt.pointer(&format!("/stages/{stage}")) else {
            continue;
        };
        let status = string(value, "status").unwrap_or("unavailable");
        let target = value.get("target");
        let label = target
            .and_then(|target| {
                let adapter = string(target, "adapter")?;
                let path = string(target, "target")?;
                Some(format!("{adapter} · {path}"))
            })
            .unwrap_or_else(|| format!("{stage} stage"));
        rows.push(FixPacketEvidence {
            kind: stage.into(),
            status: status.into(),
            label,
            artifact: None,
            qualification: "versioned local-check stage".into(),
        });
    }
    for qa in review_evidence
        .get("qa_evidence")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(5)
    {
        rows.push(FixPacketEvidence {
            kind: "synthetic_qa".into(),
            status: if qa.get("pass").and_then(Value::as_bool) == Some(true) {
                "passed".into()
            } else {
                "failed".into()
            },
            label: string(qa, "goal")
                .or_else(|| string(qa, "route"))
                .unwrap_or("Recorded QA journey")
                .to_string(),
            artifact: string(qa, "screenshot_path").map(ToOwned::to_owned),
            qualification: "recorded runtime evidence".into(),
        });
    }
    for step in review_evidence
        .get("evidence_procedure_steps")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(8)
    {
        rows.push(FixPacketEvidence {
            kind: "procedure_gate".into(),
            status: string(step, "status").unwrap_or("planned").to_string(),
            label: string(step, "gate")
                .or_else(|| string(step, "procedure"))
                .unwrap_or("Evidence procedure")
                .to_string(),
            artifact: string(step, "artifact")
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
            qualification: "deterministic procedure context".into(),
        });
    }
    rows.truncate(MAX_EVIDENCE_REFS);
    rows
}

fn render_markdown(packet: &AgentFixPacketReceipt) -> String {
    let mut out = vec![
        "# Agent Fix Packet".to_string(),
        String::new(),
        format!("Run: {}", packet.run_id),
        format!("Repo: {}", packet.repo_path),
        format!("Diff: {}", packet.source.input),
        format!("Head: {}", packet.source.head_sha),
        format!("Agent: {}", packet.agent),
        format!("Route advice: {}", packet.route_advice),
        String::new(),
        format!("Goal: {}", packet.task.goal),
    ];
    if !packet.task.acceptance_criteria.is_empty() {
        out.extend([String::new(), "Acceptance:".into()]);
        out.extend(
            packet
                .task
                .acceptance_criteria
                .iter()
                .map(|value| format!("- {value}")),
        );
    }
    out.extend([String::new(), "Findings:".into()]);
    for (index, finding) in packet.findings.iter().enumerate() {
        let line = finding
            .line
            .map(|line| format!(":{line}"))
            .unwrap_or_default();
        out.push(format!(
            "- {}. [{}] {} ({}{})",
            index + 1,
            finding.severity,
            finding.title,
            finding.file_path,
            line
        ));
        out.push(format!("  Problem: {}", finding.summary));
        if let Some(suggestion) = &finding.suggestion {
            out.push(format!("  Suggested fix: {suggestion}"));
        }
    }
    if !packet.evidence.is_empty() {
        out.extend([String::new(), "Evidence to preserve:".into()]);
        for evidence in &packet.evidence {
            let artifact = evidence
                .artifact
                .as_ref()
                .map(|value| format!("; artifact={value}"))
                .unwrap_or_default();
            out.push(format!(
                "- [{} / {}] {} ({}){}",
                evidence.kind, evidence.status, evidence.label, evidence.qualification, artifact
            ));
        }
    }
    out.extend([String::new(), "Limitations:".into()]);
    out.extend(packet.limitations.iter().map(|value| format!("- {value}")));
    out.join("\n")
}

fn validate_identity(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 160
        || value.trim() != value
        || value.contains('\0')
        || value.contains(['\r', '\n'])
    {
        return Err(format!("{label} must be a bounded single-line identity"));
    }
    Ok(())
}

fn required_string(value: &Value, key: &str) -> Result<String, String> {
    string(value, key)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("Local-check receipt is missing {key}"))
}

fn string<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn string_array(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use serde_json::json;

    fn fixture() -> Connection {
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("schema");
        let receipt = json!({
            "schema_version": "codevetter.local-check/v1",
            "run_id": "local-check-7",
            "ran_at": "2026-09-01T00:00:00Z",
            "repo_path": "/fixture/repo",
            "task": "Preserve checkout totals",
            "source": {
                "input": "main...HEAD",
                "base_sha": "a".repeat(40),
                "head_sha": "b".repeat(40),
                "changed_paths": ["src/cart.ts"]
            },
            "stages": {
                "review": {"status":"needs_attention","evidence":{
                    "review_manifest":{"executor_id":"claude"},
                    "findings":[
                        {"id":"finding-1","severity":"high","title":"Stale total","summary":"Uses stale subtotal.","suggestion":"Use discounted total.","filePath":"src/cart.ts","line":42,"confidence":0.94},
                        {"id":"finding-2","severity":"low","title":"Copy","summary":"Label is unclear.","filePath":"src/cart.ts","line":9}
                    ],
                    "qa_evidence":[{"goal":"Verify checkout","pass":true,"screenshot_path":"artifacts/checkout.png"}],
                    "evidence_procedure_steps":[{"status":"satisfied","gate":"Exact checkout passes","artifact":"artifacts/receipt.json"}]
                }},
                "correctness":{"status":"failed","target":{"adapter":"vitest","target":"src/cart.test.ts"}},
                "performance":{"status":"no_confidence","target":null}
            },
            "spec_coverage":{"requirements":[{"title":"Discounted total","text":"Charge the post-discount amount.","supplied_to_review":true,"selected_for_execution":true}]},
            "limitations":["No performance workload matched."]
        });
        connection.execute(
            "INSERT INTO local_check_runs(run_id,schema_version,repo_path,base_sha,head_sha,verdict,task,receipt_json,ran_at) VALUES(?1,'codevetter.local-check/v1','/fixture/repo',?2,?3,'needs_attention','Preserve checkout totals',?4,'2026-09-01T00:00:00Z')",
            params!["local-check-7", "a".repeat(40), "b".repeat(40), receipt.to_string()],
        ).expect("insert receipt");
        connection
    }

    #[test]
    fn packet_preserves_selected_findings_acceptance_and_runtime_evidence() {
        let packet = build_agent_fix_packet(&fixture(), "local-check-7", &["finding-1".into()])
            .expect("fix packet");
        assert_eq!(packet.schema_version, SCHEMA_VERSION);
        assert_eq!(packet.findings.len(), 1);
        assert_eq!(packet.findings[0].id, "finding-1");
        assert_eq!(packet.task.acceptance_criteria.len(), 1);
        assert!(packet
            .evidence
            .iter()
            .any(|row| row.kind == "synthetic_qa" && row.status == "passed"));
        assert!(packet.markdown.contains("Use discounted total."));
        assert!(packet
            .markdown
            .contains("not proof that a proposed fix is correct"));
    }

    #[test]
    fn packet_rejects_unknown_or_unqualified_finding_selection() {
        let error = build_agent_fix_packet(&fixture(), "local-check-7", &["missing".into()])
            .expect_err("unknown finding");
        assert!(error.contains("unavailable"));
    }
}
