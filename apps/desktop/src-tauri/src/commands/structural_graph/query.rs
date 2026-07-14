use super::analysis::{summarize_graph_analysis, StructuralGraphAnalysisSummary};
use super::types::{
    GraphTrust, StructuralGraphCoverage, StructuralGraphEdge, StructuralGraphNode,
    StructuralGraphSnapshot,
};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};

const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 500;
const MAX_EDGE_LIMIT: usize = 2_000;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_PATH_HOPS: usize = 32;
const MAX_PATH_VISITS: usize = 25_000;
const MAX_DIFF_IDS: usize = 500;
const MAX_QUERY_INDEXES: usize = 16;

#[derive(Debug, Default)]
struct StructuralGraphQueryIndex {
    exact: HashMap<String, Vec<usize>>,
    tokens: HashMap<String, Vec<usize>>,
}

static QUERY_INDEXES: OnceLock<Mutex<HashMap<String, Arc<StructuralGraphQueryIndex>>>> =
    OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum GraphDirection {
    Incoming,
    Outgoing,
    #[default]
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GraphQueryFilter {
    #[serde(default)]
    pub node_kinds: Vec<String>,
    #[serde(default)]
    pub edge_kinds: Vec<String>,
    #[serde(default)]
    pub trust: Vec<GraphTrust>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphSearchHit {
    pub node: StructuralGraphNode,
    pub score: u32,
    pub matched_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphSearchResult {
    pub hits: Vec<GraphSearchHit>,
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub context: GraphQueryContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphExplanation {
    pub node: StructuralGraphNode,
    pub incoming_count: usize,
    pub outgoing_count: usize,
    pub incoming_kinds: Vec<String>,
    pub outgoing_kinds: Vec<String>,
    pub truncated: bool,
    pub context: GraphQueryContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphProjection {
    pub nodes: Vec<StructuralGraphNode>,
    pub edges: Vec<StructuralGraphEdge>,
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub context: GraphQueryContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphPathResult {
    pub nodes: Vec<StructuralGraphNode>,
    pub edges: Vec<StructuralGraphEdge>,
    pub total_cost: f64,
    pub visited: usize,
    pub truncated: bool,
    pub context: GraphQueryContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphImpactResult {
    pub root: StructuralGraphNode,
    pub affected: Vec<StructuralGraphNode>,
    pub edges: Vec<StructuralGraphEdge>,
    pub depth_reached: usize,
    pub truncated: bool,
    pub context: GraphQueryContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphSnapshotDiff {
    pub before_snapshot_id: String,
    pub after_snapshot_id: String,
    pub added_node_ids: Vec<String>,
    pub removed_node_ids: Vec<String>,
    pub changed_node_ids: Vec<String>,
    pub added_edge_ids: Vec<String>,
    pub removed_edge_ids: Vec<String>,
    pub changed_edge_ids: Vec<String>,
    pub truncated: bool,
    pub context: GraphQueryContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphAnalysisResult {
    #[serde(flatten)]
    pub analysis: StructuralGraphAnalysisSummary,
    pub truncated: bool,
    pub context: GraphQueryContext,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct GraphTrustSummary {
    pub extracted: usize,
    pub inferred: usize,
    pub ambiguous: usize,
    pub legacy: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphFreshness {
    pub indexed_head: Option<String>,
    pub current_head: Option<String>,
    /// `None` means the caller did not provide a live repository HEAD.
    pub stale: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphQueryContext {
    pub snapshot_id: String,
    pub schema_version: i64,
    pub engine_id: String,
    pub engine_version: String,
    pub created_at: String,
    pub freshness: GraphFreshness,
    pub coverage: StructuralGraphCoverage,
    pub trust: GraphTrustSummary,
    pub max_results: usize,
    pub max_edges: usize,
    pub max_hops: usize,
    pub max_bytes: usize,
}

impl GraphQueryContext {
    pub fn observe_current_head(&mut self, current_head: Option<String>) {
        self.freshness.stale = current_head
            .as_ref()
            .map(|head| self.freshness.indexed_head.as_ref() != Some(head));
        self.freshness.current_head = current_head;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructuralGraphMetadata {
    pub snapshot_id: String,
    pub schema_version: i64,
    pub repo_path: String,
    pub repo_head: Option<String>,
    pub created_at: String,
    pub engine_id: String,
    pub engine_version: String,
    pub indexed_files: usize,
    pub node_count: usize,
    pub edge_count: usize,
    pub diagnostic_count: usize,
    pub coverage: StructuralGraphCoverage,
    pub trust: Option<GraphTrustSummary>,
    pub freshness: GraphFreshness,
    pub truncated: bool,
}

pub fn metadata(snapshot: &StructuralGraphSnapshot) -> StructuralGraphMetadata {
    StructuralGraphMetadata {
        snapshot_id: snapshot.id.clone(),
        schema_version: snapshot.schema_version,
        repo_path: snapshot.repo_path.clone(),
        repo_head: snapshot.repo_head.clone(),
        created_at: snapshot.created_at.clone(),
        engine_id: snapshot.engine.id.clone(),
        engine_version: snapshot.engine.version.clone(),
        indexed_files: snapshot.coverage.indexed_files,
        node_count: snapshot.nodes.len(),
        edge_count: snapshot.edges.len(),
        diagnostic_count: snapshot.diagnostics.len(),
        coverage: snapshot.coverage.clone(),
        trust: Some(trust_summary(snapshot)),
        freshness: GraphFreshness {
            indexed_head: snapshot.repo_head.clone(),
            current_head: None,
            stale: None,
        },
        truncated: snapshot.truncated,
    }
}

fn query_context(snapshot: &StructuralGraphSnapshot) -> GraphQueryContext {
    GraphQueryContext {
        snapshot_id: snapshot.id.clone(),
        schema_version: snapshot.schema_version,
        engine_id: snapshot.engine.id.clone(),
        engine_version: snapshot.engine.version.clone(),
        created_at: snapshot.created_at.clone(),
        freshness: GraphFreshness {
            indexed_head: snapshot.repo_head.clone(),
            current_head: None,
            stale: None,
        },
        coverage: snapshot.coverage.clone(),
        trust: trust_summary(snapshot),
        max_results: MAX_LIMIT,
        max_edges: MAX_EDGE_LIMIT,
        max_hops: MAX_PATH_HOPS,
        max_bytes: MAX_RESPONSE_BYTES,
    }
}

fn trust_summary(snapshot: &StructuralGraphSnapshot) -> GraphTrustSummary {
    let mut summary = GraphTrustSummary::default();
    for trust in snapshot
        .nodes
        .iter()
        .map(|node| node.trust)
        .chain(snapshot.edges.iter().map(|edge| edge.trust))
    {
        match trust {
            GraphTrust::Extracted => summary.extracted += 1,
            GraphTrust::Inferred => summary.inferred += 1,
            GraphTrust::Ambiguous => summary.ambiguous += 1,
            GraphTrust::Legacy => summary.legacy += 1,
        }
    }
    summary
}

pub fn analysis(snapshot: &StructuralGraphSnapshot) -> GraphAnalysisResult {
    GraphAnalysisResult {
        analysis: analysis_summary(snapshot),
        truncated: snapshot.truncated,
        context: query_context(snapshot),
    }
}

pub fn analysis_summary(snapshot: &StructuralGraphSnapshot) -> StructuralGraphAnalysisSummary {
    summarize_graph_analysis(&snapshot.nodes, &snapshot.edges, &snapshot.communities)
}

pub fn overview(snapshot: &StructuralGraphSnapshot, limit: Option<usize>) -> GraphProjection {
    overview_page(snapshot, limit, None).expect("default graph cursor is valid")
}

pub fn overview_page(
    snapshot: &StructuralGraphSnapshot,
    limit: Option<usize>,
    cursor: Option<&str>,
) -> Result<GraphProjection, String> {
    let limit = bounded_limit(limit);
    let offset = parse_cursor(cursor)?;
    let mut degree: HashMap<&str, usize> = HashMap::new();
    for edge in &snapshot.edges {
        *degree.entry(&edge.from).or_default() += 1;
        *degree.entry(&edge.to).or_default() += 1;
    }
    let mut ranked = snapshot.nodes.iter().collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        degree
            .get(right.id.as_str())
            .copied()
            .unwrap_or_default()
            .cmp(&degree.get(left.id.as_str()).copied().unwrap_or_default())
            .then_with(|| left.id.cmp(&right.id))
    });
    if offset > ranked.len() {
        return Err("Graph cursor is invalid or expired".to_string());
    }
    let page = ranked
        .iter()
        .skip(offset)
        .take(limit)
        .copied()
        .collect::<Vec<_>>();
    let next_offset = offset + page.len();
    let selected = page
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    let mut nodes = page.into_iter().cloned().collect::<Vec<_>>();
    nodes.sort_by(|left, right| left.id.cmp(&right.id));
    let mut edges = snapshot
        .edges
        .iter()
        .filter(|edge| selected.contains(edge.from.as_str()) && selected.contains(edge.to.as_str()))
        .take(MAX_EDGE_LIMIT)
        .cloned()
        .collect::<Vec<_>>();
    edges.sort_by(|left, right| left.id.cmp(&right.id));
    let edge_truncated = snapshot
        .edges
        .iter()
        .filter(|edge| selected.contains(edge.from.as_str()) && selected.contains(edge.to.as_str()))
        .count()
        > edges.len();
    let mut projection = GraphProjection {
        nodes,
        edges,
        truncated: next_offset < ranked.len() || edge_truncated,
        next_cursor: (next_offset < ranked.len()).then(|| next_offset.to_string()),
        context: query_context(snapshot),
    };
    enforce_projection_bytes(&mut projection, &HashSet::new());
    Ok(projection)
}

pub fn community(
    snapshot: &StructuralGraphSnapshot,
    community_id: &str,
    limit: Option<usize>,
) -> Result<GraphProjection, String> {
    community_page(snapshot, community_id, limit, None)
}

pub fn community_page(
    snapshot: &StructuralGraphSnapshot,
    community_id: &str,
    limit: Option<usize>,
    cursor: Option<&str>,
) -> Result<GraphProjection, String> {
    if !snapshot
        .communities
        .iter()
        .any(|community| community.id == community_id)
    {
        return Err(format!("No graph community matches '{community_id}'"));
    }
    let limit = bounded_limit(limit);
    let offset = parse_cursor(cursor)?;
    let mut degree: HashMap<&str, usize> = HashMap::new();
    for edge in &snapshot.edges {
        *degree.entry(&edge.from).or_default() += 1;
        *degree.entry(&edge.to).or_default() += 1;
    }
    let mut members = snapshot
        .nodes
        .iter()
        .filter(|node| node.community_id.as_deref() == Some(community_id))
        .collect::<Vec<_>>();
    members.sort_by(|left, right| {
        degree
            .get(right.id.as_str())
            .copied()
            .unwrap_or_default()
            .cmp(&degree.get(left.id.as_str()).copied().unwrap_or_default())
            .then_with(|| left.id.cmp(&right.id))
    });
    if offset > members.len() {
        return Err("Graph cursor is invalid or expired".to_string());
    }
    let total_members = members.len();
    let members = members
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let next_offset = offset + members.len();
    let selected = members
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    let mut nodes = members.into_iter().cloned().collect::<Vec<_>>();
    nodes.sort_by(|left, right| left.id.cmp(&right.id));
    let mut edges = snapshot
        .edges
        .iter()
        .filter(|edge| selected.contains(edge.from.as_str()) && selected.contains(edge.to.as_str()))
        .take(MAX_EDGE_LIMIT)
        .cloned()
        .collect::<Vec<_>>();
    edges.sort_by(|left, right| left.id.cmp(&right.id));
    let edge_truncated = snapshot
        .edges
        .iter()
        .filter(|edge| selected.contains(edge.from.as_str()) && selected.contains(edge.to.as_str()))
        .count()
        > edges.len();
    let mut projection = GraphProjection {
        nodes,
        edges,
        truncated: next_offset < total_members || edge_truncated,
        next_cursor: (next_offset < total_members).then(|| next_offset.to_string()),
        context: query_context(snapshot),
    };
    enforce_projection_bytes(&mut projection, &HashSet::new());
    Ok(projection)
}

pub fn subgraph(
    snapshot: &StructuralGraphSnapshot,
    seeds: &[String],
    depth: Option<usize>,
    filter: &GraphQueryFilter,
    limit: Option<usize>,
) -> Result<GraphProjection, String> {
    if seeds.is_empty() {
        return Err("At least one graph seed is required".to_string());
    }
    let max_depth = depth.unwrap_or(2).clamp(0, 8);
    let limit = bounded_limit(limit);
    let roots = seeds
        .iter()
        .map(|seed| resolve_node(snapshot, seed))
        .collect::<Result<Vec<_>, _>>()?;
    let mut adjacency = HashMap::<&str, Vec<&StructuralGraphEdge>>::new();
    for edge in snapshot
        .edges
        .iter()
        .filter(|edge| edge_matches_filter(edge, filter))
    {
        adjacency.entry(edge.from.as_str()).or_default().push(edge);
        adjacency.entry(edge.to.as_str()).or_default().push(edge);
    }
    for edges in adjacency.values_mut() {
        edges.sort_by(|left, right| left.id.cmp(&right.id));
    }
    let mut queue = roots
        .iter()
        .map(|node| (node.id.as_str(), 0_usize))
        .collect::<VecDeque<_>>();
    let mut selected = roots
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    let mut selected_edges = HashSet::new();
    let mut truncated = false;
    while let Some((node_id, current_depth)) = queue.pop_front() {
        if current_depth >= max_depth {
            continue;
        }
        for edge in adjacency.get(node_id).into_iter().flatten() {
            let neighbor = if edge.from == node_id {
                edge.to.as_str()
            } else {
                edge.from.as_str()
            };
            if selected.len() >= limit && !selected.contains(neighbor) {
                truncated = true;
                continue;
            }
            selected_edges.insert(edge.id.as_str());
            if selected.insert(neighbor) {
                queue.push_back((neighbor, current_depth + 1));
            }
        }
    }
    let mut nodes = snapshot
        .nodes
        .iter()
        .filter(|node| selected.contains(node.id.as_str()))
        .filter(|node| {
            node_matches_filter(node, filter) || roots.iter().any(|root| root.id == node.id)
        })
        .cloned()
        .collect::<Vec<_>>();
    let retained = nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    let mut edges = snapshot
        .edges
        .iter()
        .filter(|edge| selected_edges.contains(edge.id.as_str()))
        .filter(|edge| retained.contains(edge.from.as_str()) && retained.contains(edge.to.as_str()))
        .take(MAX_EDGE_LIMIT)
        .cloned()
        .collect::<Vec<_>>();
    if selected_edges.len() > edges.len() {
        truncated = true;
    }
    nodes.sort_by(|left, right| left.id.cmp(&right.id));
    edges.sort_by(|left, right| left.id.cmp(&right.id));
    let protected = roots
        .iter()
        .map(|root| root.id.clone())
        .collect::<HashSet<_>>();
    let mut projection = GraphProjection {
        nodes,
        edges,
        truncated,
        next_cursor: None,
        context: query_context(snapshot),
    };
    enforce_projection_bytes(&mut projection, &protected);
    Ok(projection)
}

pub fn diff_snapshots(
    before: &StructuralGraphSnapshot,
    after: &StructuralGraphSnapshot,
) -> GraphSnapshotDiff {
    let before_nodes = before
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let after_nodes = after
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let before_edges = before
        .edges
        .iter()
        .map(|edge| (edge.id.as_str(), edge))
        .collect::<HashMap<_, _>>();
    let after_edges = after
        .edges
        .iter()
        .map(|edge| (edge.id.as_str(), edge))
        .collect::<HashMap<_, _>>();
    let (mut added_node_ids, mut removed_node_ids, mut changed_node_ids) =
        diff_identity_maps(&before_nodes, &after_nodes);
    let (mut added_edge_ids, mut removed_edge_ids, mut changed_edge_ids) =
        diff_identity_maps(&before_edges, &after_edges);
    let truncated = [
        added_node_ids.len(),
        removed_node_ids.len(),
        changed_node_ids.len(),
        added_edge_ids.len(),
        removed_edge_ids.len(),
        changed_edge_ids.len(),
    ]
    .into_iter()
    .any(|count| count > MAX_DIFF_IDS);
    for ids in [
        &mut added_node_ids,
        &mut removed_node_ids,
        &mut changed_node_ids,
        &mut added_edge_ids,
        &mut removed_edge_ids,
        &mut changed_edge_ids,
    ] {
        ids.truncate(MAX_DIFF_IDS);
    }
    GraphSnapshotDiff {
        before_snapshot_id: before.id.clone(),
        after_snapshot_id: after.id.clone(),
        added_node_ids,
        removed_node_ids,
        changed_node_ids,
        added_edge_ids,
        removed_edge_ids,
        changed_edge_ids,
        truncated,
        context: query_context(after),
    }
}

fn diff_identity_maps<T: PartialEq>(
    before: &HashMap<&str, &T>,
    after: &HashMap<&str, &T>,
) -> (Vec<String>, Vec<String>, Vec<String>) {
    let mut added = after
        .keys()
        .filter(|id| !before.contains_key(**id))
        .map(|id| (*id).to_string())
        .collect::<Vec<_>>();
    let mut removed = before
        .keys()
        .filter(|id| !after.contains_key(**id))
        .map(|id| (*id).to_string())
        .collect::<Vec<_>>();
    let mut changed = after
        .iter()
        .filter_map(|(id, value)| {
            before
                .get(id)
                .filter(|before| *before != value)
                .map(|_| (*id).to_string())
        })
        .collect::<Vec<_>>();
    added.sort();
    removed.sort();
    changed.sort();
    (added, removed, changed)
}

pub fn search(
    snapshot: &StructuralGraphSnapshot,
    query: &str,
    filter: &GraphQueryFilter,
    limit: Option<usize>,
) -> GraphSearchResult {
    search_page(snapshot, query, filter, limit, None).expect("default graph cursor is valid")
}

pub fn search_page(
    snapshot: &StructuralGraphSnapshot,
    query: &str,
    filter: &GraphQueryFilter,
    limit: Option<usize>,
    cursor: Option<&str>,
) -> Result<GraphSearchResult, String> {
    let needle = normalize(query);
    if needle.is_empty() {
        return Ok(GraphSearchResult {
            hits: Vec::new(),
            truncated: false,
            next_cursor: None,
            context: query_context(snapshot),
        });
    }

    let tokens = lexical_tokens(&needle);
    let index = query_index(snapshot);
    let mut candidate_indices = HashSet::new();
    if let Some(exact) = index.exact.get(&needle) {
        candidate_indices.extend(exact.iter().copied());
    }
    for token in &tokens {
        if let Some(postings) = index.tokens.get(token) {
            candidate_indices.extend(postings.iter().copied());
        }
    }
    let candidates = if candidate_indices.is_empty() {
        (0..snapshot.nodes.len()).collect::<Vec<_>>()
    } else {
        let mut candidates = candidate_indices.into_iter().collect::<Vec<_>>();
        candidates.sort_unstable();
        candidates
    };
    let mut hits = candidates
        .into_iter()
        .filter_map(|index| snapshot.nodes.get(index))
        .filter(|node| node_matches_filter(node, filter))
        .filter_map(|node| {
            rank_node(node, &needle)
                .or_else(|| rank_question_tokens(node, &tokens))
                .map(|(score, matched_by)| (node, score, matched_by))
        })
        .collect::<Vec<_>>();
    hits.sort_by(|(left_node, left_score, _), (right_node, right_score, _)| {
        left_score
            .cmp(right_score)
            .then_with(|| left_node.label.cmp(&right_node.label))
            .then_with(|| left_node.id.cmp(&right_node.id))
    });

    let offset = parse_cursor(cursor)?;
    if offset > hits.len() {
        return Err("Graph cursor is invalid or expired".to_string());
    }
    let limit = bounded_limit(limit);
    let total = hits.len();
    let page = hits
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let next_offset = offset + page.len();
    let mut result = GraphSearchResult {
        hits: page
            .into_iter()
            .map(|(node, score, matched_by)| GraphSearchHit {
                node: node.clone(),
                score,
                matched_by,
            })
            .collect(),
        truncated: next_offset < total,
        next_cursor: (next_offset < total).then(|| next_offset.to_string()),
        context: query_context(snapshot),
    };
    enforce_search_bytes(&mut result, offset, total);
    Ok(result)
}

pub fn resolve_node<'a>(
    snapshot: &'a StructuralGraphSnapshot,
    reference: &str,
) -> Result<&'a StructuralGraphNode, String> {
    let needle = normalize(reference);
    if needle.is_empty() {
        return Err("A node id, qualified name, path, or label is required".to_string());
    }

    let index = query_index(snapshot);
    let candidates = index
        .exact
        .get(&needle)
        .cloned()
        .unwrap_or_else(|| (0..snapshot.nodes.len()).collect());
    for exact_score in 0..=3 {
        let matches = candidates
            .iter()
            .filter_map(|index| snapshot.nodes.get(*index))
            .filter(|node| rank_node(node, &needle).is_some_and(|(score, _)| score == exact_score))
            .collect::<Vec<_>>();
        match matches.len() {
            0 => continue,
            1 => return Ok(matches[0]),
            count => {
                return Err(format!(
                    "Node reference is ambiguous ({count} matches); use the stable node id"
                ))
            }
        }
    }
    Err(format!("No graph node matches '{reference}'"))
}

pub fn explain(
    snapshot: &StructuralGraphSnapshot,
    reference: &str,
) -> Result<GraphExplanation, String> {
    let node = resolve_node(snapshot, reference)?;
    let mut incoming_kinds = HashSet::new();
    let mut outgoing_kinds = HashSet::new();
    let mut incoming_count = 0;
    let mut outgoing_count = 0;
    for edge in &snapshot.edges {
        if edge.to == node.id {
            incoming_count += 1;
            incoming_kinds.insert(edge.kind.clone());
        }
        if edge.from == node.id {
            outgoing_count += 1;
            outgoing_kinds.insert(edge.kind.clone());
        }
    }
    let mut incoming_kinds = incoming_kinds.into_iter().collect::<Vec<_>>();
    let mut outgoing_kinds = outgoing_kinds.into_iter().collect::<Vec<_>>();
    incoming_kinds.sort();
    outgoing_kinds.sort();
    Ok(GraphExplanation {
        node: node.clone(),
        incoming_count,
        outgoing_count,
        incoming_kinds,
        outgoing_kinds,
        truncated: false,
        context: query_context(snapshot),
    })
}

pub fn neighbors(
    snapshot: &StructuralGraphSnapshot,
    reference: &str,
    direction: GraphDirection,
    filter: &GraphQueryFilter,
    limit: Option<usize>,
    cursor: Option<&str>,
) -> Result<GraphProjection, String> {
    let root = resolve_node(snapshot, reference)?;
    let node_by_id = node_map(snapshot);
    let mut edges = snapshot
        .edges
        .iter()
        .filter(|edge| edge_matches_filter(edge, filter))
        .filter(|edge| match direction {
            GraphDirection::Incoming => edge.to == root.id,
            GraphDirection::Outgoing => edge.from == root.id,
            GraphDirection::Both => edge.from == root.id || edge.to == root.id,
        })
        .collect::<Vec<_>>();
    edges.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.id.cmp(&right.id))
    });

    let offset = parse_cursor(cursor)?;
    let limit = bounded_limit(limit);
    let page = edges
        .iter()
        .skip(offset)
        .take(limit)
        .copied()
        .collect::<Vec<_>>();
    let truncated = offset + page.len() < edges.len();
    let mut node_ids = HashSet::from([root.id.as_str()]);
    for edge in &page {
        node_ids.insert(edge.from.as_str());
        node_ids.insert(edge.to.as_str());
    }
    let mut nodes = node_ids
        .into_iter()
        .filter_map(|id| node_by_id.get(id).copied())
        .filter(|node| node_matches_filter(node, filter) || node.id == root.id)
        .cloned()
        .collect::<Vec<_>>();
    nodes.sort_by(|left, right| left.id.cmp(&right.id));
    let protected = HashSet::from([root.id.clone()]);
    let mut projection = GraphProjection {
        nodes,
        edges: page.into_iter().cloned().collect(),
        truncated,
        next_cursor: truncated.then(|| (offset + limit).to_string()),
        context: query_context(snapshot),
    };
    enforce_projection_bytes(&mut projection, &protected);
    Ok(projection)
}

pub fn shortest_path(
    snapshot: &StructuralGraphSnapshot,
    from: &str,
    to: &str,
    filter: &GraphQueryFilter,
) -> Result<GraphPathResult, String> {
    let start = resolve_node(snapshot, from)?;
    let target = resolve_node(snapshot, to)?;
    if start.id == target.id {
        return Ok(GraphPathResult {
            nodes: vec![start.clone()],
            edges: Vec::new(),
            total_cost: 0.0,
            visited: 1,
            truncated: false,
            context: query_context(snapshot),
        });
    }

    let mut adjacency: HashMap<&str, Vec<&StructuralGraphEdge>> = HashMap::new();
    let mut degree: HashMap<&str, usize> = HashMap::new();
    for edge in snapshot
        .edges
        .iter()
        .filter(|edge| edge_matches_filter(edge, filter))
    {
        adjacency.entry(&edge.from).or_default().push(edge);
        *degree.entry(&edge.from).or_default() += 1;
        *degree.entry(&edge.to).or_default() += 1;
    }
    for edges in adjacency.values_mut() {
        edges.sort_by(|left, right| left.id.cmp(&right.id));
    }

    let mut heap = BinaryHeap::new();
    heap.push(PathVisit::new(start.id.clone(), 0.0));
    let mut distance = HashMap::from([(start.id.clone(), 0.0)]);
    let mut previous: HashMap<String, (String, String)> = HashMap::new();
    let mut visited = 0;
    while let Some(current) = heap.pop() {
        if visited >= MAX_PATH_VISITS {
            break;
        }
        visited += 1;
        if current.node_id == target.id {
            break;
        }
        if current.cost > *distance.get(&current.node_id).unwrap_or(&f64::INFINITY) {
            continue;
        }
        for edge in adjacency
            .get(current.node_id.as_str())
            .into_iter()
            .flatten()
        {
            let hub_penalty = degree.get(edge.to.as_str()).copied().unwrap_or(0) as f64 * 0.002;
            let next_cost = current.cost + trust_cost(edge.trust) + hub_penalty;
            if next_cost < *distance.get(&edge.to).unwrap_or(&f64::INFINITY) {
                distance.insert(edge.to.clone(), next_cost);
                previous.insert(edge.to.clone(), (current.node_id.clone(), edge.id.clone()));
                heap.push(PathVisit::new(edge.to.clone(), next_cost));
            }
        }
    }

    let total_cost = distance.get(&target.id).copied().ok_or_else(|| {
        format!(
            "No directed graph path connects '{}' to '{}'",
            start.label, target.label
        )
    })?;
    let edge_by_id = snapshot
        .edges
        .iter()
        .map(|edge| (edge.id.as_str(), edge))
        .collect::<HashMap<_, _>>();
    let node_by_id = node_map(snapshot);
    let mut node_ids = vec![target.id.clone()];
    let mut edge_ids = Vec::new();
    let mut cursor = target.id.clone();
    while cursor != start.id {
        let (parent, edge_id) = previous
            .get(&cursor)
            .cloned()
            .ok_or_else(|| "Path reconstruction failed".to_string())?;
        node_ids.push(parent.clone());
        edge_ids.push(edge_id);
        cursor = parent;
    }
    node_ids.reverse();
    edge_ids.reverse();
    if edge_ids.len() > MAX_PATH_HOPS {
        return Err(format!(
            "No directed graph path within the {MAX_PATH_HOPS}-hop limit connects '{}' to '{}'",
            start.label, target.label
        ));
    }
    let mut result = GraphPathResult {
        nodes: node_ids
            .iter()
            .filter_map(|id| node_by_id.get(id.as_str()).copied().cloned())
            .collect(),
        edges: edge_ids
            .iter()
            .filter_map(|id| edge_by_id.get(id.as_str()).copied().cloned())
            .collect(),
        total_cost,
        visited,
        truncated: visited >= MAX_PATH_VISITS,
        context: query_context(snapshot),
    };
    enforce_path_bytes(&mut result)?;
    Ok(result)
}

pub fn impact(
    snapshot: &StructuralGraphSnapshot,
    reference: &str,
    direction: GraphDirection,
    depth: Option<usize>,
    filter: &GraphQueryFilter,
    limit: Option<usize>,
) -> Result<GraphImpactResult, String> {
    let root = resolve_node(snapshot, reference)?;
    let max_depth = depth.unwrap_or(3).clamp(1, 12);
    let limit = bounded_limit(limit);
    let mut adjacency: HashMap<&str, Vec<&StructuralGraphEdge>> = HashMap::new();
    let mut degree = HashMap::<&str, usize>::new();
    for edge in snapshot
        .edges
        .iter()
        .filter(|edge| edge_matches_filter(edge, filter))
    {
        *degree.entry(edge.from.as_str()).or_default() += 1;
        *degree.entry(edge.to.as_str()).or_default() += 1;
        match direction {
            GraphDirection::Incoming => adjacency.entry(&edge.to).or_default().push(edge),
            GraphDirection::Outgoing => adjacency.entry(&edge.from).or_default().push(edge),
            GraphDirection::Both => {
                adjacency.entry(&edge.to).or_default().push(edge);
                adjacency.entry(&edge.from).or_default().push(edge);
            }
        }
    }
    for (node_id, edges) in &mut adjacency {
        edges.sort_by(|left, right| {
            let left_neighbor = if left.from == *node_id {
                left.to.as_str()
            } else {
                left.from.as_str()
            };
            let right_neighbor = if right.from == *node_id {
                right.to.as_str()
            } else {
                right.from.as_str()
            };
            degree
                .get(left_neighbor)
                .copied()
                .unwrap_or_default()
                .cmp(&degree.get(right_neighbor).copied().unwrap_or_default())
                .then_with(|| left.id.cmp(&right.id))
        });
    }

    let mut queue = VecDeque::from([(root.id.as_str(), 0_usize)]);
    let mut seen = HashSet::from([root.id.as_str()]);
    let mut edge_ids = HashSet::new();
    let mut depth_reached = 0;
    let mut truncated = false;
    while let Some((node_id, current_depth)) = queue.pop_front() {
        depth_reached = depth_reached.max(current_depth);
        if current_depth >= max_depth {
            continue;
        }
        for edge in adjacency.get(node_id).into_iter().flatten() {
            edge_ids.insert(edge.id.as_str());
            let neighbor = if edge.from == node_id {
                edge.to.as_str()
            } else {
                edge.from.as_str()
            };
            if seen.insert(neighbor) {
                if seen.len() > limit + 1 {
                    truncated = true;
                    break;
                }
                queue.push_back((neighbor, current_depth + 1));
            }
        }
        if truncated {
            break;
        }
    }

    let node_by_id = node_map(snapshot);
    let mut affected = seen
        .into_iter()
        .filter(|id| *id != root.id)
        .filter_map(|id| node_by_id.get(id).copied().cloned())
        .collect::<Vec<_>>();
    affected.sort_by(|left, right| left.id.cmp(&right.id));
    affected.truncate(limit);
    let retained_ids = affected
        .iter()
        .map(|node| node.id.as_str())
        .chain(std::iter::once(root.id.as_str()))
        .collect::<HashSet<_>>();
    let mut edges = snapshot
        .edges
        .iter()
        .filter(|edge| edge_ids.contains(edge.id.as_str()))
        .filter(|edge| {
            retained_ids.contains(edge.from.as_str()) && retained_ids.contains(edge.to.as_str())
        })
        .take(MAX_EDGE_LIMIT)
        .cloned()
        .collect::<Vec<_>>();
    if edge_ids.len() > edges.len() {
        truncated = true;
    }
    edges.sort_by(|left, right| left.id.cmp(&right.id));
    let mut result = GraphImpactResult {
        root: root.clone(),
        affected,
        edges,
        depth_reached,
        truncated,
        context: query_context(snapshot),
    };
    enforce_impact_bytes(&mut result);
    Ok(result)
}

fn bounded_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

fn serialized_bytes<T: Serialize>(value: &T) -> usize {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
}

fn strip_node_excerpts(node: &mut StructuralGraphNode) {
    for source in &mut node.sources {
        source.excerpt = None;
    }
}

fn strip_edge_excerpts(edge: &mut StructuralGraphEdge) {
    for source in &mut edge.sources {
        source.excerpt = None;
    }
}

fn enforce_projection_bytes(
    projection: &mut GraphProjection,
    protected_node_ids: &HashSet<String>,
) {
    if serialized_bytes(projection) <= MAX_RESPONSE_BYTES {
        return;
    }
    projection.truncated = true;
    for node in &mut projection.nodes {
        strip_node_excerpts(node);
    }
    for edge in &mut projection.edges {
        strip_edge_excerpts(edge);
    }
    while serialized_bytes(projection) > MAX_RESPONSE_BYTES && !projection.edges.is_empty() {
        projection.edges.pop();
    }
    while serialized_bytes(projection) > MAX_RESPONSE_BYTES {
        let Some(index) = projection
            .nodes
            .iter()
            .rposition(|node| !protected_node_ids.contains(&node.id))
        else {
            break;
        };
        projection.nodes.remove(index);
    }
    let retained = projection
        .nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    projection.edges.retain(|edge| {
        retained.contains(edge.from.as_str()) && retained.contains(edge.to.as_str())
    });
}

fn enforce_search_bytes(result: &mut GraphSearchResult, offset: usize, total: usize) {
    if serialized_bytes(result) <= MAX_RESPONSE_BYTES {
        return;
    }
    result.truncated = true;
    for hit in &mut result.hits {
        strip_node_excerpts(&mut hit.node);
    }
    while serialized_bytes(result) > MAX_RESPONSE_BYTES && !result.hits.is_empty() {
        result.hits.pop();
    }
    let next_offset = offset + result.hits.len();
    result.next_cursor = (next_offset < total).then(|| next_offset.to_string());
}

fn enforce_path_bytes(result: &mut GraphPathResult) -> Result<(), String> {
    if serialized_bytes(result) <= MAX_RESPONSE_BYTES {
        return Ok(());
    }
    for node in &mut result.nodes {
        strip_node_excerpts(node);
    }
    for edge in &mut result.edges {
        strip_edge_excerpts(edge);
    }
    if serialized_bytes(result) > MAX_RESPONSE_BYTES {
        return Err(format!(
            "Graph path exceeds the {MAX_RESPONSE_BYTES}-byte response limit"
        ));
    }
    result.truncated = true;
    Ok(())
}

fn enforce_impact_bytes(result: &mut GraphImpactResult) {
    if serialized_bytes(result) <= MAX_RESPONSE_BYTES {
        return;
    }
    result.truncated = true;
    strip_node_excerpts(&mut result.root);
    for node in &mut result.affected {
        strip_node_excerpts(node);
    }
    for edge in &mut result.edges {
        strip_edge_excerpts(edge);
    }
    while serialized_bytes(result) > MAX_RESPONSE_BYTES && !result.edges.is_empty() {
        result.edges.pop();
    }
    while serialized_bytes(result) > MAX_RESPONSE_BYTES && !result.affected.is_empty() {
        result.affected.pop();
    }
    let retained = result
        .affected
        .iter()
        .map(|node| node.id.as_str())
        .chain(std::iter::once(result.root.id.as_str()))
        .collect::<HashSet<_>>();
    result.edges.retain(|edge| {
        retained.contains(edge.from.as_str()) && retained.contains(edge.to.as_str())
    });
}

fn parse_cursor(cursor: Option<&str>) -> Result<usize, String> {
    cursor
        .unwrap_or("0")
        .parse::<usize>()
        .map_err(|_| "Graph cursor is invalid or expired".to_string())
}

fn normalize(value: &str) -> String {
    value.trim().replace('\\', "/").to_lowercase()
}

fn node_matches_filter(node: &StructuralGraphNode, filter: &GraphQueryFilter) -> bool {
    (filter.node_kinds.is_empty() || filter.node_kinds.iter().any(|kind| kind == &node.kind))
        && (filter.trust.is_empty() || filter.trust.contains(&node.trust))
}

fn edge_matches_filter(edge: &StructuralGraphEdge, filter: &GraphQueryFilter) -> bool {
    (filter.edge_kinds.is_empty() || filter.edge_kinds.iter().any(|kind| kind == &edge.kind))
        && (filter.trust.is_empty() || filter.trust.contains(&edge.trust))
}

fn rank_node(node: &StructuralGraphNode, needle: &str) -> Option<(u32, String)> {
    let id = normalize(&node.id);
    let qualified = node.qualified_name.as_deref().map(normalize);
    let path = node.path.as_deref().map(normalize);
    let label = normalize(&node.label);
    if id == needle {
        Some((0, "id".to_string()))
    } else if qualified.as_deref() == Some(needle) {
        Some((1, "qualified_name".to_string()))
    } else if path.as_deref() == Some(needle) {
        Some((2, "path".to_string()))
    } else if label == needle {
        Some((3, "label".to_string()))
    } else if qualified
        .as_deref()
        .is_some_and(|value| value.contains(needle))
    {
        Some((10, "qualified_name_contains".to_string()))
    } else if path.as_deref().is_some_and(|value| value.contains(needle)) {
        Some((11, "path_contains".to_string()))
    } else if label.contains(needle) {
        Some((12, "label_contains".to_string()))
    } else {
        None
    }
}

fn lexical_tokens(query: &str) -> Vec<String> {
    const STOP_WORDS: &[&str] = &[
        "a", "an", "and", "are", "does", "for", "from", "how", "in", "is", "of", "on", "or", "the",
        "to", "what", "when", "where", "which", "why", "with",
    ];
    let mut tokens = query
        .split(|character: char| {
            !(character.is_alphanumeric()
                || matches!(character, '_' | '-' | '.' | '/' | ':' | '\\'))
        })
        .map(str::trim)
        .filter(|token| token.len() >= 2 && !STOP_WORDS.contains(token))
        .map(str::to_string)
        .collect::<Vec<_>>();
    tokens.sort();
    tokens.dedup();
    tokens
}

fn rank_question_tokens(node: &StructuralGraphNode, tokens: &[String]) -> Option<(u32, String)> {
    if tokens.is_empty() {
        return None;
    }
    let haystack = normalize(&format!(
        "{} {} {} {} {}",
        node.label,
        node.qualified_name.as_deref().unwrap_or_default(),
        node.path.as_deref().unwrap_or_default(),
        node.kind,
        node.detail.as_deref().unwrap_or_default()
    ));
    let matched = tokens
        .iter()
        .filter(|token| haystack.contains(token.as_str()))
        .count();
    if matched == 0 {
        return None;
    }
    let missing = tokens.len() - matched;
    Some((20 + missing as u32 * 5, "lexical_question".to_string()))
}

fn node_map(snapshot: &StructuralGraphSnapshot) -> HashMap<&str, &StructuralGraphNode> {
    snapshot
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect()
}

fn query_index(snapshot: &StructuralGraphSnapshot) -> Arc<StructuralGraphQueryIndex> {
    let indexes = QUERY_INDEXES.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(cache) = indexes.lock() {
        if let Some(index) = cache.get(&snapshot.id) {
            return Arc::clone(index);
        }
    }
    let mut index = StructuralGraphQueryIndex::default();
    for (ordinal, node) in snapshot.nodes.iter().enumerate() {
        for value in [
            Some(node.id.as_str()),
            node.path.as_deref(),
            node.qualified_name.as_deref(),
            Some(node.label.as_str()),
        ]
        .into_iter()
        .flatten()
        {
            index
                .exact
                .entry(normalize(value))
                .or_default()
                .push(ordinal);
        }
        let searchable = normalize(&format!(
            "{} {} {} {} {}",
            node.label,
            node.qualified_name.as_deref().unwrap_or_default(),
            node.path.as_deref().unwrap_or_default(),
            node.kind,
            node.detail.as_deref().unwrap_or_default()
        ));
        for token in lexical_tokens(&searchable) {
            index.tokens.entry(token).or_default().push(ordinal);
        }
    }
    for postings in index.tokens.values_mut() {
        postings.sort_unstable();
        postings.dedup();
    }
    let index = Arc::new(index);
    if let Ok(mut cache) = indexes.lock() {
        if cache.len() >= MAX_QUERY_INDEXES {
            cache.clear();
        }
        cache.insert(snapshot.id.clone(), Arc::clone(&index));
    }
    index
}

fn trust_cost(trust: GraphTrust) -> f64 {
    match trust {
        GraphTrust::Extracted => 1.0,
        GraphTrust::Inferred => 1.6,
        GraphTrust::Ambiguous => 3.5,
        GraphTrust::Legacy => 4.0,
    }
}

#[derive(Debug)]
struct PathVisit {
    node_id: String,
    cost: f64,
}

impl PathVisit {
    fn new(node_id: String, cost: f64) -> Self {
        Self { node_id, cost }
    }
}

impl PartialEq for PathVisit {
    fn eq(&self, other: &Self) -> bool {
        self.node_id == other.node_id && self.cost == other.cost
    }
}

impl Eq for PathVisit {}

impl PartialOrd for PathVisit {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for PathVisit {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .cost
            .total_cmp(&self.cost)
            .then_with(|| other.node_id.cmp(&self.node_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::structural_graph::types::{
        GraphOrigin, StructuralGraphCommunity, StructuralGraphCoverage, StructuralGraphEngineInfo,
    };

    fn node(id: &str, label: &str, path: &str) -> StructuralGraphNode {
        StructuralGraphNode {
            id: id.to_string(),
            kind: "function".to_string(),
            label: label.to_string(),
            qualified_name: Some(format!("{path}::{label}")),
            path: Some(path.to_string()),
            detail: None,
            language: Some("rust".to_string()),
            community_id: None,
            trust: GraphTrust::Extracted,
            origin: GraphOrigin::Syntax,
            sources: Vec::new(),
        }
    }

    fn snapshot() -> StructuralGraphSnapshot {
        let nodes = vec![
            node("node:a", "start", "src/a.rs"),
            node("node:b", "middle", "src/b.rs"),
            node("node:c", "finish", "src/c.rs"),
            node("node:d", "start", "tests/a.rs"),
        ];
        let edge = |id: &str, from: &str, to: &str, trust| StructuralGraphEdge {
            id: id.to_string(),
            from: from.to_string(),
            to: to.to_string(),
            kind: "calls".to_string(),
            evidence: "test".to_string(),
            trust,
            origin: GraphOrigin::Syntax,
            sources: Vec::new(),
            candidates: Vec::new(),
        };
        StructuralGraphSnapshot {
            schema_version: 3,
            id: "snapshot".to_string(),
            repo_path: "/repo".to_string(),
            repo_head: Some("head".to_string()),
            created_at: "now".to_string(),
            engine: StructuralGraphEngineInfo {
                id: "engine".to_string(),
                version: "1".to_string(),
                bundled: true,
                syntax_aware: true,
                supported_languages: Vec::new(),
            },
            cursor: None,
            ignore_fingerprint: None,
            coverage: StructuralGraphCoverage::default(),
            diagnostics: Vec::new(),
            communities: Vec::new(),
            files: Vec::new(),
            nodes,
            edges: vec![
                edge("edge:ab", "node:a", "node:b", GraphTrust::Extracted),
                edge("edge:bc", "node:b", "node:c", GraphTrust::Extracted),
                edge("edge:ac", "node:a", "node:c", GraphTrust::Ambiguous),
            ],
            truncated: false,
        }
    }

    #[test]
    fn search_prefers_exact_stable_identifier() {
        let result = search(
            &snapshot(),
            "node:a",
            &GraphQueryFilter::default(),
            Some(10),
        );
        assert_eq!(result.hits[0].node.id, "node:a");
        assert_eq!(result.hits[0].matched_by, "id");
    }

    #[test]
    fn search_seeds_natural_language_questions_without_stop_words() {
        let result = search(
            &snapshot(),
            "where is the finish function?",
            &GraphQueryFilter::default(),
            Some(10),
        );
        assert_eq!(result.hits[0].node.id, "node:c");
        assert_eq!(result.hits[0].matched_by, "lexical_question");
    }

    #[test]
    fn search_pages_are_stable_and_carry_query_context() {
        let mut graph = snapshot();
        for index in 0..6 {
            graph.nodes.push(node(
                &format!("node:page:{index}"),
                &format!("paged target {index}"),
                &format!("src/page-{index}.rs"),
            ));
        }
        graph.coverage.discovered_files = 10;
        graph.coverage.indexed_files = 10;

        let first = search_page(
            &graph,
            "paged target",
            &GraphQueryFilter::default(),
            Some(2),
            None,
        )
        .expect("first page");
        let second = search_page(
            &graph,
            "paged target",
            &GraphQueryFilter::default(),
            Some(2),
            first.next_cursor.as_deref(),
        )
        .expect("second page");

        assert_eq!(first.hits.len(), 2);
        assert_eq!(second.hits.len(), 2);
        assert!(first.truncated);
        assert!(first.next_cursor.is_some());
        assert!(first
            .hits
            .iter()
            .all(|hit| second.hits.iter().all(|other| other.node.id != hit.node.id)));
        assert_eq!(first.context.snapshot_id, "snapshot");
        assert_eq!(first.context.coverage.indexed_files, 10);
        assert!(first.context.trust.extracted > 0);
        assert_eq!(first.context.freshness.stale, None);
    }

    #[test]
    fn overview_is_bounded_and_prefers_connected_nodes() {
        let result = overview(&snapshot(), Some(2));
        assert_eq!(result.nodes.len(), 2);
        assert!(result.nodes.iter().any(|node| node.id == "node:a"));
        assert!(result.nodes.iter().any(|node| node.id == "node:b"));
        assert!(result.truncated);
        assert_eq!(result.next_cursor.as_deref(), Some("2"));
        assert_eq!(result.context.max_edges, MAX_EDGE_LIMIT);
    }

    #[test]
    fn community_projection_is_bounded_and_rejects_unknown_ids() {
        let mut snapshot = snapshot();
        snapshot.communities = vec![StructuralGraphCommunity {
            id: "community:core".to_string(),
            label: "core".to_string(),
            member_count: 3,
            hub_node_ids: vec!["node:b".to_string()],
            bridge_node_ids: Vec::new(),
            score: 4.0,
        }];
        for node in snapshot.nodes.iter_mut().take(3) {
            node.community_id = Some("community:core".to_string());
        }
        let result = community(&snapshot, "community:core", Some(2)).unwrap();
        assert_eq!(result.nodes.len(), 2);
        assert!(result.truncated);
        assert!(community(&snapshot, "community:missing", Some(2)).is_err());
    }

    #[test]
    fn filtered_multi_seed_subgraph_and_snapshot_diff_are_deterministic() {
        let snapshot = snapshot();
        let projection = subgraph(
            &snapshot,
            &["node:a".to_string(), "node:c".to_string()],
            Some(1),
            &GraphQueryFilter {
                trust: vec![GraphTrust::Extracted],
                ..GraphQueryFilter::default()
            },
            Some(10),
        )
        .unwrap();
        assert_eq!(
            projection
                .edges
                .iter()
                .map(|edge| edge.id.as_str())
                .collect::<Vec<_>>(),
            vec!["edge:ab", "edge:bc"]
        );

        let mut after = snapshot.clone();
        after.id = "snapshot:after".to_string();
        after.nodes[0].detail = Some("changed".to_string());
        after.nodes.pop();
        after.nodes.push(node("node:new", "new", "src/new.rs"));
        after.edges.pop();
        let diff = diff_snapshots(&snapshot, &after);
        assert_eq!(diff.added_node_ids, vec!["node:new"]);
        assert_eq!(diff.removed_node_ids, vec!["node:d"]);
        assert_eq!(diff.changed_node_ids, vec!["node:a"]);
        assert_eq!(diff.removed_edge_ids, vec!["edge:ac"]);
    }

    #[test]
    fn ambiguous_labels_require_a_stable_identifier() {
        assert!(resolve_node(&snapshot(), "start")
            .unwrap_err()
            .contains("ambiguous"));
    }

    #[test]
    fn path_prefers_extracted_edges_over_ambiguous_shortcuts() {
        let result = shortest_path(
            &snapshot(),
            "node:a",
            "node:c",
            &GraphQueryFilter::default(),
        )
        .unwrap();
        assert_eq!(result.edges.len(), 2);
        assert_eq!(result.edges[0].id, "edge:ab");
    }

    #[test]
    fn impact_walks_reverse_callers_with_a_bound() {
        let result = impact(
            &snapshot(),
            "node:c",
            GraphDirection::Incoming,
            Some(3),
            &GraphQueryFilter::default(),
            Some(1),
        )
        .unwrap();
        assert_eq!(result.affected.len(), 1);
        assert!(result.truncated);

        let downstream = impact(
            &snapshot(),
            "node:a",
            GraphDirection::Outgoing,
            Some(1),
            &GraphQueryFilter::default(),
            Some(10),
        )
        .unwrap();
        assert!(downstream.affected.iter().any(|node| node.id == "node:b"));
    }
}
