use crate::{
    commands::{
        history_graph::{repository_tag_fingerprint, HistoryTemporalReference},
        history_query::HistoryCausalSelector,
        history_read::{HistoryReadService, HistorySearchKind},
        mcp_access::{record_mcp_audit, require_enabled_scope},
        structural_graph::{
            query::{GraphDirection, GraphQueryFilter},
            service::StructuralGraphReadService,
        },
    },
    mcp::{
        cursor::McpCursor,
        limits::{
            DEFAULT_PAGE_SIZE, MAX_EVIDENCE_IDS, MAX_GRAPH_NODES, MAX_HOPS, MAX_PAGE_SIZE,
            QUERY_TIMEOUT_MS,
        },
        sanitize::{sanitize_error_message, sanitize_response},
        uri::HistoryResourceUri,
    },
};
use rmcp::{
    model::{
        Annotations, CallToolRequestParams, CallToolResult, ContentBlock, ErrorData,
        Implementation, JsonObject, ListResourceTemplatesResult, ListResourcesResult,
        ListToolsResult, PaginatedRequestParams, ProtocolVersion, ReadResourceRequestParams,
        ReadResourceResult, Resource, ResourceContents, ResourceTemplate, ServerCapabilities,
        ServerInfo, Tool, ToolAnnotations,
    },
    service::RequestContext,
    RoleServer, ServerHandler,
};
use rusqlite::{Connection, OpenFlags};
use serde::de::DeserializeOwned;
use serde_json::{json, Map, Value};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::Instant,
};
use tokio::sync::Semaphore;
use uuid::Uuid;

const MIME_TYPE: &str = "application/json";
const MAX_CONCURRENT_QUERIES: usize = 4;
const MAX_LINEAGE_SCAN: usize = 500;
static QUERY_SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();

#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
#[serde(default, deny_unknown_fields)]
struct McpHistoryFilter {
    kinds: Vec<HistorySearchKind>,
    from: Option<String>,
    to: Option<String>,
}

impl McpHistoryFilter {
    fn validate(&self) -> Result<(), String> {
        let from = self.from.as_deref().map(parse_filter_time).transpose()?;
        let to = self.to.as_deref().map(parse_filter_time).transpose()?;
        if from.zip(to).is_some_and(|(from, to)| from > to) {
            return Err("History filter 'from' must not be after 'to'".to_string());
        }
        Ok(())
    }

    fn includes_kind(&self, kind: &HistorySearchKind) -> bool {
        self.kinds.is_empty() || self.kinds.contains(kind)
    }

    fn includes_time(&self, value: Option<&str>) -> bool {
        let Some(value) = value.and_then(|value| parse_filter_time(value).ok()) else {
            return self.from.is_none() && self.to.is_none();
        };
        let after_start = self
            .from
            .as_deref()
            .and_then(|value| parse_filter_time(value).ok())
            .is_none_or(|from| value >= from);
        let before_end = self
            .to
            .as_deref()
            .and_then(|value| parse_filter_time(value).ok())
            .is_none_or(|to| value <= to);
        after_start && before_end
    }
}

fn parse_filter_time(value: &str) -> Result<chrono::DateTime<chrono::FixedOffset>, String> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map_err(|_| "History filter dates must be RFC 3339 timestamps".to_string())
}

#[derive(Debug, Clone)]
pub struct CodeVetterMcpServer {
    database_path: PathBuf,
    repo_id: String,
    repo_path: PathBuf,
    session_id: String,
    tools: Arc<Vec<Tool>>,
    freshness_cache: Arc<Mutex<RepositoryFreshnessCache>>,
}

#[derive(Debug)]
struct RepositoryFreshnessCache {
    head: String,
    tags_fingerprint: Option<String>,
    checked_at: Instant,
}

#[derive(Clone)]
struct RepositoryFreshness {
    head: String,
    tags_fingerprint: Option<String>,
}

impl CodeVetterMcpServer {
    pub fn new(database_path: PathBuf, repo_id: String) -> Result<Self, String> {
        let connection = open_read_only(&database_path)?;
        let scope = require_enabled_scope(&connection, &repo_id)?;
        let repo_path = PathBuf::from(&scope.repo_path);
        let current_head = scope
            .indexed_head
            .ok_or_else(|| "Release history is not built for this repository".to_string())?;
        Ok(Self {
            database_path,
            repo_id,
            repo_path,
            session_id: Uuid::new_v4().to_string(),
            tools: Arc::new(tool_definitions()),
            freshness_cache: Arc::new(Mutex::new(RepositoryFreshnessCache {
                head: current_head,
                tags_fingerprint: None,
                // Initialization exposes no repository content. Force the first
                // scoped read to refresh Git HEAD, while keeping handshake cold
                // start independent of process spawning.
                checked_at: Instant::now() - std::time::Duration::from_secs(1),
            })),
        })
    }

    fn current_freshness(&self) -> Result<RepositoryFreshness, String> {
        let mut cache = self
            .freshness_cache
            .lock()
            .map_err(|_| "Repository freshness cache is unavailable".to_string())?;
        if cache.checked_at.elapsed() >= std::time::Duration::from_secs(1) {
            cache.head = git_head_for_repo(&self.repo_path)?;
            cache.tags_fingerprint = repository_tag_fingerprint(&self.repo_path).ok();
            cache.checked_at = Instant::now();
        }
        Ok(RepositoryFreshness {
            head: cache.head.clone(),
            tags_fingerprint: cache.tags_fingerprint.clone(),
        })
    }

    async fn execute_tool(&self, name: String, arguments: Map<String, Value>) -> CallToolResult {
        let database_path = self.database_path.clone();
        let repo_id = self.repo_id.clone();
        let session_id = self.session_id.clone();
        let freshness = match self.current_freshness() {
            Ok(freshness) => freshness,
            Err(message) => {
                return CallToolResult::structured_error(json!({
                    "schemaVersion": 1,
                    "error": {"code": "unavailable", "message": message},
                }))
            }
        };
        let operation = name.clone();
        let started = Instant::now();
        let result = match tokio::time::timeout(
            query_timeout_remaining(started),
            query_semaphore().acquire_owned(),
        )
        .await
        {
            Ok(Ok(permit)) => {
                let worker = tokio::task::spawn_blocking(move || {
                    let _permit = permit;
                    let connection = open_read_only(&database_path)?;
                    let scope = require_enabled_scope(&connection, &repo_id)?;
                    let outcome = dispatch_tool(
                        &connection,
                        &scope.repo_path,
                        &freshness.head,
                        freshness.tags_fingerprint.as_deref(),
                        &repo_id,
                        &name,
                        arguments,
                    )?;
                    build_envelope(&repo_id, outcome)
                });
                match tokio::time::timeout(query_timeout_remaining(started), worker).await {
                    Ok(Ok(result)) => result,
                    Ok(Err(error)) => Err(format!("MCP query worker failed: {error}")),
                    Err(_) => Err(format!(
                        "MCP query exceeded the {QUERY_TIMEOUT_MS} ms timeout"
                    )),
                }
            }
            Ok(Err(_)) => Err("MCP query scheduler is unavailable".to_string()),
            Err(_) => Err(format!(
                "MCP query exceeded the {QUERY_TIMEOUT_MS} ms timeout while waiting for capacity"
            )),
        };
        let duration_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        match result {
            Ok(value) => {
                let response_bytes = serde_json::to_vec(&value)
                    .map(|bytes| bytes.len())
                    .unwrap_or(0);
                enqueue_audit(
                    self.database_path.clone(),
                    self.repo_id.clone(),
                    session_id,
                    operation,
                    "ok".to_string(),
                    duration_ms,
                    result_count(&value),
                    response_bytes,
                );
                compact_success(value)
            }
            Err(message) => {
                let safe_message =
                    sanitize_error_message(&message, &self.repo_path.to_string_lossy());
                let code = classify_error(&safe_message);
                enqueue_audit(
                    self.database_path.clone(),
                    self.repo_id.clone(),
                    session_id,
                    operation,
                    code.to_string(),
                    duration_ms,
                    0,
                    0,
                );
                CallToolResult::structured_error(json!({
                    "schemaVersion": 1,
                    "error": {"code": code, "message": safe_message},
                }))
            }
        }
    }

