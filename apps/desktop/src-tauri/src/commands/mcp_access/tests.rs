use super::*;

fn fixture() -> Connection {
    let connection = Connection::open_in_memory().expect("database");
    crate::db::schema::run_migrations(&connection).expect("schema");
    connection
        .execute(
            "INSERT INTO history_graph_repositories (
                repo_path, repository_fingerprint, indexed_head, status,
                created_at, updated_at
             ) VALUES ('/fixture', 'fixture', 'head', 'ready', ?1, ?1)",
            [Utc::now().to_rfc3339()],
        )
        .expect("history");
    connection
        .execute(
            "INSERT INTO mcp_repository_scopes (
                repo_path, repo_id, enabled, created_at, updated_at
             ) VALUES ('/fixture', 'opaque-repo', 1, ?1, ?1)",
            [Utc::now().to_rfc3339()],
        )
        .expect("scope");
    connection
}

#[test]
fn scope_is_opaque_and_live_disable_is_observed() {
    let connection = fixture();
    let scope = require_enabled_scope(&connection, "opaque-repo").expect("enabled");
    assert_eq!(scope.repo_path, "/fixture");
    assert!(!scope.repo_id.contains("fixture"));
    connection
        .execute(
            "UPDATE mcp_repository_scopes SET enabled = 0 WHERE repo_id = 'opaque-repo'",
            [],
        )
        .expect("disable");
    assert!(require_enabled_scope(&connection, "opaque-repo")
        .unwrap_err()
        .contains("disabled"));
    assert!(require_enabled_scope(&connection, "unknown")
        .unwrap_err()
        .contains("missing"));
}

#[test]
fn audit_is_bounded_and_never_accepts_content_fields() {
    let connection = fixture();
    for index in 0..=MAX_AUDIT_ROWS {
        record_mcp_audit(
            &connection,
            "opaque-repo",
            "session",
            "history_search",
            "ok",
            index as u64,
            1,
            100,
        )
        .expect("audit");
    }
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM mcp_access_audit", [], |row| {
            row.get(0)
        })
        .expect("count");
    assert_eq!(count, MAX_AUDIT_ROWS as i64);
    let schema = connection
        .prepare("PRAGMA table_info(mcp_access_audit)")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<Result<Vec<_>, _>>()
        })
        .expect("columns");
    assert!(!schema.iter().any(|column| {
        ["arguments", "query", "prompt", "content", "evidence"].contains(&column.as_str())
    }));
}

#[test]
fn audit_rejects_content_shaped_metadata() {
    let connection = fixture();
    let error = record_mcp_audit(
        &connection,
        "opaque-repo",
        "session",
        "history_search bearer-token",
        "ok",
        1,
        1,
        1,
    )
    .unwrap_err();
    assert_eq!(error, "Invalid MCP audit operation");
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM mcp_access_audit", [], |row| {
            row.get(0)
        })
        .expect("count");
    assert_eq!(count, 0);
}
