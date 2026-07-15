use rusqlite::Connection;

const MIGRATION_SQL: &str = include_str!("schema/history_graph.sql");

pub fn run_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(MIGRATION_SQL)?;
    run_additive_migrations(conn)
}

fn run_additive_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    let _ = conn.execute(
        "ALTER TABLE history_graph_annotations ADD COLUMN decision TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE history_graph_annotations ADD COLUMN related_event_id TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE history_graph_annotations ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE history_graph_events ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1",
        [],
    );
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_history_graph_annotations_evidence
         ON history_graph_annotations(repo_path, related_event_id, created_at)",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn temporal_graph_schema_is_indexed_and_idempotent() {
        let conn = Connection::open_in_memory().expect("database");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys");

        run_migration(&conn).expect("first migration");
        run_migration(&conn).expect("idempotent migration");

        let tables = schema_objects(&conn, "table", "history_graph_%");
        assert_eq!(
            tables,
            BTreeSet::from([
                "history_graph_annotations".to_string(),
                "history_graph_checkpoints".to_string(),
                "history_graph_event_blobs".to_string(),
                "history_graph_events".to_string(),
                "history_graph_repositories".to_string(),
                "history_graph_revision_paths".to_string(),
                "history_graph_revisions".to_string(),
                "history_graph_snapshot_blobs".to_string(),
            ])
        );

        let indexes = schema_objects(&conn, "index", "idx_history_graph_%");
        for required in [
            "idx_history_graph_annotations_evidence",
            "idx_history_graph_events_entity",
            "idx_history_graph_events_revision",
            "idx_history_graph_paths_path",
            "idx_history_graph_revisions_time",
        ] {
            assert!(indexes.contains(required), "missing {required}");
        }
    }

    #[test]
    fn legacy_event_and_annotation_tables_gain_additive_columns() {
        let conn = Connection::open_in_memory().expect("database");
        conn.execute_batch(
            "CREATE TABLE history_graph_events (id TEXT PRIMARY KEY);
             CREATE TABLE history_graph_annotations (
                 id TEXT PRIMARY KEY,
                 repo_path TEXT NOT NULL,
                 created_at TEXT NOT NULL
             );",
        )
        .expect("legacy schema");

        run_additive_migrations(&conn).expect("upgrade legacy schema");

        let event_columns = table_columns(&conn, "history_graph_events");
        assert!(event_columns.contains("schema_version"));
        let annotation_columns = table_columns(&conn, "history_graph_annotations");
        for required in ["decision", "related_event_id", "metadata_json"] {
            assert!(annotation_columns.contains(required), "missing {required}");
        }
        assert!(
            schema_objects(&conn, "index", "idx_history_graph_annotations_evidence")
                .contains("idx_history_graph_annotations_evidence")
        );
    }

    fn table_columns(conn: &Connection, table: &str) -> BTreeSet<String> {
        let mut statement = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .expect("prepare columns");
        statement
            .query_map([], |row| row.get(1))
            .expect("query columns")
            .collect::<Result<_, _>>()
            .expect("columns")
    }

    fn schema_objects(conn: &Connection, kind: &str, pattern: &str) -> BTreeSet<String> {
        let mut statement = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = ?1 AND name LIKE ?2")
            .expect("prepare schema lookup");
        statement
            .query_map([kind, pattern], |row| row.get(0))
            .expect("query schema")
            .collect::<Result<_, _>>()
            .expect("schema objects")
    }
}