    async fn read_scoped_resource(&self, raw_uri: String) -> Result<ReadResourceResult, ErrorData> {
        let uri = HistoryResourceUri::parse(&raw_uri, &self.repo_id)
            .map_err(|message| ErrorData::resource_not_found(message, None))?;
        let database_path = self.database_path.clone();
        let repo_id = self.repo_id.clone();
        let session_id = self.session_id.clone();
        let operation = format!("resource_read:{}", uri.kind);
        let freshness = self.current_freshness().map_err(to_internal_error)?;
        let started = Instant::now();
        let permit = tokio::time::timeout(
            query_timeout_remaining(started),
            query_semaphore().acquire_owned(),
        )
        .await
        .map_err(|_| ErrorData::internal_error("CodeVetter resource query timed out", None))?
        .map_err(|_| ErrorData::internal_error("Resource query scheduler is unavailable", None))?;
        let worker = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let connection = open_read_only(&database_path)?;
            let scope = require_enabled_scope(&connection, &repo_id)?;
            let outcome = dispatch_resource(
                &connection,
                &scope.repo_path,
                &freshness.head,
                freshness.tags_fingerprint.as_deref(),
                &uri,
            )?;
            build_envelope(&repo_id, outcome)
        });
        let result = tokio::time::timeout(query_timeout_remaining(started), worker)
            .await
            .map_err(|_| ErrorData::internal_error("CodeVetter resource query timed out", None))?
            .map_err(|error| {
                ErrorData::internal_error(format!("Resource worker failed: {error}"), None)
            })?
            .map_err(|message| ErrorData::resource_not_found(message, None));
        let duration_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        match result {
            Ok(value) => {
                let text = serde_json::to_string(&value)
                    .map_err(|error| ErrorData::internal_error(error.to_string(), None))?;
                enqueue_audit(
                    self.database_path.clone(),
                    self.repo_id.clone(),
                    session_id,
                    operation,
                    "ok".to_string(),
                    duration_ms,
                    result_count(&value),
                    text.len(),
                );
                Ok(ReadResourceResult::new(vec![ResourceContents::text(
                    text, raw_uri,
                )
                .with_mime_type(MIME_TYPE)]))
            }
            Err(error) => {
                enqueue_audit(
                    self.database_path.clone(),
                    self.repo_id.clone(),
                    session_id,
                    operation,
                    "not_found".to_string(),
                    duration_ms,
                    0,
                    0,
                );
                Err(error)
            }
        }
    }

    fn resources(&self) -> Result<Vec<Resource>, String> {
        let connection = open_read_only(&self.database_path)?;
        let scope = require_enabled_scope(&connection, &self.repo_id)?;
        let graph =
            StructuralGraphReadService::new_with_current_head(&connection, &scope.repo_path, None);
        let freshness = self.current_freshness()?;
        let history = HistoryReadService::new_with_current_head(
            &connection,
            self.repo_path.clone(),
            freshness.head,
        )?;
        let snapshots = graph.snapshots(MAX_PAGE_SIZE)?;
        let releases = history.list_releases(MAX_PAGE_SIZE)?.revisions;
        let history_status =
            history.status_with_tag_fingerprint(freshness.tags_fingerprint.as_deref())?;
        let graph_modified = snapshots
            .first()
            .map(|snapshot| snapshot.created_at.as_str());
        let history_modified = history_status.updated_at.as_deref();
        let overview_modified = latest_resource_time([graph_modified, history_modified]);
        let mut resources = vec![
            resource(
                &self.repo_id,
                "repository",
                "overview",
                "Repository history overview",
                overview_modified.as_deref(),
            )?,
            resource(
                &self.repo_id,
                "graph",
                "overview",
                "Current structural graph overview",
                graph_modified,
            )?,
        ];
        for snapshot in snapshots {
            resources.push(resource(
                &self.repo_id,
                "snapshot",
                &snapshot.id,
                &format!("Structural snapshot {}", snapshot.id),
                Some(&snapshot.created_at),
            )?);
        }
        for release in releases {
            let id = release.tags.first().unwrap_or(&release.sha);
            resources.push(resource(
                &self.repo_id,
                "release",
                id,
                &format!("Release {}", id),
                Some(&release.committed_at),
            )?);
        }
        Ok(resources)
    }
}

impl ServerHandler for CodeVetterMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
        )
        .with_server_info(Implementation::new("codevetter-history", env!("CARGO_PKG_VERSION")))
        .with_protocol_version(ProtocolVersion::V_2025_11_25)
        .with_instructions(
            "Local, repository-scoped, read-only CodeVetter structural graph and release history. Start compact and hydrate cited evidence only when needed.",
        )
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        require_scope(&self.database_path, &self.repo_id).map_err(to_internal_error)?;
        Ok(ListToolsResult::with_all_items(self.tools.as_ref().clone()))
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.tools.iter().find(|tool| tool.name == name).cloned()
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !self.tools.iter().any(|tool| tool.name == request.name) {
            return Err(ErrorData::invalid_params(
                "Unknown CodeVetter history tool",
                None,
            ));
        }
        Ok(self
            .execute_tool(
                request.name.to_string(),
                request.arguments.unwrap_or_default(),
            )
            .await)
    }

    async fn list_resources(
        &self,
        request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        let resources = self.resources().map_err(to_internal_error)?;
        let offset = request
            .and_then(|request| request.cursor)
            .map(|cursor| {
                McpCursor::decode(&cursor, &self.repo_id, "resources/list", "v1")
                    .map(|cursor| cursor.offset())
            })
            .transpose()
            .map_err(|message| ErrorData::invalid_params(message, None))?
            .unwrap_or_default();
        if offset > resources.len() {
            return Err(ErrorData::invalid_params(
                "Invalid resource-list cursor",
                None,
            ));
        }
        let page = resources
            .iter()
            .skip(offset)
            .take(DEFAULT_PAGE_SIZE)
            .cloned()
            .collect::<Vec<_>>();
        let next_offset = offset + page.len();
        let next_cursor = (next_offset < resources.len())
            .then(|| McpCursor::new(&self.repo_id, "resources/list", next_offset, "v1").encode())
            .transpose()
            .map_err(to_internal_error)?;
        Ok(ListResourcesResult {
            meta: None,
            next_cursor,
            resources: page,
        })
    }

    async fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, ErrorData> {
        require_scope(&self.database_path, &self.repo_id).map_err(to_internal_error)?;
        let templates = [
            "snapshot",
            "community",
            "release",
            "commit",
            "episode",
            "entity-lineage",
            "causal-thread",
            "annotation",
            "evidence",
        ]
        .into_iter()
        .map(|kind| {
            ResourceTemplate::new(
                format!("codevetter-history://{}/{kind}/{{id}}", self.repo_id),
                format!("codevetter-{kind}"),
            )
            .with_description(format!(
                "Read a bounded {kind} resource. The id variable is a base64url-encoded stable identifier."
            ))
            .with_mime_type(MIME_TYPE)
        })
        .collect();
        Ok(ListResourceTemplatesResult::with_all_items(templates))
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResult, ErrorData> {
        self.read_scoped_resource(request.uri).await
    }
}

