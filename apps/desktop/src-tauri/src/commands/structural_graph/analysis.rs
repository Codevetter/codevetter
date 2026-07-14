use super::types::{
    stable_graph_id, StructuralGraphCommunity, StructuralGraphEdge, StructuralGraphNode,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StructuralGraphNodeRank {
    pub node_id: String,
    pub label: String,
    pub kind: String,
    pub path: Option<String>,
    pub degree: usize,
    pub score: f64,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StructuralGraphConnectionInsight {
    pub edge_id: String,
    pub from_community_id: String,
    pub to_community_id: String,
    pub score: f64,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StructuralGraphSuggestedQuestion {
    pub question: String,
    pub node_ids: Vec<String>,
    pub source_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct StructuralGraphAnalysisSummary {
    pub communities: Vec<StructuralGraphCommunity>,
    pub hubs: Vec<StructuralGraphNodeRank>,
    pub super_hubs: Vec<StructuralGraphNodeRank>,
    pub bridges: Vec<StructuralGraphNodeRank>,
    pub cross_community_edges: Vec<StructuralGraphConnectionInsight>,
    pub surprising_connections: Vec<StructuralGraphConnectionInsight>,
    pub suggested_questions: Vec<StructuralGraphSuggestedQuestion>,
}

pub fn analyze_graph(
    nodes: &mut [StructuralGraphNode],
    edges: &[StructuralGraphEdge],
) -> Vec<StructuralGraphCommunity> {
    let community_key_by_node = assign_community_keys(nodes, edges);
    let mut degree: HashMap<&str, usize> = HashMap::new();
    let mut bridge_nodes: HashMap<String, HashSet<String>> = HashMap::new();
    for edge in edges {
        *degree.entry(edge.from.as_str()).or_default() += 1;
        *degree.entry(edge.to.as_str()).or_default() += 1;
        let Some(from_community) = community_key_by_node.get(&edge.from) else {
            continue;
        };
        let Some(to_community) = community_key_by_node.get(&edge.to) else {
            continue;
        };
        if from_community != to_community {
            bridge_nodes
                .entry(from_community.clone())
                .or_default()
                .insert(edge.from.clone());
            bridge_nodes
                .entry(to_community.clone())
                .or_default()
                .insert(edge.to.clone());
        }
    }

    let mut members: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for node in nodes.iter_mut() {
        let key = community_key_by_node
            .get(&node.id)
            .cloned()
            .unwrap_or_else(|| "root".to_string());
        let community_id = stable_graph_id("community", &key);
        node.community_id = Some(community_id);
        members.entry(key).or_default().push(node.id.clone());
    }

    members
        .into_iter()
        .map(|(key, mut member_ids)| {
            member_ids.sort();
            let mut ranked = member_ids.clone();
            ranked.sort_by(|left, right| {
                degree
                    .get(right.as_str())
                    .copied()
                    .unwrap_or(0)
                    .cmp(&degree.get(left.as_str()).copied().unwrap_or(0))
                    .then_with(|| left.cmp(right))
            });
            let hub_node_ids = ranked
                .into_iter()
                .filter(|node_id| degree.get(node_id.as_str()).copied().unwrap_or(0) > 0)
                .take(5)
                .collect::<Vec<_>>();
            let mut bridges = bridge_nodes
                .remove(&key)
                .unwrap_or_default()
                .into_iter()
                .collect::<Vec<_>>();
            bridges.sort();
            let score = member_ids
                .iter()
                .map(|node_id| degree.get(node_id.as_str()).copied().unwrap_or(0))
                .sum::<usize>() as f64;
            StructuralGraphCommunity {
                id: stable_graph_id("community", &key),
                label: key,
                member_count: member_ids.len(),
                hub_node_ids,
                bridge_node_ids: bridges,
                score,
            }
        })
        .collect()
}

fn assign_community_keys(
    nodes: &[StructuralGraphNode],
    edges: &[StructuralGraphEdge],
) -> HashMap<String, String> {
    let node_ids = nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    let path_seed = nodes
        .iter()
        .map(|node| (node.id.clone(), community_key(node)))
        .collect::<HashMap<_, _>>();
    let mut labels = path_seed.clone();
    let mut adjacency: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in edges {
        if !node_ids.contains(edge.from.as_str()) || !node_ids.contains(edge.to.as_str()) {
            continue;
        }
        adjacency.entry(&edge.from).or_default().push(&edge.to);
        adjacency.entry(&edge.to).or_default().push(&edge.from);
    }
    for neighbors in adjacency.values_mut() {
        neighbors.sort_unstable();
        neighbors.dedup();
    }
    let mut ordered_ids = nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<Vec<_>>();
    ordered_ids.sort_unstable();
    for _ in 0..8 {
        let mut next = labels.clone();
        let mut changed = false;
        for node_id in &ordered_ids {
            let Some(current) = labels.get(*node_id) else {
                continue;
            };
            let mut scores = BTreeMap::<String, usize>::new();
            *scores.entry(current.clone()).or_default() += 2;
            if let Some(seed) = path_seed.get(*node_id) {
                *scores.entry(seed.clone()).or_default() += 1;
            }
            for neighbor in adjacency.get(*node_id).into_iter().flatten() {
                if let Some(label) = labels.get(*neighbor) {
                    *scores.entry(label.clone()).or_default() += 1;
                }
            }
            let selected = scores
                .into_iter()
                .max_by(|(left_label, left_score), (right_label, right_score)| {
                    left_score
                        .cmp(right_score)
                        .then_with(|| right_label.cmp(left_label))
                })
                .map(|(label, _)| label)
                .unwrap_or_else(|| current.clone());
            if selected != *current {
                next.insert((*node_id).to_string(), selected);
                changed = true;
            }
        }
        labels = next;
        if !changed {
            break;
        }
    }
    labels
}

pub fn summarize_graph_analysis(
    nodes: &[StructuralGraphNode],
    edges: &[StructuralGraphEdge],
    communities: &[StructuralGraphCommunity],
) -> StructuralGraphAnalysisSummary {
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let community_by_node = nodes
        .iter()
        .filter_map(|node| {
            node.community_id
                .as_deref()
                .map(|community| (node.id.as_str(), community))
        })
        .collect::<HashMap<_, _>>();
    let mut degree = HashMap::<&str, usize>::new();
    for edge in edges {
        *degree.entry(edge.from.as_str()).or_default() += 1;
        *degree.entry(edge.to.as_str()).or_default() += 1;
    }
    let super_hub_threshold = ((edges.len() as f64).sqrt().ceil() as usize).max(12);
    let mut ranked = nodes
        .iter()
        .filter_map(|node| {
            let node_degree = degree.get(node.id.as_str()).copied().unwrap_or_default();
            (node_degree > 0).then(|| StructuralGraphNodeRank {
                node_id: node.id.clone(),
                label: node.label.clone(),
                kind: node.kind.clone(),
                path: node.path.clone(),
                degree: node_degree,
                score: node_degree as f64,
                reason: "deterministic total degree".to_string(),
            })
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .degree
            .cmp(&left.degree)
            .then_with(|| left.node_id.cmp(&right.node_id))
    });
    let super_hubs = ranked
        .iter()
        .filter(|rank| rank.degree >= super_hub_threshold)
        .take(20)
        .cloned()
        .collect::<Vec<_>>();
    let super_hub_ids = super_hubs
        .iter()
        .map(|rank| rank.node_id.as_str())
        .collect::<HashSet<_>>();
    let hubs = ranked
        .iter()
        .filter(|rank| !super_hub_ids.contains(rank.node_id.as_str()))
        .take(20)
        .cloned()
        .collect::<Vec<_>>();

    let bridge_ids = communities
        .iter()
        .flat_map(|community| community.bridge_node_ids.iter())
        .collect::<HashSet<_>>();
    let mut bridges = ranked
        .iter()
        .filter(|rank| bridge_ids.contains(&rank.node_id))
        .cloned()
        .collect::<Vec<_>>();
    for bridge in &mut bridges {
        bridge.reason = "connects nodes assigned to different navigation communities".to_string();
    }
    bridges.truncate(30);

    let mut cross_community_edges = edges
        .iter()
        .filter_map(|edge| {
            let from_community = community_by_node.get(edge.from.as_str())?;
            let to_community = community_by_node.get(edge.to.as_str())?;
            if from_community == to_community {
                return None;
            }
            let endpoint_degree = degree.get(edge.from.as_str()).copied().unwrap_or_default()
                + degree.get(edge.to.as_str()).copied().unwrap_or_default();
            Some(StructuralGraphConnectionInsight {
                edge_id: edge.id.clone(),
                from_community_id: (*from_community).to_string(),
                to_community_id: (*to_community).to_string(),
                score: 1.0 / (endpoint_degree.max(1) as f64),
                reason: format!("{} crosses navigation communities", edge.kind),
            })
        })
        .collect::<Vec<_>>();
    cross_community_edges.sort_by(|left, right| left.edge_id.cmp(&right.edge_id));
    let mut surprising_connections = cross_community_edges.clone();
    surprising_connections.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.edge_id.cmp(&right.edge_id))
    });
    surprising_connections.truncate(20);
    cross_community_edges.truncate(100);

    let mut suggested_questions = Vec::new();
    for bridge in bridges.iter().take(5) {
        if let Some(node) = node_by_id.get(bridge.node_id.as_str()) {
            suggested_questions.push(StructuralGraphSuggestedQuestion {
                question: format!(
                    "Why does {} connect multiple repository communities?",
                    node.label
                ),
                node_ids: vec![node.id.clone()],
                source_paths: node
                    .sources
                    .iter()
                    .map(|source| source.path.clone())
                    .collect(),
            });
        }
    }
    for hub in hubs
        .iter()
        .take(5_usize.saturating_sub(suggested_questions.len()))
    {
        if let Some(node) = node_by_id.get(hub.node_id.as_str()) {
            suggested_questions.push(StructuralGraphSuggestedQuestion {
                question: format!("What depends on {}, and how is it verified?", node.label),
                node_ids: vec![node.id.clone()],
                source_paths: node
                    .sources
                    .iter()
                    .map(|source| source.path.clone())
                    .collect(),
            });
        }
    }

    StructuralGraphAnalysisSummary {
        communities: communities.to_vec(),
        hubs,
        super_hubs,
        bridges,
        cross_community_edges,
        surprising_connections,
        suggested_questions,
    }
}

fn community_key(node: &StructuralGraphNode) -> String {
    let Some(path) = node.path.as_deref() else {
        return node.kind.clone();
    };
    let components = Path::new(path)
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .filter(|component| !component.is_empty() && *component != ".")
        .take(2)
        .collect::<Vec<_>>();
    match components.as_slice() {
        [] => "root".to_string(),
        [first] => (*first).to_string(),
        [first, second] if matches!(*first, "src" | "lib" | "app" | "pages" | "tests") => {
            (*first).to_string()
        }
        [first, second] => format!("{first}/{second}"),
        _ => unreachable!(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::structural_graph::types::{GraphOrigin, GraphTrust};

    #[test]
    fn communities_hubs_and_bridges_are_deterministic() {
        let mut nodes = [
            node("a", "apps/api/a.rs"),
            node("b", "apps/api/b.rs"),
            node("c", "apps/web/c.ts"),
        ];
        let edges = [edge("a", "b"), edge("b", "c")];
        let first = analyze_graph(&mut nodes, &edges);
        let second = analyze_graph(&mut nodes, &edges);
        assert_eq!(first, second);
        assert_eq!(first.len(), 2);
        assert!(first
            .iter()
            .any(|community| !community.bridge_node_ids.is_empty()));
        let first_summary = summarize_graph_analysis(&nodes, &edges, &first);
        let second_summary = summarize_graph_analysis(&nodes, &edges, &second);
        assert_eq!(first_summary, second_summary);
        assert!(!first_summary.cross_community_edges.is_empty());
        assert!(!first_summary.surprising_connections.is_empty());
        assert!(!first_summary.suggested_questions.is_empty());
    }

    fn node(id: &str, path: &str) -> StructuralGraphNode {
        StructuralGraphNode {
            id: id.to_string(),
            kind: "function".to_string(),
            label: id.to_string(),
            qualified_name: None,
            path: Some(path.to_string()),
            detail: None,
            language: None,
            community_id: None,
            trust: GraphTrust::Extracted,
            origin: GraphOrigin::Syntax,
            sources: Vec::new(),
        }
    }

    fn edge(from: &str, to: &str) -> StructuralGraphEdge {
        StructuralGraphEdge {
            id: format!("{from}:{to}"),
            from: from.to_string(),
            to: to.to_string(),
            kind: "calls".to_string(),
            evidence: "fixture".to_string(),
            trust: GraphTrust::Inferred,
            origin: GraphOrigin::Resolution,
            sources: Vec::new(),
            candidates: Vec::new(),
        }
    }
}
