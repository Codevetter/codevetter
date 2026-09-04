use rusqlite::Connection;

pub fn run_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS verification_workbench_schema_migrations (
            version INTEGER PRIMARY KEY,
            migration_identity TEXT NOT NULL UNIQUE,
            applied_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS outcome_calibration_observations (
            id TEXT PRIMARY KEY,
            schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version = 1),
            repo_path TEXT NOT NULL,
            repository_identity TEXT NOT NULL,
            snapshot_before_id TEXT,
            snapshot_after_id TEXT NOT NULL,
            feature_key TEXT NOT NULL,
            feature_delta REAL NOT NULL,
            outcome_kind TEXT NOT NULL,
            outcome_state TEXT NOT NULL,
            outcome_id TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            excluded_reason TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            UNIQUE(repository_identity, snapshot_after_id, feature_key, outcome_kind, outcome_id)
        );

        CREATE INDEX IF NOT EXISTS idx_outcome_calibration_observations_repo
            ON outcome_calibration_observations(repo_path, observed_at DESC);

        CREATE TABLE IF NOT EXISTS outcome_calibration_summaries (
            id TEXT PRIMARY KEY,
            schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version = 1),
            summary_identity TEXT NOT NULL UNIQUE,
            repo_path TEXT NOT NULL,
            feature_key TEXT NOT NULL,
            outcome_kind TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('insufficient', 'descriptive', 'qualified')),
            direction TEXT NOT NULL,
            sample_size INTEGER NOT NULL,
            independent_outcomes INTEGER NOT NULL,
            success_rate REAL,
            failure_rate REAL,
            confidence_low REAL,
            confidence_high REAL,
            window_start TEXT,
            window_end TEXT,
            source_ids_json TEXT NOT NULL DEFAULT '[]',
            exclusions_json TEXT NOT NULL DEFAULT '[]',
            rerun_command TEXT,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_outcome_calibration_summaries_repo
            ON outcome_calibration_summaries(repo_path, created_at DESC);

        CREATE TABLE IF NOT EXISTS session_retention_pins (
            session_id TEXT PRIMARY KEY REFERENCES cc_sessions(id) ON DELETE CASCADE,
            reason TEXT,
            pinned_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS session_retention_runs (
            id TEXT PRIMARY KEY,
            schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version = 1),
            plan_identity TEXT NOT NULL UNIQUE,
            archive_fingerprint TEXT NOT NULL,
            policy_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('planned', 'applied', 'rejected')),
            plan_json TEXT NOT NULL,
            candidate_sessions INTEGER NOT NULL DEFAULT 0,
            protected_sessions INTEGER NOT NULL DEFAULT 0,
            candidate_rows INTEGER NOT NULL DEFAULT 0,
            estimated_bytes INTEGER NOT NULL DEFAULT 0,
            applied_rows INTEGER,
            applied_sessions INTEGER,
            applied_at TEXT,
            rejection_reason TEXT,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_session_retention_runs_created
            ON session_retention_runs(created_at DESC);

        CREATE TABLE IF NOT EXISTS session_retention_events (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES session_retention_runs(id) ON DELETE CASCADE,
            event_type TEXT NOT NULL CHECK(event_type IN ('applied', 'rejected', 'compacted')),
            detail_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_session_retention_events_run
            ON session_retention_events(run_id, created_at ASC);

        CREATE TABLE IF NOT EXISTS managed_work_runs (
            id TEXT PRIMARY KEY,
            schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version = 1),
            work_item_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
            provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude')),
            profile_id TEXT NOT NULL,
            profile_path TEXT NOT NULL,
            repo_path TEXT NOT NULL,
            base_revision TEXT NOT NULL,
            worktree_path TEXT,
            worktree_branch TEXT,
            owner_token TEXT NOT NULL UNIQUE,
            environment_json TEXT NOT NULL DEFAULT '{}',
            ports_json TEXT NOT NULL DEFAULT '[]',
            terminal_id TEXT,
            provider_session_id TEXT,
            process_id INTEGER,
            process_started_at TEXT,
            state TEXT NOT NULL,
            current_checkpoint_id TEXT,
            change_identity TEXT,
            disconnected_reason TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_managed_work_runs_item_updated
            ON managed_work_runs(work_item_id, updated_at DESC);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_work_runs_one_live_item
            ON managed_work_runs(work_item_id)
            WHERE state IN ('planned', 'starting', 'running', 'attention', 'checking');

        CREATE TABLE IF NOT EXISTS managed_work_port_reservations (
            run_id TEXT NOT NULL REFERENCES managed_work_runs(id) ON DELETE CASCADE,
            port INTEGER NOT NULL CHECK(port BETWEEN 1024 AND 65535),
            purpose TEXT NOT NULL,
            reserved_at TEXT NOT NULL,
            PRIMARY KEY(run_id, purpose),
            UNIQUE(port)
        );

        CREATE TABLE IF NOT EXISTS managed_work_checkpoints (
            id TEXT PRIMARY KEY,
            schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version = 1),
            run_id TEXT NOT NULL REFERENCES managed_work_runs(id) ON DELETE CASCADE,
            sequence INTEGER NOT NULL,
            kind TEXT NOT NULL,
            state TEXT NOT NULL,
            change_identity TEXT,
            command_json TEXT,
            summary TEXT NOT NULL,
            evidence_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            UNIQUE(run_id, sequence)
        );

        CREATE INDEX IF NOT EXISTS idx_managed_work_checkpoints_run
            ON managed_work_checkpoints(run_id, sequence DESC);

        CREATE TABLE IF NOT EXISTS intent_closure_receipts (
            id TEXT PRIMARY KEY,
            schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version = 1),
            work_item_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
            goal_version INTEGER NOT NULL,
            goal_text TEXT NOT NULL,
            acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
            provider TEXT,
            session_id TEXT,
            managed_run_id TEXT REFERENCES managed_work_runs(id) ON DELETE SET NULL,
            change_identity TEXT NOT NULL,
            review_id TEXT,
            verification_run_id TEXT,
            disposition TEXT NOT NULL CHECK(
                disposition IN ('satisfied', 'partially_satisfied', 'not_satisfied', 'waived')
            ),
            reason TEXT NOT NULL,
            stale_at TEXT,
            stale_reason TEXT,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_intent_closure_receipts_item
            ON intent_closure_receipts(work_item_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS local_performance_receipts (
            id TEXT PRIMARY KEY,
            schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version = 1),
            receipt_kind TEXT NOT NULL,
            repository_revision TEXT NOT NULL,
            fixture_identity TEXT NOT NULL,
            machine_json TEXT NOT NULL,
            measurements_json TEXT NOT NULL,
            before_identity TEXT,
            rollback_json TEXT,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_local_performance_receipts_kind
            ON local_performance_receipts(receipt_kind, created_at DESC);

        CREATE TABLE IF NOT EXISTS local_check_runs (
            run_id TEXT PRIMARY KEY,
            schema_version TEXT NOT NULL,
            repo_path TEXT NOT NULL,
            base_sha TEXT NOT NULL,
            head_sha TEXT NOT NULL,
            verdict TEXT NOT NULL,
            task TEXT NOT NULL,
            receipt_json TEXT NOT NULL,
            ran_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_local_check_runs_repo_time
            ON local_check_runs(repo_path, ran_at DESC);

        INSERT OR IGNORE INTO verification_workbench_schema_migrations
            (version, migration_identity, applied_at)
        VALUES
            (1, 'verification-workbench-v1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

        INSERT OR IGNORE INTO verification_workbench_schema_migrations
            (version, migration_identity, applied_at)
        VALUES
            (2, 'verification-workbench-local-check-runs-v2', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
        "#,
    )?;

    let _ = conn.execute(
        "ALTER TABLE managed_work_runs ADD COLUMN profile_path TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE managed_work_runs ADD COLUMN worktree_branch TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE managed_work_runs ADD COLUMN terminal_id TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE managed_work_runs ADD COLUMN provider_session_id TEXT",
        [],
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::run_migration;
    use crate::db::schema;
    use rusqlite::{params, Connection};

    fn table_exists(conn: &Connection, table: &str) -> bool {
        conn.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1
            )",
            [table],
            |row| row.get(0),
        )
        .expect("table lookup")
    }

    #[test]
    fn migration_is_additive_and_idempotent() {
        let conn = Connection::open_in_memory().expect("database");
        schema::run_migrations(&conn).expect("initial migration");
        run_migration(&conn).expect("repeat migration");

        for table in [
            "outcome_calibration_observations",
            "outcome_calibration_summaries",
            "session_retention_runs",
            "session_retention_events",
            "managed_work_runs",
            "managed_work_checkpoints",
            "intent_closure_receipts",
            "local_performance_receipts",
            "local_check_runs",
        ] {
            assert!(table_exists(&conn, table), "missing {table}");
        }

        let identity: String = conn
            .query_row(
                "SELECT migration_identity
                 FROM verification_workbench_schema_migrations WHERE version = 1",
                [],
                |row| row.get(0),
            )
            .expect("migration row");
        assert_eq!(identity, "verification-workbench-v1");
        let run_identity: String = conn
            .query_row(
                "SELECT migration_identity
                 FROM verification_workbench_schema_migrations WHERE version = 2",
                [],
                |row| row.get(0),
            )
            .expect("local-check migration row");
        assert_eq!(run_identity, "verification-workbench-local-check-runs-v2");
    }

    #[test]
    fn existing_task_and_session_rows_survive_migration() {
        let conn = Connection::open_in_memory().expect("database");
        schema::run_migrations(&conn).expect("schema");
        conn.execute(
            "INSERT INTO cc_projects(id, display_name, dir_path, created_at)
             VALUES('project:legacy', 'Legacy', '/tmp/legacy', '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("project");
        conn.execute(
            "INSERT INTO cc_sessions(id, project_id, agent_type)
             VALUES('session:legacy', 'project:legacy', 'codex')",
            [],
        )
        .expect("session");
        conn.execute(
            "INSERT INTO agent_tasks(id, title, status, created_at, updated_at)
             VALUES('task:legacy', 'Legacy task', 'backlog',
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("task");

        run_migration(&conn).expect("repeat migration");

        let task_title: String = conn
            .query_row(
                "SELECT title FROM agent_tasks WHERE id = ?1",
                ["task:legacy"],
                |row| row.get(0),
            )
            .expect("legacy task");
        let agent_type: String = conn
            .query_row(
                "SELECT agent_type FROM cc_sessions WHERE id = ?1",
                ["session:legacy"],
                |row| row.get(0),
            )
            .expect("legacy session");
        assert_eq!(task_title, "Legacy task");
        assert_eq!(agent_type, "codex");

        conn.execute(
            "INSERT INTO managed_work_runs(
                id, work_item_id, provider, profile_id, profile_path, repo_path, base_revision,
                owner_token, state, created_at, updated_at
             ) VALUES(?1, ?2, 'codex', 'default', '/tmp/profile', '/tmp/legacy',
                      ?3, ?4, 'planned', ?5, ?5)",
            params![
                "run:legacy",
                "task:legacy",
                "a".repeat(40),
                "owner:legacy",
                "2026-01-01T00:00:00Z"
            ],
        )
        .expect("managed run");
    }
}