fn dispatch_tool(
    connection: &Connection,
    repo_path: &str,
    current_head: &str,
    current_tags_fingerprint: Option<&str>,
    repo_id: &str,
    name: &str,
    arguments: Map<String, Value>,
) -> Result<CanonicalResponse, String> {
    let graph = StructuralGraphReadService::new_with_current_head(
        connection,
        repo_path,
        Some(current_head.to_string()),
    );
    let history = HistoryReadService::new_with_current_head(
        connection,
        PathBuf::from(repo_path),
        current_head.to_string(),
    )?;
    let limit = bounded_limit(arguments.get("limit"));
    let filter = optional_field::<GraphQueryFilter>(&arguments, "filter")?.unwrap_or_default();
    let data = match name {
        "graph_query" => {
            let query = optional_string(&arguments, "query")?;
            let fingerprint = serde_json::to_string(&(query.map(str::to_ascii_lowercase), &filter))
                .map_err(|error| error.to_string())?;
            let offset =
                decode_offset_cursor(arguments.get("cursor"), repo_id, name, &fingerprint)?;
            let raw_cursor = (offset > 0).then(|| offset.to_string());
            if let Some(query) = query {
                let mut result = graph.search_page(query, &filter, limit, raw_cursor.as_deref())?;
                result.next_cursor = result
                    .next_cursor
                    .as_deref()
                    .map(|cursor| {
                        cursor
                            .parse::<usize>()
                            .map_err(|_| "Invalid canonical graph cursor".to_string())
                            .and_then(|offset| {
                                McpCursor::new(repo_id, name, offset, &fingerprint).encode()
                            })
                    })
                    .transpose()?;
                serde_json::to_value(result)
            } else {
                let mut result =
                    graph.overview_page(limit.min(MAX_GRAPH_NODES), raw_cursor.as_deref())?;
                result.next_cursor = result
                    .next_cursor
                    .as_deref()
                    .map(|cursor| {
                        cursor
                            .parse::<usize>()
                            .map_err(|_| "Invalid canonical graph cursor".to_string())
                            .and_then(|offset| {
                                McpCursor::new(repo_id, name, offset, &fingerprint).encode()
                            })
                    })
                    .transpose()?;
                serde_json::to_value(result)
            }
        }
        "graph_get_node" => {
            serde_json::to_value(graph.explain(required_string(&arguments, "node")?)?)
        }
        "graph_get_neighbors" => {
            let node = required_string(&arguments, "node")?;
            let direction: GraphDirection =
                optional_field(&arguments, "direction")?.unwrap_or_default();
            let fingerprint = serde_json::to_string(&(node, &direction, &filter))
                .map_err(|error| error.to_string())?;
            let offset =
                decode_offset_cursor(arguments.get("cursor"), repo_id, name, &fingerprint)?;
            let raw_cursor = (offset > 0).then(|| offset.to_string());
            let mut projection = graph.neighbors(
                node,
                direction,
                &filter,
                limit.min(MAX_GRAPH_NODES),
                raw_cursor.as_deref(),
            )?;
            projection.next_cursor = projection
                .next_cursor
                .as_deref()
                .map(|cursor| {
                    cursor
                        .parse::<usize>()
                        .map_err(|_| "Invalid canonical graph cursor".to_string())
                        .and_then(|offset| {
                            McpCursor::new(repo_id, name, offset, &fingerprint).encode()
                        })
                })
                .transpose()?;
            serde_json::to_value(projection)
        }
        "graph_path" => serde_json::to_value(graph.path(
            required_string(&arguments, "from")?,
            required_string(&arguments, "to")?,
            &filter,
        )?),
        "graph_impact" => serde_json::to_value(graph.impact(
            required_string(&arguments, "node")?,
            optional_field(&arguments, "direction")?.unwrap_or(GraphDirection::Outgoing),
            bounded_depth(arguments.get("depth")),
            &filter,
            limit.min(MAX_GRAPH_NODES),
        )?),
        "history_list_releases" => {
            let history_filter = optional_field::<McpHistoryFilter>(&arguments, "history_filter")?
                .unwrap_or_default();
            history_filter.validate()?;
            let fingerprint = serde_json::to_string(&("releases:v2", &history_filter))
                .map_err(|error| error.to_string())?;
            let offset =
                decode_offset_cursor(arguments.get("cursor"), repo_id, name, &fingerprint)?;
            let mut result = history.list_releases(500)?;
            let source_truncated = result.truncated;
            result.revisions.retain(|revision| {
                history_filter.includes_kind(&HistorySearchKind::Release)
                    && history_filter.includes_time(Some(&revision.committed_at))
            });
            let available = result.revisions.len();
            result.revisions = result
                .revisions
                .into_iter()
                .skip(offset)
                .take(limit)
                .collect();
            let next_cursor = (offset.saturating_add(result.revisions.len()) < available)
                .then(|| {
                    McpCursor::new(
                        repo_id,
                        name,
                        offset.saturating_add(result.revisions.len()),
                        &fingerprint,
                    )
                    .encode()
                })
                .transpose()?;
            result.truncated = next_cursor.is_some();
            Ok(json!({
                "result": result,
                "nextCursor": next_cursor,
                "coverage": {"sourceTruncatedAt500": source_truncated}
            }))
        }
        "history_search" => {
            let query = required_string(&arguments, "query")?;
            let history_filter = optional_field::<McpHistoryFilter>(&arguments, "history_filter")?
                .unwrap_or_default();
            history_filter.validate()?;
            let fingerprint = serde_json::to_string(&(query.to_ascii_lowercase(), &history_filter))
                .map_err(|error| error.to_string())?;
            let offset =
                decode_offset_cursor(arguments.get("cursor"), repo_id, name, &fingerprint)?;
            let mut result = history.search(query, 500, 0)?;
            let source_truncated = result.truncated;
            result.items.retain(|item| {
                history_filter.includes_kind(&item.kind)
                    && history_filter.includes_time(item.recorded_at.as_deref())
            });
            let available = result.items.len();
            result.items = result.items.into_iter().skip(offset).take(limit).collect();
            let next_offset = offset.saturating_add(result.items.len());
            let next_cursor = (next_offset < available)
                .then(|| McpCursor::new(repo_id, name, next_offset, &fingerprint).encode())
                .transpose()?;
            result.next_offset = None;
            result.truncated = next_cursor.is_some();
            Ok(json!({
                "result": result,
                "nextCursor": next_cursor,
                "coverage": {"sourceTruncatedAt500": source_truncated}
            }))
        }
        "history_get_state" => serde_json::to_value(history.state(
            required_field(&arguments, "reference")?,
            limit.min(MAX_GRAPH_NODES),
        )?),
        "history_lineage" => {
            let entity = required_string(&arguments, "entity")?;
            let reference: HistoryTemporalReference = required_field(&arguments, "reference")?;
            let fingerprint =
                serde_json::to_string(&(entity, &reference)).map_err(|error| error.to_string())?;
            let offset =
                decode_offset_cursor(arguments.get("cursor"), repo_id, name, &fingerprint)?;
            let mut result = history.lineage(entity, reference, MAX_LINEAGE_SCAN)?;
            let (page_start, page_len, next_offset) = lineage_page_bounds(
                result.lineage.len(),
                result.occurrences.len(),
                offset,
                limit,
            );
            result.lineage = result
                .lineage
                .into_iter()
                .skip(page_start)
                .take(page_len)
                .collect();
            result.occurrences = result
                .occurrences
                .into_iter()
                .skip(page_start)
                .take(page_len)
                .collect();
            let next_cursor = next_offset
                .map(|next| McpCursor::new(repo_id, name, next, &fingerprint).encode())
                .transpose()?;
            result.truncated = result.truncated || next_cursor.is_some();
            result.next_cursor = None;
            Ok(json!({"result": result, "nextCursor": next_cursor}))
        }
        "history_explain" => serde_json::to_value(history.explain(
            required_string(&arguments, "entity")?,
            required_field(&arguments, "reference")?,
        )?),
        "history_trace" => {
            let selector: HistoryCausalSelector = required_field(&arguments, "selector")?;
            let fingerprint =
                serde_json::to_string(&selector).map_err(|error| error.to_string())?;
            let cursor = decode_position_cursor::<(String, String)>(
                arguments.get("cursor"),
                repo_id,
                name,
                &fingerprint,
            )?;
            let mut trace = history.trace(selector, limit, cursor)?;
            trace.next_cursor = trace
                .next_cursor
                .as_deref()
                .map(serde_json::from_str::<Value>)
                .transpose()
                .map_err(|_| "Invalid persisted causal cursor".to_string())?
                .map(|position| {
                    McpCursor::new(repo_id, name, 0, &fingerprint)
                        .with_position(position)
                        .encode()
                })
                .transpose()?;
            serde_json::to_value(trace)
        }
        "history_compare" => serde_json::to_value(history.compare(
            required_field(&arguments, "before")?,
            required_field(&arguments, "after")?,
        )?),
        "history_get_evidence" => {
            let ids: Vec<String> = required_field(&arguments, "ids")?;
            if ids.is_empty()
                || ids.len() > MAX_EVIDENCE_IDS
                || ids
                    .iter()
                    .any(|id| id.is_empty() || id.len() > 4_096 || id.chars().any(char::is_control))
            {
                return Err(format!(
                    "Evidence ids must contain 1 to {MAX_EVIDENCE_IDS} bounded identifiers"
                ));
            }
            serde_json::to_value(history.evidence(&ids)?)
        }
        _ => return Err("Unknown CodeVetter history tool".to_string()),
    }
    .map_err(|error| format!("Serialize canonical query result: {error}"))?;
    let history_status = history.status_with_tag_fingerprint(current_tags_fingerprint)?;
    let graph_status = graph.status_with_current_head(Some(history.current_head().to_string()))?;
    Ok(CanonicalResponse {
        data: json!({"operation": name, "data": data}),
        graph_status,
        history_status,
    })
}

