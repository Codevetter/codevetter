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

const SURFACE_PARITY_FIXTURE: &str =
    include_str!("../../../tests/fixtures/surface-parity/evidence-scope-v1.json");
const LOCAL_CHECK_PARITY_FIXTURE: &str =
    include_str!("../../../tests/fixtures/surface-parity/local-check-v1.json");

fn surface_parity_fixture() -> Value {
    serde_json::from_str(SURFACE_PARITY_FIXTURE).expect("surface parity fixture")
}

fn local_check_parity_fixture() -> Value {
    serde_json::from_str(LOCAL_CHECK_PARITY_FIXTURE).expect("local-check parity fixture")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn timed_out_sql_workers_release_all_query_capacity() {
    let semaphore = Arc::new(Semaphore::new(4));
    let mut tasks = Vec::new();
    for _ in 0..4 {
        let permit = Arc::clone(&semaphore)
            .acquire_owned()
            .await
            .expect("permit");
        tasks.push(tokio::spawn(async move {
            let (interrupt_sender, interrupt_receiver) = oneshot::channel();
            let worker = tokio::task::spawn_blocking(move || {
                let _permit = permit;
                let connection = Connection::open_in_memory().map_err(|error| error.to_string())?;
                let _ = interrupt_sender.send(connection.get_interrupt_handle());
                connection
                    .query_row(
                        "WITH RECURSIVE count(value) AS (
                           VALUES(0) UNION ALL SELECT value+1 FROM count WHERE value<1000000000
                         ) SELECT sum(value) FROM count",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(|error| error.to_string())
            });
            await_interruptible_query(
                worker,
                interrupt_receiver,
                Duration::from_millis(20),
                "test query",
            )
            .await
        }));
    }
    for task in tasks {
        let result = task.await.expect("timeout task");
        assert!(result
            .expect_err("query must time out")
            .contains("exceeded"));
    }
    let permit = tokio::time::timeout(Duration::from_millis(100), semaphore.acquire())
        .await
        .expect("capacity restored")
        .expect("semaphore open");
    drop(permit);
}

#[test]
fn every_tool_is_explicitly_read_only_and_schema_bounded() {
    let fixture = surface_parity_fixture();
    assert_eq!(fixture["authority"]["mcp"], "read_only_projection");
    assert_eq!(fixture["authority"]["mcp_may_execute"], false);
    let tools = tool_definitions();
    assert_eq!(
        tools
            .iter()
            .map(|tool| tool.name.as_ref())
            .collect::<Vec<_>>(),
        vec![
            "capability_catalog",
            "graph_query",
            "graph_get_node",
            "graph_get_neighbors",
            "graph_path",
            "graph_impact",
            "history_list_releases",
            "history_list_landmarks",
            "history_list_contributors",
            "history_search",
            "history_get_state",
            "history_lineage",
            "history_explain",
            "history_trace",
            "history_compare",
            "history_get_evidence",
            "prepare_review",
            "resolve_evidence_scope",
            "qa_workspace_inspect",
            "verification_get_receipt",
            "review_list_manifests",
            "archaeology_list_rules",
            "archaeology_list_domains",
            "archaeology_get_rule",
            "archaeology_reverse_source",
            "archaeology_list_relations",
            "archaeology_compare_temporal",
            "archaeology_hydrate_evidence",
        ]
    );
    for tool in tools {
        let annotations = tool.annotations.expect("annotations");
        assert_eq!(annotations.read_only_hint, Some(true));
        assert_eq!(annotations.destructive_hint, Some(false));
        assert_eq!(annotations.open_world_hint, Some(false));
        let output = tool.output_schema.expect("output schema");
        assert!(output.get("oneOf").is_some());
        assert_eq!(
            tool.input_schema.get("additionalProperties"),
            Some(&Value::Bool(false))
        );
        if tool.name == "history_trace" {
            assert!(tool.input_schema["properties"]["selector"]
                .get("oneOf")
                .is_some());
        }
        if tool.name == "archaeology_compare_temporal" {
            assert_eq!(
                tool.input_schema["properties"]["limit"]["maximum"],
                MAX_PAGE_SIZE
            );
            assert!(tool.input_schema["properties"].get("cursor").is_some());
        }
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
    let surface_fixture = surface_parity_fixture();
    let local_check_fixture = local_check_parity_fixture();
    let repo = fixture.path().join("repo");
    fs::create_dir(&repo).expect("repo");
    git(&repo, &["init"]);
    git(&repo, &["config", "user.email", "fixture@codevetter.local"]);
    git(&repo, &["config", "user.name", "CodeVetter Fixture"]);
    fs::write(repo.join("main.rs"), "fn main() {}\n").expect("source");
    for (relative_path, content) in surface_fixture["repository"]["files"]
        .as_object()
        .expect("surface parity files")
    {
        let path = repo.join(relative_path);
        fs::create_dir_all(path.parent().expect("surface fixture parent"))
            .expect("surface fixture directory");
        fs::write(
            path,
            content.as_str().expect("surface fixture file content"),
        )
        .expect("surface fixture file");
    }
    git(&repo, &["add", "."]);
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
    let mut canonical_local_check = local_check_fixture["canonical_receipt"].clone();
    canonical_local_check["repo_path"] = Value::String(repo_path.clone());
    connection
        .execute(
            "INSERT INTO local_check_runs (
                    run_id, schema_version, repo_path, base_sha, head_sha,
                    verdict, task, receipt_json, ran_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                canonical_local_check["run_id"].as_str().expect("run id"),
                canonical_local_check["schema_version"]
                    .as_str()
                    .expect("receipt schema"),
                repo_path,
                canonical_local_check["source"]["base_sha"]
                    .as_str()
                    .expect("base sha"),
                canonical_local_check["source"]["head_sha"]
                    .as_str()
                    .expect("head sha"),
                canonical_local_check["verdict"].as_str().expect("verdict"),
                canonical_local_check["task"].as_str().expect("task"),
                serde_json::to_string(&canonical_local_check).expect("receipt JSON"),
                canonical_local_check["ran_at"].as_str().expect("run time"),
            ],
        )
        .expect("local-check parity receipt");
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
            metrics: Vec::new(),
            clone_groups: Vec::new(),
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
    assert_eq!(tools.tools.len(), 28);
    assert!(tools.tools.iter().all(|tool| tool.output_schema.is_some()));
    let templates = client
        .list_resource_templates(None)
        .await
        .expect("resource templates");
    assert!(templates
        .resource_templates
        .iter()
        .any(|template| template.uri_template.contains("/landmark-catalog/")));
    assert!(templates
        .resource_templates
        .iter()
        .any(|template| template.uri_template.contains("/contributor-summary/")));
    assert!(client
        .call_tool(
            CallToolRequestParams::new("graph_query").with_arguments(
                json!({"unexpected": "rejected"})
                    .as_object()
                    .expect("arguments")
                    .clone(),
            ),
        )
        .await
        .is_err());
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
    assert!(resources
        .resources
        .iter()
        .any(|resource| resource.uri.contains("/landmark-catalog/")));
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
    let landmark_resource = resources
        .resources
        .iter()
        .find(|resource| resource.uri.contains("/landmark-catalog/"))
        .expect("landmark catalog resource");
    let landmark_read = client
        .read_resource(ReadResourceRequestParams::new(
            landmark_resource.uri.clone(),
        ))
        .await
        .expect("read landmark catalog resource");
    assert_eq!(landmark_read.contents.len(), 1);
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
    fs::write(repo.join("main.rs"), "fn main() { println!(\"ready\"); }\n")
        .expect("changed source");
    let prepared = client
        .call_tool(
            CallToolRequestParams::new("prepare_review").with_arguments(
                json!({"task": "Check the changed entrypoint", "change": "WORKTREE"})
                    .as_object()
                    .expect("arguments")
                    .clone(),
            ),
        )
        .await
        .expect("prepared review")
        .structured_content
        .expect("prepared review structured");
    assert_eq!(
        prepared["data"]["data"]["schema_version"],
        "codevetter.review-packet/v1"
    );
    assert_eq!(
        prepared["data"]["data"]["source"]["changed_paths"][0]["path"],
        "main.rs"
    );
    assert_eq!(prepared["data"]["data"]["source"]["head_sha"], head);
    assert!(prepared.to_string().find(&repo_path).is_none());
    let performance_scope = client
        .call_tool(
            CallToolRequestParams::new("resolve_evidence_scope").with_arguments(
                json!({"consumer": "performance", "scope_kind": "codebase"})
                    .as_object()
                    .expect("arguments")
                    .clone(),
            ),
        )
        .await
        .expect("performance scope")
        .structured_content
        .expect("performance scope structured");
    assert_eq!(performance_scope["data"]["data"]["schema_version"], 1);
    assert_eq!(performance_scope["data"]["data"]["consumer"], "performance");
    assert_eq!(performance_scope["data"]["data"]["kind"], "codebase");
    assert!(performance_scope.to_string().find(&repo_path).is_none());
    let request = &surface_fixture["request"];
    let expected = &surface_fixture["expected"];
    let parity_scope = client
        .call_tool(
            CallToolRequestParams::new("resolve_evidence_scope").with_arguments(
                json!({
                    "consumer": request["consumer"],
                    "scope_kind": request["kind"],
                    "scope_value": request["value"]
                })
                .as_object()
                .expect("surface parity arguments")
                .clone(),
            ),
        )
        .await
        .expect("surface parity MCP scope")
        .structured_content
        .expect("surface parity MCP structured content");
    let parity_plan = &parity_scope["data"]["data"];
    assert_eq!(parity_plan["schema_version"], expected["schema_version"]);
    assert_eq!(parity_plan["status"], expected["status"]);
    assert_eq!(
        parity_plan["candidates"].as_array().map(Vec::len),
        expected["candidate_count"]
            .as_u64()
            .map(|count| count as usize)
    );
    assert_eq!(
        parity_plan["candidates"][0]["id"],
        expected["first_candidate"]["id"]
    );
    assert_eq!(
        parity_plan["candidates"][0]["target"],
        expected["first_candidate"]["target"]
    );
    assert!(parity_scope.to_string().find(&repo_path).is_none());
    let local_expected = &local_check_fixture["expected"];
    let parity_receipt = client
        .call_tool(
            CallToolRequestParams::new("verification_get_receipt").with_arguments(
                json!({"run_id": local_expected["run_id"]})
                    .as_object()
                    .expect("receipt parity arguments")
                    .clone(),
            ),
        )
        .await
        .expect("surface parity MCP receipt")
        .structured_content
        .expect("surface parity MCP receipt content");
    let receipt_projection = &parity_receipt["data"]["data"];
    assert_eq!(
        receipt_projection["schema_version"],
        local_expected["mcp_projection_schema"]
    );
    assert_eq!(receipt_projection["authority"], "read_only_projection");
    assert_eq!(
        receipt_projection["receipt"]["schema_version"],
        local_expected["receipt_schema"]
    );
    assert_eq!(
        receipt_projection["receipt"]["request_id"],
        local_expected["request_id"]
    );
    assert_eq!(
        receipt_projection["receipt"]["verdict"],
        local_expected["verdict"]
    );
    assert_eq!(
        receipt_projection["receipt"]["stages"]["performance"]["status"],
        local_expected["performance_status"]
    );
    assert_eq!(
        receipt_projection["receipt"]["stages"]["review"]["evidence"]["cross_review"]["strategy"],
        "claude_then_codex_independent"
    );
    assert_eq!(
        receipt_projection["receipt"]["stages"]["review"]["evidence"]["cross_review"]["passes"][1]
            ["reviewer"],
        "codex"
    );
    assert!(receipt_projection["receipt"]["limitations"]
        .as_array()
        .is_some_and(|limitations| limitations.contains(&local_expected["limitation"])));
    assert!(receipt_projection["receipt"].get("repo_path").is_none());
    assert!(parity_receipt.to_string().find(&repo_path).is_none());
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
    let landmarks = client
        .call_tool(
            CallToolRequestParams::new("history_list_landmarks")
                .with_arguments(json!({"limit": 1}).as_object().expect("arguments").clone()),
        )
        .await
        .expect("landmark catalog")
        .structured_content
        .expect("landmark catalog structured");
    assert_eq!(landmarks["schemaVersion"], 1);
    assert!(landmarks["data"]["data"]["landmarks"].is_array());
    let contributors = client
        .call_tool(
            CallToolRequestParams::new("history_list_contributors").with_arguments(
                json!({
                    "contributor_scope": {"kind": "exact_interval", "to_inclusive": head}
                })
                .as_object()
                .expect("arguments")
                .clone(),
            ),
        )
        .await
        .expect("contributor summary")
        .structured_content
        .expect("contributor summary structured");
    assert_eq!(contributors["schemaVersion"], 1);
    assert!(contributors["data"]["data"]["contributors"].is_array());
    let invalid_range = client
        .call_tool(
            CallToolRequestParams::new("history_search").with_arguments(
                json!({"query": "fixture", "history_filter": {"from": "not-a-date"}})
                    .as_object()
                    .expect("arguments")
                    .clone(),
            ),
        )
        .await;
    assert!(invalid_range.is_err());
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
    let prepared_without_graph = client
        .call_tool(
            CallToolRequestParams::new("prepare_review").with_arguments(
                json!({"task": "Check the changed entrypoint", "change": "WORKTREE"})
                    .as_object()
                    .expect("arguments")
                    .clone(),
            ),
        )
        .await
        .expect("prepared review without graph")
        .structured_content
        .expect("prepared review without graph structured");
    assert_eq!(
        prepared_without_graph["data"]["data"]["graph"]["status"],
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
fn request_validation_rejects_unknown_and_out_of_bounds_arguments() {
    let mut arguments = json!({"query": "safe", "unexpected": "ignored"})
        .as_object()
        .expect("arguments")
        .clone();
    assert!(validate_tool_arguments("graph_query", &arguments)
        .unwrap_err()
        .contains("Unknown 'unexpected'"));

    arguments = json!({"limit": MAX_PAGE_SIZE + 1})
        .as_object()
        .expect("arguments")
        .clone();
    assert!(validate_tool_arguments("graph_query", &arguments).is_err());

    arguments = json!({"filter": {"node_kinds": [], "unknown": true}})
        .as_object()
        .expect("arguments")
        .clone();
    assert!(validate_tool_arguments("graph_query", &arguments).is_err());

    arguments = json!({
        "selector": {"kind": "event", "event_id": "event-1", "extra": "rejected"}
    })
    .as_object()
    .expect("arguments")
    .clone();
    assert!(validate_tool_arguments("history_trace", &arguments).is_err());

    arguments = json!({
        "selector": {"kind": "event", "event_id": "event-1"},
        "limit": 10
    })
    .as_object()
    .expect("arguments")
    .clone();
    assert!(validate_tool_arguments("history_trace", &arguments).is_ok());

    arguments = json!({
        "landmark_kind": "candidate_inflection",
        "limit": 10,
        "unexpected": true
    })
    .as_object()
    .expect("arguments")
    .clone();
    assert!(validate_tool_arguments("history_list_landmarks", &arguments).is_err());

    arguments = json!({
        "contributor_scope": {
            "kind": "exact_interval",
            "to_inclusive": "a".repeat(40),
            "unknown": true
        }
    })
    .as_object()
    .expect("arguments")
    .clone();
    assert!(validate_tool_arguments("history_list_contributors", &arguments).is_err());

    arguments = json!({
        "filter": {"query": "claim", "unknown": true}
    })
    .as_object()
    .expect("arguments")
    .clone();
    assert!(validate_tool_arguments("archaeology_list_rules", &arguments).is_err());

    arguments = json!({
        "source": {"kind": "span", "span_id": "span:one", "path": "/private/repo"}
    })
    .as_object()
    .expect("arguments")
    .clone();
    assert!(validate_tool_arguments("archaeology_reverse_source", &arguments).is_err());

    arguments = json!({
        "rule_id": format!("sha256:{}", "a".repeat(64)),
        "evidence": [{"kind": "span", "evidence_id": "span:one"}],
        "limit": 1
    })
    .as_object()
    .expect("arguments")
    .clone();
    assert!(validate_tool_arguments("archaeology_hydrate_evidence", &arguments).is_ok());

    arguments = json!({"task": "Review the change", "change": "main...feature"})
        .as_object()
        .expect("arguments")
        .clone();
    assert!(validate_tool_arguments("prepare_review", &arguments).is_ok());

    arguments = json!({"task": "Review the change", "change": "x".repeat(513)})
        .as_object()
        .expect("arguments")
        .clone();
    assert!(validate_tool_arguments("prepare_review", &arguments).is_err());

    arguments = json!({
        "consumer": "performance",
        "scope_kind": "change",
        "scope_value": "main...HEAD"
    })
    .as_object()
    .expect("arguments")
    .clone();
    assert!(validate_tool_arguments("resolve_evidence_scope", &arguments).is_ok());

    arguments = json!({"consumer": "testing", "scope_kind": "codebase"})
        .as_object()
        .expect("arguments")
        .clone();
    assert!(validate_tool_arguments("resolve_evidence_scope", &arguments).is_ok());

    arguments = json!({"consumer": "performance", "scope_kind": "flow"})
        .as_object()
        .expect("arguments")
        .clone();
    assert!(validate_tool_arguments("resolve_evidence_scope", &arguments).is_err());

    arguments = json!({
        "consumer": "performance",
        "scope_kind": "codebase",
        "scope_value": "must-not-be-present"
    })
    .as_object()
    .expect("arguments")
    .clone();
    assert!(validate_tool_arguments("resolve_evidence_scope", &arguments).is_err());

    arguments = json!({"run_id": "local-check-surface-parity"})
        .as_object()
        .expect("arguments")
        .clone();
    assert!(validate_tool_arguments("verification_get_receipt", &arguments).is_ok());

    arguments = json!({"run_id": "../foreign receipt"})
        .as_object()
        .expect("arguments")
        .clone();
    assert!(validate_tool_arguments("verification_get_receipt", &arguments).is_err());
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
