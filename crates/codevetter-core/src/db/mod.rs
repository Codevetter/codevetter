pub(crate) mod archaeology_schema;
pub(crate) mod history_graph_schema;
pub(crate) mod mcp_schema;
pub mod queries;
pub mod schema;
pub(crate) mod structural_graph_schema;
pub(crate) mod verification_workbench_schema;

use rusqlite::Connection;
use std::{path::PathBuf, time::Duration};

pub(crate) const INCREMENTAL_VACUUM_MODE: u32 = 2;
const RECLAIM_PAGE_BATCH: u64 = 256;

/// Open (or create) the SQLite database in the app data directory and run
/// all migrations so that every table is guaranteed to exist.
pub fn init_db(app_data_dir: PathBuf) -> Result<Connection, rusqlite::Error> {
    std::fs::create_dir_all(&app_data_dir).ok();
    let db_path = app_data_dir.join("codevetter.db");
    let conn = Connection::open(db_path)?;
    conn.busy_timeout(Duration::from_secs(30))?;
    if conn.pragma_query_value(None, "page_count", |row| row.get::<_, u64>(0))? == 0 {
        conn.pragma_update(None, "auto_vacuum", INCREMENTAL_VACUUM_MODE)?;
    }

    // Performance pragmas ------------------------------------------------
    // mmap_size: up to 256 MB mapped I/O — big speedup for warm reads
    //   on the indexed message DB without actually using that much RAM
    //   (pages page in on demand).
    // temp_store=MEMORY: keeps sort/group temp tables in RAM — matters
    //   for the GROUP BY strftime() used by the token usage chart.
    // cache_size negative = KiB — 16 MB page cache (was 64 MB pre-1.1.84).
    //   The indexer churns whole tables, so a bigger cache was rarely a hot
    //   hit; trimming it cuts steady-state RSS by ~50 MB.
    // wal_autocheckpoint = 200 pages (~800 KB) — more aggressive than the
    //   1000-page default; the indexer commits frequently and we want the
    //   WAL to stay small in steady-state.
    conn.execute_batch(
        "PRAGMA journal_mode      = WAL;
         PRAGMA synchronous       = NORMAL;
         PRAGMA foreign_keys      = ON;
         PRAGMA mmap_size         = 268435456;
         PRAGMA temp_store        = MEMORY;
         PRAGMA cache_size        = -16384;
         PRAGMA wal_autocheckpoint = 200;",
    )?;

    schema::run_migrations(&conn)?;

    Ok(conn)
}

/// Reclaim a bounded number of free pages on databases configured for incremental vacuum.
pub(crate) fn reclaim_free_pages(conn: &Connection) -> Result<(), rusqlite::Error> {
    if conn.pragma_query_value(None, "auto_vacuum", |row| row.get::<_, u32>(0))?
        != INCREMENTAL_VACUUM_MODE
        || conn.pragma_query_value(None, "freelist_count", |row| row.get::<_, u64>(0))?
            < RECLAIM_PAGE_BATCH
    {
        return Ok(());
    }

    let mut statement =
        conn.prepare(&format!("PRAGMA incremental_vacuum({RECLAIM_PAGE_BATCH})"))?;
    let mut pages = statement.query([])?;
    while pages.next()?.is_some() {}
    Ok(())
}

/// True when SQLite could not acquire a write lock (background indexer contention).
pub fn is_database_busy(err: &rusqlite::Error) -> bool {
    match err {
        rusqlite::Error::SqliteFailure(code, _) => {
            code.code == rusqlite::ErrorCode::DatabaseBusy
                || code.code == rusqlite::ErrorCode::DatabaseLocked
        }
        _ => false,
    }
}

/// Retry a DB operation when the shared DB file is busy (e.g. periodic indexer).
pub fn with_busy_retry<T, F>(mut op: F, max_attempts: u32) -> Result<T, rusqlite::Error>
where
    F: FnMut() -> Result<T, rusqlite::Error>,
{
    let mut attempt = 0u32;
    loop {
        match op() {
            Ok(value) => return Ok(value),
            Err(err) if is_database_busy(&err) && attempt + 1 < max_attempts => {
                attempt += 1;
                let delay_ms = (300u64 * attempt as u64).min(4000);
                std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            }
            Err(err) => return Err(err),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_database_reclaims_a_bounded_batch_of_free_pages() {
        let dir = tempfile::tempdir().expect("temporary database directory");
        let conn = init_db(dir.path().to_path_buf()).expect("database");
        assert_eq!(
            conn.pragma_query_value(None, "auto_vacuum", |row| row.get::<_, u32>(0))
                .unwrap(),
            INCREMENTAL_VACUUM_MODE
        );
        conn.execute_batch(
            "CREATE TABLE rebuildable(payload BLOB);
             WITH RECURSIVE sequence(i) AS (
                 VALUES(1) UNION ALL SELECT i + 1 FROM sequence WHERE i < 700
             )
             INSERT INTO rebuildable SELECT randomblob(4000) FROM sequence;
             DELETE FROM rebuildable;",
        )
        .expect("seed free pages");
        let page_count = || {
            conn.pragma_query_value(None, "page_count", |row| row.get::<_, u64>(0))
                .unwrap()
        };
        let starting_pages = page_count();
        reclaim_free_pages(&conn).expect("reclaim one batch");
        let reclaimed = starting_pages - page_count();
        assert!(
            reclaimed >= RECLAIM_PAGE_BATCH,
            "reclaimed {reclaimed} pages"
        );
        // SQLite may also remove a pointer-map page when the batch crosses its boundary.
        assert!(
            reclaimed <= RECLAIM_PAGE_BATCH + 1,
            "reclaimed {reclaimed} pages"
        );
        assert!(
            conn.pragma_query_value(None, "freelist_count", |row| row.get::<_, u64>(0))
                .unwrap()
                > 0
        );
    }
}