fn dispatch_resource(
    connection: &Connection,
    repo_path: &str,
    current_head: &str,
    current_tags_fingerprint: Option<&str>,
    uri: &HistoryResourceUri,
) -> Result<CanonicalResponse, String> {
    let graph = StructuralGraphReadService::new_with_current_head(
        connection,
        repo_path,
        Some(current_head.to_string()),
    );
    let history = HistoryReadService::new_with_current_head(
        connection,
        PathBuf::from(repo_path),
        current_head.to_string(),
    )?;
    let data = match uri.kind.as_str() {
        "repository" => json!({
            "graph": graph.status()?,
            "history": history.status()?,
        }),
        "graph" => to_json(graph.overview(DEFAULT_PAGE_SIZE)?)?,
        "snapshot" => {
            let snapshot = graph.snapshot_by_id(&uri.id)?;
            json!({
                "metadata": crate::commands::structural_graph::query::metadata(&snapshot),
                "analysis": crate::commands::structural_graph::query::analysis(&snapshot),
                "projection": crate::commands::structural_graph::query::overview(
                    &snapshot,
                    Some(DEFAULT_PAGE_SIZE),
                )
            })
        }
        "commit" => to_json(history.state(
            HistoryTemporalReference::Revision {
                revision: uri.id.clone(),
            },
            DEFAULT_PAGE_SIZE,
        )?)?,
        "community" => to_json(graph.community(&uri.id, MAX_GRAPH_NODES)?)?,
        "release" => to_json(history.state(
            HistoryTemporalReference::Release {
                tag: uri.id.clone(),
            },
            DEFAULT_PAGE_SIZE,
        )?)?,
        "episode" => to_json(history.trace(
            HistoryCausalSelector::EpisodeKey {
                key: uri.id.clone(),
            },
            DEFAULT_PAGE_SIZE,
            None,
        )?)?,
        "entity-lineage" => {
            to_json(history.lineage(&uri.id, head_reference(&history)?, DEFAULT_PAGE_SIZE)?)?
        }
        "causal-thread" => to_json(history.trace(
            HistoryCausalSelector::Event {
                event_id: uri.id.clone(),
            },
            DEFAULT_PAGE_SIZE,
            None,
        )?)?,
        "annotation" => {
            let page = history.annotations(None, None, MAX_PAGE_SIZE, None)?;
            let annotation = page
                .annotations
                .into_iter()
                .find(|annotation| annotation.id == uri.id)
                .ok_or_else(|| "History annotation is unavailable".to_string())?;
            to_json(annotation)?
        }
        "evidence" => {
            let evidence = history.evidence(std::slice::from_ref(&uri.id))?;
            if evidence.is_empty() {
                return Err("History evidence is unavailable".to_string());
            }
            to_json(evidence)?
        }
        _ => return Err("Unsupported history resource".to_string()),
    };
    let history_status = history.status_with_tag_fingerprint(current_tags_fingerprint)?;
    let graph_status = graph.status_with_current_head(Some(history.current_head().to_string()))?;
    Ok(CanonicalResponse {
        data: json!({"resource": {"kind": uri.kind, "id": uri.id}, "data": data}),
        graph_status,
        history_status,
    })
}

fn build_envelope(repo_id: &str, outcome: CanonicalResponse) -> Result<Value, String> {
    let repository_uri = HistoryResourceUri::new(repo_id, "repository", "overview")?.to_string();
    let graph_uri = HistoryResourceUri::new(repo_id, "graph", "overview")?.to_string();
    sanitize_response(json!({
        "schemaVersion": 1,
        "repository": {"id": repo_id},
        "freshness": {
            "structural": outcome.graph_status,
            "history": outcome.history_status,
        },
        "limits": {
            "defaultPageSize": DEFAULT_PAGE_SIZE,
            "maxPageSize": MAX_PAGE_SIZE,
            "maxGraphNodes": MAX_GRAPH_NODES,
            "maxHops": MAX_HOPS,
            "maxEvidenceIds": MAX_EVIDENCE_IDS,
        },
        "links": [
            {"kind": "repository", "uri": repository_uri},
            {"kind": "graph", "uri": graph_uri}
        ],
        "data": outcome.data,
    }))
}

struct CanonicalResponse {
    data: Value,
    graph_status: crate::commands::structural_graph::service::StructuralGraphReadStatus,
    history_status: crate::commands::history_graph::HistoryGraphStatus,
}

fn to_json<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value)
        .map_err(|error| format!("Serialize canonical query result: {error}"))
}

fn head_reference(history: &HistoryReadService<'_>) -> Result<HistoryTemporalReference, String> {
    Ok(HistoryTemporalReference::Revision {
        revision: history.status()?.current_head,
    })
}

