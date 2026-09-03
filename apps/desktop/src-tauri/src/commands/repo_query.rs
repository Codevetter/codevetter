//! Bounded, read-only repository query projection shared by the native viewer and CLI.
//!
//! Query semantics stay in the canonical structural graph and history services. This
//! module only validates the native/CLI boundary and packages freshness alongside results.

use crate::commands::{
    history_graph::HistoryGraphStatus,
    history_query::{HistoryCausalSelector, HistoryCausalTrace},
    history_read::{HistoryReadService, HistoryUnifiedSearch},
    structural_graph::{
        query::{
            self, GraphDirection, GraphExplanation, GraphImpactResult, GraphPathResult,
            GraphQueryFilter, GraphSearchResult,
        },
        service::{StructuralGraphReadService, StructuralGraphReadStatus},
        types::StructuralGraphSnapshot,
    },
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{BufRead, Write},
    path::Path,
    sync::Arc,
};

pub const REPO_QUERY_SCHEMA: &str = "codevetter.repo-query/v2";
pub const REPO_QUERY_PREPARATION_SCHEMA: &str = "codevetter.repo-query-preparation/v1";
pub const REPO_QUERY_WORKER_REQUEST_SCHEMA: &str = "codevetter.repo-query-worker-request/v2";
pub const REPO_QUERY_WORKER_RESPONSE_SCHEMA: &str = "codevetter.repo-query-worker-response/v1";
const MAX_QUERY_BYTES: usize = 4_096;
const MAX_QUERY_RESULTS: usize = 100;
const MAX_WORKER_LINE_BYTES: usize = 16 * 1024;
const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_WORKER_GRAPH_SNAPSHOTS: usize = 1;

#[derive(Default)]
struct RepositoryQueryWorkerCache {
    graph_snapshots: HashMap<String, CachedGraphSnapshot>,
}

struct CachedGraphSnapshot {
    snapshot: Arc<StructuralGraphSnapshot>,
    traversal_ready: bool,
}

