use crate::commands::git_metadata::{is_release_tag, read_git_tags};
use crate::commands::history_evidence::refresh_builtin_adapters;
use crate::commands::structural_graph::analysis::StructuralGraphAnalysisSummary;
use crate::commands::structural_graph::extract::{
    build_snapshot_from_blob_delta, build_snapshot_from_blobs, HistoricalFileBlob,
};
use crate::commands::structural_graph::query::{self, GraphProjection};
use crate::commands::structural_graph::storage::load_snapshot_by_id;
use crate::commands::structural_graph::types::stable_graph_id;
use crate::commands::structural_graph::types::{
    GraphSourceAnchor, GraphTrust, StructuralGraphCancellation, StructuralGraphCommunity,
    StructuralGraphCoverage, StructuralGraphDiagnostic, StructuralGraphEdge,
    StructuralGraphFileRecord, StructuralGraphNode, StructuralGraphProgress,
    StructuralGraphSnapshot, BUNDLED_ENGINE_ID, BUNDLED_ENGINE_VERSION,
    STRUCTURAL_GRAPH_SCHEMA_VERSION,
};
use crate::DbState;
use chrono::Utc;
use flate2::{read::ZlibDecoder, write::ZlibEncoder, Compression};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{Emitter, State};

const DEFAULT_HISTORY_LIMIT: usize = 250;
const MAX_HISTORY_LIMIT: usize = 2_000;
const DEFAULT_GRAPH_LIMIT: usize = 360;
const MAX_GRAPH_LIMIT: usize = 1_500;
const MAX_HISTORICAL_FILES: usize = 25_000;
const MAX_HISTORICAL_BLOB_BYTES: usize = 2 * 1024 * 1024;

static ACTIVE_HISTORY_BACKFILLS: OnceLock<Mutex<HashMap<String, StructuralGraphCancellation>>> =
    OnceLock::new();

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn malloc_zone_pressure_relief(zone: *mut std::ffi::c_void, goal: usize) -> usize;
}