fn tool_definitions() -> Vec<Tool> {
    let specs = [
        (
            "graph_query",
            "Search the canonical structural graph or return a compact overview",
            &[] as &[&str],
        ),
        (
            "graph_get_node",
            "Explain one stable graph node with source-backed relationships",
            &["node"],
        ),
        (
            "graph_get_neighbors",
            "Return bounded filtered neighbors for one graph node",
            &["node"],
        ),
        (
            "graph_path",
            "Find a trust-weighted structural path between two graph nodes",
            &["from", "to"],
        ),
        (
            "graph_impact",
            "Return bounded upstream or downstream structural impact leads",
            &["node"],
        ),
        (
            "history_list_releases",
            "List compact indexed release summaries",
            &[],
        ),
        (
            "history_search",
            "Search releases, commits, entities, events, and annotations",
            &["query"],
        ),
        (
            "history_get_state",
            "Reconstruct a persisted as-of release, commit, or date state",
            &["reference"],
        ),
        (
            "history_lineage",
            "Follow one entity across moves, renames, splits, merges, and removals",
            &["entity", "reference"],
        ),
        (
            "history_explain",
            "Explain what, why, when, how, verification, and outcome with cited gaps",
            &["entity", "reference"],
        ),
        (
            "history_trace",
            "Trace bounded qualified evidence from intent through verification and outcome",
            &["selector"],
        ),
        (
            "history_compare",
            "Compare two persisted historical states without implying unsupported causation",
            &["before", "after"],
        ),
        (
            "history_get_evidence",
            "Hydrate only selected stable evidence identifiers",
            &["ids"],
        ),
    ];
    specs
        .into_iter()
        .map(|(name, description, required)| {
            Tool::new(name, description, input_schema(name, required))
                .with_raw_output_schema(output_schema())
                .with_annotations(
                    ToolAnnotations::new()
                        .read_only(true)
                        .destructive(false)
                        .idempotent(true)
                        .open_world(false),
                )
        })
        .collect()
}

fn input_schema(name: &str, required: &[&str]) -> Arc<JsonObject> {
    let mut properties = Map::new();
    for field in ["query", "node", "from", "to", "entity", "cursor"] {
        properties.insert(
            field.to_string(),
            json!({"type": "string", "maxLength": 4096}),
        );
    }
    properties.insert(
        "limit".to_string(),
        json!({"type": "integer", "minimum": 1, "maximum": MAX_PAGE_SIZE}),
    );
    properties.insert(
        "depth".to_string(),
        json!({"type": "integer", "minimum": 1, "maximum": MAX_HOPS}),
    );
    properties.insert(
        "direction".to_string(),
        json!({"type": "string", "enum": ["incoming", "outgoing", "both"]}),
    );
    properties.insert(
        "filter".to_string(),
        json!({"type": "object", "additionalProperties": false, "properties": {
            "node_kinds": {"type": "array", "items": {"type": "string"}, "maxItems": 32},
            "edge_kinds": {"type": "array", "items": {"type": "string"}, "maxItems": 32},
            "trust": {"type": "array", "items": {"type": "string"}, "maxItems": 4}
        }}),
    );
    properties.insert(
        "history_filter".to_string(),
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "kinds": {
                    "type": "array",
                    "maxItems": 5,
                    "uniqueItems": true,
                    "items": {"type": "string", "enum": ["release", "commit", "entity", "event", "annotation"]}
                },
                "from": {"type": "string", "format": "date-time"},
                "to": {"type": "string", "format": "date-time"}
            }
        }),
    );
    for field in ["reference", "before", "after"] {
        properties.insert(field.to_string(), temporal_schema());
    }
    properties.insert("selector".to_string(), selector_schema());
    properties.insert("ids".to_string(), json!({"type": "array", "items": {"type": "string", "maxLength": 4096}, "minItems": 1, "maxItems": MAX_EVIDENCE_IDS}));
    let applicable = match name {
        "graph_query" => &["query", "filter", "limit", "cursor"][..],
        "graph_get_node" => &["node"][..],
        "graph_get_neighbors" => &["node", "direction", "filter", "limit", "cursor"][..],
        "graph_path" => &["from", "to", "filter"][..],
        "graph_impact" => &["node", "direction", "depth", "filter", "limit"][..],
        "history_list_releases" => &["limit", "cursor", "history_filter"][..],
        "history_search" => &["query", "limit", "cursor", "history_filter"][..],
        "history_get_state" => &["reference"][..],
        "history_lineage" => &["entity", "reference", "limit", "cursor"][..],
        "history_explain" => &["entity", "reference"][..],
        "history_trace" => &["selector", "limit", "cursor"][..],
        "history_compare" => &["before", "after"][..],
        "history_get_evidence" => &["ids"][..],
        _ => &[][..],
    };
    properties.retain(|key, _| applicable.contains(&key.as_str()));
    Arc::new(
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": properties,
            "required": required,
        })
        .as_object()
        .expect("tool schema object")
        .clone(),
    )
}

fn temporal_schema() -> Value {
    json!({
        "oneOf": [
            {"type": "object", "additionalProperties": false, "properties": {"kind": {"const": "revision"}, "revision": {"type": "string"}}, "required": ["kind", "revision"]},
            {"type": "object", "additionalProperties": false, "properties": {"kind": {"const": "release"}, "tag": {"type": "string"}}, "required": ["kind", "tag"]},
            {"type": "object", "additionalProperties": false, "properties": {"kind": {"const": "date"}, "at": {"type": "string"}}, "required": ["kind", "at"]}
        ]
    })
}

fn selector_schema() -> Value {
    json!({"type": "object", "description": "Tagged HistoryCausalSelector: event, entity, revision, release, or episode_key"})
}

fn output_schema() -> Arc<JsonObject> {
    Arc::new(
        json!({
            "type": "object",
            "additionalProperties": true,
            "required": ["schemaVersion"],
            "properties": {"schemaVersion": {"const": 1}}
        })
        .as_object()
        .expect("output schema object")
        .clone(),
    )
}

fn resource(
    repo_id: &str,
    kind: &str,
    id: &str,
    name: &str,
    last_modified: Option<&str>,
) -> Result<Resource, String> {
    let uri = HistoryResourceUri::new(repo_id, kind, id)?.to_string();
    let mut resource = Resource::new(uri, name)
        .with_description("Bounded, redacted, local CodeVetter history resource")
        .with_mime_type(MIME_TYPE);
    if let Some(timestamp) = last_modified
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&chrono::Utc))
    {
        resource = resource.with_annotations(Annotations::for_resource(0.5, timestamp));
    }
    Ok(resource)
}

fn latest_resource_time<'a>(values: impl IntoIterator<Item = Option<&'a str>>) -> Option<String> {
    values
        .into_iter()
        .flatten()
        .filter_map(|value| {
            chrono::DateTime::parse_from_rfc3339(value)
                .ok()
                .map(|parsed| (parsed, value))
        })
        .max_by_key(|(parsed, _)| *parsed)
        .map(|(_, value)| value.to_string())
}

fn query_semaphore() -> Arc<Semaphore> {
    Arc::clone(QUERY_SEMAPHORE.get_or_init(|| Arc::new(Semaphore::new(MAX_CONCURRENT_QUERIES))))
}

fn query_timeout_remaining(started: Instant) -> std::time::Duration {
    std::time::Duration::from_millis(QUERY_TIMEOUT_MS).saturating_sub(started.elapsed())
}

fn open_read_only(path: &PathBuf) -> Result<Connection, String> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("Open CodeVetter history database read-only: {error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_millis(500))
        .map_err(|error| format!("Configure history query timeout: {error}"))?;
    connection
        .execute_batch(
            "PRAGMA query_only = ON;
             PRAGMA mmap_size = 268435456;
             PRAGMA temp_store = MEMORY;
             PRAGMA cache_size = -8192;",
        )
        .map_err(|error| format!("Configure read-only history connection: {error}"))?;
    Ok(connection)
}

fn git_head_for_repo(repo_path: &PathBuf) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(["rev-parse", "HEAD"])
        .output()
        .map_err(|error| format!("Read repository HEAD: {error}"))?;
    if !output.status.success() {
        return Err("Repository HEAD is unavailable".to_string());
    }
    let head = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if head.is_empty() {
        return Err("Repository HEAD is unavailable".to_string());
    }
    Ok(head)
}