impl RepositoryQueryWorkerCache {
    fn graph_snapshot(
        &mut self,
        graph: &StructuralGraphReadService<'_>,
        status: &StructuralGraphReadStatus,
        traversal_required: bool,
    ) -> Result<Arc<StructuralGraphSnapshot>, String> {
        let snapshot_id = status.snapshot_id.as_deref().ok_or_else(|| {
            "Canonical structural graph snapshot identity is unavailable".to_string()
        })?;
        if let Some(cached) = self.graph_snapshots.get_mut(snapshot_id) {
            if traversal_required && !cached.traversal_ready {
                let edges = graph.traversal_edges_by_snapshot_id(snapshot_id)?;
                Arc::get_mut(&mut cached.snapshot)
                    .ok_or_else(|| "Canonical graph cache is unexpectedly shared".to_string())?
                    .edges = edges;
                cached.traversal_ready = true;
            }
            return Ok(Arc::clone(&cached.snapshot));
        }
        let mut snapshot = graph.search_snapshot_by_id(snapshot_id)?;
        if snapshot.id != snapshot_id {
            return Err(
                "Canonical structural graph changed while the query was prepared".to_string(),
            );
        }
        if self.graph_snapshots.len() >= MAX_WORKER_GRAPH_SNAPSHOTS {
            self.graph_snapshots.clear();
        }
        if traversal_required {
            snapshot.edges = graph.traversal_edges_by_snapshot_id(snapshot_id)?;
        }
        let snapshot = Arc::new(snapshot);
        self.graph_snapshots.insert(
            snapshot.id.clone(),
            CachedGraphSnapshot {
                snapshot: Arc::clone(&snapshot),
                traversal_ready: traversal_required,
            },
        );
        Ok(snapshot)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryQueryDomain {
    Graph,
    History,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryQueryMode {
    #[default]
    Search,
    Explain,
    Impact,
    Path,
    Trace,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryHistorySelectorKind {
    Event,
    Entity,
    Revision,
    Release,
    Episode,
}

#[derive(Debug, Clone)]
pub struct RepositoryQueryInput {
    pub domain: RepositoryQueryDomain,
    pub mode: RepositoryQueryMode,
    pub query: String,
    pub target: Option<String>,
    pub direction: Option<GraphDirection>,
    pub depth: Option<usize>,
    pub history_selector: Option<RepositoryHistorySelectorKind>,
    pub limit: usize,
}

impl RepositoryQueryInput {
    pub fn search(domain: RepositoryQueryDomain, query: impl Into<String>, limit: usize) -> Self {
        Self {
            domain,
            mode: RepositoryQueryMode::Search,
            query: query.into(),
            target: None,
            direction: None,
            depth: None,
            history_selector: None,
            limit,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryQueryReceipt {
    pub schema_version: &'static str,
    pub authority: &'static str,
    pub repo_path: String,
    pub query: String,
    pub domain: RepositoryQueryDomain,
    pub mode: RepositoryQueryMode,
    pub target: Option<String>,
    pub direction: Option<GraphDirection>,
    pub depth: Option<usize>,
    pub history_selector: Option<RepositoryHistorySelectorKind>,
    pub limit: usize,
    pub status: &'static str,
    pub issue: Option<String>,
    pub graph_status: StructuralGraphReadStatus,
    pub history_status: HistoryGraphStatus,
    pub graph_result: Option<GraphSearchResult>,
    pub graph_explanation: Option<GraphExplanation>,
    pub graph_impact: Option<GraphImpactResult>,
    pub graph_path: Option<GraphPathResult>,
    pub history_result: Option<HistoryUnifiedSearch>,
    pub history_trace: Option<HistoryCausalTrace>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryQueryWorkerOperation {
    Prepare,
    Query,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryQueryWorkerRequest {
    pub schema_version: String,
    pub request_id: String,
    pub operation: RepositoryQueryWorkerOperation,
    pub repo_path: String,
    pub domain: RepositoryQueryDomain,
    #[serde(default)]
    pub mode: RepositoryQueryMode,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub direction: Option<GraphDirection>,
    #[serde(default)]
    pub depth: Option<usize>,
    #[serde(default)]
    pub history_selector: Option<RepositoryHistorySelectorKind>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepositoryQueryPreparation {
    pub schema_version: &'static str,
    pub authority: &'static str,
    pub repo_path: String,
    pub domain: RepositoryQueryDomain,
    pub status: &'static str,
    pub issue: Option<String>,
    pub graph_status: StructuralGraphReadStatus,
    pub history_status: HistoryGraphStatus,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepositoryQueryWorkerResponse {
    pub schema_version: &'static str,
    pub request_id: String,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receipt: Option<RepositoryQueryReceipt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preparation: Option<RepositoryQueryPreparation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn query_repository_evidence(
    connection: &Connection,
    repo_path: &Path,
    domain: RepositoryQueryDomain,
    query_text: &str,
    limit: usize,
) -> Result<RepositoryQueryReceipt, String> {
    query_repository_evidence_with_input(
        connection,
        repo_path,
        RepositoryQueryInput::search(domain, query_text, limit),
    )
}

pub fn query_repository_evidence_with_input(
    connection: &Connection,
    repo_path: &Path,
    input: RepositoryQueryInput,
) -> Result<RepositoryQueryReceipt, String> {
    query_repository_evidence_internal(connection, None, repo_path, input)
}

pub fn prepare_repository_query(
    connection: &Connection,
    repo_path: &Path,
    domain: RepositoryQueryDomain,
) -> Result<RepositoryQueryPreparation, String> {
    prepare_repository_query_with_cache(connection, repo_path, domain, None)
}

fn prepare_repository_query_with_cache(
    connection: &Connection,
    repo_path: &Path,
    domain: RepositoryQueryDomain,
    cache: Option<&mut RepositoryQueryWorkerCache>,
) -> Result<RepositoryQueryPreparation, String> {
    let canonical = canonical_repository(repo_path)?;
    let repo_path = canonical.to_string_lossy().into_owned();
    let graph = StructuralGraphReadService::new(connection, repo_path.clone());
    let history = HistoryReadService::new(connection, &repo_path)?;
    let graph_status = graph.status()?;
    let history_status = history.status()?;
    let (status, issue) = match domain {
        RepositoryQueryDomain::Graph if graph_status.indexed => {
            if let Some(cache) = cache {
                let snapshot = cache.graph_snapshot(&graph, &graph_status, false)?;
                query::prepare_search_index(&snapshot);
            } else {
                graph.prepare_search_index()?;
            }
            ("ready", None)
        }
        RepositoryQueryDomain::Graph => (
            "unavailable",
            Some(
                "The canonical structural graph has not been indexed for this repository."
                    .to_string(),
            ),
        ),
        RepositoryQueryDomain::History if history_status.indexed => ("ready", None),
        RepositoryQueryDomain::History => (
            "unavailable",
            Some(
                "Temporal history has not been indexed for this repository; no query was run."
                    .to_string(),
            ),
        ),
    };
    Ok(RepositoryQueryPreparation {
        schema_version: REPO_QUERY_PREPARATION_SCHEMA,
        authority: "read_only_projection",
        repo_path,
        domain,
        status,
        issue,
        graph_status,
        history_status,
    })
}

/// Serve bounded read-only repository requests until stdin closes.
///
/// One SQLite connection and the canonical process-local graph index cache are
/// retained for the worker lifetime. Every request receives exactly one line
/// of JSON, including malformed requests, so callers cannot lose framing.
pub fn run_repository_query_worker(
    connection: &Connection,
    reader: impl BufRead,
    mut writer: impl Write,
) -> Result<(), String> {
    let mut cache = RepositoryQueryWorkerCache::default();
    for line in reader.lines() {
        let line =
            line.map_err(|error| format!("read repository query worker request: {error}"))?;
        let response = if line.len() > MAX_WORKER_LINE_BYTES {
            RepositoryQueryWorkerResponse::error(
                "invalid",
                format!(
                    "Repository query worker requests must not exceed {MAX_WORKER_LINE_BYTES} bytes"
                ),
            )
        } else {
            handle_worker_line(connection, &mut cache, &line)
        };
        serde_json::to_writer(&mut writer, &response)
            .map_err(|error| format!("serialize repository query worker response: {error}"))?;
        writer
            .write_all(b"\n")
            .map_err(|error| format!("write repository query worker response: {error}"))?;
        writer
            .flush()
            .map_err(|error| format!("flush repository query worker response: {error}"))?;
    }
    Ok(())
}

fn handle_worker_line(
    connection: &Connection,
    cache: &mut RepositoryQueryWorkerCache,
    line: &str,
) -> RepositoryQueryWorkerResponse {
    let request = match serde_json::from_str::<RepositoryQueryWorkerRequest>(line) {
        Ok(request) => request,
        Err(error) => {
            return RepositoryQueryWorkerResponse::error(
                "invalid",
                format!("Decode repository query worker request: {error}"),
            )
        }
    };
    if let Err(error) = validate_worker_request(&request) {
        return RepositoryQueryWorkerResponse::error(&request.request_id, error);
    }
    let outcome = match request.operation {
        RepositoryQueryWorkerOperation::Prepare => prepare_repository_query_with_cache(
            connection,
            Path::new(&request.repo_path),
            request.domain,
            Some(cache),
        )
        .map(|preparation| (None, Some(preparation))),
        RepositoryQueryWorkerOperation::Query => query_repository_evidence_cached(
            connection,
            cache,
            Path::new(&request.repo_path),
            RepositoryQueryInput {
                domain: request.domain,
                mode: request.mode,
                query: request.query.unwrap_or_default(),
                target: request.target,
                direction: request.direction,
                depth: request.depth,
                history_selector: request.history_selector,
                limit: request.limit.unwrap_or(40),
            },
        )
        .map(|receipt| (Some(receipt), None)),
    };
    match outcome {
        Ok((receipt, preparation)) => RepositoryQueryWorkerResponse {
            schema_version: REPO_QUERY_WORKER_RESPONSE_SCHEMA,
            request_id: request.request_id,
            status: "ok",
            receipt,
            preparation,
            error: None,
        },
        Err(error) => RepositoryQueryWorkerResponse::error(&request.request_id, error),
    }
}

fn query_repository_evidence_cached(
    connection: &Connection,
    cache: &mut RepositoryQueryWorkerCache,
    repo_path: &Path,
    input: RepositoryQueryInput,
) -> Result<RepositoryQueryReceipt, String> {
    query_repository_evidence_internal(connection, Some(cache), repo_path, input)
}

fn query_repository_evidence_internal(
    connection: &Connection,
    cache: Option<&mut RepositoryQueryWorkerCache>,
    repo_path: &Path,
    mut input: RepositoryQueryInput,
) -> Result<RepositoryQueryReceipt, String> {
    normalize_and_validate_input(&mut input)?;
    let canonical = canonical_repository(repo_path)?;
    let repo_path = canonical.to_string_lossy().into_owned();
    let graph = StructuralGraphReadService::new(connection, repo_path.clone());
    let history = HistoryReadService::new(connection, &repo_path)?;
    let graph_status = graph.status()?;
    let history_status = history.status()?;

    let mut graph_result = None;
    let mut graph_explanation = None;
    let mut graph_impact = None;
    let mut graph_path = None;
    let mut history_result = None;
    let mut history_trace = None;
    let (status, issue) = match input.domain {
        RepositoryQueryDomain::Graph if !graph_status.indexed => (
            "unavailable",
            Some(
                "The canonical structural graph has not been indexed for this repository."
                    .to_string(),
            ),
        ),
        RepositoryQueryDomain::Graph => {
            let snapshot = match cache {
                Some(cache) => cache.graph_snapshot(
                    &graph,
                    &graph_status,
                    input.mode != RepositoryQueryMode::Search,
                )?,
                None => {
                    let snapshot_id = graph_status.snapshot_id.as_deref().ok_or_else(|| {
                        "Canonical structural graph snapshot identity is unavailable".to_string()
                    })?;
                    let mut snapshot = graph.search_snapshot_by_id(snapshot_id)?;
                    if input.mode != RepositoryQueryMode::Search {
                        snapshot.edges = graph.traversal_edges_by_snapshot_id(snapshot_id)?;
                    }
                    Arc::new(snapshot)
                }
            };
            let current_head = graph.current_head();
            match input.mode {
                RepositoryQueryMode::Search => {
                    let mut result = query::search(
                        &snapshot,
                        &input.query,
                        &GraphQueryFilter::default(),
                        Some(input.limit),
                    );
                    result.context.observe_current_head(current_head);
                    graph_result = Some(result);
                }
                RepositoryQueryMode::Explain => {
                    let mut result = query::explain(&snapshot, &input.query)?;
                    result.context.observe_current_head(current_head);
                    graph_explanation = Some(result);
                }
                RepositoryQueryMode::Impact => {
                    let mut result = query::impact(
                        &snapshot,
                        &input.query,
                        input.direction.clone().unwrap_or(GraphDirection::Outgoing),
                        input.depth,
                        &GraphQueryFilter::default(),
                        Some(input.limit),
                    )?;
                    result.context.observe_current_head(current_head);
                    hydrate_result_edges(&graph, &result.context.snapshot_id, &mut result.edges)?;
                    graph_impact = Some(result);
                }
                RepositoryQueryMode::Path => {
                    let mut result = query::shortest_path(
                        &snapshot,
                        &input.query,
                        input.target.as_deref().unwrap_or_default(),
                        &GraphQueryFilter::default(),
                    )?;
                    result.context.observe_current_head(current_head);
                    hydrate_result_edges(&graph, &result.context.snapshot_id, &mut result.edges)?;
                    graph_path = Some(result);
                }
                RepositoryQueryMode::Trace => unreachable!("validated graph query mode"),
            }
            ("ready", None)
        }
        RepositoryQueryDomain::History if !history_status.indexed => (
            "unavailable",
            Some(
                "Temporal history has not been indexed for this repository; no query was run."
                    .to_string(),
            ),
        ),
        RepositoryQueryDomain::History => {
            match input.mode {
                RepositoryQueryMode::Search => {
                    history_result = Some(history.search(&input.query, input.limit, 0)?);
                }
                RepositoryQueryMode::Trace => {
                    history_trace = Some(history.trace(
                        history_selector(
                            input.history_selector.expect("validated history selector"),
                            &input.query,
                        ),
                        input.limit,
                        None,
                    )?);
                }
                _ => unreachable!("validated history query mode"),
            }
            ("ready", None)
        }
    };

    Ok(RepositoryQueryReceipt {
        schema_version: REPO_QUERY_SCHEMA,
        authority: "read_only_projection",
        repo_path,
        query: input.query,
        domain: input.domain,
        mode: input.mode,
        target: input.target,
        direction: input.direction,
        depth: input.depth,
        history_selector: input.history_selector,
        limit: input.limit,
        status,
        issue,
        graph_status,
        history_status,
        graph_result,
        graph_explanation,
        graph_impact,
        graph_path,
        history_result,
        history_trace,
    })
}

fn validate_worker_request(request: &RepositoryQueryWorkerRequest) -> Result<(), String> {
    if request.schema_version != REPO_QUERY_WORKER_REQUEST_SCHEMA {
        return Err(format!(
            "Unsupported repository query worker request schema {}",
            request.schema_version
        ));
    }
    if request.request_id.is_empty()
        || request.request_id.len() > MAX_REQUEST_ID_BYTES
        || request.request_id.chars().any(char::is_control)
    {
        return Err("Repository query worker request ids must be one bounded line".to_string());
    }
    if request.repo_path.is_empty()
        || request.repo_path.len() > MAX_QUERY_BYTES
        || request.repo_path.chars().any(char::is_control)
    {
        return Err("Repository query worker paths must be one bounded line".to_string());
    }
    match request.operation {
        RepositoryQueryWorkerOperation::Prepare
            if request.mode != RepositoryQueryMode::Search
                || request.query.is_some()
                || request.target.is_some()
                || request.direction.is_some()
                || request.depth.is_some()
                || request.history_selector.is_some()
                || request.limit.is_some() =>
        {
            Err("Repository query prepare does not accept query operation fields".to_string())
        }
        RepositoryQueryWorkerOperation::Query if request.query.is_none() => {
            Err("Repository query requests require a query field".to_string())
        }
        RepositoryQueryWorkerOperation::Query => {
            let mut input = RepositoryQueryInput {
                domain: request.domain,
                mode: request.mode,
                query: request.query.clone().unwrap_or_default(),
                target: request.target.clone(),
                direction: request.direction.clone(),
                depth: request.depth,
                history_selector: request.history_selector,
                limit: request.limit.unwrap_or(40),
            };
            normalize_and_validate_input(&mut input)
        }
        RepositoryQueryWorkerOperation::Prepare => Ok(()),
    }
}

impl RepositoryQueryWorkerResponse {
    fn error(request_id: &str, error: String) -> Self {
        Self {
            schema_version: REPO_QUERY_WORKER_RESPONSE_SCHEMA,
            request_id: request_id.to_string(),
            status: "error",
            receipt: None,
            preparation: None,
            error: Some(error),
        }
    }
}

fn canonical_repository(repo_path: &Path) -> Result<std::path::PathBuf, String> {
    let canonical = std::fs::canonicalize(repo_path)
        .map_err(|error| format!("repository {} is unavailable: {error}", repo_path.display()))?;
    if !canonical.is_dir() {
        return Err(format!(
            "repository {} is not a directory",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn validate_query(query: &str) -> Result<String, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("A non-empty repository query is required".to_string());
    }
    if query.len() > MAX_QUERY_BYTES || query.chars().any(char::is_control) {
        return Err(format!(
            "Repository queries must be one bounded line of at most {MAX_QUERY_BYTES} bytes"
        ));
    }
    Ok(query.to_string())
}

fn validate_limit(limit: usize) -> Result<usize, String> {
    if !(1..=MAX_QUERY_RESULTS).contains(&limit) {
        return Err(format!(
            "Repository query limit must be between 1 and {MAX_QUERY_RESULTS}"
        ));
    }
    Ok(limit)
}

fn normalize_and_validate_input(input: &mut RepositoryQueryInput) -> Result<(), String> {
    input.query = validate_query(&input.query)?;
    input.limit = validate_limit(input.limit)?;
    if let Some(target) = input.target.as_mut() {
        *target = validate_query(target)?;
    }
    if let Some(depth) = input.depth {
        if !(1..=12).contains(&depth) {
            return Err("Repository impact depth must be between 1 and 12".to_string());
        }
    }
    match (input.domain, input.mode) {
        (RepositoryQueryDomain::Graph, RepositoryQueryMode::Search)
        | (RepositoryQueryDomain::Graph, RepositoryQueryMode::Explain)
            if input.target.is_none()
                && input.direction.is_none()
                && input.depth.is_none()
                && input.history_selector.is_none() =>
        {
            Ok(())
        }
        (RepositoryQueryDomain::Graph, RepositoryQueryMode::Impact)
            if input.target.is_none() && input.history_selector.is_none() =>
        {
            input.direction.get_or_insert(GraphDirection::Outgoing);
            input.depth.get_or_insert(3);
            Ok(())
        }
        (RepositoryQueryDomain::Graph, RepositoryQueryMode::Path)
            if input.target.is_some()
                && input.direction.is_none()
                && input.depth.is_none()
                && input.history_selector.is_none() =>
        {
            Ok(())
        }
        (RepositoryQueryDomain::History, RepositoryQueryMode::Search)
            if input.target.is_none()
                && input.direction.is_none()
                && input.depth.is_none()
                && input.history_selector.is_none() =>
        {
            Ok(())
        }
        (RepositoryQueryDomain::History, RepositoryQueryMode::Trace)
            if input.target.is_none()
                && input.direction.is_none()
                && input.depth.is_none()
                && input.history_selector.is_some() =>
        {
            Ok(())
        }
        (RepositoryQueryDomain::Graph, RepositoryQueryMode::Trace) => {
            Err("Graph queries do not support causal trace mode".to_string())
        }
        (RepositoryQueryDomain::History, _) => {
            Err("History queries support only search and causal trace modes".to_string())
        }
        _ => Err("Repository query fields are inconsistent with the selected mode".to_string()),
    }
}

fn history_selector(kind: RepositoryHistorySelectorKind, value: &str) -> HistoryCausalSelector {
    match kind {
        RepositoryHistorySelectorKind::Event => HistoryCausalSelector::Event {
            event_id: value.to_string(),
        },
        RepositoryHistorySelectorKind::Entity => HistoryCausalSelector::Entity {
            entity_id: value.to_string(),
        },
        RepositoryHistorySelectorKind::Revision => HistoryCausalSelector::Revision {
            revision: value.to_string(),
        },
        RepositoryHistorySelectorKind::Release => HistoryCausalSelector::Release {
            tag: value.to_string(),
        },
        RepositoryHistorySelectorKind::Episode => HistoryCausalSelector::EpisodeKey {
            key: value.to_string(),
        },
    }
}

fn hydrate_result_edges(
    graph: &StructuralGraphReadService<'_>,
    snapshot_id: &str,
    edges: &mut [crate::commands::structural_graph::types::StructuralGraphEdge],
) -> Result<(), String> {
    let ids = edges.iter().map(|edge| edge.id.clone()).collect::<Vec<_>>();
    let mut hydrated = graph
        .edges_by_ids(snapshot_id, &ids)?
        .into_iter()
        .map(|edge| (edge.id.clone(), edge))
        .collect::<HashMap<_, _>>();
    for edge in edges {
        *edge = hydrated
            .remove(&edge.id)
            .ok_or_else(|| "A canonical traversal edge could not be hydrated".to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::structural_graph::{
        storage::persist_snapshot,
        types::{
            GraphOrigin, GraphTrust, StructuralGraphCoverage, StructuralGraphEdge,
            StructuralGraphEngineInfo, StructuralGraphNode, StructuralGraphSnapshot,
            STRUCTURAL_GRAPH_SCHEMA_VERSION,
        },
    };
    use std::{fs, io::Cursor, process::Command};

    #[test]
    fn query_boundary_rejects_empty_multiline_and_unbounded_inputs() {
        assert!(validate_query("  ").is_err());
        assert!(validate_query("one\ntwo").is_err());
        assert!(validate_query(&"x".repeat(MAX_QUERY_BYTES + 1)).is_err());
        assert!(validate_limit(0).is_err());
        assert!(validate_limit(MAX_QUERY_RESULTS + 1).is_err());
        assert_eq!(
            validate_query("  review pipeline  ").unwrap(),
            "review pipeline"
        );
        assert_eq!(validate_limit(25).unwrap(), 25);
    }

    #[test]
    fn history_query_fails_closed_when_temporal_coverage_is_not_indexed() {
        let root =
            std::env::temp_dir().join(format!("codevetter-repo-query-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("fixture root");
        for arguments in [
            vec!["init", "-q"],
            vec!["add", "README.md"],
            vec![
                "-c",
                "user.name=CodeVetter",
                "-c",
                "user.email=codevetter@example.invalid",
                "commit",
                "-qm",
                "Fix verification regression",
            ],
        ] {
            if arguments[0] == "add" {
                fs::write(root.join("README.md"), "fixture").expect("fixture source");
            }
            assert!(Command::new("git")
                .args(arguments)
                .current_dir(&root)
                .status()
                .expect("git command")
                .success());
        }
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("schema");

        let receipt = query_repository_evidence(
            &connection,
            &root,
            RepositoryQueryDomain::History,
            "regression",
            10,
        )
        .expect("history query");

        assert_eq!(receipt.schema_version, REPO_QUERY_SCHEMA);
        assert_eq!(receipt.authority, "read_only_projection");
        assert_eq!(receipt.status, "unavailable");
        assert!(!receipt.graph_status.indexed);
        assert!(!receipt.history_status.indexed);
        assert!(receipt.issue.is_some());
        assert!(receipt.history_result.is_none());
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn worker_keeps_framing_and_fails_closed_for_unindexed_evidence() {
        let root =
            std::env::temp_dir().join(format!("codevetter-repo-worker-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("fixture root");
        assert!(Command::new("git")
            .args(["init", "-q"])
            .current_dir(&root)
            .status()
            .expect("git init")
            .success());
        fs::write(root.join("README.md"), "fixture").expect("fixture source");
        assert!(Command::new("git")
            .args(["add", "README.md"])
            .current_dir(&root)
            .status()
            .expect("git add")
            .success());
        assert!(Command::new("git")
            .args([
                "-c",
                "user.name=CodeVetter",
                "-c",
                "user.email=codevetter@example.invalid",
                "commit",
                "-qm",
                "Seed worker fixture",
            ])
            .current_dir(&root)
            .status()
            .expect("git commit")
            .success());
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("schema");
        let repo_path = root.to_string_lossy();
        let input = format!(
            "{{\"schema_version\":\"{REPO_QUERY_WORKER_REQUEST_SCHEMA}\",\"request_id\":\"prepare-1\",\"operation\":\"prepare\",\"repo_path\":{},\"domain\":\"graph\"}}\n{{\"schema_version\":\"{REPO_QUERY_WORKER_REQUEST_SCHEMA}\",\"request_id\":\"query-1\",\"operation\":\"query\",\"repo_path\":{},\"domain\":\"history\",\"query\":\"seed\",\"limit\":10}}\n",
            serde_json::to_string(repo_path.as_ref()).expect("path json"),
            serde_json::to_string(repo_path.as_ref()).expect("path json")
        );
        let mut output = Vec::new();
        run_repository_query_worker(&connection, Cursor::new(input), &mut output)
            .expect("worker run");
        let encoded = String::from_utf8(output).expect("worker utf8");
        let responses = encoded
            .lines()
            .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("worker response"))
            .collect::<Vec<_>>();

        assert_eq!(responses.len(), 2);
        assert_eq!(responses[0]["request_id"], "prepare-1");
        assert_eq!(responses[0]["status"], "ok");
        assert_eq!(responses[0]["preparation"]["status"], "unavailable");
        assert_eq!(responses[1]["request_id"], "query-1");
        assert_eq!(responses[1]["status"], "ok");
        assert_eq!(responses[1]["receipt"]["status"], "unavailable");
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn worker_cache_reloads_when_the_latest_canonical_snapshot_changes() {
        let root =
            std::env::temp_dir().join(format!("codevetter-repo-cache-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("fixture root");
        assert!(Command::new("git")
            .args(["init", "-q"])
            .current_dir(&root)
            .status()
            .expect("git init")
            .success());
        fs::write(root.join("README.md"), "fixture").expect("fixture source");
        assert!(Command::new("git")
            .args(["add", "README.md"])
            .current_dir(&root)
            .status()
            .expect("git add")
            .success());
        assert!(Command::new("git")
            .args([
                "-c",
                "user.name=CodeVetter",
                "-c",
                "user.email=codevetter@example.invalid",
                "commit",
                "-qm",
                "Seed cache fixture",
            ])
            .current_dir(&root)
            .status()
            .expect("git commit")
            .success());
        let head = String::from_utf8(
            Command::new("git")
                .args(["rev-parse", "HEAD"])
                .current_dir(&root)
                .output()
                .expect("git head")
                .stdout,
        )
        .expect("head utf8")
        .trim()
        .to_string();
        let repo_path = fs::canonicalize(&root)
            .expect("canonical fixture root")
            .to_string_lossy()
            .into_owned();
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("schema");
        persist_snapshot(
            &connection,
            &search_snapshot(
                "snapshot-1",
                "alpha_verifier",
                "2026-09-01T00:00:01Z",
                &repo_path,
                &head,
            ),
        )
        .expect("first snapshot");
        let mut cache = RepositoryQueryWorkerCache::default();
        let preparation = prepare_repository_query_with_cache(
            &connection,
            &root,
            RepositoryQueryDomain::Graph,
            Some(&mut cache),
        )
        .expect("prepare first snapshot");
        assert_eq!(preparation.status, "ready");
        assert!(cache.graph_snapshots.contains_key("snapshot-1"));
        let first = query_repository_evidence_cached(
            &connection,
            &mut cache,
            &root,
            RepositoryQueryInput::search(RepositoryQueryDomain::Graph, "alpha", 10),
        )
        .expect("query first snapshot");
        assert_eq!(
            first.graph_result.unwrap().hits[0].node.label,
            "alpha_verifier"
        );
        let explained = query_repository_evidence_cached(
            &connection,
            &mut cache,
            &root,
            RepositoryQueryInput {
                domain: RepositoryQueryDomain::Graph,
                mode: RepositoryQueryMode::Explain,
                query: "node:alpha_verifier".to_string(),
                target: None,
                direction: None,
                depth: None,
                history_selector: None,
                limit: 10,
            },
        )
        .expect("explain first snapshot");
        assert_eq!(
            explained.graph_explanation.unwrap().node.label,
            "alpha_verifier"
        );
        let impacted = query_repository_evidence_cached(
            &connection,
            &mut cache,
            &root,
            RepositoryQueryInput {
                domain: RepositoryQueryDomain::Graph,
                mode: RepositoryQueryMode::Impact,
                query: "node:alpha_verifier".to_string(),
                target: None,
                direction: Some(GraphDirection::Both),
                depth: Some(2),
                history_selector: None,
                limit: 10,
            },
        )
        .expect("impact first snapshot");
        assert_eq!(
            impacted.graph_impact.unwrap().edges[0].evidence,
            "canonical fixture edge"
        );

        persist_snapshot(
            &connection,
            &search_snapshot(
                "snapshot-2",
                "beta_verifier",
                "2026-09-01T00:00:02Z",
                &repo_path,
                &head,
            ),
        )
        .expect("second snapshot");
        let second = query_repository_evidence_cached(
            &connection,
            &mut cache,
            &root,
            RepositoryQueryInput::search(RepositoryQueryDomain::Graph, "beta", 10),
        )
        .expect("query second snapshot");
        assert_eq!(
            second.graph_result.unwrap().hits[0].node.label,
            "beta_verifier"
        );
        assert_eq!(cache.graph_snapshots.len(), 1);
        assert!(cache.graph_snapshots.contains_key("snapshot-2"));
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    fn search_snapshot(
        id: &str,
        label: &str,
        created_at: &str,
        repo_path: &str,
        head: &str,
    ) -> StructuralGraphSnapshot {
        StructuralGraphSnapshot {
            schema_version: STRUCTURAL_GRAPH_SCHEMA_VERSION,
            id: id.to_string(),
            repo_path: repo_path.to_string(),
            repo_head: Some(head.to_string()),
            created_at: created_at.to_string(),
            engine: StructuralGraphEngineInfo {
                id: "fixture".to_string(),
                version: "1".to_string(),
                bundled: true,
                syntax_aware: true,
                supported_languages: vec!["rust".to_string()],
            },
            cursor: None,
            ignore_fingerprint: None,
            coverage: StructuralGraphCoverage {
                discovered_files: 1,
                indexed_files: 1,
                ..StructuralGraphCoverage::default()
            },
            diagnostics: Vec::new(),
            communities: Vec::new(),
            files: Vec::new(),
            nodes: vec![StructuralGraphNode {
                id: format!("node:{label}"),
                kind: "function".to_string(),
                label: label.to_string(),
                qualified_name: Some(format!("fixture::{label}")),
                path: Some("src/lib.rs".to_string()),
                detail: Some("Canonical worker cache fixture".to_string()),
                language: Some("rust".to_string()),
                community_id: None,
                trust: GraphTrust::Extracted,
                origin: GraphOrigin::Syntax,
                sources: Vec::new(),
            }],
            edges: vec![StructuralGraphEdge {
                id: format!("edge:{label}"),
                from: format!("node:{label}"),
                to: format!("node:{label}"),
                kind: "references".to_string(),
                evidence: "canonical fixture edge".to_string(),
                trust: GraphTrust::Extracted,
                origin: GraphOrigin::Resolution,
                sources: Vec::new(),
                candidates: Vec::new(),
            }],
            metrics: Vec::new(),
            clone_groups: Vec::new(),
            truncated: false,
        }
    }
}
