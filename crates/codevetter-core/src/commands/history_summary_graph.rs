use crate::commands::unpack_types::{
    RepoHistoryBrief, RepoHistoryGraph, RepoHistoryGraphEdge, RepoHistoryGraphNode,
};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

const MAX_NODES: usize = 240;
const MAX_EDGES: usize = 480;

fn id(kind: &str, value: &str) -> String {
    format!(
        "{kind}:{}",
        value
            .to_ascii_lowercase()
            .replace(|c: char| !c.is_ascii_alphanumeric(), "-")
    )
}

pub(crate) fn build_history_graph(brief: &RepoHistoryBrief) -> RepoHistoryGraph {
    let mut nodes = HashMap::<String, RepoHistoryGraphNode>::new();
    let mut edges = Vec::<RepoHistoryGraphEdge>::new();
    let mut truncated = false;
    let mut add_node = |node: RepoHistoryGraphNode| {
        if nodes.len() < MAX_NODES || nodes.contains_key(&node.id) {
            nodes.entry(node.id.clone()).or_insert(node);
        } else {
            truncated = true;
        }
    };

    for commit in &brief.recent_commits {
        let commit_id = id("commit", &commit.sha);
        add_node(RepoHistoryGraphNode {
            id: commit_id.clone(),
            kind: "commit".into(),
            label: commit.subject.clone(),
            path: None,
            detail: commit.date.clone().unwrap_or_default(),
            citations: vec![format!("git:{}", commit.sha)],
            trust: "git_observed".into(),
        });
        for file in commit.files.iter().take(24) {
            let file_id = id("file", file);
            add_node(RepoHistoryGraphNode {
                id: file_id.clone(),
                kind: "file".into(),
                label: file.clone(),
                path: Some(file.clone()),
                detail: "Changed in recent local git history".into(),
                citations: vec![file.clone()],
                trust: "git_observed".into(),
            });
            edges.push(RepoHistoryGraphEdge {
                from: commit_id.clone(),
                to: file_id,
                kind: "changed".into(),
                evidence: format!("{} changed this file", commit.sha),
                citations: vec![format!("git:{}", commit.sha), file.clone()],
                trust: "git_observed".into(),
            });
        }
    }
    for (idx, decision) in brief.decisions.iter().enumerate() {
        let path = decision
            .source
            .split('#')
            .next()
            .unwrap_or(&decision.source);
        let decision_id = id("decision", &format!("{idx}-{}", decision.source));
        let file_id = id("file", path);
        add_node(RepoHistoryGraphNode {
            id: file_id.clone(),
            kind: "file".into(),
            label: path.into(),
            path: Some(path.into()),
            detail: "Contains durable decision context".into(),
            citations: vec![decision.source.clone()],
            trust: "source_backed".into(),
        });
        add_node(RepoHistoryGraphNode {
            id: decision_id.clone(),
            kind: "decision".into(),
            label: decision.text.clone(),
            path: Some(path.into()),
            detail: decision.marker.clone(),
            citations: vec![decision.source.clone()],
            trust: "source_backed".into(),
        });
        edges.push(RepoHistoryGraphEdge {
            from: file_id,
            to: decision_id,
            kind: "records_decision".into(),
            evidence: decision.text.clone(),
            citations: vec![decision.source.clone()],
            trust: "source_backed".into(),
        });
    }
    for hint in &brief.test_hints {
        let file_id = id("file", &hint.path);
        let test_id = id("test", &format!("{}-{}", hint.path, hint.reason));
        add_node(RepoHistoryGraphNode {
            id: file_id.clone(),
            kind: "file".into(),
            label: hint.path.clone(),
            path: Some(hint.path.clone()),
            detail: "Verification source".into(),
            citations: vec![hint.path.clone()],
            trust: "source_backed".into(),
        });
        add_node(RepoHistoryGraphNode {
            id: test_id.clone(),
            kind: "test".into(),
            label: hint.reason.clone(),
            path: Some(hint.path.clone()),
            detail: "Likely verification lead".into(),
            citations: vec![hint.path.clone()],
            trust: "navigation_lead".into(),
        });
        edges.push(RepoHistoryGraphEdge {
            from: file_id,
            to: test_id,
            kind: "verified_by".into(),
            evidence: hint.reason.clone(),
            citations: vec![hint.path.clone()],
            trust: "navigation_lead".into(),
        });
    }
    for coupling in &brief.temporal_couplings {
        if coupling.files.len() < 2 {
            continue;
        }
        let left = id("file", &coupling.files[0]);
        let right = id("file", &coupling.files[1]);
        for file in coupling.files.iter().take(2) {
            add_node(RepoHistoryGraphNode {
                id: id("file", file),
                kind: "file".into(),
                label: file.clone(),
                path: Some(file.clone()),
                detail: "Recent co-change lead".into(),
                citations: vec![file.clone()],
                trust: "git_observed".into(),
            });
        }
        edges.push(RepoHistoryGraphEdge {
            from: left,
            to: right,
            kind: "co_changes_with".into(),
            evidence: coupling.reason.clone(),
            citations: coupling
                .last_commit
                .iter()
                .map(|sha| format!("git:{sha}"))
                .collect(),
            trust: "navigation_lead".into(),
        });
    }
    let mut nodes = nodes.into_values().collect::<Vec<_>>();
    nodes.sort_by(|a, b| a.id.cmp(&b.id));
    let node_ids = nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    let edge_count_before_node_filter = edges.len();
    edges.retain(|edge| {
        node_ids.contains(edge.from.as_str()) && node_ids.contains(edge.to.as_str())
    });
    truncated |= edges.len() < edge_count_before_node_filter;
    edges.sort_by(|a, b| (&a.from, &a.kind, &a.to).cmp(&(&b.from, &b.kind, &b.to)));
    edges.dedup_by(|a, b| a.from == b.from && a.kind == b.kind && a.to == b.to);
    if edges.len() > MAX_EDGES {
        edges.truncate(MAX_EDGES);
        truncated = true;
    }
    RepoHistoryGraph {
        schema_version: 2,
        nodes,
        edges,
        truncated,
    }
}