fn require_scope(path: &PathBuf, repo_id: &str) -> Result<(), String> {
    let connection = open_read_only(path)?;
    require_enabled_scope(&connection, repo_id).map(|_| ())
}

fn record_audit(
    path: &PathBuf,
    repo_id: &str,
    session_id: &str,
    operation: &str,
    status: &str,
    duration_ms: u64,
    result_count: usize,
    response_bytes: usize,
) -> Result<(), String> {
    let connection =
        Connection::open(path).map_err(|error| format!("Open MCP access audit: {error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(2))
        .map_err(|error| format!("Configure MCP access audit: {error}"))?;
    connection
        .execute_batch(
            "PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;",
        )
        .map_err(|error| format!("Configure MCP access audit: {error}"))?;
    record_mcp_audit(
        &connection,
        repo_id,
        session_id,
        operation,
        status,
        duration_ms,
        result_count,
        response_bytes,
    )
}

fn enqueue_audit(
    path: PathBuf,
    repo_id: String,
    session_id: String,
    operation: String,
    status: String,
    duration_ms: u64,
    result_count: usize,
    response_bytes: usize,
) {
    tokio::task::spawn_blocking(move || {
        let _ = record_audit(
            &path,
            &repo_id,
            &session_id,
            &operation,
            &status,
            duration_ms,
            result_count,
            response_bytes,
        );
    });
}

fn compact_success(value: Value) -> CallToolResult {
    let summary = compact_summary(&value);
    let mut result = CallToolResult::structured(value);
    result.content = vec![ContentBlock::text(summary)];
    result
}

fn compact_summary(value: &Value) -> String {
    let operation = value
        .pointer("/data/operation")
        .and_then(Value::as_str)
        .unwrap_or("CodeVetter query");
    let count = result_count(value);
    let stale = value
        .pointer("/freshness/history/stale")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    format!("{operation}: {count} bounded result item(s); history stale={stale}. Use structuredContent for stable IDs, trust, gaps, citations, and nextCursor.")
}

fn result_count(value: &Value) -> usize {
    fn count(value: &Value) -> Option<usize> {
        match value {
            Value::Array(items) => Some(items.len()),
            Value::Object(map) => [
                "items",
                "hits",
                "nodes",
                "revisions",
                "episodes",
                "annotations",
            ]
            .into_iter()
            .find_map(|key| map.get(key).and_then(Value::as_array).map(Vec::len))
            .or_else(|| map.values().find_map(count)),
            _ => None,
        }
    }
    count(value).unwrap_or(1)
}

fn classify_error(message: &str) -> &'static str {
    let lower = message.to_ascii_lowercase();
    if lower.contains("disabled") || lower.contains("scope") {
        "permission_denied"
    } else if lower.contains("stale") {
        "stale_index"
    } else if lower.contains("unavailable")
        || lower.contains("not built")
        || lower.contains("outside indexed")
    {
        "unavailable"
    } else if lower.contains("not found") {
        "not_found"
    } else if lower.contains("ambiguous") || lower.contains("multiple") {
        "ambiguous"
    } else if lower.contains("no directed graph path") || lower.contains("no bounded path") {
        "bounded_no_path"
    } else if lower.contains("cancel") {
        "cancelled"
    } else if lower.contains("timeout") || lower.contains("exceeded") {
        "timeout"
    } else if lower.contains("invalid") || lower.contains("required") || lower.contains("must") {
        "invalid_input"
    } else if lower.contains("worker failed") || lower.contains("internal") {
        "internal"
    } else {
        "query_failed"
    }
}

fn to_internal_error(message: String) -> ErrorData {
    ErrorData::internal_error(message, None)
}

fn bounded_limit(value: Option<&Value>) -> usize {
    value
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_PAGE_SIZE as u64)
        .clamp(1, MAX_PAGE_SIZE as u64) as usize
}

fn bounded_depth(value: Option<&Value>) -> usize {
    value
        .and_then(Value::as_u64)
        .unwrap_or(3)
        .clamp(1, MAX_HOPS as u64) as usize
}

fn required_string<'a>(arguments: &'a Map<String, Value>, field: &str) -> Result<&'a str, String> {
    optional_string(arguments, field)?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("A non-empty '{field}' string is required"))
}

fn optional_string<'a>(
    arguments: &'a Map<String, Value>,
    field: &str,
) -> Result<Option<&'a str>, String> {
    arguments
        .get(field)
        .map(|value| {
            value
                .as_str()
                .filter(|text| text.len() <= 4_096)
                .ok_or_else(|| format!("'{field}' must be a bounded string"))
        })
        .transpose()
}

fn required_field<T: DeserializeOwned>(
    arguments: &Map<String, Value>,
    field: &str,
) -> Result<T, String> {
    arguments
        .get(field)
        .cloned()
        .ok_or_else(|| format!("'{field}' is required"))
        .and_then(|value| {
            serde_json::from_value(value).map_err(|_| format!("'{field}' has an invalid shape"))
        })
}

fn optional_field<T: DeserializeOwned>(
    arguments: &Map<String, Value>,
    field: &str,
) -> Result<Option<T>, String> {
    arguments
        .get(field)
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| format!("'{field}' has an invalid shape"))
}

fn decode_offset_cursor(
    value: Option<&Value>,
    repo_id: &str,
    operation: &str,
    fingerprint: &str,
) -> Result<usize, String> {
    value
        .and_then(Value::as_str)
        .map(|cursor| {
            McpCursor::decode(cursor, repo_id, operation, fingerprint).map(|cursor| cursor.offset())
        })
        .transpose()
        .map(Option::unwrap_or_default)
}

fn lineage_page_bounds(
    lineage_len: usize,
    occurrence_len: usize,
    offset: usize,
    limit: usize,
) -> (usize, usize, Option<usize>) {
    let available = lineage_len.max(occurrence_len);
    let start = offset.min(available);
    let page_len = limit.min(available.saturating_sub(start));
    let end = start.saturating_add(page_len);
    (start, page_len, (end < available).then_some(end))
}

