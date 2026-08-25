use super::*;
use crate::commands::{
    deterministic_review::{plan_units, public_manifest_page, resolve_target},
    evidence_scope::{
        resolve as resolve_evidence_scope, EvidenceScopeConsumer, EvidenceScopeInput,
        EvidenceScopeKind, EvidenceScopePlan,
    },
};
use std::collections::BTreeSet;

const GRAPH_LEAD_LIMIT: usize = 12;
const IMPACT_ROOT_LIMIT: usize = 2;
const IMPACT_LEAD_LIMIT: usize = 8;
const HISTORY_LEAD_LIMIT: usize = 8;
const REVIEW_MANIFEST_LIMIT: usize = 5;

pub(super) fn prepare_review_packet(
    connection: &Connection,
    repo_path: &str,
    graph: &StructuralGraphReadService<'_>,
    history: &HistoryReadService<'_>,
    task: &str,
    change: &str,
) -> Result<Value, String> {
    let target = resolve_target(repo_path, change)?;
    let units = plan_units(&target, "review-agent")?;
    let changed_paths = units
        .iter()
        .map(|unit| {
            json!({
                "path": unit.file_path,
                "status": unit.file_status,
                "diff_bytes": unit.diff_bytes,
                "review_coverage_state": unit.coverage_state,
                "review_coverage_reason": unit.coverage_reason,
            })
        })
        .collect::<Vec<_>>();

    let mut limitations = vec![
        "This packet prepares review context; it does not run a reviewer or prove correctness."
            .to_string(),
        "Graph impact entries are bounded leads and require source or executable confirmation."
            .to_string(),
    ];

    let graph_context = graph_context(graph, task, &units, &mut limitations);
    let history_context = match history.search(task, HISTORY_LEAD_LIMIT, 0) {
        Ok(result) => json!({"status": "ready", "result": result}),
        Err(error) => {
            limitations.push(format!("History leads are unavailable: {error}"));
            json!({"status": "unavailable", "items": []})
        }
    };
    let review_evidence =
        match public_manifest_page(connection, repo_path, None, REVIEW_MANIFEST_LIMIT, 0) {
            Ok(page) => json!({"status": "ready", "result": page}),
            Err(error) => {
                limitations.push(format!("Prior review evidence is unavailable: {error}"));
                json!({"status": "unavailable", "items": []})
            }
        };

    let testing = verification_scope(repo_path, change, EvidenceScopeConsumer::Testing);
    let performance = verification_scope(repo_path, change, EvidenceScopeConsumer::Performance);
    record_scope_limitation("Testing", &testing, &mut limitations);
    record_scope_limitation("Performance", &performance, &mut limitations);

    let graph_lead_count = graph_context["leads"].as_array().map_or(0, Vec::len);
    let impact_root_count = graph_context["impact"].as_array().map_or(0, Vec::len);
    let history_lead_count = history_context["result"]["items"]
        .as_array()
        .map_or(0, Vec::len);
    let prior_manifest_count = review_evidence["result"]["items"]
        .as_array()
        .map_or(0, Vec::len);

    Ok(json!({
        "schema_version": "codevetter.review-packet/v1",
        "task": task,
        "source": {
            "identity": target.identity,
            "diff_mode": target.diff_mode,
            "requested_range": target.requested_range,
            "head_sha": target.head_sha,
            "base_sha": target.base_sha,
            "source_fingerprint": target.source_fingerprint,
            "changed_paths": changed_paths,
        },
        "graph": graph_context,
        "history": history_context,
        "prior_review_evidence": review_evidence,
        "verification_targets": {
            "testing": scope_value(testing),
            "performance": scope_value(performance),
        },
        "coverage": {
            "changed_path_count": units.len(),
            "graph_lead_count": graph_lead_count,
            "impact_root_count": impact_root_count,
            "history_lead_count": history_lead_count,
            "prior_manifest_count": prior_manifest_count,
        },
        "limitations": limitations,
    }))
}

fn graph_context(
    graph: &StructuralGraphReadService<'_>,
    task: &str,
    units: &[crate::commands::deterministic_review::ReviewUnit],
    limitations: &mut Vec<String>,
) -> Value {
    let filter = GraphQueryFilter::default();
    let mut leads = Vec::new();
    let mut seen = BTreeSet::new();
    let queries =
        std::iter::once(task).chain(units.iter().take(5).map(|unit| unit.file_path.as_str()));
    for query in queries {
        let remaining = GRAPH_LEAD_LIMIT.saturating_sub(leads.len());
        if remaining == 0 {
            break;
        }
        match graph.search(query, &filter, remaining) {
            Ok(result) => {
                for hit in result.hits {
                    if seen.insert(hit.node.id.clone()) {
                        leads.push(hit);
                    }
                }
            }
            Err(error) => {
                limitations.push(format!("Structural graph leads are unavailable: {error}"));
                return json!({"status": "unavailable", "leads": [], "impact": []});
            }
        }
    }

    let mut impact = Vec::new();
    for hit in leads.iter().take(IMPACT_ROOT_LIMIT) {
        match graph.impact(
            &hit.node.id,
            GraphDirection::Both,
            2,
            &filter,
            IMPACT_LEAD_LIMIT,
        ) {
            Ok(result) => impact.push(result),
            Err(error) => limitations.push(format!(
                "Impact for graph node {} is unavailable: {error}",
                hit.node.id
            )),
        }
    }
    json!({"status": "ready", "leads": leads, "impact": impact})
}

fn verification_scope(
    repo_path: &str,
    change: &str,
    consumer: EvidenceScopeConsumer,
) -> Result<EvidenceScopePlan, String> {
    tauri::async_runtime::block_on(resolve_evidence_scope(EvidenceScopeInput {
        repo_path: repo_path.to_string(),
        kind: EvidenceScopeKind::Change,
        value: Some(change.to_string()),
        consumer,
    }))
}

fn scope_value(scope: Result<EvidenceScopePlan, String>) -> Value {
    match scope {
        Ok(plan) => json!({"status": "ready", "plan": plan}),
        Err(error) => json!({"status": "unavailable", "reason": error}),
    }
}

fn record_scope_limitation(
    label: &str,
    scope: &Result<EvidenceScopePlan, String>,
    limitations: &mut Vec<String>,
) {
    if let Err(error) = scope {
        limitations.push(format!("{label} target discovery is unavailable: {error}"));
    }
}
