use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
};

#[test]
fn packaged_shape_runs_offline_uses_json_only_stdout_and_negotiates_stable_protocol() {
    let fixture = tempfile::tempdir().expect("fixture");
    let repo = fixture.path().join("repo");
    fs::create_dir(&repo).expect("repo");
    git(&repo, &["init"]);
    git(&repo, &["config", "user.email", "fixture@codevetter.local"]);
    git(&repo, &["config", "user.name", "CodeVetter Fixture"]);
    fs::write(repo.join("README.md"), "fixture\n").expect("file");
    git(&repo, &["add", "README.md"]);
    git(&repo, &["commit", "-m", "fixture"]);
    let head = git_output(&repo, &["rev-parse", "HEAD"]);
    let repo_path = repo
        .canonicalize()
        .expect("canonical")
        .to_string_lossy()
        .to_string();
    let database = fixture.path().join("codevetter.db");
    let connection = Connection::open(&database).expect("database");
    codevetter_desktop::db::schema::run_migrations(&connection).expect("schema");
    connection
        .execute(
            "INSERT INTO history_graph_repositories (
                repo_path, repository_fingerprint, indexed_head, status,
                created_at, updated_at
             ) VALUES (?1, 'fixture', ?2, 'ready', ?3, ?3)",
            params![repo_path, head, "2026-01-01T00:00:00Z"],
        )
        .expect("history repository");
    for (ordinal, sha, committed_at, tag) in [
        (0, "fixture-release-1", "2025-12-01T00:00:00Z", "v0.9.0"),
        (1, "fixture-release-2", "2026-01-01T00:00:00Z", "v1.0.0"),
    ] {
        connection
            .execute(
                "INSERT INTO history_graph_revisions (
                    repo_path, sha, ordinal, committed_at, author_name, subject,
                    parents_json, tags_json, is_release, is_head, coverage_json
                 ) VALUES (?1, ?2, ?3, ?4, 'Fixture', ?5, '[]', ?6, 1, 0, '{}')",
                params![
                    repo_path,
                    sha,
                    ordinal,
                    committed_at,
                    format!("Release {tag}"),
                    json!([tag]).to_string()
                ],
            )
            .expect("release revision");
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
    drop(connection);

    let binary = env!("CARGO_BIN_EXE_codevetter-mcp");
    let mut child = Command::new(binary)
        .args([
            "--database",
            database.to_str().expect("database path"),
            "--repo-id",
            repo_id,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("HTTP_PROXY", "http://127.0.0.1:1")
        .env("HTTPS_PROXY", "http://127.0.0.1:1")
        .env("ALL_PROXY", "http://127.0.0.1:1")
        .env("NO_PROXY", "")
        .env_remove("http_proxy")
        .env_remove("https_proxy")
        .env_remove("all_proxy")
        .env_remove("no_proxy")
        .spawn()
        .expect("spawn sidecar");
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let mut lines = BufReader::new(stdout).lines();
    writeln!(
        stdin,
        "{}",
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": {"name": "stdio-fixture", "version": "1"}
            }
        })
    )
    .expect("initialize");
    stdin.flush().expect("flush");
    let initialize_line = lines
        .next()
        .expect("initialize line")
        .expect("initialize read");
    let initialize: Value = serde_json::from_str(&initialize_line).expect("JSON-only stdout");
    assert_eq!(initialize["result"]["protocolVersion"], "2025-11-25");
    assert!(initialize["result"]["capabilities"]["tools"].is_object());
    assert!(initialize["result"]["capabilities"]["resources"].is_object());
    assert!(initialize["result"]["capabilities"]
        .get("prompts")
        .is_none());

    writeln!(
        stdin,
        "{}",
        json!({"jsonrpc": "2.0", "method": "notifications/initialized"})
    )
    .expect("initialized");
    writeln!(
        stdin,
        "{}",
        json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
    )
    .expect("tools list");
    stdin.flush().expect("flush");
    let tools_line = lines.next().expect("tools line").expect("tools read");
    let tools: Value = serde_json::from_str(&tools_line).expect("JSON-only stdout");
    assert_eq!(tools["result"]["tools"].as_array().map(Vec::len), Some(13));

    writeln!(
        stdin,
        "{}",
        json!({"jsonrpc": "2.0", "id": 3, "method": "resources/list", "params": {}})
    )
    .expect("resources list");
    stdin.flush().expect("flush");
    let resources: Value = serde_json::from_str(
        &lines
            .next()
            .expect("resources line")
            .expect("resources read"),
    )
    .expect("JSON-only stdout");
    let repository_uri = resources["result"]["resources"]
        .as_array()
        .expect("resources")
        .iter()
        .find_map(|resource| {
            let uri = resource["uri"].as_str()?;
            uri.contains("/repository/").then(|| uri.to_string())
        })
        .expect("repository resource");

    writeln!(
        stdin,
        "{}",
        json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "resources/read",
            "params": {"uri": repository_uri}
        })
    )
    .expect("resource read");
    stdin.flush().expect("flush");
    let resource: Value =
        serde_json::from_str(&lines.next().expect("resource line").expect("resource read"))
            .expect("JSON-only stdout");
    assert!(resource["result"]["contents"][0]["text"]
        .as_str()
        .is_some_and(|text| text.contains("schemaVersion")));

    writeln!(
        stdin,
        "{}",
        json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {"name": "history_list_releases", "arguments": {"limit": 1}}
        })
    )
    .expect("tool call");
    stdin.flush().expect("flush");
    let tool_result: Value = serde_json::from_str(
        &lines
            .next()
            .expect("tool result line")
            .expect("tool result read"),
    )
    .expect("JSON-only stdout");
    assert_ne!(tool_result["result"]["isError"], Value::Bool(true));
    assert!(tool_result["result"]["structuredContent"]["schemaVersion"].is_number());
    let next_cursor = tool_result["result"]["structuredContent"]["data"]["data"]["nextCursor"]
        .as_str()
        .expect("release pagination cursor");

    writeln!(
        stdin,
        "{}",
        json!({
            "jsonrpc": "2.0",
            "method": "notifications/cancelled",
            "params": {"requestId": 999, "reason": "compatibility smoke test"}
        })
    )
    .expect("cancellation notification");
    writeln!(
        stdin,
        "{}",
        json!({
            "jsonrpc": "2.0",
            "method": "notifications/cancelled",
            "params": {"requestId": 1000, "reason": "repeated compatibility smoke test"}
        })
    )
    .expect("repeated cancellation notification");
    writeln!(
        stdin,
        "{}",
        json!({
            "jsonrpc": "2.0",
            "id": 6,
            "method": "tools/call",
            "params": {
                "name": "history_list_releases",
                "arguments": {"limit": 1, "cursor": next_cursor}
            }
        })
    )
    .expect("paginated tool call");
    stdin.flush().expect("flush");
    let second_page: Value = serde_json::from_str(
        &lines
            .next()
            .expect("second page line")
            .expect("second page read"),
    )
    .expect("JSON-only stdout");
    assert_ne!(second_page["result"]["isError"], Value::Bool(true));

    drop(stdin);
    let status = child.wait().expect("wait");
    assert!(status.success());

    let mut unsupported = Command::new(binary)
        .args([
            "--database",
            database.to_str().expect("database path"),
            "--repo-id",
            repo_id,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("HTTP_PROXY", "http://127.0.0.1:1")
        .env("HTTPS_PROXY", "http://127.0.0.1:1")
        .env("ALL_PROXY", "http://127.0.0.1:1")
        .env("NO_PROXY", "")
        .env_remove("http_proxy")
        .env_remove("https_proxy")
        .env_remove("all_proxy")
        .env_remove("no_proxy")
        .spawn()
        .expect("spawn unsupported-version sidecar");
    let mut unsupported_stdin = unsupported.stdin.take().expect("unsupported stdin");
    let unsupported_stdout = unsupported.stdout.take().expect("unsupported stdout");
    let mut unsupported_lines = BufReader::new(unsupported_stdout).lines();
    writeln!(
        unsupported_stdin,
        "{}",
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2099-01-01",
                "capabilities": {},
                "clientInfo": {"name": "unsupported-fixture", "version": "1"}
            }
        })
    )
    .expect("unsupported initialize");
    unsupported_stdin.flush().expect("unsupported flush");
    let unsupported_response: Value = serde_json::from_str(
        &unsupported_lines
            .next()
            .expect("unsupported response line")
            .expect("unsupported response read"),
    )
    .expect("unsupported response JSON");
    assert_eq!(
        unsupported_response["result"]["protocolVersion"],
        "2025-11-25"
    );
    drop(unsupported_stdin);
    assert!(unsupported.wait().expect("unsupported wait").success());
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
