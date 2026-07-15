use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    thread,
    time::{Duration, Instant},
};

const RESPONSE_TIMEOUT: Duration = Duration::from_secs(5);

#[test]
fn stdio_boundary_is_json_only_scoped_and_paginated() {
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
        .expect("canonical repo")
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

    let mut sidecar = McpProcess::spawn(&database, repo_id);
    let initialized = sidecar.request(json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "stdio-fixture", "version": "1"}
        }
    }));
    assert_eq!(initialized["result"]["protocolVersion"], "2025-11-25");
    sidecar.notify(json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    }));

    let tools = sidecar.request(json!({
        "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}
    }));
    assert_eq!(tools["result"]["tools"].as_array().map(Vec::len), Some(13));

    let resources = sidecar.request(json!({
        "jsonrpc": "2.0", "id": 3, "method": "resources/list", "params": {}
    }));
    let repository_uri = resources["result"]["resources"]
        .as_array()
        .expect("resources")
        .iter()
        .find_map(|resource| {
            let uri = resource["uri"].as_str()?;
            uri.contains("/repository/").then(|| uri.to_string())
        })
        .expect("repository resource");
    assert!(!repository_uri.contains(&repo_path));

    let resource = sidecar.request(json!({
        "jsonrpc": "2.0",
        "id": 4,
        "method": "resources/read",
        "params": {"uri": repository_uri}
    }));
    assert!(resource["result"]["contents"][0]["text"]
        .as_str()
        .is_some_and(|text| text.contains("schemaVersion")));

    let first_page = sidecar.request(json!({
        "jsonrpc": "2.0",
        "id": 5,
        "method": "tools/call",
        "params": {"name": "history_list_releases", "arguments": {"limit": 1}}
    }));
    let next_cursor = first_page["result"]["structuredContent"]["data"]["data"]["nextCursor"]
        .as_str()
        .expect("release cursor");
    let second_page = sidecar.request(json!({
        "jsonrpc": "2.0",
        "id": 6,
        "method": "tools/call",
        "params": {
            "name": "history_list_releases",
            "arguments": {"limit": 1, "cursor": next_cursor}
        }
    }));
    assert_ne!(second_page["result"]["isError"], Value::Bool(true));
    sidecar.close();
}

struct McpProcess {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: Receiver<Result<String, String>>,
    closed: bool,
}

impl McpProcess {
    fn spawn(database: &std::path::Path, repo_id: &str) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_codevetter-mcp"))
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
        let stdout = child.stdout.take().expect("stdout");
        let stderr = child.stderr.take().expect("stderr");
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let message = line.map_err(|error| error.to_string());
                if sender.send(message).is_err() {
                    break;
                }
            }
        });
        thread::spawn(move || {
            let mut stderr = BufReader::new(stderr);
            let mut sink = Vec::new();
            let _ = stderr.read_to_end(&mut sink);
        });
        let stdin = child.stdin.take();
        Self {
            child,
            stdin,
            stdout: receiver,
            closed: false,
        }
    }

    fn request(&mut self, message: Value) -> Value {
        self.write(message);
        let line = self
            .stdout
            .recv_timeout(RESPONSE_TIMEOUT)
            .expect("sidecar response timed out")
            .expect("read sidecar stdout");
        serde_json::from_str(&line).expect("sidecar stdout must contain JSON only")
    }

    fn notify(&mut self, message: Value) {
        self.write(message);
    }

    fn write(&mut self, message: Value) {
        let stdin = self.stdin.as_mut().expect("sidecar stdin");
        writeln!(stdin, "{message}").expect("write request");
        stdin.flush().expect("flush request");
    }

    fn close(mut self) {
        self.stdin.take();
        let deadline = Instant::now() + RESPONSE_TIMEOUT;
        loop {
            if let Some(status) = self.child.try_wait().expect("poll sidecar") {
                assert!(status.success(), "sidecar exited with {status}");
                self.closed = true;
                return;
            }
            assert!(Instant::now() < deadline, "sidecar did not exit after EOF");
            thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for McpProcess {
    fn drop(&mut self) {
        if !self.closed {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
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