fn active_history_backfills() -> &'static Mutex<HashMap<String, StructuralGraphCancellation>> {
    ACTIVE_HISTORY_BACKFILLS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn release_history_allocator_pressure() {
    #[cfg(target_os = "macos")]
    unsafe {
        malloc_zone_pressure_relief(std::ptr::null_mut(), 0);
    }
    #[cfg(target_os = "linux")]
    unsafe {
        libc::malloc_trim(0);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryRevision {
    pub sha: String,
    pub short_sha: String,
    pub parents: Vec<String>,
    pub committed_at: String,
    pub author: String,
    pub subject: String,
    pub tags: Vec<String>,
    pub is_release: bool,
    pub is_head: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryTimeline {
    pub schema_version: i64,
    pub repo_path: String,
    pub head: String,
    pub generated_at: String,
    pub revisions: Vec<HistoryRevision>,
    pub total_commits: usize,
    pub truncated: bool,
    pub is_shallow: bool,
    pub coverage_complete: bool,
    pub release_ranges: Vec<HistoryReleaseRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryReleaseRange {
    pub id: String,
    pub label: String,
    pub tag: Option<String>,
    pub from_exclusive: Option<String>,
    pub to_inclusive: String,
    pub commit_shas: Vec<String>,
    pub is_unreleased: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistorySearchResult {
    pub revisions: Vec<HistoryRevision>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryTopologyNode {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub path: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryTopologyEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryTopology {
    pub schema_version: i64,
    pub repo_path: String,
    pub revision: String,
    pub nodes: Vec<HistoryTopologyNode>,
    pub edges: Vec<HistoryTopologyEdge>,
    pub changed_paths: Vec<String>,
    pub path_changes: Vec<HistoryPathChange>,
    pub total_files: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryPathChange {
    pub path: String,
    pub change_kind: String,
    pub old_path: Option<String>,
    pub additions: Option<usize>,
    pub deletions: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryStructuralState {
    pub schema_version: i64,
    pub repo_path: String,
    pub revision: String,
    pub snapshot_id: String,
    pub cached: bool,
    pub projection: GraphProjection,
    pub analysis: StructuralGraphAnalysisSummary,
    pub changed_paths: Vec<String>,
    pub path_changes: Vec<HistoryPathChange>,
    pub indexed_files: usize,
    pub node_count: usize,
    pub edge_count: usize,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HistoryStructuralDelta {
    pub schema_version: i64,
    #[serde(default)]
    pub materialization_version: i64,
    pub repo_path: String,
    pub before_revision: String,
    pub after_revision: String,
    pub before_snapshot_id: String,
    pub after_snapshot_id: String,
    pub added_node_ids: Vec<String>,
    pub removed_node_ids: Vec<String>,
    pub changed_node_ids: Vec<String>,
    pub added_edge_ids: Vec<String>,
    pub removed_edge_ids: Vec<String>,
    pub changed_edge_ids: Vec<String>,
    pub added_community_ids: Vec<String>,
    pub removed_community_ids: Vec<String>,
    pub added_hub_ids: Vec<String>,
    pub removed_hub_ids: Vec<String>,
    pub added_bridge_ids: Vec<String>,
    pub removed_bridge_ids: Vec<String>,
    pub path_changes: Vec<HistoryPathChange>,
    pub lineage: Vec<HistoryLineageEdge>,
    pub coverage_gap: Option<String>,
    pub generated_at: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub upsert_nodes: Vec<StructuralGraphNode>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub upsert_edges: Vec<StructuralGraphEdge>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub upsert_communities: Vec<StructuralGraphCommunity>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub upsert_files: Vec<StructuralGraphFileRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub removed_file_paths: Vec<String>,
    #[serde(default)]
    pub after_coverage: StructuralGraphCoverage,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub after_diagnostics: Vec<StructuralGraphDiagnostic>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_ignore_fingerprint: Option<String>,
    #[serde(default)]
    pub after_truncated: bool,
    #[serde(default)]
    pub after_created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryLineageEdge {
    pub id: String,
    pub from_entity_id: String,
    pub to_entity_id: String,
    pub relation: String,
    pub trust: GraphTrust,
    pub evidence: String,
    pub sources: Vec<GraphSourceAnchor>,
    pub candidates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryEntityMoment {
    pub revision_sha: String,
    pub committed_at: String,
    pub ordinal: i64,
    pub entity_id: String,
    pub label: String,
    pub kind: String,
    pub path: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryEntityEvolution {
    pub schema_version: i64,
    pub repo_path: String,
    pub resolved_revision: String,
    pub entity_id: String,
    pub entity_label: String,
    pub entity_kind: String,
    pub lineage: Vec<HistoryLineageEdge>,
    pub occurrences: Vec<HistoryEntityMoment>,
    pub first_seen: Option<HistoryEntityMoment>,
    pub last_changed: Option<HistoryEntityMoment>,
    pub last_present: Option<HistoryEntityMoment>,
    pub indexed_head: String,
    pub stale: bool,
    pub coverage_gap: Option<String>,
    pub truncated: bool,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HistoryTemporalReference {
    Revision { revision: String },
    Release { tag: String },
    Date { at: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryAsOfState {
    pub requested: HistoryTemporalReference,
    pub resolved_revision: String,
    pub committed_at: String,
    pub exact: bool,
    pub state: HistoryStructuralState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryBackfillProgress {
    pub phase: String,
    pub completed: usize,
    pub total: usize,
    pub revision: Option<String>,
    pub detail: String,
    pub eta_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryBackfillResult {
    pub repo_path: String,
    pub total: usize,
    pub completed: usize,
    pub built: usize,
    pub cache_hits: usize,
    pub cancelled: bool,
    pub release_checkpoints: usize,
    pub coverage_complete: bool,
    pub refresh_kind: String,
    pub invalidated: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryGraphStatus {
    pub repo_path: String,
    pub indexed: bool,
    pub backfilling: bool,
    pub stale: bool,
    pub current_head: String,
    pub indexed_head: Option<String>,
    pub checkpoint_count: usize,
    pub event_count: usize,
    pub coverage: Value,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HistoryFacetStatus {
    Evidenced,
    QualifiedLead,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryFacet {
    pub name: String,
    pub status: HistoryFacetStatus,
    pub summary: String,
    pub trust: GraphTrust,
    pub sources: Vec<GraphSourceAnchor>,
    pub event_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryFacetPacket {
    pub schema_version: i64,
    pub repo_path: String,
    pub as_of_revision: String,
    pub entity_id: String,
    pub entity_label: String,
    pub entity_kind: String,
    pub facets: Vec<HistoryFacet>,
    pub gaps: Vec<String>,
    pub contradictions: Vec<String>,
    pub trust_summary: BTreeMap<String, usize>,
    pub indexed_head: String,
    pub stale: bool,
    pub truncated: bool,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HistoryAnnotationDecision {
    Note,
    Confirm,
    Reject,
    Correction,
}

impl HistoryAnnotationDecision {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Note => "note",
            Self::Confirm => "confirm",
            Self::Reject => "reject",
            Self::Correction => "correction",
        }
    }

    pub(crate) fn from_storage(value: &str) -> Self {
        match value {
            "confirm" => Self::Confirm,
            "reject" => Self::Reject,
            "correction" => Self::Correction,
            _ => Self::Note,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryAnnotation {
    pub id: String,
    pub repo_path: String,
    pub revision_sha: Option<String>,
    pub entity_id: Option<String>,
    pub author: String,
    pub body: String,
    pub decision: HistoryAnnotationDecision,
    pub related_event_id: Option<String>,
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryAnnotationPage {
    pub annotations: Vec<HistoryAnnotation>,
    pub truncated: bool,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct GitTreeEntry {
    object_id: String,
    path: String,
}

struct HistoricalBlobBatch {
    blobs: Vec<HistoricalFileBlob>,
    discovered_files: usize,
    truncated: bool,
}

struct GitObjectReader<'a> {
    root: &'a Path,
}

impl<'a> GitObjectReader<'a> {
    fn new(root: &'a Path) -> Self {
        Self { root }
    }

    #[cfg(test)]
    fn blobs_at(&self, revision: &str) -> Result<Vec<HistoricalFileBlob>, String> {
        Ok(self.blobs_at_with_coverage(revision)?.blobs)
    }

    fn blobs_at_with_coverage(&self, revision: &str) -> Result<HistoricalBlobBatch, String> {
        let revision = resolve_revision(self.root, revision)?;
        let tree = git_bytes(self.root, &["ls-tree", "-r", "-z", &revision])?;
        let mut entries = tree
            .split(|byte| *byte == 0)
            .filter(|record| !record.is_empty())
            .filter_map(parse_tree_entry)
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| left.path.cmp(&right.path));
        let discovered_files = entries.len();
        let truncated = discovered_files > MAX_HISTORICAL_FILES;
        entries.truncate(MAX_HISTORICAL_FILES);
        Ok(HistoricalBlobBatch {
            blobs: self.read_batch(&entries)?,
            discovered_files,
            truncated,
        })
    }

    fn blobs_for_paths(
        &self,
        revision: &str,
        paths: &[String],
    ) -> Result<Vec<HistoricalFileBlob>, String> {
        if paths.is_empty() {
            return Ok(Vec::new());
        }
        let revision = resolve_revision(self.root, revision)?;
        let mut arguments = vec!["ls-tree", "-r", "-z", revision.as_str(), "--"];
        arguments.extend(paths.iter().map(String::as_str));
        let tree = git_bytes(self.root, &arguments)?;
        let mut entries = tree
            .split(|byte| *byte == 0)
            .filter(|record| !record.is_empty())
            .filter_map(parse_tree_entry)
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| left.path.cmp(&right.path));
        entries.dedup_by(|left, right| left.path == right.path);
        self.read_batch(&entries)
    }

    fn read_batch(&self, entries: &[GitTreeEntry]) -> Result<Vec<HistoricalFileBlob>, String> {
        let mut child = Command::new("git")
            .arg("-C")
            .arg(self.root)
            .args(["cat-file", "--batch"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Start Git object reader: {error}"))?;
        {
            let stdin = child
                .stdin
                .as_mut()
                .ok_or_else(|| "Git object reader stdin is unavailable".to_string())?;
            for entry in entries {
                writeln!(stdin, "{}", entry.object_id)
                    .map_err(|error| format!("Queue Git object: {error}"))?;
            }
        }
        drop(child.stdin.take());
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Git object reader stdout is unavailable".to_string())?;
        let mut reader = BufReader::new(stdout);
        let mut blobs = Vec::with_capacity(entries.len());
        for entry in entries {
            let mut header = String::new();
            reader
                .read_line(&mut header)
                .map_err(|error| format!("Read Git object header: {error}"))?;
            let fields = header.split_whitespace().collect::<Vec<_>>();
            if fields.len() != 3 || fields[1] != "blob" {
                return Err(format!(
                    "Git object {} is unavailable or is not a blob",
                    entry.object_id
                ));
            }
            let size = fields[2]
                .parse::<usize>()
                .map_err(|error| format!("Invalid Git object size: {error}"))?;
            let bytes = if size <= MAX_HISTORICAL_BLOB_BYTES {
                let mut bytes = vec![0; size];
                reader
                    .read_exact(&mut bytes)
                    .map_err(|error| format!("Read Git object content: {error}"))?;
                bytes
            } else {
                std::io::copy(&mut reader.by_ref().take(size as u64), &mut std::io::sink())
                    .map_err(|error| format!("Skip oversized Git object: {error}"))?;
                vec![0; MAX_HISTORICAL_BLOB_BYTES + 1]
            };
            let mut newline = [0_u8; 1];
            reader
                .read_exact(&mut newline)
                .map_err(|error| format!("Read Git object delimiter: {error}"))?;
            blobs.push(HistoricalFileBlob {
                path: entry.path.clone(),
                bytes,
            });
        }
        let status = child
            .wait()
            .map_err(|error| format!("Wait for Git object reader: {error}"))?;
        if !status.success() {
            return Err("Git object reader failed".to_string());
        }
        Ok(blobs)
    }
}

fn parse_tree_entry(record: &[u8]) -> Option<GitTreeEntry> {
    let tab = record.iter().position(|byte| *byte == b'\t')?;
    let header = String::from_utf8_lossy(&record[..tab]);
    let fields = header.split_whitespace().collect::<Vec<_>>();
    if fields.len() != 3 || fields[1] != "blob" {
        return None;
    }
    Some(GitTreeEntry {
        object_id: fields[2].to_string(),
        path: String::from_utf8_lossy(&record[tab + 1..]).replace('\\', "/"),
    })
}

#[tauri::command]
pub async fn get_history_timeline(
    repo_path: String,
    limit: Option<usize>,
    _db: State<'_, DbState>,
) -> Result<HistoryTimeline, String> {
    let root = canonical_repo_path(&repo_path)?;
    tokio::task::spawn_blocking(move || build_timeline(&root, limit))
        .await
        .map_err(|error| format!("History timeline worker failed: {error}"))?
}

#[tauri::command]
pub async fn backfill_history_graph(
    repo_path: String,
    recent_commit_limit: Option<usize>,
    app: tauri::AppHandle,
    db: State<'_, DbState>,
) -> Result<HistoryBackfillResult, String> {
    let root = canonical_repo_path(&repo_path)?;
    let canonical = root.to_string_lossy().to_string();
    let storage_key = history_storage_key(&canonical);
    let cancellation = StructuralGraphCancellation::default();
    {
        let mut active = active_history_backfills()
            .lock()
            .map_err(|_| "History backfill registry is unavailable".to_string())?;
        if active.contains_key(&canonical) {
            return Err("A history backfill is already running for this repository".to_string());
        }
        active.insert(canonical.clone(), cancellation.clone());
    }
    let database = Arc::clone(&db.0);
    let cleanup_key = canonical.clone();
    let worker = tokio::task::spawn_blocking(move || {
        let recent_limit = recent_commit_limit
            .unwrap_or(500)
            .clamp(1, MAX_HISTORY_LIMIT);
        let timeline = build_timeline(&root, Some(recent_limit))?;
        let tag_fingerprint = repository_tag_fingerprint(&root)?;
        let (previous_head, previous_tag_fingerprint) = {
            let connection = database
                .lock()
                .map_err(|_| "History database is unavailable".to_string())?;
            connection
                .query_row(
                    "SELECT indexed_head, indexed_tags_fingerprint
                     FROM history_graph_repositories WHERE repo_path = ?1",
                    params![canonical],
                    |row| {
                        Ok((
                            row.get::<_, Option<String>>(0)?,
                            row.get::<_, Option<String>>(1)?,
                        ))
                    },
                )
                .optional()
                .map_err(|error| format!("Load prior history cursor: {error}"))?
                .unwrap_or_default()
        };
        let rewritten = previous_head.as_deref().is_some_and(|head| {
            head != timeline.head && !git_is_ancestor(&root, head, &timeline.head)
        });
        let engine_incompatible = {
            let connection = database
                .lock()
                .map_err(|_| "History database is unavailable".to_string())?;
            has_incompatible_history_checkpoints(&connection, &canonical)?
        };
        let tags_changed = previous_tag_fingerprint
            .as_deref()
            .is_some_and(|fingerprint| fingerprint != tag_fingerprint.as_str());
        let fast_forward = previous_head.as_deref().is_some_and(|head| {
            head != timeline.head && git_is_ancestor(&root, head, &timeline.head)
        });
        let refresh_kind = classify_history_refresh(
            previous_head.as_deref(),
            rewritten,
            engine_incompatible,
            fast_forward,
            tags_changed,
        )
        .to_string();
        let mut invalidated = 0;
        {
            let mut connection = database
                .lock()
                .map_err(|_| "History database is unavailable".to_string())?;
            refresh_builtin_adapters(&mut connection, &root)?;
        }
        let mut targets = Vec::new();
        let mut seen = HashSet::new();
        if refresh_kind != "no_op" && seen.insert(timeline.head.clone()) {
            targets.push(timeline.head.clone());
        }
        let releases = reachable_release_revisions(&root)?;
        let release_checkpoints = releases.len();
        for revision in releases {
            let should_schedule = refresh_kind != "no_op"
                && (refresh_kind != "tag_metadata" || {
                    let connection = database
                        .lock()
                        .map_err(|_| "History database is unavailable".to_string())?;
                    !compatible_history_checkpoint_exists(&connection, &canonical, &revision)?
                });
            if should_schedule && seen.insert(revision.clone()) {
                targets.push(revision);
            }
        }
        let indexed_revisions = timeline
            .revisions
            .iter()
            .map(|revision| revision.sha.as_str())
            .collect::<HashSet<_>>();
        if refresh_kind != "no_op" {
            for revision in &timeline.revisions {
                let materialization_parent = revision.parents.first();
                if materialization_parent
                    .is_none_or(|parent| !indexed_revisions.contains(parent.as_str()))
                    && seen.insert(revision.sha.clone())
                {
                    targets.push(revision.sha.clone());
                }
            }
        }
        let checkpoint_total = targets.len();
        let delta_pairs = if matches!(
            refresh_kind.as_str(),
            "initial" | "rewritten_history" | "engine_repair" | "fast_forward"
        ) {
            timeline
                .revisions
                .iter()
                .filter_map(|revision| {
                    revision.parents.first().and_then(|parent| {
                        indexed_revisions
                            .contains(parent.as_str())
                            .then(|| (parent.clone(), revision.sha.clone()))
                    })
                })
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        let delta_total = delta_pairs.len();
        let total = checkpoint_total + delta_total;
        let started = std::time::Instant::now();
        let mut completed = 0;
        let mut checkpoint_completed = 0;
        let mut delta_completed = 0;
        let mut built = 0;
        let mut cache_hits = 0;
        let checkpoint_targets = targets.iter().cloned().collect::<HashSet<_>>();
        for revision in &targets {
            if cancellation.is_cancelled() {
                break;
            }
            let _ = app.emit(
                "history-backfill-progress",
                HistoryBackfillProgress {
                    phase: "checkpoint".to_string(),
                    completed,
                    total,
                    revision: Some(revision.clone()),
                    detail: "Building exact structural checkpoint from Git objects".to_string(),
                    eta_ms: estimate_eta_ms(started, completed, total),
                },
            );
            let (_, cached) = load_or_build_history_snapshot(
                &root,
                &canonical,
                &storage_key,
                revision,
                &app,
                &database,
            )?;
            if cached {
                cache_hits += 1;
            } else {
                built += 1;
            }
            completed += 1;
            checkpoint_completed += 1;
        }
        if !cancellation.is_cancelled() {
            let mut previous_snapshot: Option<(String, StructuralGraphSnapshot)> = None;
            for (before_revision, after_revision) in &delta_pairs {
                if cancellation.is_cancelled() {
                    break;
                }
                let _ = app.emit(
                    "history-backfill-progress",
                    HistoryBackfillProgress {
                        phase: "delta".to_string(),
                        completed,
                        total,
                        revision: Some(after_revision.clone()),
                        detail: "Computing structural delta and conservative entity lineage"
                            .to_string(),
                        eta_ms: estimate_eta_ms(started, completed, total),
                    },
                );
                let before = if previous_snapshot
                    .as_ref()
                    .is_some_and(|(revision, _)| revision == before_revision)
                {
                    previous_snapshot
                        .take()
                        .map(|(_, snapshot)| snapshot)
                        .expect("checked previous history snapshot")
                } else {
                    load_or_build_history_snapshot(
                        &root,
                        &canonical,
                        &storage_key,
                        before_revision,
                        &app,
                        &database,
                    )?
                    .0
                };
                let cached_delta = {
                    let connection = database
                        .lock()
                        .map_err(|_| "History database is unavailable".to_string())?;
                    load_history_structural_delta(
                        &connection,
                        &canonical,
                        before_revision,
                        after_revision,
                    )?
                };
                if let Some(delta) = cached_delta.filter(|delta| {
                    delta.materialization_version == 1 && delta.before_snapshot_id == before.id
                }) {
                    let after = apply_structural_delta(before, &delta)?;
                    previous_snapshot = Some((after_revision.clone(), after));
                    completed += 1;
                    delta_completed += 1;
                    cache_hits += 1;
                    continue;
                }
                let path_changes =
                    changed_path_records_between(&root, before_revision, after_revision)?;
                let after = if checkpoint_targets.contains(after_revision) {
                    load_or_build_history_snapshot(
                        &root,
                        &canonical,
                        &storage_key,
                        after_revision,
                        &app,
                        &database,
                    )?
                    .0
                } else {
                    build_history_snapshot_from_previous(
                        &root,
                        &storage_key,
                        after_revision,
                        &before,
                        &path_changes,
                        &app,
                    )?
                };
                let connection = database
                    .lock()
                    .map_err(|_| "History database is unavailable".to_string())?;
                ensure_history_revision(&connection, &root, &canonical, after_revision)?;
                compute_and_persist_structural_delta_with_paths(
                    &connection,
                    &canonical,
                    before_revision,
                    after_revision,
                    &before,
                    &after,
                    path_changes,
                )?;
                drop(connection);
                previous_snapshot = Some((after_revision.clone(), after));
                completed += 1;
                delta_completed += 1;
                if delta_completed % 4 == 0 {
                    release_history_allocator_pressure();
                }
            }
            release_history_allocator_pressure();
        }
        let cancelled = cancellation.is_cancelled();
        let coverage_complete = !cancelled && timeline.coverage_complete && completed == total;
        if !cancelled {
            let connection = database
                .lock()
                .map_err(|_| "History database is unavailable".to_string())?;
            persist_timeline_catalog(&connection, &timeline)?;
            let publication = connection
                .unchecked_transaction()
                .map_err(|error| format!("Start history publication transaction: {error}"))?;
            invalidated += prune_unreachable_history(&publication, &root, &canonical)?;
            invalidated += prune_incompatible_history_checkpoints(&publication, &canonical)?;
            let cursor_json =
                history_adapter_cursor_json(&publication, &canonical, &timeline.head)?;
            publication
                .execute(
                    "UPDATE history_graph_repositories
                     SET indexed_head = ?2, indexed_tags_fingerprint = ?3,
                         status = 'ready', cursor_json = ?4, coverage_json = ?5, updated_at = ?6
                     WHERE repo_path = ?1",
                    params![
                        canonical,
                        timeline.head,
                        tag_fingerprint,
                        cursor_json,
                        serde_json::json!({
                            "checkpoint_total": checkpoint_total,
                            "checkpoint_completed": checkpoint_completed,
                            "checkpoint_cache_hits": cache_hits,
                            "delta_total": delta_total,
                            "delta_completed": delta_completed,
                            "recent_commit_limit": recent_limit,
                            "is_shallow": timeline.is_shallow,
                            "history_truncated": timeline.truncated,
                            "coverage_complete": coverage_complete,
                            "refresh_kind": refresh_kind.clone(),
                            "invalidated": invalidated,
                        })
                        .to_string(),
                        Utc::now().to_rfc3339(),
                    ],
                )
                .map_err(|error| format!("Update history backfill coverage: {error}"))?;
            publication
                .commit()
                .map_err(|error| format!("Publish history backfill: {error}"))?;
        }
        let _ = app.emit(
            "history-backfill-progress",
            HistoryBackfillProgress {
                phase: if cancelled { "cancelled" } else { "complete" }.to_string(),
                completed,
                total,
                revision: None,
                detail: if cancelled {
                    "Backfill stopped after the current checkpoint"
                } else {
                    "History checkpoints and structural deltas are ready"
                }
                .to_string(),
                eta_ms: Some(0),
            },
        );
        Ok(HistoryBackfillResult {
            repo_path: canonical,
            total,
            completed,
            built,
            cache_hits,
            cancelled,
            release_checkpoints,
            coverage_complete,
            refresh_kind,
            invalidated,
        })
    })
    .await;
    if let Ok(mut active) = active_history_backfills().lock() {
        active.remove(&cleanup_key);
    }
    worker.map_err(|error| format!("History backfill worker failed: {error}"))?
}

#[tauri::command]
pub fn cancel_history_backfill(repo_path: String) -> Result<bool, String> {
    let canonical = canonical_repo_path(&repo_path)?
        .to_string_lossy()
        .to_string();
    let active = active_history_backfills()
        .lock()
        .map_err(|_| "History backfill registry is unavailable".to_string())?;
    if let Some(cancellation) = active.get(&canonical) {
        cancellation.cancel();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn get_history_graph_status(
    repo_path: String,
    db: State<'_, DbState>,
) -> Result<HistoryGraphStatus, String> {
    let root = canonical_repo_path(&repo_path)?;
    let canonical = root.to_string_lossy().to_string();
    let current_head = git_text(&root, &["rev-parse", "HEAD"])?;
    let backfilling = active_history_backfills()
        .lock()
        .map(|active| active.contains_key(&canonical))
        .unwrap_or(false);
    let database = Arc::clone(&db.0);
    tokio::task::spawn_blocking(move || {
        let connection = database
            .lock()
            .map_err(|_| "History database is unavailable".to_string())?;
        let stored = connection
            .query_row(
                "SELECT indexed_head, coverage_json, updated_at,
                    (SELECT COUNT(*) FROM history_graph_checkpoints c WHERE c.repo_path = r.repo_path),
                    (SELECT COUNT(*) FROM history_graph_events e WHERE e.repo_path = r.repo_path)
                 FROM history_graph_repositories r WHERE repo_path = ?1",
                params![canonical],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("Load history status: {error}"))?;
        let (indexed_head, coverage, updated_at, checkpoints, events) = stored
            .map(|(head, coverage, updated, checkpoints, events)| {
                (
                    head,
                    serde_json::from_str(&coverage).unwrap_or(Value::Object(Default::default())),
                    updated,
                    checkpoints.max(0) as usize,
                    events.max(0) as usize,
                )
            })
            .unwrap_or((
                None,
                Value::Object(Default::default()),
                None,
                0,
                0,
            ));
        Ok(HistoryGraphStatus {
            repo_path: canonical,
            indexed: indexed_head.is_some(),
            backfilling,
            stale: indexed_head.as_deref() != Some(current_head.as_str()),
            current_head,
            indexed_head,
            checkpoint_count: checkpoints,
            event_count: events,
            coverage,
            updated_at,
        })
    })
    .await
    .map_err(|error| format!("History status worker failed: {error}"))?
}

#[tauri::command]
pub async fn explain_history_entity(
    repo_path: String,
    entity: String,
    revision: Option<String>,
    app: tauri::AppHandle,
    db: State<'_, DbState>,
) -> Result<HistoryFacetPacket, String> {
    let root = canonical_repo_path(&repo_path)?;
    let canonical = root.to_string_lossy().to_string();
    let revision = resolve_revision(&root, revision.as_deref().unwrap_or("HEAD"))?;
    let current_head = git_text(&root, &["rev-parse", "HEAD"])?;
    let storage_key = history_storage_key(&canonical);
    let database = Arc::clone(&db.0);
    tokio::task::spawn_blocking(move || {
        let (snapshot, _) = load_or_build_history_snapshot(
            &root,
            &canonical,
            &storage_key,
            &revision,
            &app,
            &database,
        )?;
        let node = query::resolve_node(&snapshot, &entity)?.clone();
        let related_edges = snapshot
            .edges
            .iter()
            .filter(|edge| edge.from == node.id || edge.to == node.id)
            .collect::<Vec<_>>();
        let relation_kinds = {
            let mut kinds = related_edges
                .iter()
                .map(|edge| edge.kind.clone())
                .collect::<Vec<_>>();
            kinds.sort();
            kinds.dedup();
            kinds
        };
        let path_history = node
            .path
            .as_deref()
            .map(|path| git_path_history(&root, &revision, path))
            .transpose()?
            .unwrap_or_default();
        let mut facets = Vec::new();
        facets.push(HistoryFacet {
            name: "what".to_string(),
            status: HistoryFacetStatus::Evidenced,
            summary: format!(
                "{} `{}` is present in the exact structural checkpoint with {} local relationship kinds{}",
                node.kind,
                node.label,
                relation_kinds.len(),
                if !relation_kinds.is_empty() { format!(": {}", relation_kinds.join(", ")) } else { Default::default() }
            ),
            trust: node.trust,
            sources: node.sources.clone(),
            event_ids: Vec::new(),
        });
        if let Some((sha, _, subject)) = path_history.last() {
            facets.push(HistoryFacet {
                name: "why".to_string(),
                status: HistoryFacetStatus::QualifiedLead,
                summary: format!(
                    "Latest path-changing commit {} says: {}. The subject is intent evidence, not proof of runtime behavior.",
                    &sha[..sha.len().min(8)], subject
                ),
                trust: GraphTrust::Inferred,
                sources: node.sources.clone(),
                event_ids: Vec::new(),
            });
        } else {
            facets.push(unknown_facet(
                "why",
                "No local intent evidence is linked to this entity",
            ));
        }
        if let (Some(first), Some(last)) = (path_history.first(), path_history.last()) {
            facets.push(HistoryFacet {
                name: "when".to_string(),
                status: HistoryFacetStatus::Evidenced,
                summary: format!(
                    "The current path first appears in local Git history at {} and was last changed at {}",
                    first.1, last.1
                ),
                trust: GraphTrust::Extracted,
                sources: node.sources.clone(),
                event_ids: Vec::new(),
            });
        } else {
            facets.push(unknown_facet(
                "when",
                "No bounded Git path history is available for this entity",
            ));
        }
        facets.push(if related_edges.is_empty() {
            unknown_facet("how", "No structural relationships explain how this entity participates")
        } else {
            HistoryFacet {
                name: "how".to_string(),
                status: HistoryFacetStatus::Evidenced,
                summary: format!(
                    "The local graph connects this entity through: {}",
                    relation_kinds.join(", ")
                ),
                trust: if related_edges
                    .iter()
                    .all(|edge| edge.trust == GraphTrust::Extracted)
                {
                    GraphTrust::Extracted
                } else {
                    GraphTrust::Inferred
                },
                sources: related_edges
                    .iter()
                    .flat_map(|edge| edge.sources.iter().cloned())
                    .take(20)
                    .collect(),
                event_ids: Vec::new(),
            }
        });
        let verification_edges = related_edges
            .iter()
            .filter(|edge| {
                matches!(
                    edge.kind.as_str(),
                    "tests" | "tested_by" | "verifies" | "covered_by"
                )
            })
            .collect::<Vec<_>>();
        facets.push(if verification_edges.is_empty() {
            unknown_facet(
                "verification",
                "No source-backed test or verification relationship is linked locally",
            )
        } else {
            HistoryFacet {
                name: "verification".to_string(),
                status: HistoryFacetStatus::Evidenced,
                summary: format!(
                    "{} local verification relationship(s) are linked",
                    verification_edges.len()
                ),
                trust: GraphTrust::Inferred,
                sources: verification_edges
                    .iter()
                    .flat_map(|edge| edge.sources.iter().cloned())
                    .collect(),
                event_ids: Vec::new(),
            }
        });
        let (outcomes, contradictions, indexed_head, stale, _) = {
            let connection = database
                .lock()
                .map_err(|_| "History database is unavailable".to_string())?;
            let outcomes = load_outcome_events(&connection, &canonical, &node.id)?;
            let contradictions =
                load_entity_annotation_contradictions(&connection, &canonical, &node.id)?;
            let (indexed_head, stale, coverage) =
                history_index_freshness(&connection, &canonical, &current_head)?;
            (outcomes, contradictions, indexed_head, stale, coverage)
        };
        facets.push(if outcomes.is_empty() {
            unknown_facet(
                "outcome",
                if node.kind == "analytics_event" {
                    "Code emission is evidenced, but provider ingestion/delivery is unknown without a configured local provider export"
                } else {
                    "No local deploy, runtime, incident, analytics, or observed-outcome evidence is linked"
                },
            )
        } else {
            HistoryFacet {
                name: "outcome".to_string(),
                status: HistoryFacetStatus::Evidenced,
                summary: format!("{} local observed outcome event(s) are linked", outcomes.len()),
                trust: outcomes
                    .iter()
                    .map(|(_, _, trust)| *trust)
                    .min_by_key(|trust| match trust {
                        GraphTrust::Extracted => 0,
                        GraphTrust::Inferred => 1,
                        GraphTrust::Ambiguous => 2,
                        GraphTrust::Legacy => 3,
                    })
                    .unwrap_or(GraphTrust::Inferred),
                sources: Vec::new(),
                event_ids: outcomes.into_iter().map(|(id, _, _)| id).collect(),
            }
        });
        let gaps = facets
            .iter()
            .filter(|facet| facet.status == HistoryFacetStatus::Unknown)
            .map(|facet| format!("{}: {}", facet.name, facet.summary))
            .collect();
        let mut trust_summary = BTreeMap::new();
        for facet in &facets {
            *trust_summary
                .entry(facet.trust.as_str().to_string())
                .or_default() += 1;
        }
        Ok(HistoryFacetPacket {
            schema_version: 1,
            repo_path: canonical,
            as_of_revision: revision,
            entity_id: node.id,
            entity_label: node.label,
            entity_kind: node.kind,
            facets,
            gaps,
            contradictions,
            trust_summary,
            stale,
            indexed_head,
            truncated: false,
            next_cursor: None,
        })
    })
    .await
    .map_err(|error| format!("History entity explanation worker failed: {error}"))?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn add_history_annotation(
    repo_path: String,
    revision_sha: Option<String>,
    entity_id: Option<String>,
    author: String,
    body: String,
    decision: HistoryAnnotationDecision,
    related_event_id: Option<String>,
    db: State<'_, DbState>,
) -> Result<HistoryAnnotation, String> {
    let root = canonical_repo_path(&repo_path)?;
    let canonical = root.to_string_lossy().to_string();
    let revision_sha = revision_sha
        .as_deref()
        .map(|revision| resolve_revision(&root, revision))
        .transpose()?;
    let author = author.trim().to_string();
    let body = body.trim().to_string();
    if author.is_empty() || author.len() > 120 {
        return Err("Annotation author must be between 1 and 120 bytes".to_string());
    }
    if body.is_empty() || body.len() > 20_000 {
        return Err("Annotation body must be between 1 and 20,000 bytes".to_string());
    }
    let entity_id = entity_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let related_event_id = related_event_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let database = Arc::clone(&db.0);
    tokio::task::spawn_blocking(move || {
        let id = format!("annotation:{}", uuid::Uuid::new_v4());
        let event_id = stable_graph_id("history-annotation-event", &id);
        let now = Utc::now().to_rfc3339();
        let source = "local_user".to_string();
        let mut connection = database
            .lock()
            .map_err(|_| "History database is unavailable".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Start annotation transaction: {error}"))?;
        transaction
            .execute(
                "INSERT OR IGNORE INTO history_graph_repositories (
                    repo_path, repository_fingerprint, status, created_at, updated_at
                 ) VALUES (?1, ?2, 'pending', ?3, ?3)",
                params![canonical, stable_graph_id("repository", &canonical), now],
            )
            .map_err(|error| format!("Ensure annotation repository: {error}"))?;
        if let Some(target_event_id) = related_event_id.as_deref() {
            let exists = transaction
                .query_row(
                    "SELECT 1 FROM history_graph_events WHERE repo_path = ?1 AND id = ?2",
                    params![canonical, target_event_id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|error| format!("Validate annotation evidence target: {error}"))?
                .is_some();
            if !exists {
                return Err(
                    "The annotation evidence target does not exist in this repository".to_string(),
                );
            }
        }
        transaction
            .execute(
                "INSERT INTO history_graph_annotations (
                    id, repo_path, revision_sha, entity_id, author, body, decision,
                    related_event_id, source, metadata_json, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '{}', ?10)",
                params![
                    id,
                    canonical,
                    revision_sha,
                    entity_id,
                    author,
                    body,
                    decision.as_str(),
                    related_event_id,
                    source,
                    now,
                ],
            )
            .map_err(|error| format!("Persist history annotation: {error}"))?;
        transaction
            .execute(
                "INSERT INTO history_graph_events (
                    id, repo_path, revision_sha, event_kind, entity_id, trust, origin,
                    source_id, source_cursor, payload_json, evidence_json, recorded_at
                 ) VALUES (?1, ?2, ?3, 'user_annotation', ?4, 'extracted',
                    'user_annotation', ?5, ?5, ?6, '[]', ?7)",
                params![
                    event_id,
                    canonical,
                    revision_sha,
                    entity_id,
                    id,
                    serde_json::json!({
                        "annotation_id": id,
                        "decision": decision.as_str(),
                        "summary": body,
                        "related_event_id": related_event_id,
                    })
                    .to_string(),
                    now,
                ],
            )
            .map_err(|error| format!("Append annotation evidence event: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Commit history annotation: {error}"))?;
        Ok(HistoryAnnotation {
            id,
            repo_path: canonical,
            revision_sha,
            entity_id,
            author,
            body,
            decision,
            related_event_id,
            source,
            created_at: now,
        })
    })
    .await
    .map_err(|error| format!("History annotation worker failed: {error}"))?
}

#[tauri::command]
pub async fn list_history_annotations(
    repo_path: String,
    revision_sha: Option<String>,
    entity_id: Option<String>,
    limit: Option<usize>,
    cursor: Option<String>,
    db: State<'_, DbState>,
) -> Result<HistoryAnnotationPage, String> {
    let canonical = canonical_repo_path(&repo_path)?
        .to_string_lossy()
        .to_string();
    let limit = limit.unwrap_or(25).clamp(1, 100);
    let cursor = cursor
        .as_deref()
        .map(decode_annotation_cursor)
        .transpose()?;
    let database = Arc::clone(&db.0);
    tokio::task::spawn_blocking(move || {
        let connection = database
            .lock()
            .map_err(|_| "History database is unavailable".to_string())?;
        let (cursor_time, cursor_id) = cursor
            .map(|(time, id)| (Some(time), Some(id)))
            .unwrap_or_default();
        let mut statement = connection
            .prepare(
                "SELECT id, repo_path, revision_sha, entity_id, author, body,
                        COALESCE(decision, 'note'), related_event_id, source, created_at
                 FROM history_graph_annotations
                 WHERE repo_path = ?1
                   AND (?2 IS NULL OR revision_sha = ?2)
                   AND (?3 IS NULL OR entity_id = ?3)
                   AND (?4 IS NULL OR created_at < ?4 OR (created_at = ?4 AND id < ?5))
                 ORDER BY created_at DESC, id DESC LIMIT ?6",
            )
            .map_err(|error| format!("Prepare history annotation query: {error}"))?;
        let rows = statement
            .query_map(
                params![
                    canonical,
                    revision_sha,
                    entity_id,
                    cursor_time,
                    cursor_id,
                    (limit + 1) as i64
                ],
                |row| {
                    let decision: String = row.get(6)?;
                    Ok(HistoryAnnotation {
                        id: row.get(0)?,
                        repo_path: row.get(1)?,
                        revision_sha: row.get(2)?,
                        entity_id: row.get(3)?,
                        author: row.get(4)?,
                        body: row.get(5)?,
                        decision: HistoryAnnotationDecision::from_storage(&decision),
                        related_event_id: row.get(7)?,
                        source: row.get(8)?,
                        created_at: row.get(9)?,
                    })
                },
            )
            .map_err(|error| format!("Query history annotations: {error}"))?;
        let mut annotations = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Read history annotations: {error}"))?;
        let truncated = annotations.len() > limit;
        annotations.truncate(limit);
        let next_cursor = truncated
            .then(|| annotations.last())
            .flatten()
            .map(|annotation| encode_annotation_cursor(&annotation.created_at, &annotation.id))
            .transpose()?;
        Ok(HistoryAnnotationPage {
            annotations,
            truncated,
            next_cursor,
        })
    })
    .await
    .map_err(|error| format!("History annotation query worker failed: {error}"))?
}

fn encode_annotation_cursor(created_at: &str, id: &str) -> Result<String, String> {
    serde_json::to_string(&(created_at, id)).map_err(|error| format!("Encode cursor: {error}"))
}

fn decode_annotation_cursor(cursor: &str) -> Result<(String, String), String> {
    serde_json::from_str(cursor).map_err(|_| "Invalid history annotation cursor".to_string())
}

fn unknown_facet(name: &str, summary: &str) -> HistoryFacet {
    HistoryFacet {
        name: name.to_string(),
        status: HistoryFacetStatus::Unknown,
        summary: summary.to_string(),
        trust: GraphTrust::Inferred,
        sources: Vec::new(),
        event_ids: Vec::new(),
    }
}

fn git_path_history(
    root: &Path,
    revision: &str,
    path: &str,
) -> Result<Vec<(String, String, String)>, String> {
    let output = git_text(
        root,
        &[
            "log",
            "--follow",
            "--reverse",
            "--format=%H%x1f%cI%x1f%s%x1e",
            revision,
            "--",
            path,
        ],
    )?;
    Ok(output
        .split('\u{1e}')
        .filter_map(|record| {
            let fields = record.trim().splitn(3, '\u{1f}').collect::<Vec<_>>();
            (fields.len() == 3).then(|| {
                (
                    fields[0].to_string(),
                    fields[1].to_string(),
                    fields[2].to_string(),
                )
            })
        })
        .collect())
}

pub(crate) fn load_outcome_events(
    connection: &Connection,
    repo_path: &str,
    entity_id: &str,
) -> Result<Vec<(String, String, GraphTrust)>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, event_kind, trust FROM history_graph_events
             WHERE repo_path = ?1 AND entity_id = ?2
               AND event_kind IN ('deploy', 'release', 'incident', 'observed_outcome',
                   'analytics_provider_ingestion', 'analytics_provider_delivery')
             ORDER BY recorded_at DESC, id LIMIT 100",
        )
        .map_err(|error| format!("Prepare outcome evidence query: {error}"))?;
    let outcomes = statement
        .query_map(params![repo_path, entity_id], |row| {
            let trust: String = row.get(2)?;
            Ok((row.get(0)?, row.get(1)?, GraphTrust::from_storage(&trust)))
        })
        .map_err(|error| format!("Query outcome evidence: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read outcome evidence: {error}"))?;
    Ok(outcomes)
}

pub(crate) fn load_entity_annotation_contradictions(
    connection: &Connection,
    repo_path: &str,
    entity_id: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT decision, body FROM history_graph_annotations
             WHERE repo_path = ?1 AND entity_id = ?2
               AND decision IN ('reject', 'correction')
             ORDER BY created_at DESC, id LIMIT 20",
        )
        .map_err(|error| format!("Prepare entity contradiction query: {error}"))?;
    let contradictions = statement
        .query_map(params![repo_path, entity_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("Query entity contradictions: {error}"))?
        .map(|row| {
            row.map(|(decision, body)| {
                format!(
                    "Local {decision} annotation: {}",
                    body.chars().take(500).collect::<String>()
                )
            })
            .map_err(|error| format!("Read entity contradiction: {error}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(contradictions)
}

pub(crate) fn history_index_freshness(
    connection: &Connection,
    repo_path: &str,
    current_head: &str,
) -> Result<(String, bool, Value), String> {
    let row = connection
        .query_row(
            "SELECT indexed_head, indexed_tags_fingerprint, coverage_json
             FROM history_graph_repositories
             WHERE repo_path = ?1",
            params![repo_path],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("Load history freshness: {error}"))?;
    let Some((indexed_head, indexed_tags_fingerprint, coverage_json)) = row else {
        return Ok((String::new(), true, serde_json::json!({})));
    };
    let indexed_head = indexed_head.unwrap_or_default();
    let tags_stale = repository_tag_fingerprint(Path::new(repo_path))
        .ok()
        .zip(indexed_tags_fingerprint)
        .is_some_and(|(current, indexed)| current != indexed);
    let stale = indexed_head.is_empty() || indexed_head != current_head || tags_stale;
    let coverage = serde_json::from_str(&coverage_json).unwrap_or_else(|_| serde_json::json!({}));
    Ok((indexed_head, stale, coverage))
}

pub(crate) fn load_lineage_family(
    connection: &Connection,
    repo_path: &str,
    seed_entity_id: &str,
    limit: usize,
) -> Result<(Vec<HistoryLineageEdge>, HashSet<String>, bool), String> {
    let mut statement = connection
        .prepare(
            "SELECT payload_json FROM history_graph_events
             WHERE repo_path = ?1 AND event_kind = 'entity_lineage'
               AND (entity_id = ?2 OR related_entity_id = ?2)
             ORDER BY recorded_at, id LIMIT ?3",
        )
        .map_err(|error| format!("Prepare lineage query: {error}"))?;
    let mut family = HashSet::from([seed_entity_id.to_string()]);
    let mut queue = vec![seed_entity_id.to_string()];
    let mut cursor = 0;
    let mut edges = BTreeMap::<String, HistoryLineageEdge>::new();
    let mut truncated = false;
    while cursor < queue.len() {
        if edges.len() >= limit || family.len() >= limit {
            truncated = true;
            break;
        }
        let entity_id = queue[cursor].clone();
        cursor += 1;
        let rows = statement
            .query_map(params![repo_path, entity_id, (limit + 1) as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| format!("Query entity lineage: {error}"))?;
        for payload in rows {
            let payload = payload.map_err(|error| format!("Read entity lineage: {error}"))?;
            let edge: HistoryLineageEdge = serde_json::from_str(&payload)
                .map_err(|error| format!("Decode entity lineage: {error}"))?;
            if edges.contains_key(&edge.id) {
                continue;
            }
            if edges.len() >= limit {
                truncated = true;
                break;
            }
            let mut related_ids = vec![edge.from_entity_id.clone()];
            if edge.relation != "removed_in" {
                related_ids.push(edge.to_entity_id.clone());
            }
            related_ids.extend(edge.candidates.iter().cloned());
            for related_id in related_ids {
                if family.len() >= limit {
                    truncated = true;
                    break;
                }
                if family.insert(related_id.clone()) {
                    queue.push(related_id);
                }
            }
            edges.insert(edge.id.clone(), edge);
        }
    }
    Ok((edges.into_values().collect(), family, truncated))
}

pub(crate) fn load_entity_occurrences(
    connection: &Connection,
    repo_path: &str,
    entity_ids: &HashSet<String>,
    limit: usize,
) -> Result<(Vec<HistoryEntityMoment>, bool), String> {
    let mut statement = connection
        .prepare(
            "SELECT c.revision_sha, r.committed_at, r.ordinal, n.id, n.label,
                    n.kind, n.path, n.detail
             FROM history_graph_checkpoints c
             JOIN history_graph_revisions r
               ON r.repo_path = c.repo_path AND r.sha = c.revision_sha
             JOIN structural_graph_nodes n ON n.snapshot_id = c.snapshot_id
             WHERE c.repo_path = ?1 AND c.status = 'ready' AND c.engine_id = ?2
               AND c.engine_version = ?3 AND c.schema_version = ?4 AND n.id = ?5
             ORDER BY r.ordinal, n.id",
        )
        .map_err(|error| format!("Prepare entity occurrence query: {error}"))?;
    let mut occurrences = BTreeMap::<(i64, String, String), HistoryEntityMoment>::new();
    let mut ids = entity_ids.iter().collect::<Vec<_>>();
    ids.sort();
    let mut truncated = false;
    for entity_id in ids {
        let rows = statement
            .query_map(
                params![
                    repo_path,
                    BUNDLED_ENGINE_ID,
                    BUNDLED_ENGINE_VERSION,
                    STRUCTURAL_GRAPH_SCHEMA_VERSION,
                    entity_id
                ],
                |row| {
                    Ok(HistoryEntityMoment {
                        revision_sha: row.get(0)?,
                        committed_at: row.get(1)?,
                        ordinal: row.get(2)?,
                        entity_id: row.get(3)?,
                        label: row.get(4)?,
                        kind: row.get(5)?,
                        path: row.get(6)?,
                        detail: row.get(7)?,
                    })
                },
            )
            .map_err(|error| format!("Query entity occurrences: {error}"))?;
        for moment in rows {
            let moment = moment.map_err(|error| format!("Read entity occurrence: {error}"))?;
            if occurrences.len() >= limit {
                truncated = true;
                break;
            }
            occurrences.insert(
                (
                    moment.ordinal,
                    moment.revision_sha.clone(),
                    moment.entity_id.clone(),
                ),
                moment,
            );
        }
        if truncated {
            break;
        }
    }
    Ok((occurrences.into_values().collect(), truncated))
}

fn estimate_eta_ms(started: std::time::Instant, completed: usize, total: usize) -> Option<u64> {
    if completed == 0 || completed >= total {
        return None;
    }
    let per_item = started.elapsed().as_millis() / completed as u128;
    Some((per_item * (total - completed) as u128).min(u64::MAX as u128) as u64)
}

fn reachable_release_revisions(root: &Path) -> Result<Vec<String>, String> {
    let mut releases = tags_by_commit(root)?
        .into_iter()
        .filter(|(_, tags)| tags.iter().any(|tag| is_release_tag(tag)))
        .filter(|(sha, _)| git_is_ancestor(root, sha, "HEAD"))
        .map(|(sha, _)| {
            let committed_at = git_text(root, &["show", "-s", "--format=%cI", &sha])?;
            Ok((committed_at, sha))
        })
        .collect::<Result<Vec<_>, String>>()?;
    releases.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
    Ok(releases.into_iter().map(|(_, sha)| sha).collect())
}

fn git_is_ancestor(root: &Path, ancestor: &str, descendant: &str) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["merge-base", "--is-ancestor", ancestor, descendant])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[tauri::command]
pub async fn get_history_revision_topology(
    repo_path: String,
    revision: String,
    max_nodes: Option<usize>,
    db: State<'_, DbState>,
) -> Result<HistoryTopology, String> {
    let root = canonical_repo_path(&repo_path)?;
    let database = Arc::clone(&db.0);
    tokio::task::spawn_blocking(move || {
        let topology = build_topology(&root, &revision, max_nodes)?;
        let connection = database
            .lock()
            .map_err(|_| "History database is unavailable".to_string())?;
        persist_changed_paths(&connection, &topology)?;
        Ok(topology)
    })
    .await
    .map_err(|error| format!("History topology worker failed: {error}"))?
}

#[tauri::command]
pub async fn get_history_structural_state(
    repo_path: String,
    revision: String,
    max_nodes: Option<usize>,
    app: tauri::AppHandle,
    db: State<'_, DbState>,
) -> Result<HistoryStructuralState, String> {
    let root = canonical_repo_path(&repo_path)?;
    let revision = resolve_revision(&root, &revision)?;
    let canonical = root.to_string_lossy().to_string();
    let storage_key = history_storage_key(&canonical);
    let database = Arc::clone(&db.0);
    tokio::task::spawn_blocking(move || {
        let reconstructed = {
            let connection = database
                .lock()
                .map_err(|_| "History database is unavailable".to_string())?;
            reconstruct_history_as_of(&connection, &canonical, &storage_key, &revision)?
        };
        let (snapshot, cached) = match reconstructed {
            Some(snapshot) => (snapshot, true),
            None => load_or_build_history_snapshot(
                &root,
                &canonical,
                &storage_key,
                &revision,
                &app,
                &database,
            )?,
        };
        let path_changes = changed_path_records(&root, &revision)?;
        let mut revision_changes = path_changes
            .iter()
            .map(|change| change.path.clone())
            .collect::<Vec<_>>();
        revision_changes.sort();
        Ok(HistoryStructuralState {
            schema_version: 1,
            repo_path: canonical,
            revision,
            snapshot_id: snapshot.id.clone(),
            cached,
            projection: query::overview(&snapshot, max_nodes),
            analysis: query::analysis_summary(&snapshot),
            changed_paths: revision_changes,
            path_changes,
            indexed_files: snapshot.coverage.indexed_files,
            node_count: snapshot.nodes.len(),
            edge_count: snapshot.edges.len(),
            generated_at: snapshot.created_at,
        })
    })
    .await
    .map_err(|error| format!("Historical structural state worker failed: {error}"))?
}

#[tauri::command]
pub async fn get_history_structural_delta(
    repo_path: String,
    before_revision: String,
    after_revision: String,
    app: tauri::AppHandle,
    db: State<'_, DbState>,
) -> Result<HistoryStructuralDelta, String> {
    let root = canonical_repo_path(&repo_path)?;
    let before_revision = resolve_revision(&root, &before_revision)?;
    let after_revision = resolve_revision(&root, &after_revision)?;
    let canonical = root.to_string_lossy().to_string();
    let storage_key = history_storage_key(&canonical);
    let database = Arc::clone(&db.0);
    tokio::task::spawn_blocking(move || {
        let cached_delta = {
            let connection = database
                .lock()
                .map_err(|_| "History database is unavailable".to_string())?;
            load_history_structural_delta(
                &connection,
                &canonical,
                &before_revision,
                &after_revision,
            )?
        };
        if let Some(delta) = cached_delta {
            return Ok(delta);
        }
        let (before, _) = load_or_build_history_snapshot(
            &root,
            &canonical,
            &storage_key,
            &before_revision,
            &app,
            &database,
        )?;
        let (after, _) = load_or_build_history_snapshot(
            &root,
            &canonical,
            &storage_key,
            &after_revision,
            &app,
            &database,
        )?;
        let connection = database
            .lock()
            .map_err(|_| "History database is unavailable".to_string())?;
        let delta = compute_and_persist_structural_delta(
            &connection,
            &root,
            &canonical,
            &before_revision,
            &after_revision,
            &before,
            &after,
        )?;
        Ok(delta)
    })
    .await
    .map_err(|error| format!("Historical structural delta worker failed: {error}"))?
}

#[tauri::command]
pub async fn get_history_as_of(
    repo_path: String,
    reference: HistoryTemporalReference,
    max_nodes: Option<usize>,
    app: tauri::AppHandle,
    db: State<'_, DbState>,
) -> Result<HistoryAsOfState, String> {
    let root = canonical_repo_path(&repo_path)?;
    let revision = resolve_temporal_reference(&root, &reference)?;
    let committed_at = git_text(&root, &["show", "-s", "--format=%cI", &revision])?;
    let canonical = root.to_string_lossy().to_string();
    let storage_key = history_storage_key(&canonical);
    let database = Arc::clone(&db.0);
    tokio::task::spawn_blocking(move || {
        let reconstructed = {
            let connection = database
                .lock()
                .map_err(|_| "History database is unavailable".to_string())?;
            reconstruct_history_as_of(&connection, &canonical, &storage_key, &revision)?
        };
        let (snapshot, cached) = match reconstructed {
            Some(snapshot) => (snapshot, true),
            None => load_or_build_history_snapshot(
                &root,
                &canonical,
                &storage_key,
                &revision,
                &app,
                &database,
            )?,
        };
        let path_changes = changed_path_records(&root, &revision)?;
        let mut changed_paths = path_changes
            .iter()
            .map(|change| change.path.clone())
            .collect::<Vec<_>>();
        changed_paths.sort();
        Ok(HistoryAsOfState {
            requested: reference,
            resolved_revision: revision.clone(),
            committed_at,
            exact: true,
            state: HistoryStructuralState {
                schema_version: 1,
                repo_path: canonical,
                revision,
                snapshot_id: snapshot.id.clone(),
                cached,
                projection: query::overview(&snapshot, max_nodes),
                analysis: query::analysis_summary(&snapshot),
                changed_paths,
                path_changes,
                indexed_files: snapshot.coverage.indexed_files,
                node_count: snapshot.nodes.len(),
                edge_count: snapshot.edges.len(),
                generated_at: snapshot.created_at,
            },
        })
    })
    .await
    .map_err(|error| format!("Historical as-of worker failed: {error}"))?
}

#[tauri::command]
pub async fn get_history_entity_evolution(
    repo_path: String,
    entity: String,
    revision: Option<String>,
    app: tauri::AppHandle,
    db: State<'_, DbState>,
) -> Result<HistoryEntityEvolution, String> {
    let root = canonical_repo_path(&repo_path)?;
    let canonical = root.to_string_lossy().to_string();
    let revision = resolve_revision(&root, revision.as_deref().unwrap_or("HEAD"))?;
    let current_head = git_text(&root, &["rev-parse", "HEAD"])?;
    let storage_key = history_storage_key(&canonical);
    let database = Arc::clone(&db.0);
    tokio::task::spawn_blocking(move || {
        let (snapshot, _) = load_or_build_history_snapshot(
            &root,
            &canonical,
            &storage_key,
            &revision,
            &app,
            &database,
        )?;
        let node = query::resolve_node(&snapshot, &entity)?.clone();
        let connection = database
            .lock()
            .map_err(|_| "History database is unavailable".to_string())?;
        let (lineage, family_ids, lineage_truncated) =
            load_lineage_family(&connection, &canonical, &node.id, 200)?;
        let (occurrences, occurrence_truncated) =
            load_entity_occurrences(&connection, &canonical, &family_ids, 500)?;
        let first_seen = occurrences.first().cloned();
        let last_present = occurrences.last().cloned();
        let mut last_changed = None;
        let mut previous_signature: Option<(&str, &str, Option<&str>, Option<&str>)> = None;
        for occurrence in &occurrences {
            let signature = (
                occurrence.entity_id.as_str(),
                occurrence.label.as_str(),
                occurrence.path.as_deref(),
                occurrence.detail.as_deref(),
            );
            if previous_signature != Some(signature) {
                last_changed = Some(occurrence.clone());
            }
            previous_signature = Some(signature);
        }
        let (indexed_head, stale, coverage) =
            history_index_freshness(&connection, &canonical, &current_head)?;
        let coverage_complete = coverage
            .get("coverage_complete")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let truncated = lineage_truncated || occurrence_truncated;
        let coverage_gap = if truncated {
            Some("Entity evolution exceeded local query bounds".to_string())
        } else if !coverage_complete {
            Some("First/last moments are bounded by the indexed history coverage".to_string())
        } else {
            None
        };
        Ok(HistoryEntityEvolution {
            schema_version: 1,
            repo_path: canonical,
            resolved_revision: revision,
            entity_id: node.id,
            entity_label: node.label,
            entity_kind: node.kind,
            lineage,
            occurrences,
            first_seen,
            last_changed,
            last_present,
            indexed_head,
            stale,
            coverage_gap,
            truncated,
            next_cursor: None,
        })
    })
    .await
    .map_err(|error| format!("History entity evolution worker failed: {error}"))?
}

pub(crate) fn resolve_temporal_reference(
    root: &Path,
    reference: &HistoryTemporalReference,
) -> Result<String, String> {
    match reference {
        HistoryTemporalReference::Revision { revision } => resolve_revision(root, revision),
        HistoryTemporalReference::Release { tag } => resolve_revision(root, tag),
        HistoryTemporalReference::Date { at } => {
            chrono::DateTime::parse_from_rfc3339(at)
                .map_err(|error| format!("History date must be RFC3339: {error}"))?;
            let revision = git_text(root, &["rev-list", "-1", &format!("--before={at}"), "HEAD"])?;
            if revision.is_empty() {
                Err(format!("No reachable commit exists at or before {at}"))
            } else {
                Ok(revision)
            }
        }
    }
}

pub(crate) fn reconstruct_history_as_of(
    connection: &Connection,
    repo_path: &str,
    storage_key: &str,
    target_revision: &str,
) -> Result<Option<StructuralGraphSnapshot>, String> {
    let target_exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM history_graph_revisions
             WHERE repo_path = ?1 AND sha = ?2)",
            params![repo_path, target_revision],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("Resolve indexed as-of revision: {error}"))?;
    if !target_exists {
        return Ok(None);
    }
    let mut checkpoint_statement = connection
        .prepare(
            "SELECT revision_sha, snapshot_id FROM history_graph_checkpoints
             WHERE repo_path = ?1 AND status = 'ready'
               AND engine_id = ?2 AND engine_version = ?3 AND schema_version = ?4",
        )
        .map_err(|error| format!("Prepare compatible history checkpoints: {error}"))?;
    let checkpoints = checkpoint_statement
        .query_map(
            params![
                repo_path,
                BUNDLED_ENGINE_ID,
                BUNDLED_ENGINE_VERSION,
                STRUCTURAL_GRAPH_SCHEMA_VERSION,
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|error| format!("Query compatible history checkpoints: {error}"))?
        .collect::<Result<HashMap<_, _>, _>>()
        .map_err(|error| format!("Read compatible history checkpoints: {error}"))?;

    let mut materialization_chain = vec![target_revision.to_string()];
    while !checkpoints.contains_key(
        materialization_chain
            .last()
            .expect("materialization chain has a target"),
    ) {
        if materialization_chain.len() > MAX_HISTORY_LIMIT + checkpoints.len() + 1 {
            return Ok(None);
        }
        let current = materialization_chain
            .last()
            .expect("materialization chain has a current revision");
        let parents_json = connection
            .query_row(
                "SELECT parents_json FROM history_graph_revisions
                 WHERE repo_path = ?1 AND sha = ?2",
                params![repo_path, current],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("Load materialization parent: {error}"))?;
        let Some(parents_json) = parents_json else {
            return Ok(None);
        };
        let parents: Vec<String> = serde_json::from_str(&parents_json).unwrap_or_default();
        let Some(parent) = parents.first() else {
            return Ok(None);
        };
        let parent_indexed = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM history_graph_revisions
                 WHERE repo_path = ?1 AND sha = ?2)",
                params![repo_path, parent],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| format!("Check materialization parent coverage: {error}"))?;
        if !parent_indexed || materialization_chain.contains(parent) {
            return Ok(None);
        }
        materialization_chain.push(parent.clone());
    }
    let checkpoint_revision = materialization_chain
        .last()
        .expect("checkpoint terminates materialization chain")
        .clone();
    let Some(snapshot_id) = checkpoints.get(&checkpoint_revision).cloned() else {
        return Ok(None);
    };
    let snapshot_blob = load_history_snapshot_blob(connection, repo_path, &snapshot_id)?;
    let normalized_snapshot = if snapshot_blob.is_none() {
        load_snapshot_by_id(connection, storage_key, &snapshot_id)
            .map_err(|error| error.to_string())?
    } else {
        None
    };
    let Some(mut snapshot) = snapshot_blob.or(normalized_snapshot) else {
        return Ok(None);
    };
    materialization_chain.reverse();
    for pair in materialization_chain.windows(2) {
        let Some(delta) = load_history_structural_delta(connection, repo_path, &pair[0], &pair[1])?
        else {
            return Ok(None);
        };
        if delta.before_revision != pair[0]
            || delta.after_revision != pair[1]
            || delta.before_snapshot_id != snapshot.id
        {
            return Ok(None);
        }
        let next_blob =
            load_history_snapshot_blob(connection, repo_path, &delta.after_snapshot_id)?;
        let next_normalized = if next_blob.is_none() {
            load_snapshot_by_id(connection, storage_key, &delta.after_snapshot_id)
                .map_err(|error| error.to_string())?
        } else {
            None
        };
        if let Some(next_snapshot) = next_blob.or(next_normalized) {
            snapshot = next_snapshot;
        } else if delta.materialization_version == 1 {
            snapshot = apply_structural_delta(snapshot, &delta)?;
        } else {
            return Ok(None);
        }
    }
    if snapshot.repo_head.as_deref() == Some(target_revision) {
        Ok(Some(snapshot))
    } else {
        Ok(None)
    }
}

fn apply_structural_delta(
    mut snapshot: StructuralGraphSnapshot,
    delta: &HistoryStructuralDelta,
) -> Result<StructuralGraphSnapshot, String> {
    if snapshot.id != delta.before_snapshot_id || delta.materialization_version != 1 {
        return Err("Structural delta is incompatible with its base checkpoint".to_string());
    }
    let removed_nodes = delta.removed_node_ids.iter().collect::<HashSet<_>>();
    let upsert_nodes = delta
        .upsert_nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    snapshot.nodes.retain(|node| {
        !removed_nodes.contains(&node.id) && !upsert_nodes.contains(node.id.as_str())
    });
    snapshot.nodes.extend(delta.upsert_nodes.iter().cloned());
    snapshot.nodes.sort_by(|left, right| left.id.cmp(&right.id));

    let removed_edges = delta.removed_edge_ids.iter().collect::<HashSet<_>>();
    let upsert_edges = delta
        .upsert_edges
        .iter()
        .map(|edge| edge.id.as_str())
        .collect::<HashSet<_>>();
    snapshot.edges.retain(|edge| {
        !removed_edges.contains(&edge.id) && !upsert_edges.contains(edge.id.as_str())
    });
    snapshot.edges.extend(delta.upsert_edges.iter().cloned());
    snapshot.edges.sort_by(|left, right| left.id.cmp(&right.id));

    let removed_files = delta
        .removed_file_paths
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let upsert_files = delta
        .upsert_files
        .iter()
        .map(|file| file.path.as_str())
        .collect::<HashSet<_>>();
    snapshot.files.retain(|file| {
        !removed_files.contains(file.path.as_str()) && !upsert_files.contains(file.path.as_str())
    });
    snapshot.files.extend(delta.upsert_files.iter().cloned());
    snapshot
        .files
        .sort_by(|left, right| left.path.cmp(&right.path));

    snapshot.id = delta.after_snapshot_id.clone();
    snapshot.repo_head = Some(delta.after_revision.clone());
    snapshot.created_at = delta.after_created_at.clone();
    snapshot.cursor = delta.after_cursor.clone();
    snapshot.ignore_fingerprint = delta.after_ignore_fingerprint.clone();
    snapshot.coverage = delta.after_coverage.clone();
    snapshot.diagnostics = delta.after_diagnostics.clone();
    snapshot.communities = delta.upsert_communities.clone();
    snapshot.truncated = delta.after_truncated;
    Ok(snapshot)
}

fn set_delta<'a>(
    before: impl Iterator<Item = &'a str>,
    after: impl Iterator<Item = &'a str>,
) -> (Vec<String>, Vec<String>) {
    let before = before.collect::<HashSet<_>>();
    let after = after.collect::<HashSet<_>>();
    let mut added = after
        .difference(&before)
        .map(|id| (*id).to_string())
        .collect::<Vec<_>>();
    let mut removed = before
        .difference(&after)
        .map(|id| (*id).to_string())
        .collect::<Vec<_>>();
    added.sort();
    removed.sort();
    (added, removed)
}

fn compute_and_persist_structural_delta(
    connection: &Connection,
    root: &Path,
    repo_path: &str,
    before_revision: &str,
    after_revision: &str,
    before: &StructuralGraphSnapshot,
    after: &StructuralGraphSnapshot,
) -> Result<HistoryStructuralDelta, String> {
    let path_changes = changed_path_records_between(root, before_revision, after_revision)?;
    compute_and_persist_structural_delta_with_paths(
        connection,
        repo_path,
        before_revision,
        after_revision,
        before,
        after,
        path_changes,
    )
}

fn compute_and_persist_structural_delta_with_paths(
    connection: &Connection,
    repo_path: &str,
    before_revision: &str,
    after_revision: &str,
    before: &StructuralGraphSnapshot,
    after: &StructuralGraphSnapshot,
    path_changes: Vec<HistoryPathChange>,
) -> Result<HistoryStructuralDelta, String> {
    let structural = query::diff_snapshots(before, after);
    let (added_community_ids, removed_community_ids) = set_delta(
        before
            .communities
            .iter()
            .map(|community| community.id.as_str()),
        after
            .communities
            .iter()
            .map(|community| community.id.as_str()),
    );
    let (added_hub_ids, removed_hub_ids) = set_delta(
        before
            .communities
            .iter()
            .flat_map(|community| community.hub_node_ids.iter().map(String::as_str)),
        after
            .communities
            .iter()
            .flat_map(|community| community.hub_node_ids.iter().map(String::as_str)),
    );
    let (added_bridge_ids, removed_bridge_ids) = set_delta(
        before
            .communities
            .iter()
            .flat_map(|community| community.bridge_node_ids.iter().map(String::as_str)),
        after
            .communities
            .iter()
            .flat_map(|community| community.bridge_node_ids.iter().map(String::as_str)),
    );
    let coverage_gap = (before.truncated || after.truncated)
        .then(|| "One or both structural checkpoints were bounded".to_string());
    let mut lineage = derive_lineage(before, after, &path_changes, after_revision);
    lineage.extend(derive_reintroductions(
        connection,
        repo_path,
        after,
        &structural.added_node_ids,
        after_revision,
    )?);
    lineage.sort_by(|left, right| left.id.cmp(&right.id));
    lineage.dedup_by(|left, right| left.id == right.id);
    let upsert_node_ids = structural
        .added_node_ids
        .iter()
        .chain(structural.changed_node_ids.iter())
        .collect::<HashSet<_>>();
    let upsert_edge_ids = structural
        .added_edge_ids
        .iter()
        .chain(structural.changed_edge_ids.iter())
        .collect::<HashSet<_>>();
    let upsert_nodes = after
        .nodes
        .iter()
        .filter(|node| upsert_node_ids.contains(&node.id))
        .cloned()
        .collect();
    let upsert_edges = after
        .edges
        .iter()
        .filter(|edge| upsert_edge_ids.contains(&edge.id))
        .cloned()
        .collect();
    let before_files = before
        .files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect::<HashMap<_, _>>();
    let after_file_paths = after
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect::<HashSet<_>>();
    let upsert_files = after
        .files
        .iter()
        .filter(|file| before_files.get(file.path.as_str()).copied() != Some(*file))
        .cloned()
        .collect();
    let mut removed_file_paths = before
        .files
        .iter()
        .filter(|file| !after_file_paths.contains(file.path.as_str()))
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    removed_file_paths.sort();
    let delta = HistoryStructuralDelta {
        schema_version: 1,
        materialization_version: 1,
        repo_path: repo_path.to_string(),
        before_revision: before_revision.to_string(),
        after_revision: after_revision.to_string(),
        before_snapshot_id: before.id.clone(),
        after_snapshot_id: after.id.clone(),
        added_node_ids: structural.added_node_ids,
        removed_node_ids: structural.removed_node_ids,
        changed_node_ids: structural.changed_node_ids,
        added_edge_ids: structural.added_edge_ids,
        removed_edge_ids: structural.removed_edge_ids,
        changed_edge_ids: structural.changed_edge_ids,
        added_community_ids,
        removed_community_ids,
        added_hub_ids,
        removed_hub_ids,
        added_bridge_ids,
        removed_bridge_ids,
        path_changes,
        lineage,
        coverage_gap,
        generated_at: Utc::now().to_rfc3339(),
        upsert_nodes,
        upsert_edges,
        upsert_communities: after.communities.clone(),
        upsert_files,
        removed_file_paths,
        after_coverage: after.coverage.clone(),
        after_diagnostics: after.diagnostics.clone(),
        after_cursor: after.cursor.clone(),
        after_ignore_fingerprint: after.ignore_fingerprint.clone(),
        after_truncated: after.truncated,
        after_created_at: after.created_at.clone(),
    };
    persist_structural_delta(connection, &delta)?;
    Ok(delta)
}

fn persist_structural_delta(
    connection: &Connection,
    delta: &HistoryStructuralDelta,
) -> Result<(), String> {
    let event_id = structural_delta_event_id(
        &delta.repo_path,
        &delta.before_revision,
        &delta.after_revision,
    );
    let summary = serde_json::json!({
        "schema_version": delta.schema_version,
        "materialization_version": delta.materialization_version,
        "repo_path": delta.repo_path,
        "before_revision": delta.before_revision,
        "after_revision": delta.after_revision,
        "before_snapshot_id": delta.before_snapshot_id,
        "after_snapshot_id": delta.after_snapshot_id,
        "added_node_ids": delta.added_node_ids,
        "removed_node_ids": delta.removed_node_ids,
        "changed_node_ids": delta.changed_node_ids,
        "added_edge_ids": delta.added_edge_ids,
        "removed_edge_ids": delta.removed_edge_ids,
        "changed_edge_ids": delta.changed_edge_ids,
        "added_community_ids": delta.added_community_ids,
        "removed_community_ids": delta.removed_community_ids,
        "added_hub_ids": delta.added_hub_ids,
        "removed_hub_ids": delta.removed_hub_ids,
        "added_bridge_ids": delta.added_bridge_ids,
        "removed_bridge_ids": delta.removed_bridge_ids,
        "path_changes": delta.path_changes,
        "lineage": delta.lineage,
        "coverage_gap": delta.coverage_gap,
        "generated_at": delta.generated_at,
        "payload_encoding": "zlib-json-v1",
    })
    .to_string();
    connection
        .execute(
            "INSERT OR REPLACE INTO history_graph_events (
                id, repo_path, revision_sha, event_kind, trust, origin,
                source_id, source_cursor, payload_json, evidence_json, recorded_at
             ) VALUES (?1, ?2, ?3, 'structural_delta', 'extracted', 'analysis',
                'codevetter-structural-history', ?4, ?5, '[]', ?6)",
            params![
                event_id,
                delta.repo_path,
                delta.after_revision,
                delta.after_snapshot_id,
                summary,
                delta.generated_at,
            ],
        )
        .map_err(|error| format!("Persist structural history delta: {error}"))?;
    persist_history_delta_blob(connection, &event_id, delta)?;
    for lineage in &delta.lineage {
        connection
            .execute(
                "INSERT OR REPLACE INTO history_graph_events (
                    id, repo_path, revision_sha, event_kind, entity_id, related_entity_id,
                    relation_kind, trust, origin, source_id, source_cursor,
                    payload_json, evidence_json, recorded_at
                 ) VALUES (?1, ?2, ?3, 'entity_lineage', ?4, ?5, ?6, ?7,
                    'analysis', 'codevetter-lineage', ?8, ?9, ?10, ?11)",
                params![
                    lineage.id,
                    delta.repo_path,
                    delta.after_revision,
                    lineage.from_entity_id,
                    lineage.to_entity_id,
                    lineage.relation,
                    lineage.trust.as_str(),
                    delta.after_snapshot_id,
                    serde_json::to_string(lineage).map_err(|error| error.to_string())?,
                    serde_json::to_string(&lineage.sources).map_err(|error| error.to_string())?,
                    delta.generated_at,
                ],
            )
            .map_err(|error| format!("Persist structural lineage: {error}"))?;
    }
    Ok(())
}

fn structural_delta_event_id(
    repo_path: &str,
    before_revision: &str,
    after_revision: &str,
) -> String {
    stable_graph_id(
        "history-event",
        &format!("structural_delta\0{repo_path}\0{before_revision}\0{after_revision}"),
    )
}

fn derive_reintroductions(
    connection: &Connection,
    repo_path: &str,
    after: &StructuralGraphSnapshot,
    added_node_ids: &[String],
    after_revision: &str,
) -> Result<Vec<HistoryLineageEdge>, String> {
    let mut statement = connection
        .prepare(
            "SELECT payload_json FROM history_graph_events
             WHERE repo_path = ?1 AND event_kind = 'entity_lineage'
               AND entity_id = ?2 AND relation_kind = 'removed_in'
             ORDER BY recorded_at DESC, id DESC LIMIT 1",
        )
        .map_err(|error| format!("Prepare reintroduction query: {error}"))?;
    let added = added_node_ids.iter().collect::<HashSet<_>>();
    let mut reintroductions = Vec::new();
    for node in after.nodes.iter().filter(|node| added.contains(&node.id)) {
        let removed: Option<String> = statement
            .query_row(params![repo_path, node.id], |row| row.get(0))
            .optional()
            .map_err(|error| format!("Query prior removal: {error}"))?;
        let Some(removed) = removed else {
            continue;
        };
        let removal: HistoryLineageEdge = serde_json::from_str(&removed)
            .map_err(|error| format!("Decode prior removal: {error}"))?;
        reintroductions.push(HistoryLineageEdge {
            id: stable_graph_id(
                "lineage",
                &format!("reintroduced_in\0{}\0{after_revision}", node.id),
            ),
            from_entity_id: node.id.clone(),
            to_entity_id: node.id.clone(),
            relation: "reintroduced_in".to_string(),
            trust: GraphTrust::Extracted,
            evidence: format!(
                "Entity returns after the prior removal event {}",
                removal.id
            ),
            sources: node.sources.clone(),
            candidates: Vec::new(),
        });
    }
    Ok(reintroductions)
}

fn derive_lineage(
    before: &StructuralGraphSnapshot,
    after: &StructuralGraphSnapshot,
    path_changes: &[HistoryPathChange],
    after_revision: &str,
) -> Vec<HistoryLineageEdge> {
    let mut lineage = Vec::new();
    let after_by_id = after
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    for source in &before.nodes {
        let Some(target) = after_by_id.get(source.id.as_str()) else {
            continue;
        };
        if lineage_relevant_change(source, target) {
            lineage.push(lineage_edge(
                source,
                target,
                "same_as",
                GraphTrust::Extracted,
                "Stable structural identity persists while entity attributes change".to_string(),
                Vec::new(),
            ));
        }
    }
    let after_by_path = after
        .nodes
        .iter()
        .filter_map(|node| node.path.as_deref().map(|path| (path, node)))
        .fold(HashMap::<&str, Vec<_>>::new(), |mut map, (path, node)| {
            map.entry(path).or_default().push(node);
            map
        });
    let mut matched_before = HashSet::new();
    let mut matched_after = HashSet::new();
    for change in path_changes.iter().filter(|change| {
        matches!(change.change_kind.as_str(), "renamed" | "copied") && change.old_path.is_some()
    }) {
        let old_path = change.old_path.as_deref().unwrap_or_default();
        let Some(candidates_at_target) = after_by_path.get(change.path.as_str()) else {
            continue;
        };
        for source in before
            .nodes
            .iter()
            .filter(|node| node.path.as_deref() == Some(old_path))
        {
            let mut candidates = candidates_at_target
                .iter()
                .copied()
                .filter(|target| {
                    target.kind == source.kind
                        && (target.label == source.label
                            || (source.kind == "file" && target.kind == "file"))
                })
                .collect::<Vec<_>>();
            candidates.sort_by(|left, right| left.id.cmp(&right.id));
            if candidates.is_empty() {
                continue;
            }
            let target = candidates[0];
            let trust = if candidates.len() == 1 {
                GraphTrust::Extracted
            } else {
                GraphTrust::Ambiguous
            };
            let relation = if change.change_kind == "renamed" {
                "moved_to"
            } else {
                "evolved_from"
            };
            lineage.push(lineage_edge(
                source,
                target,
                relation,
                trust,
                format!(
                    "Git {} maps {} to {} and structural kind/label remains compatible",
                    change.change_kind, old_path, change.path
                ),
                candidates
                    .iter()
                    .skip(1)
                    .map(|node| node.id.clone())
                    .collect(),
            ));
            matched_before.insert(source.id.as_str());
            matched_after.insert(target.id.as_str());
        }
    }
    let rename_sources = before
        .nodes
        .iter()
        .filter(|node| {
            !after.nodes.iter().any(|target| target.id == node.id)
                && !matched_before.contains(node.id.as_str())
        })
        .collect::<Vec<_>>();
    let mut merge_targets = HashMap::<&str, Vec<_>>::new();
    for source in &rename_sources {
        let source_line = source.sources.first().and_then(|anchor| anchor.start_line);
        for target in after
            .nodes
            .iter()
            .filter(|target| !matched_after.contains(target.id.as_str()))
            .filter(|target| target.kind == source.kind && target.path == source.path)
            .filter(|target| {
                source_line.is_some()
                    && target.sources.first().and_then(|anchor| anchor.start_line) == source_line
            })
        {
            merge_targets
                .entry(target.id.as_str())
                .or_default()
                .push(*source);
        }
    }
    for (target_id, mut sources) in merge_targets {
        if sources.len() < 2 {
            continue;
        }
        sources.sort_by(|left, right| left.id.cmp(&right.id));
        let Some(target) = after_by_id.get(target_id) else {
            continue;
        };
        for source in &sources {
            lineage.push(lineage_edge(
                source,
                target,
                "merged_from",
                GraphTrust::Ambiguous,
                "Multiple removed entities share the successor's path, kind, and source line"
                    .to_string(),
                sources
                    .iter()
                    .filter(|candidate| candidate.id != source.id)
                    .map(|candidate| candidate.id.clone())
                    .collect(),
            ));
            matched_before.insert(source.id.as_str());
        }
        matched_after.insert(target.id.as_str());
    }
    for source in rename_sources {
        if matched_before.contains(source.id.as_str()) {
            continue;
        }
        let source_line = source.sources.first().and_then(|anchor| anchor.start_line);
        let mut candidates = after
            .nodes
            .iter()
            .filter(|target| !matched_after.contains(target.id.as_str()))
            .filter(|target| target.kind == source.kind && target.path == source.path)
            .filter(|target| {
                source_line.is_some()
                    && target.sources.first().and_then(|anchor| anchor.start_line) == source_line
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| left.id.cmp(&right.id));
        if candidates.len() == 1 {
            let target = candidates[0];
            lineage.push(lineage_edge(
                source,
                target,
                if source.label == target.label {
                    "evolved_from"
                } else {
                    "renamed_to"
                },
                GraphTrust::Inferred,
                "Same path, structural kind, and source line across adjacent revisions".to_string(),
                Vec::new(),
            ));
            matched_before.insert(source.id.as_str());
            matched_after.insert(target.id.as_str());
        } else if candidates.len() > 1 {
            lineage.push(lineage_edge(
                source,
                candidates[0],
                "split_into",
                GraphTrust::Ambiguous,
                "Multiple same-path structural candidates follow the removed entity".to_string(),
                candidates
                    .iter()
                    .skip(1)
                    .map(|node| node.id.clone())
                    .collect(),
            ));
            matched_before.insert(source.id.as_str());
        }
    }
    let revision_entity = stable_graph_id("revision", after_revision);
    for source in before.nodes.iter().filter(|node| {
        !after.nodes.iter().any(|target| target.id == node.id)
            && !matched_before.contains(node.id.as_str())
    }) {
        lineage.push(HistoryLineageEdge {
            id: stable_graph_id(
                "lineage",
                &format!("removed_in\0{}\0{revision_entity}", source.id),
            ),
            from_entity_id: source.id.clone(),
            to_entity_id: revision_entity.clone(),
            relation: "removed_in".to_string(),
            trust: GraphTrust::Extracted,
            evidence: "Entity is absent from the exact next structural checkpoint".to_string(),
            sources: source.sources.clone(),
            candidates: Vec::new(),
        });
    }
    lineage.sort_by(|left, right| left.id.cmp(&right.id));
    lineage
}

fn lineage_relevant_change(
    source: &crate::commands::structural_graph::types::StructuralGraphNode,
    target: &crate::commands::structural_graph::types::StructuralGraphNode,
) -> bool {
    source.label != target.label
        || source.qualified_name != target.qualified_name
        || source.path != target.path
        || source.kind != target.kind
        || source.detail != target.detail
        || source.language != target.language
        || source
            .sources
            .first()
            .and_then(|anchor| anchor.excerpt.as_deref())
            != target
                .sources
                .first()
                .and_then(|anchor| anchor.excerpt.as_deref())
}

fn lineage_edge(
    source: &crate::commands::structural_graph::types::StructuralGraphNode,
    target: &crate::commands::structural_graph::types::StructuralGraphNode,
    relation: &str,
    trust: GraphTrust,
    evidence: String,
    candidates: Vec<String>,
) -> HistoryLineageEdge {
    HistoryLineageEdge {
        id: stable_graph_id(
            "lineage",
            &format!("{relation}\0{}\0{}", source.id, target.id),
        ),
        from_entity_id: source.id.clone(),
        to_entity_id: target.id.clone(),
        relation: relation.to_string(),
        trust,
        evidence,
        sources: source
            .sources
            .iter()
            .chain(target.sources.iter())
            .cloned()
            .collect(),
        candidates,
    }
}

fn encode_history_blob<T: Serialize>(value: &T) -> Result<(Vec<u8>, usize), String> {
    let json =
        serde_json::to_vec(value).map_err(|error| format!("Encode history blob: {error}"))?;
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
    encoder
        .write_all(&json)
        .map_err(|error| format!("Compress history blob: {error}"))?;
    let compressed = encoder
        .finish()
        .map_err(|error| format!("Finish history compression: {error}"))?;
    Ok((compressed, json.len()))
}

fn decode_history_blob<T: DeserializeOwned>(payload: &[u8]) -> Result<T, String> {
    let mut decoder = ZlibDecoder::new(payload);
    let mut json = Vec::new();
    decoder
        .read_to_end(&mut json)
        .map_err(|error| format!("Decompress history blob: {error}"))?;
    serde_json::from_slice(&json).map_err(|error| format!("Decode history blob: {error}"))
}

fn persist_history_snapshot_blob(
    connection: &Connection,
    repo_path: &str,
    revision: &str,
    snapshot: &StructuralGraphSnapshot,
) -> Result<(), String> {
    let (payload, uncompressed_bytes) = encode_history_blob(snapshot)?;
    connection
        .execute(
            "INSERT OR REPLACE INTO history_graph_snapshot_blobs (
                snapshot_id, repo_path, revision_sha, encoding, payload,
                uncompressed_bytes, created_at
             ) VALUES (?1, ?2, ?3, 'zlib-json-v1', ?4, ?5, ?6)",
            params![
                snapshot.id,
                repo_path,
                revision,
                payload,
                uncompressed_bytes as i64,
                snapshot.created_at,
            ],
        )
        .map_err(|error| format!("Persist compressed history checkpoint: {error}"))?;
    Ok(())
}

fn load_history_snapshot_blob(
    connection: &Connection,
    repo_path: &str,
    snapshot_id: &str,
) -> Result<Option<StructuralGraphSnapshot>, String> {
    let payload = connection
        .query_row(
            "SELECT payload FROM history_graph_snapshot_blobs
             WHERE repo_path = ?1 AND snapshot_id = ?2 AND encoding = 'zlib-json-v1'",
            params![repo_path, snapshot_id],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()
        .map_err(|error| format!("Load compressed history checkpoint: {error}"))?;
    payload.as_deref().map(decode_history_blob).transpose()
}

fn persist_history_delta_blob(
    connection: &Connection,
    event_id: &str,
    delta: &HistoryStructuralDelta,
) -> Result<(), String> {
    let (payload, uncompressed_bytes) = encode_history_blob(delta)?;
    connection
        .execute(
            "INSERT OR REPLACE INTO history_graph_event_blobs (
                event_id, encoding, payload, uncompressed_bytes, created_at
             ) VALUES (?1, 'zlib-json-v1', ?2, ?3, ?4)",
            params![
                event_id,
                payload,
                uncompressed_bytes as i64,
                delta.generated_at,
            ],
        )
        .map_err(|error| format!("Persist compressed structural delta: {error}"))?;
    Ok(())
}

fn load_history_structural_delta(
    connection: &Connection,
    repo_path: &str,
    before_revision: &str,
    after_revision: &str,
) -> Result<Option<HistoryStructuralDelta>, String> {
    let event_id = structural_delta_event_id(repo_path, before_revision, after_revision);
    let blob = connection
        .query_row(
            "SELECT b.payload FROM history_graph_event_blobs b
             JOIN history_graph_events e ON e.id = b.event_id
             WHERE b.event_id = ?1 AND e.repo_path = ?2 AND b.encoding = 'zlib-json-v1'",
            params![event_id, repo_path],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()
        .map_err(|error| format!("Load compressed structural delta: {error}"))?;
    if let Some(blob) = blob {
        return decode_history_blob(&blob).map(Some);
    }
    let payload = connection
        .query_row(
            "SELECT payload_json FROM history_graph_events
             WHERE id = ?1 AND repo_path = ?2 AND event_kind = 'structural_delta'",
            params![event_id, repo_path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Load legacy structural delta: {error}"))?;
    payload
        .as_deref()
        .map(|payload| {
            serde_json::from_str(payload)
                .map_err(|error| format!("Decode legacy structural delta: {error}"))
        })
        .transpose()
}

fn load_or_build_history_snapshot(
    root: &Path,
    canonical_repo_path: &str,
    storage_key: &str,
    revision: &str,
    app: &tauri::AppHandle,
    database: &Arc<std::sync::Mutex<Connection>>,
) -> Result<
    (
        crate::commands::structural_graph::types::StructuralGraphSnapshot,
        bool,
    ),
    String,
> {
    let existing_snapshot_id = {
        let connection = database
            .lock()
            .map_err(|_| "History database is unavailable".to_string())?;
        connection
            .query_row(
                "SELECT snapshot_id FROM history_graph_checkpoints
                 WHERE repo_path = ?1 AND revision_sha = ?2 AND engine_id = ?3
                   AND engine_version = ?4 AND schema_version = ?5 AND status = 'ready'",
                params![
                    canonical_repo_path,
                    revision,
                    BUNDLED_ENGINE_ID,
                    BUNDLED_ENGINE_VERSION,
                    STRUCTURAL_GRAPH_SCHEMA_VERSION
                ],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("Load history checkpoint: {error}"))?
    };
    if let Some(snapshot_id) = existing_snapshot_id {
        let connection = database
            .lock()
            .map_err(|_| "History database is unavailable".to_string())?;
        if let Some(snapshot) =
            load_history_snapshot_blob(&connection, canonical_repo_path, &snapshot_id)?
        {
            return Ok((snapshot, true));
        }
        if let Some(snapshot) = load_snapshot_by_id(&connection, storage_key, &snapshot_id)
            .map_err(|error| error.to_string())?
        {
            return Ok((snapshot, true));
        }
    }
    build_history_checkpoint(
        root,
        canonical_repo_path,
        storage_key,
        revision,
        app,
        database,
    )
    .map(|snapshot| (snapshot, false))
}

fn build_history_checkpoint(
    root: &Path,
    canonical_repo_path: &str,
    storage_key: &str,
    revision: &str,
    app: &tauri::AppHandle,
    database: &Arc<std::sync::Mutex<Connection>>,
) -> Result<crate::commands::structural_graph::types::StructuralGraphSnapshot, String> {
    let snapshot = build_history_snapshot_unpersisted(root, storage_key, revision, app)?;
    let connection = database
        .lock()
        .map_err(|_| "History database is unavailable".to_string())?;
    ensure_history_revision(&connection, root, canonical_repo_path, revision)?;
    persist_history_snapshot_blob(&connection, canonical_repo_path, revision, &snapshot)?;
    connection
        .execute(
            "INSERT INTO history_graph_checkpoints (
                repo_path, revision_sha, snapshot_id, engine_id, engine_version,
                schema_version, status, coverage_json, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'ready', ?7, ?8)
             ON CONFLICT(repo_path, revision_sha, engine_id, engine_version, schema_version)
             DO UPDATE SET snapshot_id = excluded.snapshot_id, status = 'ready',
                coverage_json = excluded.coverage_json, created_at = excluded.created_at",
            params![
                canonical_repo_path,
                revision,
                snapshot.id,
                snapshot.engine.id,
                snapshot.engine.version,
                snapshot.schema_version,
                serde_json::to_string(&snapshot.coverage).map_err(|error| error.to_string())?,
                snapshot.created_at,
            ],
        )
        .map_err(|error| format!("Persist history checkpoint: {error}"))?;
    Ok(snapshot)
}

fn build_history_snapshot_unpersisted(
    root: &Path,
    storage_key: &str,
    revision: &str,
    app: &tauri::AppHandle,
) -> Result<StructuralGraphSnapshot, String> {
    let batch = GitObjectReader::new(root).blobs_at_with_coverage(revision)?;
    let cancellation = StructuralGraphCancellation::default();
    let progress_app = app.clone();
    let progress = move |event: StructuralGraphProgress| {
        let _ = progress_app.emit("history-graph-progress", &event);
    };
    let mut snapshot =
        build_snapshot_from_blobs(storage_key, revision, batch.blobs, &cancellation, &progress)
            .map_err(|error| error.to_string())?;
    apply_historical_file_coverage(&mut snapshot, batch.discovered_files, batch.truncated);
    compact_history_snapshot(&mut snapshot);
    Ok(snapshot)
}

fn apply_historical_file_coverage(
    snapshot: &mut StructuralGraphSnapshot,
    discovered_files: usize,
    truncated: bool,
) {
    if !truncated {
        return;
    }
    let omitted = discovered_files.saturating_sub(snapshot.files.len());
    snapshot.truncated = true;
    snapshot.coverage.discovered_files = discovered_files;
    snapshot.coverage.skipped_files = snapshot.coverage.skipped_files.saturating_add(omitted);
    snapshot.diagnostics.push(StructuralGraphDiagnostic {
        severity: "warning".to_string(),
        code: "historical_file_limit".to_string(),
        message: format!(
            "Historical extraction indexed {} of {} Git blobs; {} files were omitted by the local bound",
            snapshot.files.len(), discovered_files, omitted
        ),
        path: None,
        language: None,
    });
}

fn build_history_snapshot_from_previous(
    root: &Path,
    storage_key: &str,
    revision: &str,
    previous: &StructuralGraphSnapshot,
    path_changes: &[HistoryPathChange],
    app: &tauri::AppHandle,
) -> Result<StructuralGraphSnapshot, String> {
    let changed_paths = path_changes
        .iter()
        .filter(|change| change.change_kind != "deleted")
        .map(|change| change.path.clone())
        .collect::<Vec<_>>();
    let deleted_paths = path_changes
        .iter()
        .filter(|change| change.change_kind == "deleted")
        .map(|change| change.path.clone())
        .chain(
            path_changes
                .iter()
                .filter(|change| change.change_kind == "renamed")
                .filter_map(|change| change.old_path.clone()),
        )
        .collect::<Vec<_>>();
    let blobs = GitObjectReader::new(root).blobs_for_paths(revision, &changed_paths)?;
    let cancellation = StructuralGraphCancellation::default();
    let progress_app = app.clone();
    let progress = move |event: StructuralGraphProgress| {
        let _ = progress_app.emit("history-graph-progress", &event);
    };
    let mut snapshot = build_snapshot_from_blob_delta(
        storage_key,
        revision,
        previous,
        blobs,
        &deleted_paths,
        &cancellation,
        &progress,
    )
    .map_err(|error| error.to_string())?;
    compact_history_snapshot(&mut snapshot);
    Ok(snapshot)
}

fn compact_history_snapshot(snapshot: &mut StructuralGraphSnapshot) {
    for source in snapshot
        .nodes
        .iter_mut()
        .flat_map(|node| node.sources.iter_mut())
        .chain(
            snapshot
                .edges
                .iter_mut()
                .flat_map(|edge| edge.sources.iter_mut()),
        )
    {
        source.excerpt = None;
    }
}

fn ensure_history_revision(
    connection: &Connection,
    root: &Path,
    canonical_repo_path: &str,
    revision: &str,
) -> Result<(), String> {
    let exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM history_graph_revisions WHERE repo_path = ?1 AND sha = ?2)",
            params![canonical_repo_path, revision],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Check history revision: {error}"))?
        != 0;
    if exists {
        return Ok(());
    }
    let head = git_text(root, &["rev-parse", "HEAD"])?;
    let now = Utc::now().to_rfc3339();
    connection
        .execute(
            "INSERT INTO history_graph_repositories (
                repo_path, repository_fingerprint, indexed_head, status, created_at, updated_at
             ) VALUES (?1, ?2, ?3, 'partial', ?4, ?4)
             ON CONFLICT(repo_path) DO NOTHING",
            params![
                canonical_repo_path,
                stable_graph_id("repository", canonical_repo_path),
                head,
                now
            ],
        )
        .map_err(|error| format!("Ensure history repository: {error}"))?;
    let metadata = git_text(
        root,
        &["show", "-s", "--format=%cI%x1f%an%x1f%s%x1f%P", revision],
    )?;
    let fields = metadata.splitn(4, '\u{1f}').collect::<Vec<_>>();
    if fields.len() != 4 {
        return Err("Git revision metadata is incomplete".to_string());
    }
    let ordinal = connection
        .query_row(
            "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM history_graph_revisions WHERE repo_path = ?1",
            params![canonical_repo_path],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Allocate history ordinal: {error}"))?;
    let tags = tags_by_commit(root)?.remove(revision).unwrap_or_default();
    connection
        .execute(
            "INSERT INTO history_graph_revisions (
                repo_path, sha, ordinal, committed_at, author_name, subject,
                parents_json, tags_json, is_release, is_head, coverage_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, '{}')",
            params![
                canonical_repo_path,
                revision,
                ordinal,
                fields[0],
                fields[1],
                fields[2],
                serde_json::to_string(&fields[3].split_whitespace().collect::<Vec<_>>())
                    .map_err(|error| error.to_string())?,
                serde_json::to_string(&tags).map_err(|error| error.to_string())?,
                i64::from(tags.iter().any(|tag| is_release_tag(tag))),
                i64::from(revision == head),
            ],
        )
        .map_err(|error| format!("Ensure history revision: {error}"))?;
    Ok(())
}

pub(crate) fn history_storage_key(canonical_repo_path: &str) -> String {
    format!("{canonical_repo_path}::codevetter-history")
}

#[tauri::command]
pub async fn history_list_releases(
    repo_path: String,
    limit: Option<usize>,
    db: State<'_, DbState>,
) -> Result<HistorySearchResult, String> {
    query_history_revisions(repo_path, None, true, limit, db).await
}

#[tauri::command]
pub async fn history_search(
    repo_path: String,
    query: String,
    limit: Option<usize>,
    db: State<'_, DbState>,
) -> Result<HistorySearchResult, String> {
    query_history_revisions(repo_path, Some(query), false, limit, db).await
}

async fn query_history_revisions(
    repo_path: String,
    query: Option<String>,
    releases_only: bool,
    limit: Option<usize>,
    db: State<'_, DbState>,
) -> Result<HistorySearchResult, String> {
    let key = canonical_repo_path(&repo_path)?
        .to_string_lossy()
        .to_string();
    let database = Arc::clone(&db.0);
    let limit = limit.unwrap_or(50).clamp(1, 200);
    tokio::task::spawn_blocking(move || {
        let connection = database
            .lock()
            .map_err(|_| "History database is unavailable".to_string())?;
        load_history_revisions(&connection, &key, query.as_deref(), releases_only, limit)
    })
    .await
    .map_err(|error| format!("History query worker failed: {error}"))?
}

pub fn load_history_revisions(
    connection: &Connection,
    repo_path: &str,
    query: Option<&str>,
    releases_only: bool,
    limit: usize,
) -> Result<HistorySearchResult, String> {
    let query = query.unwrap_or_default().trim().to_lowercase();
    let mut statement = connection
        .prepare(
            "SELECT sha, substr(sha, 1, 8), parents_json, committed_at, author_name,
                    subject, tags_json, is_release, is_head
             FROM history_graph_revisions
             WHERE repo_path = ?1
               AND (?2 = 0 OR is_release = 1)
               AND (?3 = '' OR lower(subject) LIKE '%' || ?3 || '%'
                    OR lower(author_name) LIKE '%' || ?3 || '%'
                    OR lower(tags_json) LIKE '%' || ?3 || '%'
                    OR lower(sha) LIKE ?3 || '%')
             ORDER BY ordinal DESC
             LIMIT ?4",
        )
        .map_err(|error| format!("Prepare history query: {error}"))?;
    let rows = statement
        .query_map(
            params![
                repo_path,
                i64::from(releases_only),
                query,
                (limit + 1) as i64
            ],
            |row| {
                let parents_json: String = row.get(2)?;
                let tags_json: String = row.get(6)?;
                Ok(HistoryRevision {
                    sha: row.get(0)?,
                    short_sha: row.get(1)?,
                    parents: serde_json::from_str(&parents_json).unwrap_or_default(),
                    committed_at: row.get(3)?,
                    author: row.get(4)?,
                    subject: row.get(5)?,
                    tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                    is_release: row.get::<_, i64>(7)? != 0,
                    is_head: row.get::<_, i64>(8)? != 0,
                })
            },
        )
        .map_err(|error| format!("Query history revisions: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read history revisions: {error}"))?;
    let truncated = rows.len() > limit;
    let mut revisions = rows;
    revisions.truncate(limit);
    Ok(HistorySearchResult {
        revisions,
        truncated,
    })
}

fn persist_changed_paths(
    connection: &Connection,
    topology: &HistoryTopology,
) -> Result<(), String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Start history path transaction: {error}"))?;
    let mut statement = transaction
        .prepare(
            "INSERT INTO history_graph_revision_paths (
                repo_path, revision_sha, path, change_kind, old_path, additions, deletions
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(repo_path, revision_sha, path) DO UPDATE SET
                change_kind = excluded.change_kind,
                old_path = excluded.old_path,
                additions = excluded.additions,
                deletions = excluded.deletions",
        )
        .map_err(|error| format!("Prepare history changed paths: {error}"))?;
    for path in &topology.changed_paths {
        let change = topology
            .path_changes
            .iter()
            .find(|change| change.path == *path);
        statement
            .execute(params![
                topology.repo_path,
                topology.revision,
                path,
                change
                    .map(|change| change.change_kind.as_str())
                    .unwrap_or("changed"),
                change.and_then(|change| change.old_path.as_deref()),
                change
                    .and_then(|change| change.additions)
                    .map(|value| value as i64),
                change
                    .and_then(|change| change.deletions)
                    .map(|value| value as i64),
            ])
            .map_err(|error| format!("Persist history changed path: {error}"))?;
    }
    drop(statement);
    transaction
        .commit()
        .map_err(|error| format!("Commit history changed paths: {error}"))
}

fn build_timeline(root: &Path, limit: Option<usize>) -> Result<HistoryTimeline, String> {
    let limit = limit
        .unwrap_or(DEFAULT_HISTORY_LIMIT)
        .clamp(1, MAX_HISTORY_LIMIT);
    let head = git_text(root, &["rev-parse", "HEAD"])?;
    let tags = tags_by_commit(root)?;
    let ordinals = revision_ordinals(root)?;
    let total_commits = ordinals.len();
    let is_shallow = git_text(root, &["rev-parse", "--is-shallow-repository"])? == "true";
    let format = "%H%x1f%h%x1f%P%x1f%cI%x1f%an%x1f%s%x1e";
    let output = git_bytes(
        root,
        &[
            "log",
            "--topo-order",
            &format!("--max-count={limit}"),
            &format!("--format={format}"),
        ],
    )?;
    let mut revisions = String::from_utf8_lossy(&output)
        .split('\u{1e}')
        .filter_map(|record| parse_history_revision_record(record, &tags, &head))
        .collect::<Vec<_>>();
    let mut present = revisions
        .iter()
        .map(|revision| revision.sha.clone())
        .collect::<HashSet<_>>();
    let missing_releases = tags
        .iter()
        .filter(|(_, values)| values.iter().any(|tag| is_release_tag(tag)))
        .map(|(sha, _)| sha)
        .filter(|sha| !present.contains(*sha) && git_is_ancestor(root, sha, "HEAD"))
        .cloned()
        .collect::<Vec<_>>();
    for sha in missing_releases {
        let record = git_text(root, &["show", "-s", &format!("--format={format}"), &sha])?;
        if let Some(revision) = parse_history_revision_record(&record, &tags, &head) {
            present.insert(revision.sha.clone());
            revisions.push(revision);
        }
    }
    revisions.sort_by(|left, right| {
        ordinals
            .get(&left.sha)
            .cmp(&ordinals.get(&right.sha))
            .then_with(|| left.sha.cmp(&right.sha))
    });
    let release_ranges = release_ranges(&revisions, &head);
    let truncated = total_commits > revisions.len();
    Ok(HistoryTimeline {
        schema_version: 1,
        repo_path: root.to_string_lossy().to_string(),
        head,
        generated_at: Utc::now().to_rfc3339(),
        truncated,
        is_shallow,
        coverage_complete: !is_shallow && !truncated,
        release_ranges,
        total_commits,
        revisions,
    })
}

fn parse_history_revision_record(
    record: &str,
    tags: &HashMap<String, Vec<String>>,
    head: &str,
) -> Option<HistoryRevision> {
    let fields = record
        .trim()
        .trim_end_matches('\u{1e}')
        .splitn(6, '\u{1f}')
        .collect::<Vec<_>>();
    if fields.len() != 6 || fields[0].is_empty() {
        return None;
    }
    let revision_tags = tags.get(fields[0]).cloned().unwrap_or_default();
    Some(HistoryRevision {
        sha: fields[0].to_string(),
        short_sha: fields[1].to_string(),
        parents: fields[2].split_whitespace().map(str::to_string).collect(),
        committed_at: fields[3].to_string(),
        author: fields[4].to_string(),
        subject: fields[5].to_string(),
        is_release: revision_tags.iter().any(|tag| is_release_tag(tag)),
        is_head: fields[0] == head,
        tags: revision_tags,
    })
}

fn revision_ordinals(root: &Path) -> Result<HashMap<String, i64>, String> {
    let output = git_text(root, &["rev-list", "--topo-order", "--reverse", "HEAD"])?;
    Ok(output
        .lines()
        .filter(|sha| !sha.is_empty())
        .enumerate()
        .map(|(ordinal, sha)| (sha.to_string(), ordinal as i64))
        .collect())
}

fn release_ranges(revisions: &[HistoryRevision], head: &str) -> Vec<HistoryReleaseRange> {
    let mut ranges = Vec::new();
    let mut start = 0;
    let mut previous_release = None::<String>;
    for (index, revision) in revisions.iter().enumerate() {
        if !revision.is_release {
            continue;
        }
        let tag = revision
            .tags
            .iter()
            .find(|tag| is_release_tag(tag))
            .cloned();
        let label = tag
            .clone()
            .unwrap_or_else(|| format!("Release {}", revision.short_sha));
        ranges.push(HistoryReleaseRange {
            id: stable_graph_id(
                "release-range",
                &format!("{}\0{}", revision.sha, tag.as_deref().unwrap_or_default()),
            ),
            label,
            tag,
            from_exclusive: previous_release.clone(),
            to_inclusive: revision.sha.clone(),
            commit_shas: revisions[start..=index]
                .iter()
                .map(|commit| commit.sha.clone())
                .collect(),
            is_unreleased: false,
        });
        start = index + 1;
        previous_release = Some(revision.sha.clone());
    }
    ranges.push(HistoryReleaseRange {
        id: stable_graph_id(
            "release-range",
            &format!(
                "unreleased\0{}",
                previous_release.as_deref().unwrap_or("root")
            ),
        ),
        label: "Unreleased".to_string(),
        tag: None,
        from_exclusive: previous_release,
        to_inclusive: head.to_string(),
        commit_shas: revisions[start..]
            .iter()
            .map(|commit| commit.sha.clone())
            .collect(),
        is_unreleased: true,
    });
    ranges
}

fn timeline_tag_fingerprint(timeline: &HistoryTimeline) -> String {
    let tag_identity = timeline
        .revisions
        .iter()
        .flat_map(|revision| {
            revision
                .tags
                .iter()
                .map(move |tag| format!("{}\0{tag}", revision.sha))
        })
        .collect::<Vec<_>>()
        .join("\0");
    stable_graph_id("tags", &tag_identity)
}

pub(crate) fn repository_tag_fingerprint(root: &Path) -> Result<String, String> {
    let mut tag_identity = tags_by_commit(root)?
        .into_iter()
        .flat_map(|(sha, tags)| {
            tags.into_iter()
                .filter(|tag| is_release_tag(tag))
                .map(move |tag| format!("{sha}\0{tag}"))
        })
        .collect::<Vec<_>>();
    tag_identity.sort();
    Ok(stable_graph_id("tags", &tag_identity.join("\0")))
}

fn classify_history_refresh(
    previous_head: Option<&str>,
    rewritten: bool,
    engine_incompatible: bool,
    fast_forward: bool,
    tags_changed: bool,
) -> &'static str {
    if previous_head.is_none() {
        "initial"
    } else if rewritten {
        "rewritten_history"
    } else if engine_incompatible {
        "engine_repair"
    } else if fast_forward {
        "fast_forward"
    } else if tags_changed {
        "tag_metadata"
    } else {
        "no_op"
    }
}

fn has_incompatible_history_checkpoints(
    connection: &Connection,
    repo_path: &str,
) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM history_graph_checkpoints
                WHERE repo_path = ?1
                  AND (engine_id != ?2 OR engine_version != ?3 OR schema_version != ?4)
             )",
            params![
                repo_path,
                BUNDLED_ENGINE_ID,
                BUNDLED_ENGINE_VERSION,
                STRUCTURAL_GRAPH_SCHEMA_VERSION,
            ],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("Inspect history checkpoint compatibility: {error}"))
}

fn compatible_history_checkpoint_exists(
    connection: &Connection,
    repo_path: &str,
    revision: &str,
) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM history_graph_checkpoints
                WHERE repo_path = ?1 AND revision_sha = ?2
                  AND engine_id = ?3 AND engine_version = ?4 AND schema_version = ?5
                  AND status = 'ready'
             )",
            params![
                repo_path,
                revision,
                BUNDLED_ENGINE_ID,
                BUNDLED_ENGINE_VERSION,
                STRUCTURAL_GRAPH_SCHEMA_VERSION,
            ],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("Inspect history checkpoint cache: {error}"))
}

#[cfg(test)]
fn repair_derived_history(
    connection: &Connection,
    repo_path: &str,
    rewritten: bool,
    engine_incompatible: bool,
    recorded_at: &str,
) -> Result<usize, String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Start history repair transaction: {error}"))?;
    let snapshot_ids = if rewritten {
        let mut statement = transaction
            .prepare("SELECT snapshot_id FROM history_graph_checkpoints WHERE repo_path = ?1")
            .map_err(|error| format!("Prepare rewritten checkpoint repair: {error}"))?;
        let snapshot_ids = statement
            .query_map(params![repo_path], |row| row.get::<_, String>(0))
            .map_err(|error| format!("Query rewritten checkpoints: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Read rewritten checkpoints: {error}"))?;
        snapshot_ids
    } else {
        let mut statement = transaction
            .prepare(
                "SELECT snapshot_id FROM history_graph_checkpoints
                 WHERE repo_path = ?1
                   AND (engine_id != ?2 OR engine_version != ?3 OR schema_version != ?4)",
            )
            .map_err(|error| format!("Prepare engine checkpoint repair: {error}"))?;
        let snapshot_ids = statement
            .query_map(
                params![
                    repo_path,
                    BUNDLED_ENGINE_ID,
                    BUNDLED_ENGINE_VERSION,
                    STRUCTURAL_GRAPH_SCHEMA_VERSION,
                ],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| format!("Query incompatible checkpoints: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Read incompatible checkpoints: {error}"))?;
        snapshot_ids
    };
    let checkpoints_deleted = if rewritten {
        transaction
            .execute(
                "DELETE FROM history_graph_checkpoints WHERE repo_path = ?1",
                params![repo_path],
            )
            .map_err(|error| format!("Delete rewritten checkpoints: {error}"))?
    } else if engine_incompatible {
        transaction
            .execute(
                "DELETE FROM history_graph_checkpoints
                 WHERE repo_path = ?1
                   AND (engine_id != ?2 OR engine_version != ?3 OR schema_version != ?4)",
                params![
                    repo_path,
                    BUNDLED_ENGINE_ID,
                    BUNDLED_ENGINE_VERSION,
                    STRUCTURAL_GRAPH_SCHEMA_VERSION,
                ],
            )
            .map_err(|error| format!("Delete incompatible checkpoints: {error}"))?
    } else {
        0
    };
    let mut snapshots_deleted = 0;
    for snapshot_id in snapshot_ids {
        snapshots_deleted += transaction
            .execute(
                "DELETE FROM structural_graph_snapshots WHERE id = ?1",
                params![snapshot_id],
            )
            .map_err(|error| format!("Delete invalid structural snapshot: {error}"))?;
        snapshots_deleted += transaction
            .execute(
                "DELETE FROM history_graph_snapshot_blobs WHERE snapshot_id = ?1",
                params![snapshot_id],
            )
            .map_err(|error| format!("Delete invalid compressed history snapshot: {error}"))?;
    }
    let events_deleted = transaction
        .execute(
            if rewritten {
                "DELETE FROM history_graph_events
                 WHERE repo_path = ?1
                   AND source_id IN ('git', 'codevetter-structural-history', 'codevetter-lineage')"
            } else {
                "DELETE FROM history_graph_events
                 WHERE repo_path = ?1
                   AND source_id IN ('codevetter-structural-history', 'codevetter-lineage')"
            },
            params![repo_path],
        )
        .map_err(|error| format!("Delete derived history events: {error}"))?;
    let revisions_deleted = if rewritten {
        transaction
            .execute(
                "DELETE FROM history_graph_revisions WHERE repo_path = ?1",
                params![repo_path],
            )
            .map_err(|error| format!("Delete rewritten revision index: {error}"))?
    } else {
        0
    };
    let reason = if rewritten {
        "git_history_rewritten"
    } else {
        "structural_engine_changed"
    };
    transaction
        .execute(
            "INSERT OR REPLACE INTO history_graph_events (
                id, repo_path, event_kind, trust, origin, source_id, source_cursor,
                payload_json, evidence_json, recorded_at
             ) VALUES (?1, ?2, 'invalidation', 'extracted', 'analysis',
                'codevetter-history-repair', ?3, ?4, '[]', ?5)",
            params![
                stable_graph_id(
                    "history-event",
                    &format!("repair\0{repo_path}\0{reason}\0{recorded_at}")
                ),
                repo_path,
                reason,
                serde_json::json!({
                    "reason": reason,
                    "repair_scope": if rewritten {
                        "derived_revisions_checkpoints_snapshots_events"
                    } else {
                        "incompatible_checkpoints_snapshots_and_structural_events"
                    },
                    "preserved": ["imported_evidence", "user_annotations"],
                })
                .to_string(),
                recorded_at,
            ],
        )
        .map_err(|error| format!("Record history repair event: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Commit history repair: {error}"))?;
    Ok(checkpoints_deleted + snapshots_deleted + events_deleted + revisions_deleted)
}

fn prune_unreachable_history(
    connection: &Connection,
    root: &Path,
    repo_path: &str,
) -> Result<usize, String> {
    let reachable = revision_ordinals(root)?.into_keys().collect::<HashSet<_>>();
    let mut statement = connection
        .prepare("SELECT sha FROM history_graph_revisions WHERE repo_path = ?1 ORDER BY sha")
        .map_err(|error| format!("Prepare unreachable history cleanup: {error}"))?;
    let revisions = statement
        .query_map(params![repo_path], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Query unreachable history revisions: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read unreachable history revisions: {error}"))?;
    drop(statement);
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Start unreachable history cleanup: {error}"))?;
    let mut removed = 0;
    for revision in revisions
        .into_iter()
        .filter(|revision| !reachable.contains(revision))
    {
        let snapshot_ids = {
            let mut statement = transaction
                .prepare(
                    "SELECT snapshot_id FROM history_graph_checkpoints
                     WHERE repo_path = ?1 AND revision_sha = ?2",
                )
                .map_err(|error| format!("Prepare unreachable checkpoint cleanup: {error}"))?;
            let snapshot_ids = statement
                .query_map(params![repo_path, revision], |row| row.get::<_, String>(0))
                .map_err(|error| format!("Query unreachable checkpoints: {error}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Read unreachable checkpoints: {error}"))?;
            snapshot_ids
        };
        removed += transaction
            .execute(
                "DELETE FROM history_graph_events
                 WHERE repo_path = ?1 AND revision_sha = ?2
                   AND source_id IN ('git', 'codevetter-structural-history', 'codevetter-lineage')",
                params![repo_path, revision],
            )
            .map_err(|error| format!("Delete unreachable derived events: {error}"))?;
        removed += transaction
            .execute(
                "DELETE FROM history_graph_revisions WHERE repo_path = ?1 AND sha = ?2",
                params![repo_path, revision],
            )
            .map_err(|error| format!("Delete unreachable history revision: {error}"))?;
        for snapshot_id in snapshot_ids {
            removed += transaction
                .execute(
                    "DELETE FROM structural_graph_snapshots WHERE id = ?1",
                    params![snapshot_id],
                )
                .map_err(|error| format!("Delete unreachable structural snapshot: {error}"))?;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("Commit unreachable history cleanup: {error}"))?;
    Ok(removed)
}

fn prune_incompatible_history_checkpoints(
    connection: &Connection,
    repo_path: &str,
) -> Result<usize, String> {
    let mut statement = connection
        .prepare(
            "SELECT snapshot_id FROM history_graph_checkpoints
             WHERE repo_path = ?1
               AND (engine_id != ?2 OR engine_version != ?3 OR schema_version != ?4)",
        )
        .map_err(|error| format!("Prepare incompatible checkpoint cleanup: {error}"))?;
    let snapshot_ids = statement
        .query_map(
            params![
                repo_path,
                BUNDLED_ENGINE_ID,
                BUNDLED_ENGINE_VERSION,
                STRUCTURAL_GRAPH_SCHEMA_VERSION,
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| format!("Query incompatible checkpoints: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read incompatible checkpoints: {error}"))?;
    drop(statement);
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Start incompatible checkpoint cleanup: {error}"))?;
    let mut removed = transaction
        .execute(
            "DELETE FROM history_graph_checkpoints
             WHERE repo_path = ?1
               AND (engine_id != ?2 OR engine_version != ?3 OR schema_version != ?4)",
            params![
                repo_path,
                BUNDLED_ENGINE_ID,
                BUNDLED_ENGINE_VERSION,
                STRUCTURAL_GRAPH_SCHEMA_VERSION,
            ],
        )
        .map_err(|error| format!("Delete incompatible checkpoints: {error}"))?;
    for snapshot_id in snapshot_ids {
        removed += transaction
            .execute(
                "DELETE FROM structural_graph_snapshots WHERE id = ?1",
                params![snapshot_id],
            )
            .map_err(|error| format!("Delete incompatible structural snapshot: {error}"))?;
        removed += transaction
            .execute(
                "DELETE FROM history_graph_snapshot_blobs WHERE snapshot_id = ?1",
                params![snapshot_id],
            )
            .map_err(|error| format!("Delete incompatible compressed snapshot: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Commit incompatible checkpoint cleanup: {error}"))?;
    Ok(removed)
}

fn history_adapter_cursor_json(
    connection: &Connection,
    repo_path: &str,
    head: &str,
) -> Result<String, String> {
    let mut statement = connection
        .prepare(
            "SELECT source_id, MAX(source_cursor)
             FROM history_graph_events
             WHERE repo_path = ?1 AND source_cursor IS NOT NULL
             GROUP BY source_id ORDER BY source_id",
        )
        .map_err(|error| format!("Prepare history adapter cursors: {error}"))?;
    let adapters = statement
        .query_map(params![repo_path], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("Query history adapter cursors: {error}"))?
        .collect::<Result<BTreeMap<_, _>, _>>()
        .map_err(|error| format!("Read history adapter cursors: {error}"))?;
    Ok(serde_json::json!({ "head": head, "adapters": adapters }).to_string())
}

#[cfg(test)]
fn persist_history_adapter_cursors(
    connection: &Connection,
    repo_path: &str,
    head: &str,
) -> Result<(), String> {
    let cursor_json = history_adapter_cursor_json(connection, repo_path, head)?;
    connection
        .execute(
            "UPDATE history_graph_repositories SET cursor_json = ?2 WHERE repo_path = ?1",
            params![repo_path, cursor_json],
        )
        .map_err(|error| format!("Persist history adapter cursors: {error}"))?;
    Ok(())
}

#[cfg(test)]
fn persist_timeline(connection: &Connection, timeline: &HistoryTimeline) -> Result<(), String> {
    persist_timeline_with_publication(connection, timeline, true)
}

fn persist_timeline_catalog(
    connection: &Connection,
    timeline: &HistoryTimeline,
) -> Result<(), String> {
    persist_timeline_with_publication(connection, timeline, false)
}

fn persist_timeline_with_publication(
    connection: &Connection,
    timeline: &HistoryTimeline,
    publish: bool,
) -> Result<(), String> {
    let root = Path::new(&timeline.repo_path);
    let tag_fingerprint =
        repository_tag_fingerprint(root).unwrap_or_else(|_| timeline_tag_fingerprint(timeline));
    let ordinals = revision_ordinals(root).unwrap_or_else(|_| {
        timeline
            .revisions
            .iter()
            .enumerate()
            .map(|(ordinal, revision)| (revision.sha.clone(), ordinal as i64))
            .collect()
    });
    let previous_tag_fingerprint = connection
        .query_row(
            "SELECT indexed_tags_fingerprint FROM history_graph_repositories
             WHERE repo_path = ?1",
            params![timeline.repo_path],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| format!("Load prior tag fingerprint: {error}"))?
        .flatten();
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Start history transaction: {error}"))?;
    if publish {
        transaction
            .execute(
                "INSERT INTO history_graph_repositories (
                repo_path, repository_fingerprint, indexed_head, indexed_tags_fingerprint,
                status, cursor_json, coverage_json, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, 'ready', ?5, ?6, ?7, ?7)
             ON CONFLICT(repo_path) DO UPDATE SET
                indexed_head = excluded.indexed_head,
                indexed_tags_fingerprint = excluded.indexed_tags_fingerprint,
                status = excluded.status,
                cursor_json = excluded.cursor_json,
                coverage_json = excluded.coverage_json,
                updated_at = excluded.updated_at",
                params![
                    timeline.repo_path,
                    stable_graph_id("repository", &timeline.repo_path),
                    timeline.head,
                    tag_fingerprint,
                    serde_json::json!({ "head": timeline.head }).to_string(),
                    serde_json::json!({
                        "loaded_commits": timeline.revisions.len(),
                        "total_commits": timeline.total_commits,
                        "truncated": timeline.truncated,
                        "is_shallow": timeline.is_shallow,
                        "coverage_complete": timeline.coverage_complete,
                    })
                    .to_string(),
                    timeline.generated_at,
                ],
            )
            .map_err(|error| format!("Persist history repository: {error}"))?;
    } else {
        transaction
            .execute(
                "INSERT INTO history_graph_repositories (
                    repo_path, repository_fingerprint, indexed_head, indexed_tags_fingerprint,
                    status, cursor_json, coverage_json, created_at, updated_at
                 ) VALUES (?1, ?2, NULL, NULL, 'pending', '{}', '{}', ?3, ?3)
                 ON CONFLICT(repo_path) DO UPDATE SET updated_at = excluded.updated_at",
                params![
                    timeline.repo_path,
                    stable_graph_id("repository", &timeline.repo_path),
                    timeline.generated_at,
                ],
            )
            .map_err(|error| format!("Persist history repository catalog: {error}"))?;
    }
    let existing_revisions = {
        let mut statement = transaction
            .prepare("SELECT sha FROM history_graph_revisions WHERE repo_path = ?1 ORDER BY sha")
            .map_err(|error| format!("Prepare existing history revisions: {error}"))?;
        let revisions = statement
            .query_map(params![timeline.repo_path], |row| row.get::<_, String>(0))
            .map_err(|error| format!("Query existing history revisions: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Read existing history revisions: {error}"))?;
        revisions
    };
    for (index, sha) in existing_revisions.iter().enumerate() {
        transaction
            .execute(
                "UPDATE history_graph_revisions SET ordinal = ?3
                 WHERE repo_path = ?1 AND sha = ?2",
                params![timeline.repo_path, sha, -1_i64 - index as i64],
            )
            .map_err(|error| format!("Stage stable history ordinal: {error}"))?;
    }
    transaction
        .execute(
            "UPDATE history_graph_revisions
             SET is_head = 0, is_release = 0, tags_json = '[]' WHERE repo_path = ?1",
            params![timeline.repo_path],
        )
        .map_err(|error| format!("Reset history head: {error}"))?;
    let mut statement = transaction
        .prepare(
            "INSERT INTO history_graph_revisions (
                repo_path, sha, ordinal, committed_at, author_name, subject,
                parents_json, tags_json, is_release, is_head, coverage_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, '{}')
             ON CONFLICT(repo_path, sha) DO UPDATE SET
                ordinal = excluded.ordinal,
                committed_at = excluded.committed_at,
                author_name = excluded.author_name,
                subject = excluded.subject,
                parents_json = excluded.parents_json,
                tags_json = excluded.tags_json,
                is_release = excluded.is_release,
                is_head = excluded.is_head",
        )
        .map_err(|error| format!("Prepare history revisions: {error}"))?;
    for revision in &timeline.revisions {
        let ordinal = ordinals.get(&revision.sha).copied().unwrap_or(i64::MAX);
        statement
            .execute(params![
                timeline.repo_path,
                revision.sha,
                ordinal,
                revision.committed_at,
                revision.author,
                revision.subject,
                serde_json::to_string(&revision.parents).map_err(|error| error.to_string())?,
                serde_json::to_string(&revision.tags).map_err(|error| error.to_string())?,
                i64::from(revision.is_release),
                i64::from(revision.is_head),
            ])
            .map_err(|error| format!("Persist history revision: {error}"))?;
    }
    drop(statement);
    for sha in existing_revisions {
        let Some(ordinal) = ordinals.get(&sha) else {
            continue;
        };
        transaction
            .execute(
                "UPDATE history_graph_revisions SET ordinal = ?3
                 WHERE repo_path = ?1 AND sha = ?2",
                params![timeline.repo_path, sha, ordinal],
            )
            .map_err(|error| format!("Restore stable history ordinal: {error}"))?;
    }
    transaction
        .execute(
            "DELETE FROM history_graph_events WHERE repo_path = ?1 AND source_id = 'git'",
            params![timeline.repo_path],
        )
        .map_err(|error| format!("Replace Git timeline events: {error}"))?;
    let mut event_statement = transaction
        .prepare(
            "INSERT OR IGNORE INTO history_graph_events (
                id, repo_path, revision_sha, event_kind, trust, origin, source_id,
                source_cursor, payload_json, evidence_json, recorded_at
             ) VALUES (?1, ?2, ?3, ?4, 'extracted', 'metadata', 'git', ?5, ?6,
                '[]', ?7)",
        )
        .map_err(|error| format!("Prepare Git timeline events: {error}"))?;
    for revision in &timeline.revisions {
        event_statement
            .execute(params![
                stable_graph_id(
                    "history-event",
                    &format!("commit\0{}\0{}", timeline.repo_path, revision.sha)
                ),
                timeline.repo_path,
                revision.sha,
                "commit",
                revision.sha,
                serde_json::json!({
                    "sha": revision.sha,
                    "parents": revision.parents,
                    "subject": revision.subject,
                })
                .to_string(),
                revision.committed_at,
            ])
            .map_err(|error| format!("Persist Git commit event: {error}"))?;
        for tag in &revision.tags {
            event_statement
                .execute(params![
                    stable_graph_id(
                        "history-event",
                        &format!("release\0{}\0{}\0{tag}", timeline.repo_path, revision.sha)
                    ),
                    timeline.repo_path,
                    revision.sha,
                    "release",
                    format!("{}:{tag}", revision.sha),
                    serde_json::json!({
                        "sha": revision.sha,
                        "tag": tag,
                        "subject": revision.subject,
                        "recognized_release": revision.is_release,
                    })
                    .to_string(),
                    revision.committed_at,
                ])
                .map_err(|error| format!("Persist Git release event: {error}"))?;
        }
    }
    event_statement
        .execute(params![
            stable_graph_id(
                "history-event",
                &format!(
                    "coverage\0{}\0{}\0{}\0{}",
                    timeline.repo_path,
                    timeline.head,
                    timeline.revisions.len(),
                    timeline.coverage_complete
                )
            ),
            timeline.repo_path,
            timeline.head,
            "coverage",
            format!("coverage:{}", timeline.head),
            serde_json::json!({
                "loaded_commits": timeline.revisions.len(),
                "total_commits": timeline.total_commits,
                "truncated": timeline.truncated,
                "is_shallow": timeline.is_shallow,
                "coverage_complete": timeline.coverage_complete,
            })
            .to_string(),
            timeline.generated_at,
        ])
        .map_err(|error| format!("Persist Git coverage event: {error}"))?;
    if let Some(previous) = previous_tag_fingerprint.filter(|value| value != &tag_fingerprint) {
        event_statement
            .execute(params![
                stable_graph_id(
                    "history-event",
                    &format!(
                        "invalidation\0{}\0{}\0{}",
                        timeline.repo_path, previous, tag_fingerprint
                    )
                ),
                timeline.repo_path,
                timeline.head,
                "invalidation",
                format!("tags:{tag_fingerprint}"),
                serde_json::json!({
                    "reason": "tag_fingerprint_changed",
                    "previous": previous,
                    "current": tag_fingerprint,
                    "repair_scope": "release_ranges_and_descendant_deltas",
                })
                .to_string(),
                timeline.generated_at,
            ])
            .map_err(|error| format!("Persist history invalidation event: {error}"))?;
    }
    drop(event_statement);
    transaction
        .commit()
        .map_err(|error| format!("Commit history timeline: {error}"))
}

fn build_topology(
    root: &Path,
    revision: &str,
    max_nodes: Option<usize>,
) -> Result<HistoryTopology, String> {
    let revision = resolve_revision(root, revision)?;
    let output = git_bytes(root, &["ls-tree", "-r", "--name-only", "-z", &revision])?;
    let mut files = output
        .split(|byte| *byte == 0)
        .filter(|bytes| !bytes.is_empty())
        .map(|bytes| String::from_utf8_lossy(bytes).replace('\\', "/"))
        .collect::<Vec<_>>();
    files.sort();
    let total_files = files.len();
    let limit = max_nodes
        .unwrap_or(DEFAULT_GRAPH_LIMIT)
        .clamp(20, MAX_GRAPH_LIMIT);
    let path_changes = changed_path_records(root, &revision)?;
    let changed_paths = path_changes
        .iter()
        .map(|change| change.path.clone())
        .collect::<HashSet<_>>();

    let mut directory_counts = BTreeMap::<String, usize>::new();
    for path in &files {
        let mut current = String::new();
        for component in Path::new(path)
            .components()
            .take(path.split('/').count().saturating_sub(1))
        {
            let component = component.as_os_str().to_string_lossy();
            if !current.is_empty() {
                current.push('/');
            }
            current.push_str(&component);
            *directory_counts.entry(current.clone()).or_default() += 1;
        }
    }
    let mut selected_directories = directory_counts.into_iter().collect::<Vec<_>>();
    selected_directories.sort_by(|(left_path, left_count), (right_path, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_path.cmp(right_path))
    });
    let directory_budget = (limit / 3).max(8);
    selected_directories.truncate(directory_budget);
    let directory_ids = selected_directories
        .iter()
        .map(|(path, _)| path.as_str())
        .collect::<HashSet<_>>();

    files.sort_by(|left, right| {
        changed_paths
            .contains(right)
            .cmp(&changed_paths.contains(left))
            .then_with(|| left.cmp(right))
    });
    let file_budget = limit.saturating_sub(selected_directories.len());
    files.truncate(file_budget);
    let mut nodes = Vec::with_capacity(selected_directories.len() + files.len());
    for (path, count) in &selected_directories {
        nodes.push(HistoryTopologyNode {
            id: stable_graph_id("directory", path),
            kind: "directory".to_string(),
            label: path.rsplit('/').next().unwrap_or(path).to_string(),
            path: path.clone(),
            detail: format!("{count} files at this revision"),
        });
    }
    for path in &files {
        nodes.push(HistoryTopologyNode {
            id: stable_graph_id("file", path),
            kind: if changed_paths.contains(path) {
                "changed_file"
            } else {
                "file"
            }
            .to_string(),
            label: path.rsplit('/').next().unwrap_or(path).to_string(),
            path: path.clone(),
            detail: if changed_paths.contains(path) {
                "changed in this revision"
            } else {
                "present at this revision"
            }
            .to_string(),
        });
    }
    let node_ids = nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    let mut edges = Vec::new();
    for node in &nodes {
        let Some(parent) = Path::new(&node.path).parent().and_then(Path::to_str) else {
            continue;
        };
        if parent.is_empty() || !directory_ids.contains(parent) {
            continue;
        }
        let parent_id = stable_graph_id("directory", parent);
        if node_ids.contains(parent_id.as_str()) {
            edges.push(HistoryTopologyEdge {
                id: stable_graph_id("edge", &format!("contains\0{parent_id}\0{}", node.id)),
                from: parent_id,
                to: node.id.clone(),
                kind: "contains".to_string(),
            });
        }
    }
    nodes.sort_by(|left, right| left.id.cmp(&right.id));
    edges.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(HistoryTopology {
        schema_version: 1,
        repo_path: root.to_string_lossy().to_string(),
        revision,
        nodes,
        edges,
        changed_paths: changed_paths.into_iter().collect(),
        path_changes,
        total_files,
        truncated: total_files > file_budget,
    })
}

fn changed_path_records(root: &Path, revision: &str) -> Result<Vec<HistoryPathChange>, String> {
    let revision = resolve_revision(root, revision)?;
    let parent_line = git_text(root, &["rev-list", "--parents", "-n", "1", &revision])?;
    let parents = parent_line.split_whitespace().skip(1).collect::<Vec<_>>();
    if let Some(parent) = parents.first() {
        return changed_path_records_between(root, parent, &revision);
    }
    let output = git_bytes(
        root,
        &[
            "diff-tree",
            "--root",
            "--no-commit-id",
            "--name-status",
            "-M",
            "-C",
            "--find-copies-harder",
            "-r",
            "-z",
            &revision,
        ],
    )?;
    parse_changed_path_records(&output)
}

fn changed_path_records_between(
    root: &Path,
    before_revision: &str,
    after_revision: &str,
) -> Result<Vec<HistoryPathChange>, String> {
    let before_revision = resolve_revision(root, before_revision)?;
    let after_revision = resolve_revision(root, after_revision)?;
    let output = git_bytes(
        root,
        &[
            "diff",
            "--name-status",
            "-M",
            "-C",
            "--find-copies-harder",
            "-z",
            &before_revision,
            &after_revision,
        ],
    )?;
    parse_changed_path_records(&output)
}

fn parse_changed_path_records(output: &[u8]) -> Result<Vec<HistoryPathChange>, String> {
    let fields = output
        .split(|byte| *byte == 0)
        .filter(|bytes| !bytes.is_empty())
        .map(|bytes| String::from_utf8_lossy(bytes).replace('\\', "/"))
        .collect::<Vec<_>>();
    let mut changes = Vec::new();
    let mut index = 0;
    while index < fields.len() {
        let status = fields[index].clone();
        index += 1;
        let Some(first_path) = fields.get(index).cloned() else {
            return Err("Git history change output ended before a path".to_string());
        };
        index += 1;
        let kind = status.chars().next().unwrap_or('M');
        let (path, old_path) = if matches!(kind, 'R' | 'C') {
            let Some(new_path) = fields.get(index).cloned() else {
                return Err("Git history rename/copy output ended before a destination".to_string());
            };
            index += 1;
            (new_path, Some(first_path))
        } else {
            (first_path, None)
        };
        changes.push(HistoryPathChange {
            path,
            change_kind: match kind {
                'A' => "added",
                'D' => "deleted",
                'R' => "renamed",
                'C' => "copied",
                'T' => "type_changed",
                _ => "modified",
            }
            .to_string(),
            old_path,
            additions: None,
            deletions: None,
        });
    }
    changes.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(changes)
}

fn tags_by_commit(root: &Path) -> Result<HashMap<String, Vec<String>>, String> {
    let mut tags = HashMap::<String, Vec<String>>::new();
    for tag in read_git_tags(root)? {
        tags.entry(tag.commit_sha).or_default().push(tag.name);
    }
    for values in tags.values_mut() {
        values.sort();
    }
    Ok(tags)
}

fn resolve_revision(root: &Path, revision: &str) -> Result<String, String> {
    let revision = revision.trim();
    if revision.is_empty() || revision.len() > 128 || revision.starts_with('-') {
        return Err("A valid Git revision is required".to_string());
    }
    git_text(
        root,
        &["rev-parse", "--verify", &format!("{revision}^{{commit}}")],
    )
}

pub(crate) fn canonical_repo_path(repo_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(repo_path.trim())
        .canonicalize()
        .map_err(|error| format!("Cannot resolve repository path: {error}"))?;
    if !path.is_dir() {
        return Err("Repository path is not a directory".to_string());
    }
    Ok(path)
}

fn git_text(root: &Path, arguments: &[&str]) -> Result<String, String> {
    String::from_utf8(git_bytes(root, arguments)?)
        .map(|value| value.trim().to_string())
        .map_err(|error| format!("Git returned invalid UTF-8: {error}"))
}

fn git_bytes(root: &Path, arguments: &[&str]) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(arguments)
        .output()
        .map_err(|error| format!("Failed to run git {}: {error}", arguments.join(" ")))?;
    if !output.status.success() {
        return Err(format!(
            "Git {} failed: {}",
            arguments.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn timeline_and_topology_are_stable_and_release_aware() {
        let root = std::env::temp_dir().join(format!("cv-history-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).expect("fixture");
        run_git(&root, &["init"]);
        run_git(&root, &["config", "user.email", "fixture@local"]);
        run_git(&root, &["config", "user.name", "Fixture"]);
        fs::write(root.join("src/a.rs"), "fn a() {}\n").expect("a");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "feat: first"]);
        run_git(&root, &["tag", "v1.0.0"]);
        fs::write(root.join("src/b.rs"), "fn b() {}\n").expect("b");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "feat: second"]);

        let timeline = build_timeline(&root, Some(20)).expect("timeline");
        assert_eq!(timeline.revisions.len(), 2);
        assert!(timeline.revisions[0].is_release);
        assert!(timeline.revisions[1].is_head);
        assert!(!timeline.is_shallow);
        assert!(timeline.coverage_complete);
        assert_eq!(timeline.release_ranges.len(), 2);
        assert_eq!(timeline.release_ranges[0].tag.as_deref(), Some("v1.0.0"));
        assert!(timeline.release_ranges[1].is_unreleased);
        assert_eq!(timeline.release_ranges[1].commit_shas.len(), 1);
        assert_eq!(
            resolve_temporal_reference(
                &root,
                &HistoryTemporalReference::Release {
                    tag: "v1.0.0".to_string(),
                },
            )
            .expect("release reference"),
            timeline.revisions[0].sha
        );
        let topology = build_topology(&root, &timeline.head, Some(40)).expect("topology");
        let first_topology =
            build_topology(&root, &timeline.revisions[0].sha, Some(40)).expect("first topology");
        assert_eq!(topology.total_files, 2);
        assert!(topology.nodes.iter().any(|node| node.path == "src/b.rs"));
        let first_a = first_topology
            .nodes
            .iter()
            .find(|node| node.path == "src/a.rs")
            .expect("first a");
        let current_a = topology
            .nodes
            .iter()
            .find(|node| node.path == "src/a.rs")
            .expect("current a");
        assert_eq!(first_a.id, current_a.id, "persistent paths keep stable IDs");
        fs::write(root.join("src/a.rs"), "fn worktree_only() {}\n").expect("dirty worktree");
        let blobs = GitObjectReader::new(&root)
            .blobs_at(&timeline.revisions[0].sha)
            .expect("historical blobs");
        assert_eq!(blobs.len(), 1);
        assert_eq!(blobs[0].path, "src/a.rs");
        assert!(String::from_utf8_lossy(&blobs[0].bytes).contains("fn a"));
        assert!(!String::from_utf8_lossy(&blobs[0].bytes).contains("worktree_only"));
        let historical_snapshot = build_snapshot_from_blobs(
            &history_storage_key(&timeline.repo_path),
            &timeline.revisions[0].sha,
            blobs,
            &StructuralGraphCancellation::default(),
            &|_: StructuralGraphProgress| {},
        )
        .expect("historical structural snapshot");
        assert!(historical_snapshot
            .nodes
            .iter()
            .any(|node| node.label == "a"));
        assert!(!historical_snapshot
            .nodes
            .iter()
            .any(|node| node.label == "worktree_only" || node.label == "b"));
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("migrations");
        persist_timeline(&connection, &timeline).expect("persist timeline");
        persist_changed_paths(&connection, &topology).expect("persist changed paths");
        let revision_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM history_graph_revisions", [], |row| {
                row.get(0)
            })
            .expect("revision count");
        assert_eq!(revision_count, 2);
        let event_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM history_graph_events", [], |row| {
                row.get(0)
            })
            .expect("history event count");
        assert_eq!(
            event_count, 4,
            "commits, release, and coverage are ledger events"
        );
        let releases = load_history_revisions(&connection, &timeline.repo_path, None, true, 10)
            .expect("release query");
        assert_eq!(releases.revisions.len(), 1);
        let search =
            load_history_revisions(&connection, &timeline.repo_path, Some("second"), false, 10)
                .expect("history search");
        assert_eq!(search.revisions[0].subject, "feat: second");
        let changed_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM history_graph_revision_paths",
                [],
                |row| row.get(0),
            )
            .expect("changed path count");
        assert!(changed_count >= 1);
        run_git(&root, &["tag", "v1.1.0"]);
        let retagged = build_timeline(&root, Some(20)).expect("retagged timeline");
        persist_timeline(&connection, &retagged).expect("persist retagged timeline");
        let invalidations: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM history_graph_events WHERE event_kind = 'invalidation'",
                [],
                |row| row.get(0),
            )
            .expect("invalidation count");
        assert_eq!(invalidations, 1);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn invalid_revision_is_rejected_before_git_option_parsing() {
        let root = std::env::temp_dir();
        assert_eq!(
            resolve_revision(&root, "--upload-pack=bad").unwrap_err(),
            "A valid Git revision is required"
        );
    }

    #[test]
    fn historical_file_bounds_remain_explicit_in_snapshot_coverage() {
        let mut snapshot = build_snapshot_from_blobs(
            "history:test",
            "revision",
            vec![HistoricalFileBlob {
                path: "src/lib.rs".to_string(),
                bytes: b"fn indexed() {}\n".to_vec(),
            }],
            &StructuralGraphCancellation::default(),
            &|_: StructuralGraphProgress| {},
        )
        .expect("snapshot");
        apply_historical_file_coverage(&mut snapshot, 25_001, true);
        assert!(snapshot.truncated);
        assert_eq!(snapshot.coverage.discovered_files, 25_001);
        assert!(snapshot.coverage.skipped_files >= 25_000);
        assert!(snapshot
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "historical_file_limit"));
    }

    #[test]
    fn repository_without_tags_has_one_explicit_unreleased_range() {
        let root =
            std::env::temp_dir().join(format!("cv-history-no-tags-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("fixture");
        run_git(&root, &["init"]);
        run_git(&root, &["config", "user.email", "fixture@local"]);
        run_git(&root, &["config", "user.name", "Fixture"]);
        fs::write(root.join("main.rs"), "fn main() {}\n").expect("main");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "initial"]);
        let timeline = build_timeline(&root, Some(20)).expect("timeline");
        assert_eq!(timeline.release_ranges.len(), 1);
        assert!(timeline.release_ranges[0].is_unreleased);
        assert_eq!(
            timeline.release_ranges[0].commit_shas,
            vec![timeline.head.clone()]
        );
        assert_eq!(
            resolve_temporal_reference(
                &root,
                &HistoryTemporalReference::Date {
                    at: timeline.revisions[0].committed_at.clone(),
                },
            )
            .expect("date reference"),
            timeline.head
        );
        assert!(resolve_temporal_reference(
            &root,
            &HistoryTemporalReference::Date {
                at: "not-a-date".to_string(),
            },
        )
        .unwrap_err()
        .contains("RFC3339"));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn divergent_release_tags_join_only_after_their_branch_is_merged() {
        let root =
            std::env::temp_dir().join(format!("cv-history-divergent-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("fixture");
        run_git(&root, &["init"]);
        run_git(&root, &["config", "user.email", "fixture@local"]);
        run_git(&root, &["config", "user.name", "Fixture"]);
        fs::write(root.join("base.rs"), "fn base() {}\n").expect("base");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "base"]);
        run_git(&root, &["tag", "v1.0.0"]);
        let main_branch = git_text(&root, &["branch", "--show-current"]).expect("branch");

        run_git(&root, &["checkout", "-b", "release-side"]);
        fs::write(root.join("side.rs"), "fn side() {}\n").expect("side");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "side release"]);
        run_git(&root, &["tag", "v2.0.0-side"]);
        let side_sha = git_text(&root, &["rev-parse", "HEAD"]).expect("side sha");

        run_git(&root, &["checkout", &main_branch]);
        fs::write(root.join("main.rs"), "fn main_line() {}\n").expect("main");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "main work"]);
        let before_merge = reachable_release_revisions(&root).expect("before merge releases");
        assert!(!before_merge.contains(&side_sha));

        run_git(
            &root,
            &[
                "merge",
                "--no-ff",
                "release-side",
                "-m",
                "merge release side",
            ],
        );
        let after_merge = reachable_release_revisions(&root).expect("after merge releases");
        assert!(after_merge.contains(&side_sha));
        let timeline = build_timeline(&root, Some(20)).expect("merged timeline");
        assert_eq!(timeline.revisions.last().expect("head").parents.len(), 2);
        assert!(timeline
            .release_ranges
            .iter()
            .any(|range| range.tag.as_deref() == Some("v2.0.0-side")));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn merge_reconstruction_follows_the_recorded_first_parent_chain() {
        let root =
            std::env::temp_dir().join(format!("cv-history-merge-dag-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("fixture");
        run_git(&root, &["init"]);
        run_git(&root, &["config", "user.email", "fixture@local"]);
        run_git(&root, &["config", "user.name", "Fixture"]);
        fs::write(root.join("base.rs"), "fn base() {}\n").expect("base");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "base"]);
        let main_branch = git_text(&root, &["branch", "--show-current"]).expect("main branch");
        run_git(&root, &["checkout", "-b", "feature"]);
        fs::write(root.join("feature.rs"), "fn feature() {}\n").expect("feature");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "feature"]);
        run_git(&root, &["checkout", &main_branch]);
        fs::write(root.join("main.rs"), "fn main_line() {}\n").expect("main line");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "main line"]);
        run_git(
            &root,
            &["merge", "--no-ff", "feature", "-m", "merge feature"],
        );

        let timeline = build_timeline(&root, Some(20)).expect("timeline");
        let canonical = root.to_string_lossy().to_string();
        let storage_key = history_storage_key(&canonical);
        let cancellation = StructuralGraphCancellation::default();
        let mut snapshots = HashMap::new();
        for revision in &timeline.revisions {
            let mut snapshot = build_snapshot_from_blobs(
                &storage_key,
                &revision.sha,
                GitObjectReader::new(&root)
                    .blobs_at(&revision.sha)
                    .expect("revision blobs"),
                &cancellation,
                &|_: StructuralGraphProgress| {},
            )
            .expect("revision snapshot");
            compact_history_snapshot(&mut snapshot);
            snapshots.insert(revision.sha.clone(), snapshot);
        }

        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("migrations");
        persist_timeline(&connection, &timeline).expect("persist timeline");
        let root_revision = timeline
            .revisions
            .iter()
            .find(|revision| revision.parents.is_empty())
            .expect("root revision");
        let root_snapshot = snapshots.get(&root_revision.sha).expect("root snapshot");
        persist_history_snapshot_blob(&connection, &canonical, &root_revision.sha, root_snapshot)
            .expect("persist root snapshot");
        connection
            .execute(
                "INSERT INTO history_graph_checkpoints (
                    repo_path, revision_sha, snapshot_id, engine_id, engine_version,
                    schema_version, status, coverage_json, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'ready', '{}', ?7)",
                params![
                    canonical,
                    root_revision.sha,
                    root_snapshot.id,
                    BUNDLED_ENGINE_ID,
                    BUNDLED_ENGINE_VERSION,
                    STRUCTURAL_GRAPH_SCHEMA_VERSION,
                    timeline.generated_at,
                ],
            )
            .expect("root checkpoint");
        for revision in timeline
            .revisions
            .iter()
            .filter(|revision| !revision.parents.is_empty())
        {
            let parent = revision.parents.first().expect("first parent");
            compute_and_persist_structural_delta(
                &connection,
                &root,
                &canonical,
                parent,
                &revision.sha,
                snapshots.get(parent).expect("parent snapshot"),
                snapshots.get(&revision.sha).expect("child snapshot"),
            )
            .expect("parent-aware delta");
        }

        let reconstructed =
            reconstruct_history_as_of(&connection, &canonical, &storage_key, &timeline.head)
                .expect("reconstruct merge")
                .expect("complete first-parent chain");
        let expected = snapshots.get(&timeline.head).expect("head snapshot");
        let mut reconstructed_files = reconstructed
            .files
            .iter()
            .map(|file| file.path.clone())
            .collect::<Vec<_>>();
        let mut expected_files = expected
            .files
            .iter()
            .map(|file| file.path.clone())
            .collect::<Vec<_>>();
        reconstructed_files.sort();
        expected_files.sort();
        assert_eq!(reconstructed_files, expected_files);
        let mut reconstructed_nodes = reconstructed.nodes.clone();
        let mut expected_nodes = expected.nodes.clone();
        reconstructed_nodes.sort_by(|left, right| left.id.cmp(&right.id));
        expected_nodes.sort_by(|left, right| left.id.cmp(&right.id));
        let mut reconstructed_edges = reconstructed.edges.clone();
        let mut expected_edges = expected.edges.clone();
        reconstructed_edges.sort_by(|left, right| left.id.cmp(&right.id));
        expected_edges.sort_by(|left, right| left.id.cmp(&right.id));
        assert_eq!(reconstructed_nodes, expected_nodes);
        assert_eq!(reconstructed_edges, expected_edges);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn rolling_timeline_windows_keep_global_ordinals_and_old_releases() {
        let root = std::env::temp_dir().join(format!("cv-history-window-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("fixture");
        run_git(&root, &["init"]);
        run_git(&root, &["config", "user.email", "fixture@local"]);
        run_git(&root, &["config", "user.name", "Fixture"]);
        for index in 0..6 {
            fs::write(
                root.join("history.rs"),
                format!("fn version_{index}() {{}}\n"),
            )
            .expect("history");
            run_git(&root, &["add", "."]);
            run_git(&root, &["commit", "-m", &format!("commit {index}")]);
            if index == 0 {
                run_git(&root, &["tag", "v1.0.0"]);
            }
        }
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("migrations");
        let first = build_timeline(&root, Some(3)).expect("first window");
        persist_timeline(&connection, &first).expect("persist first window");
        for index in 6..8 {
            fs::write(
                root.join("history.rs"),
                format!("fn version_{index}() {{}}\n"),
            )
            .expect("history");
            run_git(&root, &["add", "."]);
            run_git(&root, &["commit", "-m", &format!("commit {index}")]);
        }
        let second = build_timeline(&root, Some(3)).expect("second window");
        persist_timeline(&connection, &second).expect("persist second window");

        let global_ordinals = revision_ordinals(&root).expect("global ordinals");
        let mut statement = connection
            .prepare("SELECT sha, ordinal FROM history_graph_revisions WHERE repo_path = ?1")
            .expect("ordinal query");
        let rows = statement
            .query_map([second.repo_path.as_str()], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .expect("ordinal rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("read ordinals");
        assert!(rows.iter().all(|(sha, ordinal)| {
            global_ordinals.get(sha).copied() == Some(*ordinal) && *ordinal >= 0
        }));
        let releases = load_history_revisions(&connection, &second.repo_path, None, true, 10)
            .expect("release query");
        assert_eq!(releases.revisions.len(), 1);
        assert_eq!(releases.revisions[0].tags, vec!["v1.0.0"]);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn catalog_staging_does_not_publish_freshness_before_backfill_success() {
        let root =
            std::env::temp_dir().join(format!("cv-history-publish-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("fixture");
        run_git(&root, &["init"]);
        run_git(&root, &["config", "user.email", "fixture@local"]);
        run_git(&root, &["config", "user.name", "Fixture"]);
        fs::write(root.join("history.rs"), "fn first() {}\n").expect("first");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "first"]);
        let first = build_timeline(&root, Some(20)).expect("first timeline");
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("migrations");
        persist_timeline(&connection, &first).expect("publish first timeline");

        fs::write(root.join("history.rs"), "fn second() {}\n").expect("second");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "second"]);
        let second = build_timeline(&root, Some(20)).expect("second timeline");
        persist_timeline_catalog(&connection, &second).expect("stage second catalog");
        let (indexed_head, status): (Option<String>, String) = connection
            .query_row(
                "SELECT indexed_head, status FROM history_graph_repositories WHERE repo_path = ?1",
                [second.repo_path.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("published freshness");
        assert_eq!(indexed_head.as_deref(), Some(first.head.as_str()));
        assert_eq!(status, "ready");
        assert_ne!(indexed_head.as_deref(), Some(second.head.as_str()));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn shallow_history_reports_partial_coverage() {
        let origin =
            std::env::temp_dir().join(format!("cv-history-origin-{}", uuid::Uuid::new_v4()));
        let shallow =
            std::env::temp_dir().join(format!("cv-history-shallow-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&origin).expect("origin");
        run_git(&origin, &["init"]);
        run_git(&origin, &["config", "user.email", "fixture@local"]);
        run_git(&origin, &["config", "user.name", "Fixture"]);
        for index in 0..3 {
            fs::write(origin.join("history.txt"), format!("{index}\n")).expect("history");
            run_git(&origin, &["add", "."]);
            run_git(&origin, &["commit", "-m", &format!("commit {index}")]);
        }
        let source = format!("file://{}", origin.display());
        let status = Command::new("git")
            .args(["clone", "--depth", "1", &source])
            .arg(&shallow)
            .status()
            .expect("clone");
        assert!(status.success());

        let timeline = build_timeline(&shallow, Some(20)).expect("shallow timeline");
        assert!(timeline.is_shallow);
        assert!(!timeline.coverage_complete);
        assert_eq!(timeline.revisions.len(), 1);
        fs::remove_dir_all(origin).expect("remove origin");
        fs::remove_dir_all(shallow).expect("remove shallow");
    }

    #[test]
    fn path_history_preserves_rename_copy_and_delete_leads() {
        let root = std::env::temp_dir().join(format!("cv-history-paths-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).expect("fixture");
        run_git(&root, &["init"]);
        run_git(&root, &["config", "user.email", "fixture@local"]);
        run_git(&root, &["config", "user.name", "Fixture"]);
        fs::write(root.join("src/old.rs"), "fn carried() {}\n").expect("old");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "add old"]);
        run_git(&root, &["mv", "src/old.rs", "src/new.rs"]);
        run_git(&root, &["commit", "-m", "rename old"]);
        let rename_head = git_text(&root, &["rev-parse", "HEAD"]).expect("rename head");
        let rename = changed_path_records(&root, &rename_head).expect("rename changes");
        assert!(rename.iter().any(|change| {
            change.change_kind == "renamed"
                && change.old_path.as_deref() == Some("src/old.rs")
                && change.path == "src/new.rs"
        }));

        fs::copy(root.join("src/new.rs"), root.join("src/copy.rs")).expect("copy");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "copy new"]);
        let copy_head = git_text(&root, &["rev-parse", "HEAD"]).expect("copy head");
        let copy = changed_path_records(&root, &copy_head).expect("copy changes");
        assert!(copy.iter().any(|change| {
            change.change_kind == "copied"
                && change.old_path.as_deref() == Some("src/new.rs")
                && change.path == "src/copy.rs"
        }));

        fs::remove_file(root.join("src/copy.rs")).expect("delete");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "delete copy"]);
        let delete_head = git_text(&root, &["rev-parse", "HEAD"]).expect("delete head");
        assert!(changed_path_records(&root, &delete_head)
            .expect("delete changes")
            .iter()
            .any(|change| change.change_kind == "deleted" && change.path == "src/copy.rs"));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn structural_lineage_tracks_renames_and_preserves_split_ambiguity() {
        let cancellation = StructuralGraphCancellation::default();
        let progress = |_: StructuralGraphProgress| {};
        let before = build_snapshot_from_blobs(
            "history:test",
            "before",
            vec![HistoricalFileBlob {
                path: "src/lib.rs".to_string(),
                bytes: b"fn old_name() {}\n".to_vec(),
            }],
            &cancellation,
            &progress,
        )
        .expect("before");
        let renamed = build_snapshot_from_blobs(
            "history:test",
            "renamed",
            vec![HistoricalFileBlob {
                path: "src/lib.rs".to_string(),
                bytes: b"fn new_name() {}\n".to_vec(),
            }],
            &cancellation,
            &progress,
        )
        .expect("renamed");
        let rename_lineage = derive_lineage(&before, &renamed, &[], "renamed");
        assert!(rename_lineage.iter().any(|edge| {
            edge.relation == "renamed_to"
                && edge.trust == GraphTrust::Inferred
                && renamed
                    .nodes
                    .iter()
                    .any(|node| node.id == edge.to_entity_id && node.label == "new_name")
        }));

        let split = build_snapshot_from_blobs(
            "history:test",
            "split",
            vec![HistoricalFileBlob {
                path: "src/lib.rs".to_string(),
                bytes: b"fn first() {} fn second() {}\n".to_vec(),
            }],
            &cancellation,
            &progress,
        )
        .expect("split");
        let split_lineage = derive_lineage(&before, &split, &[], "split");
        assert!(split_lineage.iter().any(|edge| {
            edge.relation == "split_into"
                && edge.trust == GraphTrust::Ambiguous
                && !edge.candidates.is_empty()
        }));

        let merge_before = build_snapshot_from_blobs(
            "history:test",
            "merge-before",
            vec![HistoricalFileBlob {
                path: "src/lib.rs".to_string(),
                bytes: b"fn first() {} fn second() {}\n".to_vec(),
            }],
            &cancellation,
            &progress,
        )
        .expect("merge before");
        let merge_after = build_snapshot_from_blobs(
            "history:test",
            "merge-after",
            vec![HistoricalFileBlob {
                path: "src/lib.rs".to_string(),
                bytes: b"fn combined() {}\n".to_vec(),
            }],
            &cancellation,
            &progress,
        )
        .expect("merge after");
        assert!(derive_lineage(&merge_before, &merge_after, &[], "merged")
            .iter()
            .any(|edge| {
                edge.relation == "merged_from"
                    && edge.trust == GraphTrust::Ambiguous
                    && !edge.candidates.is_empty()
            }));

        let stable_before = build_snapshot_from_blobs(
            "history:test",
            "stable-before",
            vec![HistoricalFileBlob {
                path: "src/lib.rs".to_string(),
                bytes: b"fn stable(value: i32) {}\n".to_vec(),
            }],
            &cancellation,
            &progress,
        )
        .expect("stable before");
        let stable_after = build_snapshot_from_blobs(
            "history:test",
            "stable-after",
            vec![HistoricalFileBlob {
                path: "src/lib.rs".to_string(),
                bytes: b"fn stable(value: i64) {}\n".to_vec(),
            }],
            &cancellation,
            &progress,
        )
        .expect("stable after");
        assert!(derive_lineage(&stable_before, &stable_after, &[], "stable")
            .iter()
            .any(|edge| edge.relation == "same_as"));

        let cross_language_before = build_snapshot_from_blobs(
            "history:test",
            "cross-language-before",
            vec![HistoricalFileBlob {
                path: "src/handler.rs".to_string(),
                bytes: b"fn carried() {}\n".to_vec(),
            }],
            &cancellation,
            &progress,
        )
        .expect("cross-language before");
        let cross_language_after = build_snapshot_from_blobs(
            "history:test",
            "cross-language-after",
            vec![HistoricalFileBlob {
                path: "src/handler.ts".to_string(),
                bytes: b"function carried() {}\n".to_vec(),
            }],
            &cancellation,
            &progress,
        )
        .expect("cross-language after");
        let cross_language = derive_lineage(
            &cross_language_before,
            &cross_language_after,
            &[HistoryPathChange {
                path: "src/handler.ts".to_string(),
                change_kind: "renamed".to_string(),
                old_path: Some("src/handler.rs".to_string()),
                additions: None,
                deletions: None,
            }],
            "cross-language-after",
        );
        assert!(cross_language.iter().any(|edge| {
            edge.relation == "moved_to"
                && edge.trust == GraphTrust::Extracted
                && cross_language_after.nodes.iter().any(|node| {
                    node.id == edge.to_entity_id
                        && node.label == "carried"
                        && node.language.as_deref() == Some("typescript")
                })
        }));
    }

    #[test]
    fn outcome_evidence_requires_an_explicit_local_observation() {
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("migrations");
        connection
            .execute(
                "INSERT INTO history_graph_repositories (
                    repo_path, repository_fingerprint, status, created_at, updated_at
                 ) VALUES ('/fixture', 'fixture', 'ready', '2026-01-01T00:00:00Z',
                    '2026-01-01T00:00:00Z')",
                [],
            )
            .expect("repository");

        assert!(load_outcome_events(&connection, "/fixture", "event:signup")
            .expect("empty outcomes")
            .is_empty());

        connection
            .execute(
                "INSERT INTO history_graph_events (
                    id, repo_path, event_kind, entity_id, trust, origin, source_id,
                    payload_json, evidence_json, recorded_at
                 ) VALUES
                    ('code-change', '/fixture', 'structural_delta', 'event:signup',
                     'extracted', 'syntax', 'git', '{}', '[]', '2026-01-01T00:00:00Z'),
                    ('provider-delivery', '/fixture', 'analytics_provider_delivery',
                     'event:signup', 'extracted', 'metadata', 'provider-export', '{}', '[]',
                     '2026-01-02T00:00:00Z')",
                [],
            )
            .expect("events");

        let outcomes =
            load_outcome_events(&connection, "/fixture", "event:signup").expect("outcomes");
        assert_eq!(outcomes.len(), 1, "code presence is not provider delivery");
        assert_eq!(outcomes[0].0, "provider-delivery");
        assert_eq!(outcomes[0].1, "analytics_provider_delivery");
        assert_eq!(outcomes[0].2, GraphTrust::Extracted);

        connection
            .execute(
                "INSERT INTO history_graph_annotations (
                    id, repo_path, entity_id, author, body, decision, source, created_at
                 ) VALUES ('reject-1', '/fixture', 'event:signup', 'owner',
                    'Provider export belongs to another environment', 'reject', 'user',
                    '2026-01-03T00:00:00Z')",
                [],
            )
            .expect("annotation");
        let contradictions =
            load_entity_annotation_contradictions(&connection, "/fixture", "event:signup")
                .expect("contradictions");
        assert_eq!(contradictions.len(), 1);
        assert!(contradictions[0].contains("another environment"));
    }

    #[test]
    fn lineage_queries_preserve_candidates_and_report_repository_freshness() {
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("migrations");
        connection
            .execute(
                "INSERT INTO history_graph_repositories (
                    repo_path, repository_fingerprint, indexed_head, status, coverage_json,
                    created_at, updated_at
                 ) VALUES ('/fixture', 'fixture', 'head-2', 'ready',
                    '{\"coverage_complete\":true}', '2026-01-01T00:00:00Z',
                    '2026-01-01T00:00:00Z')",
                [],
            )
            .expect("repository");
        let edge = HistoryLineageEdge {
            id: "lineage-1".to_string(),
            from_entity_id: "old".to_string(),
            to_entity_id: "new-a".to_string(),
            relation: "split_into".to_string(),
            trust: GraphTrust::Ambiguous,
            evidence: "two compatible successors".to_string(),
            sources: Vec::new(),
            candidates: vec!["new-b".to_string()],
        };
        connection
            .execute(
                "INSERT INTO history_graph_events (
                    id, repo_path, event_kind, entity_id, related_entity_id, relation_kind,
                    trust, origin, source_id, payload_json, evidence_json, recorded_at
                 ) VALUES (?1, '/fixture', 'entity_lineage', ?2, ?3, ?4,
                    'ambiguous', 'analysis', 'fixture', ?5, '[]', '2026-01-01T00:00:00Z')",
                params![
                    edge.id,
                    edge.from_entity_id,
                    edge.to_entity_id,
                    edge.relation,
                    serde_json::to_string(&edge).expect("lineage json")
                ],
            )
            .expect("lineage event");

        let (lineage, family, truncated) =
            load_lineage_family(&connection, "/fixture", "old", 20).expect("lineage family");
        assert!(!truncated);
        assert_eq!(lineage, vec![edge]);
        assert!(family.contains("old"));
        assert!(family.contains("new-a"));
        assert!(family.contains("new-b"));

        let (indexed_head, stale, coverage) =
            history_index_freshness(&connection, "/fixture", "head-2").expect("freshness");
        assert_eq!(indexed_head, "head-2");
        assert!(!stale);
        assert_eq!(coverage["coverage_complete"], true);
        assert!(
            history_index_freshness(&connection, "/fixture", "head-3")
                .expect("stale freshness")
                .1
        );
        connection
            .execute(
                "UPDATE history_graph_repositories
                 SET status = 'partial',
                     coverage_json = '{\"coverage_complete\":false,\"cancelled\":true,\"adapter_coverage\":\"partial\"}'
                 WHERE repo_path = '/fixture'",
                [],
            )
            .expect("partial coverage");
        let (_, stale, partial) =
            history_index_freshness(&connection, "/fixture", "head-2").expect("partial query");
        assert!(
            !stale,
            "partial adapter coverage is separate from Git freshness"
        );
        assert_eq!(partial["coverage_complete"], false);
        assert_eq!(partial["cancelled"], true);
        assert_eq!(partial["adapter_coverage"], "partial");
    }

    #[test]
    fn prior_removal_produces_an_explicit_reintroduction_edge() {
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("migrations");
        connection
            .execute(
                "INSERT INTO history_graph_repositories (
                    repo_path, repository_fingerprint, status, created_at, updated_at
                 ) VALUES ('/fixture', 'fixture', 'ready', '2026-01-01T00:00:00Z',
                    '2026-01-01T00:00:00Z')",
                [],
            )
            .expect("repository");
        let cancellation = StructuralGraphCancellation::default();
        let snapshot = build_snapshot_from_blobs(
            "history:test",
            "returned",
            vec![HistoricalFileBlob {
                path: "src/lib.rs".to_string(),
                bytes: b"fn returned() {}\n".to_vec(),
            }],
            &cancellation,
            &|_: StructuralGraphProgress| {},
        )
        .expect("snapshot");
        let node = snapshot
            .nodes
            .iter()
            .find(|node| node.label == "returned")
            .expect("returned node");
        let removal = HistoryLineageEdge {
            id: "removed-1".to_string(),
            from_entity_id: node.id.clone(),
            to_entity_id: "old-revision".to_string(),
            relation: "removed_in".to_string(),
            trust: GraphTrust::Extracted,
            evidence: "absent".to_string(),
            sources: Vec::new(),
            candidates: Vec::new(),
        };
        connection
            .execute(
                "INSERT INTO history_graph_events (
                    id, repo_path, event_kind, entity_id, related_entity_id, relation_kind,
                    trust, origin, source_id, payload_json, evidence_json, recorded_at
                 ) VALUES (?1, '/fixture', 'entity_lineage', ?2, ?3, 'removed_in',
                    'extracted', 'analysis', 'fixture', ?4, '[]',
                    '2026-01-01T00:00:00Z')",
                params![
                    removal.id,
                    removal.from_entity_id,
                    removal.to_entity_id,
                    serde_json::to_string(&removal).expect("removal json")
                ],
            )
            .expect("removal event");
        let reintroduced = derive_reintroductions(
            &connection,
            "/fixture",
            &snapshot,
            std::slice::from_ref(&node.id),
            "new-revision",
        )
        .expect("reintroduction");
        assert_eq!(reintroduced.len(), 1);
        assert_eq!(reintroduced[0].relation, "reintroduced_in");
        assert_eq!(reintroduced[0].trust, GraphTrust::Extracted);
    }

    #[test]
    fn refresh_classification_prioritizes_rewrites_and_engine_repairs() {
        assert_eq!(
            classify_history_refresh(None, false, false, false, false),
            "initial"
        );
        assert_eq!(
            classify_history_refresh(Some("old"), true, true, false, true),
            "rewritten_history"
        );
        assert_eq!(
            classify_history_refresh(Some("head"), false, true, false, true),
            "engine_repair"
        );
        assert_eq!(
            classify_history_refresh(Some("old"), false, false, true, true),
            "fast_forward"
        );
        assert_eq!(
            classify_history_refresh(Some("head"), false, false, false, true),
            "tag_metadata"
        );
        assert_eq!(
            classify_history_refresh(Some("head"), false, false, false, false),
            "no_op"
        );
    }

    #[test]
    fn exact_as_of_reconstructs_from_nearest_checkpoint_and_ordered_deltas() {
        let root = std::env::temp_dir().join(format!("cv-as-of-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).expect("fixture");
        run_git(&root, &["init"]);
        run_git(&root, &["config", "user.email", "fixture@local"]);
        run_git(&root, &["config", "user.name", "Fixture"]);
        fs::write(root.join("src/lib.rs"), "fn first() {}\n").expect("first");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "feat: first"]);
        fs::write(root.join("src/lib.rs"), "fn first() {}\nfn second() {}\n").expect("second");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "feat: second"]);
        let timeline = build_timeline(&root, Some(20)).expect("timeline");
        let canonical = root.to_string_lossy().to_string();
        let storage_key = history_storage_key(&canonical);
        let cancellation = StructuralGraphCancellation::default();
        let build = |revision: &str| {
            let mut snapshot = build_snapshot_from_blobs(
                &storage_key,
                revision,
                GitObjectReader::new(&root)
                    .blobs_at(revision)
                    .expect("historical blobs"),
                &cancellation,
                &|_: StructuralGraphProgress| {},
            )
            .expect("snapshot");
            compact_history_snapshot(&mut snapshot);
            snapshot
        };
        let before = build(&timeline.revisions[0].sha);
        let after = build(&timeline.revisions[1].sha);
        let path_changes =
            changed_path_records(&root, &timeline.revisions[1].sha).expect("path changes");
        let changed_paths = path_changes
            .iter()
            .filter(|change| change.change_kind != "deleted")
            .map(|change| change.path.clone())
            .collect::<Vec<_>>();
        let mut incremental_after = build_snapshot_from_blob_delta(
            &storage_key,
            &timeline.revisions[1].sha,
            &before,
            GitObjectReader::new(&root)
                .blobs_for_paths(&timeline.revisions[1].sha, &changed_paths)
                .expect("changed blobs"),
            &[],
            &cancellation,
            &|_: StructuralGraphProgress| {},
        )
        .expect("incremental snapshot");
        compact_history_snapshot(&mut incremental_after);
        let normalize = |snapshot: &mut StructuralGraphSnapshot| {
            snapshot.nodes.sort_by(|left, right| left.id.cmp(&right.id));
            snapshot.edges.sort_by(|left, right| left.id.cmp(&right.id));
        };
        let mut expected_after = after.clone();
        incremental_after.created_at = expected_after.created_at.clone();
        normalize(&mut incremental_after);
        normalize(&mut expected_after);
        assert_eq!(
            incremental_after, expected_after,
            "path-scoped historical extraction must equal a full revision build"
        );
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("migrations");
        persist_timeline(&connection, &timeline).expect("timeline persistence");
        persist_history_snapshot_blob(&connection, &canonical, &timeline.revisions[0].sha, &before)
            .expect("compressed before snapshot");
        connection
            .execute(
                "INSERT INTO history_graph_checkpoints (
                    repo_path, revision_sha, snapshot_id, engine_id, engine_version,
                    schema_version, status, coverage_json, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'ready', '{}', ?7)",
                params![
                    canonical,
                    timeline.revisions[0].sha,
                    before.id,
                    BUNDLED_ENGINE_ID,
                    BUNDLED_ENGINE_VERSION,
                    STRUCTURAL_GRAPH_SCHEMA_VERSION,
                    timeline.generated_at,
                ],
            )
            .expect("checkpoint");
        connection
            .execute(
                "INSERT INTO history_graph_checkpoints (
                    repo_path, revision_sha, snapshot_id, engine_id, engine_version,
                    schema_version, status, coverage_json, created_at
                 ) VALUES (?1, ?2, ?3, 'obsolete-engine', '0', 1, 'ready', '{}', ?4)",
                params![
                    canonical,
                    timeline.revisions[1].sha,
                    after.id,
                    timeline.generated_at,
                ],
            )
            .expect("incompatible checkpoint");
        let delta = compute_and_persist_structural_delta(
            &connection,
            &root,
            &canonical,
            &timeline.revisions[0].sha,
            &timeline.revisions[1].sha,
            &before,
            &after,
        )
        .expect("delta");
        assert!(!delta.added_node_ids.is_empty());
        assert!(delta
            .path_changes
            .iter()
            .any(|change| change.path == "src/lib.rs"));

        let mut reconstructed = reconstruct_history_as_of(
            &connection,
            &canonical,
            &storage_key,
            &timeline.revisions[1].sha,
        )
        .expect("as-of reconstruction")
        .expect("complete delta chain");
        let mut expected = after.clone();
        normalize(&mut reconstructed);
        normalize(&mut expected);
        assert_eq!(
            reconstructed, expected,
            "delta application must preserve exact graph content"
        );
        assert_eq!(
            reconstructed.repo_head.as_deref(),
            Some(timeline.revisions[1].sha.as_str())
        );
        assert!(reconstructed
            .nodes
            .iter()
            .any(|node| node.label == "second"));
        connection
            .execute(
                "DELETE FROM history_graph_events WHERE event_kind = 'structural_delta'",
                [],
            )
            .expect("remove delta");
        assert!(reconstruct_history_as_of(
            &connection,
            &canonical,
            &storage_key,
            &timeline.revisions[1].sha,
        )
        .expect("bounded missing chain")
        .is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rewritten_history_repair_preserves_imports_annotations_and_adapter_cursors() {
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("migrations");
        connection
            .execute_batch(
                "INSERT INTO history_graph_repositories (
                    repo_path, repository_fingerprint, indexed_head, status,
                    created_at, updated_at
                 ) VALUES ('/fixture', 'fixture', 'old-head', 'ready',
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
                 INSERT INTO history_graph_revisions (
                    repo_path, sha, ordinal, committed_at, author_name, subject,
                    parents_json, tags_json
                 ) VALUES ('/fixture', 'old-head', 0, '2026-01-01T00:00:00Z',
                    'Fixture', 'old commit', '[]', '[]');
                 INSERT INTO structural_graph_snapshots (
                    id, repo_path, repo_head, schema_version, engine_id, engine_version,
                    engine_json, coverage_json, created_at
                 ) VALUES ('old-snapshot', 'history:fixture', 'old-head', 1,
                    'old-engine', '0', '{}', '{}', '2026-01-01T00:00:00Z');
                 INSERT INTO history_graph_checkpoints (
                    repo_path, revision_sha, snapshot_id, engine_id, engine_version,
                    schema_version, created_at
                 ) VALUES ('/fixture', 'old-head', 'old-snapshot', 'old-engine', '0', 1,
                    '2026-01-01T00:00:00Z');
                 INSERT INTO history_graph_events (
                    id, repo_path, revision_sha, event_kind, trust, origin, source_id,
                    source_cursor, payload_json, evidence_json, recorded_at
                 ) VALUES
                    ('derived', '/fixture', 'old-head', 'structural_delta', 'extracted',
                     'analysis', 'codevetter-structural-history', 'old-head', '{}', '[]',
                     '2026-01-01T00:00:00Z'),
                    ('imported', '/fixture', NULL, 'analytics_provider_delivery', 'extracted',
                     'metadata', 'provider-export', 'provider:42', '{}', '[]',
                     '2026-01-02T00:00:00Z');
                 INSERT INTO history_graph_annotations (
                    id, repo_path, author, body, decision, source, created_at
                 ) VALUES ('annotation', '/fixture', 'owner', 'keep this correction',
                    'correct', 'user', '2026-01-03T00:00:00Z');",
            )
            .expect("fixture data");

        let invalidated =
            repair_derived_history(&connection, "/fixture", true, true, "2026-01-04T00:00:00Z")
                .expect("repair");
        assert!(invalidated >= 4);
        for table in [
            "history_graph_checkpoints",
            "history_graph_revisions",
            "structural_graph_snapshots",
        ] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("derived count");
            assert_eq!(count, 0, "{table} should be invalidated");
        }
        let imported: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM history_graph_events WHERE id = 'imported'",
                [],
                |row| row.get(0),
            )
            .expect("imported evidence");
        assert_eq!(imported, 1);
        let annotations: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM history_graph_annotations",
                [],
                |row| row.get(0),
            )
            .expect("annotations");
        assert_eq!(annotations, 1);
        persist_history_adapter_cursors(&connection, "/fixture", "new-head")
            .expect("adapter cursors");
        let cursor_json: String = connection
            .query_row(
                "SELECT cursor_json FROM history_graph_repositories WHERE repo_path = '/fixture'",
                [],
                |row| row.get(0),
            )
            .expect("cursor json");
        let cursor: Value = serde_json::from_str(&cursor_json).expect("cursor payload");
        assert_eq!(cursor["head"], "new-head");
        assert_eq!(cursor["adapters"]["provider-export"], "provider:42");
    }

    #[test]
    #[ignore = "performance benchmark; run explicitly with --ignored --nocapture"]
    fn bench_history_backfill_incremental_and_as_of_real_repo() {
        let process_usage = || {
            let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
            let status = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) };
            assert_eq!(status, 0, "getrusage");
            unsafe { usage.assume_init() }
        };
        let timeval_seconds =
            |value: libc::timeval| value.tv_sec as f64 + value.tv_usec as f64 / 1_000_000.0;
        let usage_before = process_usage();
        let root = std::env::var("CV_GRAPH_BENCH_REPO")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../../..")
                    .canonicalize()
                    .expect("repo root")
            });
        let limit = std::env::var("CV_HISTORY_BENCH_COMMITS")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(24)
            .clamp(4, 100);
        let total_started = std::time::Instant::now();
        let timeline = build_timeline(&root, Some(limit)).expect("timeline");
        let canonical = root.to_string_lossy().to_string();
        let storage_key = history_storage_key(&canonical);
        let db_path = std::env::temp_dir().join(format!(
            "codevetter-temporal-bench-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let connection = Connection::open(&db_path).expect("benchmark database");
        crate::db::schema::run_migrations(&connection).expect("migrations");
        persist_timeline(&connection, &timeline).expect("timeline persistence");
        let cancellation = StructuralGraphCancellation::default();
        let mut build_samples = Vec::with_capacity(timeline.revisions.len());
        let build_snapshot = |revision: &HistoryRevision| {
            let started = std::time::Instant::now();
            let mut snapshot = build_snapshot_from_blobs(
                &storage_key,
                &revision.sha,
                GitObjectReader::new(&root)
                    .blobs_at(&revision.sha)
                    .expect("historical blobs"),
                &cancellation,
                &|_: StructuralGraphProgress| {},
            )
            .expect("historical snapshot");
            compact_history_snapshot(&mut snapshot);
            (snapshot, started.elapsed().as_secs_f64() * 1000.0)
        };
        let persist_benchmark_checkpoint =
            |revision: &HistoryRevision, snapshot: &StructuralGraphSnapshot| {
                persist_history_snapshot_blob(&connection, &canonical, &revision.sha, snapshot)
                    .expect("compressed snapshot persistence");
                connection
                    .execute(
                        "INSERT INTO history_graph_checkpoints (
                            repo_path, revision_sha, snapshot_id, engine_id, engine_version,
                            schema_version, status, coverage_json, created_at
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'ready', ?7, ?8)",
                        params![
                            canonical,
                            revision.sha,
                            snapshot.id,
                            snapshot.engine.id,
                            snapshot.engine.version,
                            snapshot.schema_version,
                            serde_json::to_string(&snapshot.coverage).expect("coverage"),
                            snapshot.created_at,
                        ],
                    )
                    .expect("checkpoint");
            };
        let first_revision = timeline.revisions.first().expect("benchmark revision");
        let (mut previous_snapshot, first_build_ms) = build_snapshot(first_revision);
        build_samples.push(first_build_ms);
        persist_benchmark_checkpoint(first_revision, &previous_snapshot);
        let mut checkpoint_count = 1usize;
        let mut delta_samples = Vec::with_capacity(timeline.revisions.len().saturating_sub(1));
        let mut delta_node_changes = 0usize;
        let mut delta_edge_changes = 0usize;
        for index in 1..timeline.revisions.len() {
            let revision = &timeline.revisions[index];
            let path_changes = changed_path_records(&root, &revision.sha).expect("path changes");
            let changed_paths = path_changes
                .iter()
                .filter(|change| change.change_kind != "deleted")
                .map(|change| change.path.clone())
                .collect::<Vec<_>>();
            let deleted_paths = path_changes
                .iter()
                .filter(|change| change.change_kind == "deleted")
                .map(|change| change.path.clone())
                .chain(
                    path_changes
                        .iter()
                        .filter(|change| change.change_kind == "renamed")
                        .filter_map(|change| change.old_path.clone()),
                )
                .collect::<Vec<_>>();
            let started = std::time::Instant::now();
            let mut after_snapshot = build_snapshot_from_blob_delta(
                &storage_key,
                &revision.sha,
                &previous_snapshot,
                GitObjectReader::new(&root)
                    .blobs_for_paths(&revision.sha, &changed_paths)
                    .expect("changed blobs"),
                &deleted_paths,
                &cancellation,
                &|_: StructuralGraphProgress| {},
            )
            .expect("incremental historical snapshot");
            compact_history_snapshot(&mut after_snapshot);
            let build_ms = started.elapsed().as_secs_f64() * 1000.0;
            build_samples.push(build_ms);
            if index + 1 == timeline.revisions.len() || revision.is_release {
                persist_benchmark_checkpoint(revision, &after_snapshot);
                checkpoint_count += 1;
            }
            let started = std::time::Instant::now();
            let delta = compute_and_persist_structural_delta_with_paths(
                &connection,
                &canonical,
                &timeline.revisions[index - 1].sha,
                &revision.sha,
                &previous_snapshot,
                &after_snapshot,
                path_changes,
            )
            .expect("structural delta");
            delta_node_changes += delta.added_node_ids.len()
                + delta.removed_node_ids.len()
                + delta.changed_node_ids.len();
            delta_edge_changes += delta.added_edge_ids.len()
                + delta.removed_edge_ids.len()
                + delta.changed_edge_ids.len();
            delta_samples.push(started.elapsed().as_secs_f64() * 1000.0);
            previous_snapshot = after_snapshot;
            if index % 4 == 0 {
                release_history_allocator_pressure();
            }
        }
        release_history_allocator_pressure();
        let backfill_ms = total_started.elapsed().as_secs_f64() * 1000.0;
        let target_index = (timeline.revisions.len() * 3 / 4)
            .min(timeline.revisions.len().saturating_sub(2))
            .max(1);
        let target_revision = &timeline.revisions[target_index].sha;
        let mut as_of_samples = Vec::with_capacity(100);
        for _ in 0..100 {
            let started = std::time::Instant::now();
            std::hint::black_box(
                reconstruct_history_as_of(&connection, &canonical, &storage_key, target_revision)
                    .expect("as-of query")
                    .expect("complete as-of chain"),
            );
            as_of_samples.push(started.elapsed().as_secs_f64() * 1000.0);
        }
        let mut no_op_samples = Vec::with_capacity(10_000);
        for _ in 0..10_000 {
            let started = std::time::Instant::now();
            std::hint::black_box(classify_history_refresh(
                Some(&timeline.head),
                false,
                false,
                false,
                false,
            ));
            no_op_samples.push(started.elapsed().as_secs_f64() * 1000.0);
        }
        let one_commit_refresh_ms = build_samples.last().copied().unwrap_or_default()
            + delta_samples.last().copied().unwrap_or_default();
        let percentile = |samples: &mut Vec<f64>, percentile: usize| {
            samples.sort_by(f64::total_cmp);
            samples[samples.len() * percentile / 100]
        };
        let build_p50 = percentile(&mut build_samples, 50);
        let build_p95 = percentile(&mut build_samples, 95);
        let delta_p50 = percentile(&mut delta_samples, 50);
        let delta_p95 = percentile(&mut delta_samples, 95);
        let as_of_p50 = percentile(&mut as_of_samples, 50);
        let as_of_p95 = percentile(&mut as_of_samples, 95);
        let no_op_p50 = percentile(&mut no_op_samples, 50);
        let no_op_p95 = percentile(&mut no_op_samples, 95);
        let database_bytes = fs::metadata(&db_path)
            .map(|metadata| metadata.len())
            .unwrap_or_default();
        let snapshot_blob_bytes: i64 = connection
            .query_row(
                "SELECT COALESCE(SUM(LENGTH(payload)), 0) FROM history_graph_snapshot_blobs",
                [],
                |row| row.get(0),
            )
            .expect("snapshot blob bytes");
        let delta_blob_bytes: i64 = connection
            .query_row(
                "SELECT COALESCE(SUM(LENGTH(payload)), 0) FROM history_graph_event_blobs",
                [],
                |row| row.get(0),
            )
            .expect("delta blob bytes");
        let rss_kib = Command::new("ps")
            .args(["-o", "rss=", "-p", &std::process::id().to_string()])
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .and_then(|value| value.trim().parse::<u64>().ok())
            .unwrap_or_default();
        let usage_after = process_usage();
        let user_cpu =
            timeval_seconds(usage_after.ru_utime) - timeval_seconds(usage_before.ru_utime);
        let system_cpu =
            timeval_seconds(usage_after.ru_stime) - timeval_seconds(usage_before.ru_stime);
        let input_blocks = usage_after
            .ru_inblock
            .saturating_sub(usage_before.ru_inblock);
        let output_blocks = usage_after
            .ru_oublock
            .saturating_sub(usage_before.ru_oublock);

        eprintln!("\n=== bench_history_backfill_incremental_and_as_of_real_repo ===");
        eprintln!("repo:                  {}", root.display());
        eprintln!(
            "history:               {} commits · {} releases · {checkpoint_count} checkpoints",
            timeline.revisions.len(),
            timeline
                .revisions
                .iter()
                .filter(|revision| revision.is_release)
                .count()
        );
        eprintln!(
            "graph:                 {} files · {} nodes · {} edges",
            previous_snapshot.coverage.indexed_files,
            previous_snapshot.nodes.len(),
            previous_snapshot.edges.len()
        );
        eprintln!("backfill total:         {backfill_ms:.2} ms");
        eprintln!("checkpoint p50/p95:     {build_p50:.2} / {build_p95:.2} ms");
        eprintln!("delta p50/p95:          {delta_p50:.2} / {delta_p95:.2} ms");
        eprintln!(
            "delta avg changes:       {:.0} nodes · {:.0} edges",
            delta_node_changes as f64 / delta_samples.len().max(1) as f64,
            delta_edge_changes as f64 / delta_samples.len().max(1) as f64
        );
        eprintln!("one-commit refresh:     {one_commit_refresh_ms:.2} ms");
        eprintln!("as-of p50/p95:          {as_of_p50:.3} / {as_of_p95:.3} ms");
        eprintln!("no-op p50/p95:          {no_op_p50:.6} / {no_op_p95:.6} ms");
        eprintln!(
            "checkpoint hit ratio:   {:.1}%",
            checkpoint_count as f64 / timeline.revisions.len() as f64 * 100.0
        );
        eprintln!(
            "database:               {:.2} MiB ({:.1} KiB/commit)",
            database_bytes as f64 / 1_048_576.0,
            database_bytes as f64 / 1024.0 / timeline.revisions.len() as f64
        );
        eprintln!(
            "compressed payloads:    {:.2} MiB checkpoints · {:.2} MiB deltas",
            snapshot_blob_bytes as f64 / 1_048_576.0,
            delta_blob_bytes as f64 / 1_048_576.0
        );
        eprintln!(
            "process RSS:            {:.1} MiB\n",
            rss_kib as f64 / 1024.0
        );
        eprintln!("CPU user/system:        {user_cpu:.2} / {system_cpu:.2} s");
        eprintln!("filesystem block ops:   {input_blocks} read · {output_blocks} write\n");

        drop(connection);
        let _ = fs::remove_file(db_path);
    }

    fn run_git(root: &Path, arguments: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(arguments)
            .status()
            .expect("git");
        assert!(status.success(), "git {arguments:?}");
    }
}