#[derive(Debug, Serialize)]
pub struct HistoryGraphQueryResult {
    pub query: String,
    pub matched: Vec<RepoHistoryGraphNode>,
    pub related: Vec<RepoHistoryGraphNode>,
    pub relationships: Vec<RepoHistoryGraphEdge>,
    pub confidence: String,
    pub message: String,
    pub truncated: bool,
}

pub fn query_history_graph(
    graph: &RepoHistoryGraph,
    query: &str,
    limit: usize,
) -> HistoryGraphQueryResult {
    let query = query.trim();
    let lower = query.to_ascii_lowercase();
    let tokens = lower
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| t.len() > 1)
        .collect::<Vec<_>>();
    let mut ranked = graph
        .nodes
        .iter()
        .filter_map(|node| {
            let exact_id = node.id.eq_ignore_ascii_case(query);
            let exact_path = node
                .path
                .as_deref()
                .is_some_and(|path| path.eq_ignore_ascii_case(query));
            let exact_label = node.label.eq_ignore_ascii_case(query);
            let hay = format!(
                "{} {} {} {}",
                node.id,
                node.label,
                node.path.as_deref().unwrap_or(""),
                node.detail
            )
            .to_ascii_lowercase();
            let score = if exact_id {
                30_000
            } else if exact_path && node.kind == "file" {
                29_000
            } else if exact_path {
                28_000
            } else if exact_label {
                27_000
            } else {
                tokens.iter().filter(|token| hay.contains(**token)).count()
            };
            (score > 0).then_some((score, node.clone()))
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
    let cap = limit.clamp(1, 12);
    let matched = ranked
        .iter()
        .take(cap)
        .map(|(_, node)| node.clone())
        .collect::<Vec<_>>();
    let ids = matched
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    let mut relationships = graph
        .edges
        .iter()
        .filter(|edge| ids.contains(edge.from.as_str()) || ids.contains(edge.to.as_str()))
        .take(24)
        .cloned()
        .collect::<Vec<_>>();
    relationships.sort_by(|a, b| (&a.from, &a.kind, &a.to).cmp(&(&b.from, &b.kind, &b.to)));
    let related_ids = relationships
        .iter()
        .flat_map(|edge| [&edge.from, &edge.to])
        .filter(|id| !ids.contains(id.as_str()))
        .collect::<HashSet<_>>();
    let mut related = graph
        .nodes
        .iter()
        .filter(|node| related_ids.contains(&node.id))
        .take(18)
        .cloned()
        .collect::<Vec<_>>();
    related.sort_by(|a, b| a.id.cmp(&b.id));
    let exact = ranked.first().is_some_and(|(score, _)| *score >= 27_000);
    let truncated = ranked.len() > cap || graph.truncated || relationships.len() == 24;
    HistoryGraphQueryResult {
        query: query.into(),
        confidence: if matched.is_empty() {
            "none"
        } else if exact {
            "strong"
        } else {
            "lead"
        }
        .into(),
        message: if matched.is_empty() {
            "No bounded local-history match. Try an exact file path, commit, decision, or test term.".into()
        } else if exact {
            "Exact local-history match with one-hop relationships.".into()
        } else {
            "Ranked local-history leads; verify cited sources before changing code.".into()
        },
        matched,
        related,
        relationships,
        truncated,
    }
}

#[tauri::command]
pub async fn query_repo_history_graph(
    graph: RepoHistoryGraph,
    query: String,
    limit: Option<usize>,
) -> Result<HistoryGraphQueryResult, String> {
    if graph.nodes.len() > MAX_NODES || graph.edges.len() > MAX_EDGES {
        return Err("History graph exceeds supported query bounds.".into());
    }
    Ok(query_history_graph(&graph, &query, limit.unwrap_or(6)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::unpack_types::{
        RepoHistoryCommit, RepoHistoryDecision, RepoHistoryTestHint,
    };

    fn brief() -> RepoHistoryBrief {
        RepoHistoryBrief {
            schema_version: 2,
            summary: "test".into(),
            recent_commits: vec![RepoHistoryCommit {
                sha: "abc123".into(),
                date: Some("2026-07-13".into()),
                subject: "Change review".into(),
                files: vec!["src/review.ts".into()],
            }],
            decisions: vec![RepoHistoryDecision {
                marker: "DECISION".into(),
                text: "Keep proof local".into(),
                source: "src/review.ts#L2".into(),
            }],
            test_hints: vec![RepoHistoryTestHint {
                path: "tests/review.test.ts".into(),
                reason: "review proof test".into(),
            }],
            temporal_couplings: Vec::new(),
            graph: Default::default(),
            sources: Vec::new(),
            truncated: false,
        }
    }

    #[test]
    fn graph_is_deterministic_and_connects_history_kinds() {
        let graph = build_history_graph(&brief());
        assert_eq!(graph, build_history_graph(&brief()));
        assert!(graph.nodes.iter().any(|node| node.kind == "commit"));
        assert!(graph.nodes.iter().any(|node| node.kind == "decision"));
        assert!(graph.nodes.iter().any(|node| node.kind == "test"));
        assert!(graph.edges.iter().any(|edge| edge.kind == "changed"));
        assert!(graph
            .edges
            .iter()
            .any(|edge| edge.kind == "records_decision"));
        assert!(graph.edges.iter().any(|edge| edge.kind == "verified_by"));
    }

    #[test]
    fn exact_file_query_wins_and_returns_bounded_one_hop_context() {
        let graph = build_history_graph(&brief());
        let result = query_history_graph(&graph, "src/review.ts", 2);
        assert_eq!(result.confidence, "strong");
        assert_eq!(result.matched[0].kind, "file");
        assert_eq!(result.matched[0].path.as_deref(), Some("src/review.ts"));
        assert!(!result.relationships.is_empty());
        assert!(!result.related.is_empty());
        let none = query_history_graph(&graph, "definitely absent", 2);
        assert_eq!(none.confidence, "none");
        assert!(none.message.contains("No bounded"));
    }

    #[test]
    fn graph_caps_large_inputs_explicitly() {
        let mut input = brief();
        input.recent_commits = (0..300)
            .map(|idx| RepoHistoryCommit {
                sha: format!("sha{idx}"),
                date: None,
                subject: format!("commit {idx}"),
                files: vec![format!("src/file-{idx}.ts")],
            })
            .collect();
        let graph = build_history_graph(&input);
        assert!(graph.nodes.len() <= MAX_NODES);
        assert!(graph.edges.len() <= MAX_EDGES);
        assert!(graph
            .edges
            .iter()
            .all(|edge| graph.nodes.iter().any(|node| node.id == edge.from)
                && graph.nodes.iter().any(|node| node.id == edge.to)));
        assert!(graph.truncated);
    }
}