fn decode_position_cursor<T: DeserializeOwned>(
    value: Option<&Value>,
    repo_id: &str,
    operation: &str,
    fingerprint: &str,
) -> Result<Option<T>, String> {
    value
        .and_then(Value::as_str)
        .map(|cursor| McpCursor::decode(cursor, repo_id, operation, fingerprint)?.position())
        .transpose()
        .map(Option::flatten)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::structural_graph::{
        storage::persist_snapshot,
        types::{
            StructuralGraphCoverage, StructuralGraphEngineInfo, StructuralGraphSnapshot,
            STRUCTURAL_GRAPH_SCHEMA_VERSION,
        },
    };
    use rmcp::{ClientHandler, ServiceExt};
    use rusqlite::params;
    use std::{fs, process::Command};

    #[test]
    fn every_tool_is_explicitly_read_only_and_schema_bounded() {
        let tools = tool_definitions();
        assert_eq!(
            tools
                .iter()
                .map(|tool| tool.name.as_ref())
                .collect::<Vec<_>>(),
            vec![
                "graph_query",
                "graph_get_node",
                "graph_get_neighbors",
                "graph_path",
                "graph_impact",
                "history_list_releases",
                "history_search",
                "history_get_state",
                "history_lineage",
                "history_explain",
                "history_trace",
                "history_compare",
                "history_get_evidence",
            ]
        );
        for tool in tools {
            let annotations = tool.annotations.expect("annotations");
            assert_eq!(annotations.read_only_hint, Some(true));
            assert_eq!(annotations.destructive_hint, Some(false));
            assert_eq!(annotations.open_world_hint, Some(false));
            assert!(tool.output_schema.is_some());
            assert_eq!(
                tool.input_schema.get("additionalProperties"),
                Some(&Value::Bool(false))
            );
        }
    }

    #[test]
    fn lineage_cursor_pages_cover_each_result_once() {
        let mut offset = 0;
        let mut covered = Vec::new();
        loop {
            let (start, length, next) = lineage_page_bounds(5, 7, offset, 2);
            covered.extend(start..start + length);
            let Some(next) = next else {
                break;
            };
            let encoded = McpCursor::new("repo", "history_lineage", next, "entity:one")
                .encode()
                .expect("opaque cursor");
            offset = McpCursor::decode(&encoded, "repo", "history_lineage", "entity:one")
                .expect("decode cursor")
                .offset();
        }
        assert_eq!(covered, (0..7).collect::<Vec<_>>());
        assert_eq!(lineage_page_bounds(5, 7, 99, 2), (7, 0, None));
    }

    #[derive(Debug, Clone, Default)]
    struct TestClient;

    impl ClientHandler for TestClient {}

    #[tokio::test]
    async fn protocol_lifecycle_is_scoped_structured_and_live_revocable() {
        let fixture = tempfile::tempdir().expect("fixture");
        let repo = fixture.path().join("repo");
        fs::create_dir(&repo).expect("repo");
        git(&repo, &["init"]);
        git(&repo, &["config", "user.email", "fixture@codevetter.local"]);
        git(&repo, &["config", "user.name", "CodeVetter Fixture"]);
        fs::write(repo.join("main.rs"), "fn main() {}\n").expect("source");
        git(&repo, &["add", "main.rs"]);
        git(&repo, &["commit", "-m", "fixture release"]);
        git(&repo, &["tag", "v1.0.0"]);
        let head = git_output(&repo, &["rev-parse", "HEAD"]);
        let repo_path = repo
            .canonicalize()
            .expect("canonical repo")
            .to_string_lossy()
            .to_string();
        let database_path = fixture.path().join("codevetter.db");
        let connection = Connection::open(&database_path).expect("database");
        crate::db::schema::run_migrations(&connection).expect("schema");
        connection
            .execute(
                "INSERT INTO history_graph_repositories (
                    repo_path, repository_fingerprint, indexed_head, status,
                    coverage_json, created_at, updated_at
                 ) VALUES (?1, 'fixture', ?2, 'ready', '{\"coverage_complete\":true}', ?3, ?3)",
                params![repo_path, head, "2026-01-01T00:00:00Z"],
            )
            .expect("history repository");
        connection
            .execute(
                "INSERT INTO history_graph_revisions (
                    repo_path, sha, ordinal, committed_at, author_name, subject,
                    parents_json, tags_json, is_release, is_head, coverage_json
                 ) VALUES (?1, ?2, 0, ?3, 'Fixture', 'fixture release', '[]',
                           '[\"v1.0.0\"]', 1, 1, '{}')",
                params![repo_path, head, "2026-01-01T00:00:00Z"],
            )
            .expect("history revision");
        connection
            .execute(
                "INSERT INTO history_graph_revisions (
                    repo_path, sha, ordinal, committed_at, author_name, subject,
                    parents_json, tags_json, is_release, is_head, coverage_json
                 ) VALUES (?1, '0000000000000000000000000000000000000001', -1, ?2,
                           'Fixture', 'older fixture release', '[]', '[\"v0.9.0\"]', 1, 0, '{}')",
                params![repo_path, "2025-01-01T00:00:00Z"],
            )
            .expect("older history revision");
        for ordinal in 2..=30 {
            connection
                .execute(
                    "INSERT INTO history_graph_revisions (
                        repo_path, sha, ordinal, committed_at, author_name, subject,
                        parents_json, tags_json, is_release, is_head, coverage_json
                     ) VALUES (?1, ?2, ?3, ?4, 'Fixture', ?5, '[]', ?6, 1, 0, '{}')",
                    params![
                        repo_path,
                        format!("fixture-release-{ordinal:038}"),
                        -ordinal,
                        format!("2024-01-{ordinal:02}T00:00:00Z"),
                        format!("fixture release {ordinal}"),
                        json!([format!("v0.{ordinal}.0")]).to_string(),
                    ],
                )
                .expect("paginated history revision");
        }
        let repo_id = "repo_0123456789abcdef";
        connection
            .execute(
                "INSERT INTO mcp_repository_scopes (
                    repo_path, repo_id, enabled, created_at, updated_at
                 ) VALUES (?1, ?2, 1, ?3, ?3)",
                params![repo_path, repo_id, "2026-01-01T00:00:00Z"],
            )
            .expect("scope");
        persist_snapshot(
            &connection,
            &StructuralGraphSnapshot {
                id: "snapshot-fixture".to_string(),
                schema_version: STRUCTURAL_GRAPH_SCHEMA_VERSION,
                repo_path: repo_path.clone(),
                repo_head: Some(head.clone()),
                engine: StructuralGraphEngineInfo {
                    id: "codevetter-tree-sitter".to_string(),
                    version: "1".to_string(),
                    bundled: true,
                    syntax_aware: true,
                    supported_languages: vec!["rust".to_string()],
                },
                created_at: "2026-01-01T00:00:00Z".to_string(),
                cursor: None,
                ignore_fingerprint: None,
                coverage: StructuralGraphCoverage::default(),
                files: Vec::new(),
                nodes: Vec::new(),
                edges: Vec::new(),
                communities: Vec::new(),
                diagnostics: Vec::new(),
                truncated: false,
            },
        )
        .expect("snapshot");

        let server =
            CodeVetterMcpServer::new(database_path.clone(), repo_id.to_string()).expect("server");
        let (server_transport, client_transport) = tokio::io::duplex(64 * 1024);
        let server_task = tokio::spawn(async move {
            server
                .serve(server_transport)
                .await
                .expect("serve")
                .waiting()
                .await
                .expect("wait");
        });
        let client = TestClient.serve(client_transport).await.expect("client");
        let tools = client.list_tools(None).await.expect("tools");
        assert_eq!(tools.tools.len(), 13);
        assert!(tools.tools.iter().all(|tool| tool.output_schema.is_some()));
        let resources = client.list_resources(None).await.expect("resources");
        assert_eq!(resources.resources.len(), DEFAULT_PAGE_SIZE);
        let resource_cursor = resources.next_cursor.clone().expect("resource cursor");
        let second_resource_page = client
            .list_resources(Some(
                PaginatedRequestParams::default().with_cursor(Some(resource_cursor)),
            ))
            .await
            .expect("second resource page");
        assert!(!second_resource_page.resources.is_empty());
        assert!(resources
            .resources
            .iter()
            .all(|resource| !resource.uri.contains(&repo_path)));
        assert!(resources.resources.iter().all(|resource| {
            resource
                .annotations
                .as_ref()
                .and_then(|annotations| annotations.last_modified.as_ref())
                .is_some()
        }));
        let snapshot_resource = resources
            .resources
            .iter()
            .find(|resource| resource.uri.contains("/snapshot/"))
            .expect("snapshot resource");
        let read = client
            .read_resource(ReadResourceRequestParams::new(
                snapshot_resource.uri.clone(),
            ))
            .await
            .expect("read snapshot resource");
        assert_eq!(read.contents.len(), 1);
        assert!(client
            .read_resource(ReadResourceRequestParams::new(format!(
                "codevetter-history://{repo_id}/snapshot/../evidence"
            )))
            .await
            .is_err());
        assert!(client
            .read_resource(ReadResourceRequestParams::new(
                HistoryResourceUri::new(repo_id, "evidence", "missing-evidence")
                    .expect("missing evidence URI")
                    .to_string(),
            ))
            .await
            .is_err());
        let result = client
            .call_tool(
                CallToolRequestParams::new("graph_query")
                    .with_arguments(json!({"limit": 10}).as_object().expect("arguments").clone()),
            )
            .await
            .expect("graph query");
        assert_eq!(result.is_error, Some(false));
        let structured = result.structured_content.expect("structured");
        assert_eq!(structured["schemaVersion"], 1);
        assert!(structured.to_string().find(&repo_path).is_none());
        let first_page = client
            .call_tool(
                CallToolRequestParams::new("history_list_releases")
                    .with_arguments(json!({"limit": 1}).as_object().expect("arguments").clone()),
            )
            .await
            .expect("first release page")
            .structured_content
            .expect("first release page structured");
        let cursor = first_page["data"]["data"]["nextCursor"]
            .as_str()
            .expect("release cursor");
        let second_page = client
            .call_tool(
                CallToolRequestParams::new("history_list_releases").with_arguments(
                    json!({"limit": 1, "cursor": cursor})
                        .as_object()
                        .expect("arguments")
                        .clone(),
                ),
            )
            .await
            .expect("second release page");
        assert_eq!(second_page.is_error, Some(false));
        let future_only = client
            .call_tool(
                CallToolRequestParams::new("history_list_releases").with_arguments(
                    json!({
                        "history_filter": {"from": "2027-01-01T00:00:00Z"}
                    })
                    .as_object()
                    .expect("arguments")
                    .clone(),
                ),
            )
            .await
            .expect("filtered releases")
            .structured_content
            .expect("filtered releases structured");
        assert_eq!(
            future_only["data"]["data"]["result"]["revisions"]
                .as_array()
                .map(Vec::len),
            Some(0)
        );
        let invalid_range = client
            .call_tool(
                CallToolRequestParams::new("history_search").with_arguments(
                    json!({"query": "fixture", "history_filter": {"from": "not-a-date"}})
                        .as_object()
                        .expect("arguments")
                        .clone(),
                ),
            )
            .await
            .expect("invalid range response");
        assert_eq!(invalid_range.is_error, Some(true));
        assert_eq!(
            invalid_range.structured_content.expect("range error")["error"]["code"],
            "invalid_input"
        );
        let (first, second, third) = tokio::join!(
            client.call_tool(CallToolRequestParams::new("graph_query")),
            client.call_tool(CallToolRequestParams::new("history_list_releases")),
            client.call_tool(
                CallToolRequestParams::new("history_get_evidence").with_arguments(
                    json!({"ids": ["missing-evidence"]})
                        .as_object()
                        .expect("arguments")
                        .clone(),
                ),
            ),
        );
        assert!(first.expect("concurrent graph").is_error == Some(false));
        assert!(second.expect("concurrent releases").is_error == Some(false));
        assert!(third.expect("concurrent evidence").is_error == Some(false));

        connection
            .execute(
                "UPDATE history_graph_repositories SET indexed_head = 'stale-fixture-head' WHERE repo_path = ?1",
                [&repo_path],
            )
            .expect("stale history");
        let stale = client
            .call_tool(CallToolRequestParams::new("history_list_releases"))
            .await
            .expect("stale history response")
            .structured_content
            .expect("stale history structured");
        assert_eq!(stale["freshness"]["history"]["stale"], true);
        let repository_resource = resources
            .resources
            .iter()
            .find(|resource| resource.uri.contains("/repository/"))
            .expect("repository resource");
        let stale_resource = client
            .read_resource(ReadResourceRequestParams::new(
                repository_resource.uri.clone(),
            ))
            .await
            .expect("stale resource response");
        let stale_resource_json = serde_json::to_value(stale_resource).expect("resource JSON");
        let stale_resource_text = stale_resource_json["contents"][0]["text"]
            .as_str()
            .expect("resource text");
        let stale_resource_payload: Value =
            serde_json::from_str(stale_resource_text).expect("resource payload");
        assert_eq!(
            stale_resource_payload["freshness"]["history"]["stale"],
            true
        );
        connection
            .execute(
                "UPDATE history_graph_repositories SET indexed_head = ?2 WHERE repo_path = ?1",
                params![repo_path, head],
            )
            .expect("restore history head");

        connection
            .execute(
                "DELETE FROM structural_graph_snapshots WHERE repo_path = ?1",
                [&repo_path],
            )
            .expect("remove graph fixture");
        let missing_graph = client
            .call_tool(CallToolRequestParams::new("graph_query"))
            .await
            .expect("missing graph response");
        assert_eq!(missing_graph.is_error, Some(true));
        assert_eq!(
            missing_graph
                .structured_content
                .expect("missing graph error")["error"]["code"],
            "unavailable"
        );

        connection
            .execute(
                "UPDATE mcp_repository_scopes SET enabled = 0 WHERE repo_id = ?1",
                [repo_id],
            )
            .expect("disable");
        let disabled = client
            .call_tool(CallToolRequestParams::new("history_list_releases"))
            .await
            .expect("disabled response");
        assert_eq!(disabled.is_error, Some(true));
        assert_eq!(
            disabled.structured_content.expect("error")["error"]["code"],
            "permission_denied"
        );

        connection
            .execute(
                "UPDATE mcp_repository_scopes SET enabled = 1 WHERE repo_id = ?1",
                [repo_id],
            )
            .expect("re-enable");
        drop(connection);
        let closed_desktop = client
            .call_tool(CallToolRequestParams::new("history_list_releases"))
            .await
            .expect("closed desktop response");
        assert_eq!(closed_desktop.is_error, Some(false));

        client.cancel().await.expect("cancel");
        server_task.await.expect("server task");
    }

    #[test]
    fn request_bounds_clamp_pages_and_reject_oversized_strings() {
        assert_eq!(bounded_limit(None), DEFAULT_PAGE_SIZE);
        assert_eq!(bounded_limit(Some(&json!(0))), 1);
        assert_eq!(
            bounded_limit(Some(&json!(MAX_PAGE_SIZE + 1))),
            MAX_PAGE_SIZE
        );
        assert_eq!(bounded_depth(Some(&json!(0))), 1);
        assert_eq!(bounded_depth(Some(&json!(MAX_HOPS + 1))), MAX_HOPS);

        let mut arguments = Map::new();
        arguments.insert("query".to_string(), Value::String("x".repeat(4_097)));
        assert!(optional_string(&arguments, "query").is_err());
    }

    #[test]
    fn query_failures_use_stable_typed_error_codes() {
        let cases = [
            ("repository disabled", "permission_denied"),
            ("history index is stale", "stale_index"),
            ("graph is not built", "unavailable"),
            ("node not found", "not_found"),
            ("multiple candidates are ambiguous", "ambiguous"),
            ("No directed graph path connects nodes", "bounded_no_path"),
            ("request cancelled", "cancelled"),
            ("query exceeded timeout", "timeout"),
            ("query must be bounded", "invalid_input"),
            ("query worker failed", "internal"),
        ];
        for (message, code) in cases {
            assert_eq!(classify_error(message), code, "{message}");
        }
    }

    fn git(repo: &std::path::Path, arguments: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(arguments)
            .status()
            .expect("git");
        assert!(status.success(), "git {}", arguments.join(" "));
    }

    fn git_output(repo: &std::path::Path, arguments: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(arguments)
            .output()
            .expect("git");
        assert!(output.status.success(), "git {}", arguments.join(" "));
        String::from_utf8(output.stdout)
            .expect("utf8")
            .trim()
            .to_string()
    }
}
