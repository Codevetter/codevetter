use crate::commands::structural_graph::types::{
    stable_graph_id, GraphSourceAnchor, GraphTrust, STRUCTURAL_GRAPH_SCHEMA_VERSION,
};
use crate::DbState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::State;

const MAX_EVENT_SCAN: usize = 5_000;
const DEFAULT_TRACE_LIMIT: usize = 120;
const MAX_TRACE_LIMIT: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HistoryCausalSelector {
    Event { event_id: String },
    Entity { entity_id: String },
    Revision { revision: String },
    Release { tag: String },
    EpisodeKey { key: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HistoryCausalStage {
    Intent,
    Implementation,
    Verification,
    Release,
    Outcome,
    Regression,
    FollowUp,
    Context,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HistoryCausalLinkStatus {
    Evidenced,
    QualifiedLead,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryCausalEvent {
    pub id: String,
    pub revision_sha: Option<String>,
    pub event_kind: String,
    pub stage: HistoryCausalStage,
    pub summary: String,
    pub trust: GraphTrust,
    pub origin: String,
    pub source_id: String,
    pub source_cursor: Option<String>,
    pub recorded_at: String,
    pub effective_at: Option<String>,
    pub entity_id: Option<String>,
    pub related_entity_id: Option<String>,
    pub relation_kind: Option<String>,
    pub episode_keys: Vec<String>,
    pub sources: Vec<GraphSourceAnchor>,
    pub source_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryCausalLink {
    pub id: String,
    pub from_event_id: String,
    pub to_event_id: String,
    pub relation: String,
    pub status: HistoryCausalLinkStatus,
    pub trust: GraphTrust,
    pub evidence: String,
    pub sources: Vec<GraphSourceAnchor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryChangeEpisode {
    pub id: String,
    pub anchor_event_id: String,
    pub episode_keys: Vec<String>,
    pub events: Vec<HistoryCausalEvent>,
    pub links: Vec<HistoryCausalLink>,
    pub qualified_leads: Vec<HistoryCausalLink>,
    pub qualified_lead_events: Vec<HistoryCausalEvent>,
    pub stages_present: Vec<HistoryCausalStage>,
    pub gaps: Vec<String>,
    pub contradictions: Vec<String>,
    pub trust_summary: BTreeMap<String, usize>,
    pub started_at: String,
    pub ended_at: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryCausalTrace {
    pub schema_version: i64,
    pub repo_path: String,
    pub selector: HistoryCausalSelector,
    pub episodes: Vec<HistoryChangeEpisode>,
    pub indexed_head: String,
    pub stale: bool,
    pub coverage: Value,
    pub gaps: Vec<String>,
    pub scanned_events: usize,
    pub total_events: usize,
    pub truncated: bool,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryReviewSlice {
    pub schema_version: i64,
    pub repo_path: String,
    pub files: Vec<String>,
    pub entity_ids: Vec<String>,
    pub episodes: Vec<HistoryChangeEpisode>,
    pub constraints: Vec<HistoryCausalEvent>,
    pub verification: Vec<HistoryCausalEvent>,
    pub failures: Vec<HistoryCausalEvent>,
    pub regressions: Vec<HistoryCausalEvent>,
    pub qualified_leads: Vec<HistoryCausalEvent>,
    pub gaps: Vec<String>,
    pub indexed_head: String,
    pub stale: bool,
    pub coverage: Value,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
struct StoredHistoryEvent {
    event: HistoryCausalEvent,
    payload: Value,
    explicit_refs: Vec<String>,
}

pub(crate) fn build_review_history_slice(
    connection: &Connection,
    repo_path: &str,
    changed_files: &[String],
) -> Result<HistoryReviewSlice, String> {
    let repo_root = canonical_repo_path(repo_path)?;
    let canonical = repo_root.to_string_lossy().to_string();
    let current_head = git_text(&repo_root, &["rev-parse", "HEAD"])?;
    let (indexed_head, coverage) = connection
        .query_row(
            "SELECT indexed_head, coverage_json FROM history_graph_repositories
             WHERE repo_path = ?1",
            params![canonical],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| format!("Load review history freshness: {error}"))?
        .map(|(head, coverage)| {
            (
                head.unwrap_or_default(),
                serde_json::from_str(&coverage).unwrap_or_else(|_| serde_json::json!({})),
            )
        })
        .unwrap_or_else(|| (String::new(), serde_json::json!({})));
    let mut files = changed_files
        .iter()
        .map(|path| path.trim().replace('\\', "/"))
        .filter(|path| !path.is_empty())
        .take(100)
        .collect::<Vec<_>>();
    files.sort();
    files.dedup();
    if indexed_head.is_empty() {
        return Ok(HistoryReviewSlice {
            schema_version: 1,
            repo_path: canonical,
            files,
            entity_ids: Vec::new(),
            episodes: Vec::new(),
            constraints: Vec::new(),
            verification: Vec::new(),
            failures: Vec::new(),
            regressions: Vec::new(),
            qualified_leads: Vec::new(),
            gaps: vec!["Temporal graph is not indexed for this repository".to_string()],
            indexed_head,
            stale: true,
            coverage,
            truncated: false,
        });
    }

    let entity_ids = review_entity_ids(connection, &canonical, &indexed_head, &files, 100)?;
    let revision_ids = review_revision_ids(connection, &canonical, &files, 120)?;
    let (events, scan_truncated) = load_event_pool(connection, &canonical, &repo_root, None)?;
    let entity_set = entity_ids.iter().cloned().collect::<HashSet<_>>();
    let file_set = files.iter().cloned().collect::<HashSet<_>>();
    let seed_ids = events
        .iter()
        .filter(|event| review_event_matches(event, &entity_set, &revision_ids, &file_set))
        .map(|event| event.event.id.clone())
        .take(30)
        .collect::<Vec<_>>();
    let mut components = BTreeMap::<String, HistoryChangeEpisode>::new();
    for event_id in seed_ids {
        let (episodes, _) =
            assemble_episodes(&events, &HistoryCausalSelector::Event { event_id }, 80);
        for episode in episodes {
            let mut event_ids = episode
                .events
                .iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>();
            event_ids.sort();
            components.entry(event_ids.join("\0")).or_insert(episode);
        }
    }
    let mut episodes = components.into_values().collect::<Vec<_>>();
    episodes.sort_by(|left, right| {
        right
            .ended_at
            .cmp(&left.ended_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    let episode_truncated = episodes.len() > 6 || episodes.iter().any(|episode| episode.truncated);
    episodes.truncate(6);

    let mut all_events = episodes
        .iter()
        .flat_map(|episode| episode.events.iter().cloned())
        .collect::<Vec<_>>();
    all_events.sort_by(|left, right| {
        event_time(right)
            .cmp(event_time(left))
            .then_with(|| left.id.cmp(&right.id))
    });
    all_events.dedup_by(|left, right| left.id == right.id);
    let constraints = take_review_events(&all_events, 12, |event| {
        matches!(
            event.stage,
            HistoryCausalStage::Intent | HistoryCausalStage::FollowUp
        )
    });
    let verification = take_review_events(&all_events, 12, |event| {
        event.stage == HistoryCausalStage::Verification
    });
    let regressions = take_review_events(&all_events, 12, |event| {
        event.stage == HistoryCausalStage::Regression
    });
    let failures = take_review_events(&all_events, 12, |event| {
        let summary = event.summary.to_ascii_lowercase();
        event.stage == HistoryCausalStage::Regression
            || summary.contains("failed")
            || summary.contains("failure")
            || summary.contains("error")
            || summary.contains("reject")
    });
    let mut qualified_leads = episodes
        .iter()
        .flat_map(|episode| episode.qualified_lead_events.iter().cloned())
        .collect::<Vec<_>>();
    qualified_leads.sort_by(|left, right| {
        event_time(right)
            .cmp(event_time(left))
            .then_with(|| left.id.cmp(&right.id))
    });
    qualified_leads.dedup_by(|left, right| left.id == right.id);
    qualified_leads.truncate(12);
    let mut gaps = episodes
        .iter()
        .flat_map(|episode| episode.gaps.iter().cloned())
        .collect::<Vec<_>>();
    gaps.sort();
    gaps.dedup();
    if entity_ids.is_empty() {
        gaps.push("No indexed structural entities map to the changed files".to_string());
    }
    if episodes.is_empty() {
        gaps.push("No explicit temporal episodes map to the changed files".to_string());
    }
    if scan_truncated {
        gaps.push(format!(
            "Review history scanned only the newest {MAX_EVENT_SCAN} ledger events"
        ));
    }

    Ok(HistoryReviewSlice {
        schema_version: 1,
        repo_path: canonical,
        files,
        entity_ids,
        episodes,
        constraints,
        verification,
        failures,
        regressions,
        qualified_leads,
        gaps,
        stale: indexed_head != current_head,
        indexed_head,
        coverage,
        truncated: scan_truncated || episode_truncated,
    })
}

pub(crate) fn render_review_history_slice(slice: &HistoryReviewSlice) -> String {
    if slice.episodes.is_empty() && slice.constraints.is_empty() && slice.verification.is_empty() {
        return String::new();
    }
    const MAX_BYTES: usize = 3_500;
    let mut output = String::from(
        "\nTemporal history graph for changed files (cited context; inferred/qualified leads are not findings):\n",
    );
    for event in slice
        .constraints
        .iter()
        .chain(slice.failures.iter())
        .chain(slice.verification.iter())
        .take(12)
    {
        let source = event
            .sources
            .first()
            .map(|source| format!(" source={}", source.path))
            .unwrap_or_default();
        let line = format!(
            "- [{}|{}] {}{} event={}\n",
            stage_label(&event.stage),
            event.trust.as_str(),
            event.summary.replace('\n', " "),
            source,
            event.id
        );
        if output.len() + line.len() > MAX_BYTES {
            break;
        }
        output.push_str(&line);
    }
    if !slice.gaps.is_empty() && output.len() < MAX_BYTES {
        let line = format!(
            "- Evidence gaps: {}\n",
            slice
                .gaps
                .iter()
                .take(5)
                .cloned()
                .collect::<Vec<_>>()
                .join("; ")
        );
        output.push_str(
            &line
                .chars()
                .take(MAX_BYTES - output.len())
                .collect::<String>(),
        );
    }
    output
}

pub(crate) fn render_agent_history_context(slice: &HistoryReviewSlice) -> String {
    let mut output = String::new();
    output.push_str("## Temporal Structural History\n\n");
    output.push_str(&format!(
        "_Schemas: history_query.v{} / structural_graph.v{} · indexed head `{}` · {}{}_\n\n",
        slice.schema_version,
        STRUCTURAL_GRAPH_SCHEMA_VERSION,
        slice.indexed_head,
        if slice.stale { "stale" } else { "current" },
        if slice.truncated { " · truncated" } else { "" }
    ));
    output.push_str(&format!(
        "Scope: {} files · {} stable entities · {} causal episodes.\n\n",
        slice.files.len(),
        slice.entity_ids.len(),
        slice.episodes.len()
    ));
    for episode in slice.episodes.iter().take(6) {
        output.push_str(&format!("### Episode `{}`\n\n", episode.id));
        for event in episode.events.iter().take(24) {
            let revision = event
                .revision_sha
                .as_deref()
                .map(|revision| format!(" revision `{}`", &revision[..revision.len().min(12)]))
                .unwrap_or_default();
            let source = event
                .sources
                .first()
                .map(|source| format!(" source `{}`", source.path))
                .unwrap_or_default();
            let entities = match (&event.entity_id, &event.related_entity_id) {
                (Some(from), Some(to)) => format!(" entities `{from}` -> `{to}`"),
                (Some(entity), None) | (None, Some(entity)) => {
                    format!(" entity `{entity}`")
                }
                (None, None) => String::new(),
            };
            output.push_str(&format!(
                "- [{} / {}] {} — event `{}`{}{}{}{}\n",
                stage_label(&event.stage),
                event.trust.as_str(),
                event.summary.replace('\n', " "),
                event.id,
                revision,
                source,
                entities,
                event
                    .relation_kind
                    .as_deref()
                    .map(|relation| format!(" relation `{relation}`"))
                    .unwrap_or_default()
            ));
        }
        for contradiction in episode.contradictions.iter().take(5) {
            output.push_str(&format!("- Contradiction: {contradiction}\n"));
        }
        for gap in episode.gaps.iter().take(5) {
            output.push_str(&format!("- Gap: {gap}\n"));
        }
        for lead in episode.qualified_leads.iter().take(5) {
            output.push_str(&format!(
                "- Qualified lead only: {} -> {} — {}\n",
                lead.from_event_id, lead.to_event_id, lead.evidence
            ));
        }
        output.push('\n');
    }
    if slice.episodes.is_empty() {
        output.push_str("No explicit causal episodes map to the bounded export scope.\n\n");
    }
    if !slice.gaps.is_empty() {
        output.push_str("### Coverage Gaps\n\n");
        for gap in slice.gaps.iter().take(12) {
            output.push_str(&format!("- {gap}\n"));
        }
        output.push('\n');
    }
    output
}

#[tauri::command]
pub async fn get_history_causal_trace(
    repo_path: String,
    selector: HistoryCausalSelector,
    limit: Option<usize>,
    cursor: Option<String>,
    db: State<'_, DbState>,
) -> Result<HistoryCausalTrace, String> {
    let root = canonical_repo_path(&repo_path)?;
    let selector = resolve_selector(&root, selector)?;
    let current_head = git_text(&root, &["rev-parse", "HEAD"])?;
    let limit = limit
        .unwrap_or(DEFAULT_TRACE_LIMIT)
        .clamp(1, MAX_TRACE_LIMIT);
    let cursor = cursor.as_deref().map(decode_cursor).transpose()?;
    let database = Arc::clone(&db.0);
    tokio::task::spawn_blocking(move || {
        let connection = database
            .lock()
            .map_err(|_| "History database is unavailable".to_string())?;
        query_causal_trace(&connection, &root, &current_head, selector, limit, cursor)
    })
    .await
    .map_err(|error| format!("History causal query worker failed: {error}"))?
}

pub(crate) fn query_causal_trace(
    connection: &Connection,
    repo_root: &Path,
    current_head: &str,
    selector: HistoryCausalSelector,
    limit: usize,
    cursor: Option<(String, String)>,
) -> Result<HistoryCausalTrace, String> {
    let repo_path = repo_root.to_string_lossy().to_string();
    let total_events = connection
        .query_row(
            "SELECT COUNT(*) FROM history_graph_events WHERE repo_path = ?1",
            params![repo_path],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Count history events: {error}"))? as usize;
    let (events, scan_truncated) =
        load_event_pool(connection, &repo_path, repo_root, cursor.as_ref())?;
    let scanned_events = events.len();
    let (mut episodes, mut gaps) = assemble_episodes(&events, &selector, limit);
    let response_truncated = episodes.iter().any(|episode| episode.truncated) || scan_truncated;
    if scan_truncated {
        gaps.push(format!(
            "Causal assembly scanned the newest {scanned_events} of {total_events} ledger events"
        ));
    }
    let next_cursor = scan_truncated
        .then(|| events.last())
        .flatten()
        .map(|event| encode_cursor(&event.event.recorded_at, &event.event.id))
        .transpose()?;
    let (indexed_head, coverage) = connection
        .query_row(
            "SELECT indexed_head, coverage_json FROM history_graph_repositories
             WHERE repo_path = ?1",
            params![repo_path],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| format!("Load causal-query freshness: {error}"))?
        .map(|(head, coverage)| {
            (
                head.unwrap_or_default(),
                serde_json::from_str(&coverage).unwrap_or_else(|_| serde_json::json!({})),
            )
        })
        .unwrap_or_else(|| (String::new(), serde_json::json!({})));
    episodes.sort_by(|left, right| {
        right
            .ended_at
            .cmp(&left.ended_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(HistoryCausalTrace {
        schema_version: 1,
        repo_path,
        selector,
        episodes,
        stale: indexed_head.is_empty() || indexed_head != current_head,
        indexed_head,
        coverage,
        gaps,
        scanned_events,
        total_events,
        truncated: response_truncated,
        next_cursor,
    })
}

fn load_event_pool(
    connection: &Connection,
    repo_path: &str,
    repo_root: &Path,
    cursor: Option<&(String, String)>,
) -> Result<(Vec<StoredHistoryEvent>, bool), String> {
    let (cursor_time, cursor_id) = cursor
        .cloned()
        .map(|(time, id)| (Some(time), Some(id)))
        .unwrap_or_default();
    let mut statement = connection
        .prepare(
            "SELECT id, revision_sha, event_kind, entity_id, related_entity_id,
                    relation_kind, trust, origin, source_id, source_cursor, payload_json,
                    evidence_json, recorded_at
             FROM history_graph_events
             WHERE repo_path = ?1
               AND (?2 IS NULL OR recorded_at < ?2 OR (recorded_at = ?2 AND id < ?3))
             ORDER BY recorded_at DESC, id DESC LIMIT ?4",
        )
        .map_err(|error| format!("Prepare causal event scan: {error}"))?;
    let rows = statement
        .query_map(
            params![
                repo_path,
                cursor_time,
                cursor_id,
                (MAX_EVENT_SCAN + 1) as i64
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, String>(12)?,
                ))
            },
        )
        .map_err(|error| format!("Scan causal events: {error}"))?;
    let rows = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Read causal event: {error}"))?;
    let scan_truncated = rows.len() > MAX_EVENT_SCAN;
    let mut events = Vec::with_capacity(rows.len().min(MAX_EVENT_SCAN));
    for row in rows.into_iter().take(MAX_EVENT_SCAN) {
        let (
            id,
            revision_sha,
            event_kind,
            entity_id,
            related_entity_id,
            relation_kind,
            trust,
            origin,
            source_id,
            source_cursor,
            payload_json,
            evidence_json,
            recorded_at,
        ) = row;
        let payload: Value =
            serde_json::from_str(&payload_json).unwrap_or_else(|_| serde_json::json!({}));
        let sources: Vec<GraphSourceAnchor> =
            serde_json::from_str(&evidence_json).unwrap_or_default();
        let episode_keys = string_array(&payload, "episode_keys");
        let explicit_refs = payload
            .get("related_event_id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .into_iter()
            .collect();
        let effective_at = payload
            .get("effective_at")
            .and_then(Value::as_str)
            .map(str::to_string);
        let summary = event_summary(&payload, &event_kind);
        let source_available = sources
            .iter()
            .all(|source| resolve_source_path(repo_root, &source.path).exists());
        events.push(StoredHistoryEvent {
            event: HistoryCausalEvent {
                id,
                revision_sha,
                event_kind: event_kind.clone(),
                stage: classify_stage(&event_kind),
                summary,
                trust: GraphTrust::from_storage(&trust),
                origin,
                source_id,
                source_cursor,
                recorded_at,
                effective_at,
                entity_id,
                related_entity_id,
                relation_kind,
                episode_keys,
                sources,
                source_available,
            },
            payload,
            explicit_refs,
        });
    }
    Ok((events, scan_truncated))
}

fn review_entity_ids(
    connection: &Connection,
    repo_path: &str,
    revision: &str,
    files: &[String],
    limit: usize,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT n.id
             FROM history_graph_checkpoints c
             JOIN structural_graph_nodes n ON n.snapshot_id = c.snapshot_id
             WHERE c.repo_path = ?1 AND c.revision_sha = ?2 AND c.status = 'ready'
               AND n.path = ?3
             ORDER BY n.kind, n.label, n.id LIMIT ?4",
        )
        .map_err(|error| format!("Prepare review entity lookup: {error}"))?;
    let mut entity_ids = BTreeSet::new();
    for file in files {
        let remaining = limit.saturating_sub(entity_ids.len());
        if remaining == 0 {
            break;
        }
        let rows = statement
            .query_map(
                params![repo_path, revision, file, remaining as i64],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| format!("Query review entities: {error}"))?;
        for entity_id in rows {
            entity_ids.insert(entity_id.map_err(|error| format!("Read review entity: {error}"))?);
        }
    }
    Ok(entity_ids.into_iter().collect())
}

fn review_revision_ids(
    connection: &Connection,
    repo_path: &str,
    files: &[String],
    limit: usize,
) -> Result<HashSet<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT p.revision_sha
             FROM history_graph_revision_paths p
             JOIN history_graph_revisions r
               ON r.repo_path = p.repo_path AND r.sha = p.revision_sha
             WHERE p.repo_path = ?1 AND (p.path = ?2 OR p.old_path = ?2)
             ORDER BY r.ordinal DESC LIMIT ?3",
        )
        .map_err(|error| format!("Prepare review revision lookup: {error}"))?;
    let mut revisions = HashSet::new();
    for file in files {
        let remaining = limit.saturating_sub(revisions.len());
        if remaining == 0 {
            break;
        }
        let rows = statement
            .query_map(params![repo_path, file, remaining as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| format!("Query review revisions: {error}"))?;
        for revision in rows {
            revisions.insert(revision.map_err(|error| format!("Read review revision: {error}"))?);
        }
    }
    Ok(revisions)
}

fn review_event_matches(
    event: &StoredHistoryEvent,
    entity_ids: &HashSet<String>,
    revision_ids: &HashSet<String>,
    files: &HashSet<String>,
) -> bool {
    if event
        .event
        .revision_sha
        .as_ref()
        .is_some_and(|revision| revision_ids.contains(revision))
    {
        return true;
    }
    if event_entities(event)
        .iter()
        .any(|entity_id| entity_ids.contains(entity_id))
        || entity_ids
            .iter()
            .any(|entity_id| payload_mentions_entity(&event.payload, entity_id))
    {
        return true;
    }
    event.event.sources.iter().any(|source| {
        files
            .iter()
            .any(|file| history_path_matches(&source.path, file))
    }) || files
        .iter()
        .any(|file| payload_mentions_path(&event.payload, file))
}

fn payload_mentions_path(payload: &Value, file: &str) -> bool {
    if ["path", "old_path"]
        .iter()
        .any(|key| payload.get(*key).and_then(Value::as_str) == Some(file))
        || ["changed_paths", "source_paths"]
            .iter()
            .any(|key| string_array(payload, key).iter().any(|path| path == file))
    {
        return true;
    }
    payload
        .get("path_changes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|change| {
            ["path", "old_path"]
                .iter()
                .any(|key| change.get(*key).and_then(Value::as_str) == Some(file))
        })
}

fn history_path_matches(source_path: &str, file: &str) -> bool {
    let source_path = source_path.replace('\\', "/");
    let file = file.trim_start_matches("./");
    source_path.trim_start_matches("./") == file || source_path.ends_with(&format!("/{file}"))
}

fn take_review_events(
    events: &[HistoryCausalEvent],
    limit: usize,
    predicate: impl Fn(&HistoryCausalEvent) -> bool,
) -> Vec<HistoryCausalEvent> {
    events
        .iter()
        .filter(|event| predicate(event))
        .take(limit)
        .cloned()
        .collect()
}

fn stage_label(stage: &HistoryCausalStage) -> &'static str {
    match stage {
        HistoryCausalStage::Intent => "intent",
        HistoryCausalStage::Implementation => "implementation",
        HistoryCausalStage::Verification => "verification",
        HistoryCausalStage::Release => "release",
        HistoryCausalStage::Outcome => "outcome",
        HistoryCausalStage::Regression => "regression",
        HistoryCausalStage::FollowUp => "follow-up",
        HistoryCausalStage::Context => "context",
    }
}

fn assemble_episodes(
    events: &[StoredHistoryEvent],
    selector: &HistoryCausalSelector,
    limit: usize,
) -> (Vec<HistoryChangeEpisode>, Vec<String>) {
    let seeds = events
        .iter()
        .enumerate()
        .filter(|(_, event)| selector_matches(selector, event))
        .map(|(index, _)| index)
        .take(20)
        .collect::<Vec<_>>();
    if seeds.is_empty() {
        return (
            Vec::new(),
            vec![
                "No explicit ledger event matches the causal selector within scanned coverage"
                    .to_string(),
            ],
        );
    }
    let mut claimed = HashSet::new();
    let mut episodes = Vec::new();
    for seed in seeds {
        if claimed.contains(&seed) {
            continue;
        }
        let mut member_indexes = BTreeSet::from([seed]);
        let mut frontier = vec![seed];
        let mut links = Vec::new();
        let mut truncated = false;
        while let Some(current_index) = frontier.pop() {
            if member_indexes.len() >= limit {
                truncated = true;
                break;
            }
            for (candidate_index, candidate) in events.iter().enumerate() {
                if member_indexes.contains(&candidate_index) {
                    continue;
                }
                let Some((relation, evidence)) = explicit_link(&events[current_index], candidate)
                else {
                    continue;
                };
                if member_indexes.len() >= limit {
                    truncated = true;
                    break;
                }
                member_indexes.insert(candidate_index);
                frontier.push(candidate_index);
                links.push(causal_link(
                    &events[current_index].event,
                    &candidate.event,
                    &relation,
                    HistoryCausalLinkStatus::Evidenced,
                    GraphTrust::Extracted,
                    evidence,
                ));
            }
        }
        claimed.extend(member_indexes.iter().copied());
        let mut episode_events = member_indexes
            .iter()
            .map(|index| events[*index].event.clone())
            .collect::<Vec<_>>();
        episode_events.sort_by(|left, right| {
            event_time(left)
                .cmp(event_time(right))
                .then_with(|| left.id.cmp(&right.id))
        });
        links.sort_by(|left, right| left.id.cmp(&right.id));
        links.dedup_by(|left, right| left.id == right.id);
        let member_ids = episode_events
            .iter()
            .map(|event| event.id.as_str())
            .collect::<HashSet<_>>();
        let (qualified_leads, qualified_lead_events) =
            qualified_leads(events, &episode_events, &member_ids, 20);
        episodes.push(build_episode(
            &events[seed].event.id,
            episode_events,
            links,
            qualified_leads,
            qualified_lead_events,
            truncated,
        ));
    }
    (episodes, Vec::new())
}

fn explicit_link(
    left: &StoredHistoryEvent,
    right: &StoredHistoryEvent,
) -> Option<(String, String)> {
    if left.explicit_refs.contains(&right.event.id) || right.explicit_refs.contains(&left.event.id)
    {
        return Some((
            "references_event".to_string(),
            "One persisted record explicitly references the other event ID".to_string(),
        ));
    }
    let left_keys = left.event.episode_keys.iter().collect::<HashSet<_>>();
    let right_keys = right.event.episode_keys.iter().collect::<HashSet<_>>();
    if let Some(key) = left_keys.intersection(&right_keys).next() {
        return Some((
            "shared_episode_key".to_string(),
            format!("Both records carry the explicit episode key {key}"),
        ));
    }
    None
}

fn qualified_leads(
    all: &[StoredHistoryEvent],
    members: &[HistoryCausalEvent],
    member_ids: &HashSet<&str>,
    limit: usize,
) -> (Vec<HistoryCausalLink>, Vec<HistoryCausalEvent>) {
    let mut leads = Vec::new();
    let mut lead_events = BTreeMap::new();
    for candidate in all
        .iter()
        .filter(|event| !member_ids.contains(event.event.id.as_str()))
    {
        for member in members {
            if let Some((relation, evidence)) = identifier_association(member, candidate) {
                leads.push(causal_link(
                    member,
                    &candidate.event,
                    relation,
                    HistoryCausalLinkStatus::QualifiedLead,
                    GraphTrust::Inferred,
                    evidence,
                ));
                lead_events.insert(candidate.event.id.clone(), candidate.event.clone());
                break;
            }
            let shared_paths = member
                .sources
                .iter()
                .map(|source| source.path.as_str())
                .collect::<HashSet<_>>();
            let Some(path) = candidate
                .event
                .sources
                .iter()
                .map(|source| source.path.as_str())
                .find(|path| shared_paths.contains(path))
            else {
                continue;
            };
            if !within_minutes(event_time(member), event_time(&candidate.event), 30) {
                continue;
            }
            leads.push(causal_link(
                member,
                &candidate.event,
                "path_time_correlation",
                HistoryCausalLinkStatus::QualifiedLead,
                GraphTrust::Inferred,
                format!(
                    "Both records cite {path} within 30 minutes; no explicit identifier links them"
                ),
            ));
            lead_events.insert(candidate.event.id.clone(), candidate.event.clone());
            break;
        }
        if leads.len() >= limit {
            break;
        }
    }
    leads.sort_by(|left, right| left.id.cmp(&right.id));
    leads.dedup_by(|left, right| left.id == right.id);
    (leads, lead_events.into_values().collect())
}

fn identifier_association(
    member: &HistoryCausalEvent,
    candidate: &StoredHistoryEvent,
) -> Option<(&'static str, String)> {
    if member.revision_sha.is_some() && member.revision_sha == candidate.event.revision_sha {
        return Some((
            "same_revision_association",
            "Both records identify the same Git revision; this is association evidence, not causation"
                .to_string(),
        ));
    }
    let member_entities = [&member.entity_id, &member.related_entity_id]
        .into_iter()
        .flatten()
        .cloned()
        .collect::<HashSet<_>>();
    let candidate_entities = event_entities(candidate);
    if let Some(entity) = member_entities.intersection(&candidate_entities).next() {
        return Some((
            "same_entity_association",
            format!(
                "Both records identify entity {entity}; no explicit event reference links them"
            ),
        ));
    }
    let member_keys = member.episode_keys.iter().collect::<HashSet<_>>();
    let candidate_keys = candidate.event.episode_keys.iter().collect::<HashSet<_>>();
    member_keys.intersection(&candidate_keys).next().map(|key| {
        (
            "shared_episode_key_association",
            format!("Both records carry episode key {key}; no explicit event reference links them"),
        )
    })
}

fn build_episode(
    anchor_event_id: &str,
    events: Vec<HistoryCausalEvent>,
    links: Vec<HistoryCausalLink>,
    qualified_leads: Vec<HistoryCausalLink>,
    qualified_lead_events: Vec<HistoryCausalEvent>,
    truncated: bool,
) -> HistoryChangeEpisode {
    let mut episode_keys = events
        .iter()
        .flat_map(|event| event.episode_keys.iter().cloned())
        .collect::<Vec<_>>();
    episode_keys.sort();
    episode_keys.dedup();
    let mut stages_present = events
        .iter()
        .map(|event| event.stage.clone())
        .collect::<Vec<_>>();
    stages_present.sort_by_key(stage_order);
    stages_present.dedup();
    let mut gaps = Vec::new();
    for (stage, label) in [
        (HistoryCausalStage::Intent, "intent"),
        (HistoryCausalStage::Implementation, "implementation"),
        (HistoryCausalStage::Verification, "verification"),
        (HistoryCausalStage::Release, "release/deploy"),
        (HistoryCausalStage::Outcome, "runtime/provider outcome"),
    ] {
        if !stages_present.contains(&stage) {
            gaps.push(format!("No explicitly linked {label} evidence"));
        }
    }
    let contradictions = episode_contradictions(&events);
    let mut trust_summary = BTreeMap::new();
    for event in &events {
        *trust_summary
            .entry(event.trust.as_str().to_string())
            .or_default() += 1;
    }
    let started_at = events
        .first()
        .map(|event| event_time(event).to_string())
        .unwrap_or_default();
    let ended_at = events
        .last()
        .map(|event| event_time(event).to_string())
        .unwrap_or_default();
    HistoryChangeEpisode {
        id: stable_graph_id("history-episode", anchor_event_id),
        anchor_event_id: anchor_event_id.to_string(),
        episode_keys,
        events,
        links,
        qualified_leads,
        qualified_lead_events,
        stages_present,
        gaps,
        contradictions,
        trust_summary,
        started_at,
        ended_at,
        truncated,
    }
}

fn episode_contradictions(events: &[HistoryCausalEvent]) -> Vec<String> {
    let mut contradictions = Vec::new();
    let qa_passed = events.iter().any(|event| {
        event.event_kind == "synthetic_qa" && event.summary.to_ascii_lowercase().contains("passed")
    });
    let qa_failed = events.iter().any(|event| {
        event.event_kind == "synthetic_qa" && event.summary.to_ascii_lowercase().contains("failed")
    });
    if qa_passed && qa_failed {
        contradictions.push(
            "Linked synthetic QA evidence contains both passing and failing observations"
                .to_string(),
        );
    }
    if events.iter().any(|event| {
        event.event_kind == "user_annotation"
            && event.summary.to_ascii_lowercase().contains("reject")
    }) {
        contradictions
            .push("A local user annotation rejects linked historical evidence".to_string());
    }
    contradictions
}

fn selector_matches(selector: &HistoryCausalSelector, event: &StoredHistoryEvent) -> bool {
    match selector {
        HistoryCausalSelector::Event { event_id } => &event.event.id == event_id,
        HistoryCausalSelector::Entity { entity_id } => {
            event_entities(event).contains(entity_id)
                || payload_mentions_entity(&event.payload, entity_id)
        }
        HistoryCausalSelector::Revision { revision } => {
            event.event.revision_sha.as_deref() == Some(revision)
        }
        HistoryCausalSelector::Release { tag } => {
            event.payload.get("tag").and_then(Value::as_str) == Some(tag)
                || string_array(&event.payload, "release_candidates").contains(tag)
        }
        HistoryCausalSelector::EpisodeKey { key } => event.event.episode_keys.contains(key),
    }
}

fn payload_mentions_entity(payload: &Value, entity_id: &str) -> bool {
    [
        "entity_candidates",
        "added_node_ids",
        "changed_node_ids",
        "removed_node_ids",
    ]
    .iter()
    .any(|key| {
        string_array(payload, key)
            .iter()
            .any(|value| value == entity_id)
    })
}

fn event_entities(event: &StoredHistoryEvent) -> HashSet<String> {
    event
        .event
        .entity_id
        .iter()
        .chain(event.event.related_entity_id.iter())
        .cloned()
        .chain(string_array(&event.payload, "entity_candidates"))
        .collect()
}

fn causal_link(
    left: &HistoryCausalEvent,
    right: &HistoryCausalEvent,
    relation: &str,
    status: HistoryCausalLinkStatus,
    trust: GraphTrust,
    evidence: String,
) -> HistoryCausalLink {
    let mut ids = [left.id.as_str(), right.id.as_str()];
    ids.sort();
    HistoryCausalLink {
        id: stable_graph_id(
            "history-causal-link",
            &format!("{relation}\0{}\0{}", ids[0], ids[1]),
        ),
        from_event_id: left.id.clone(),
        to_event_id: right.id.clone(),
        relation: relation.to_string(),
        status,
        trust,
        evidence,
        sources: left
            .sources
            .iter()
            .chain(right.sources.iter())
            .take(20)
            .cloned()
            .collect(),
    }
}

fn classify_stage(event_kind: &str) -> HistoryCausalStage {
    match event_kind {
        "decision_marker" | "agent_session" => HistoryCausalStage::Intent,
        "commit" | "structural_delta" | "entity_lineage" => HistoryCausalStage::Implementation,
        "review" | "pull_request_review" | "verification_attempt" | "synthetic_qa" => {
            HistoryCausalStage::Verification
        }
        "release" | "deploy" => HistoryCausalStage::Release,
        "analytics_provider_ingestion"
        | "analytics_provider_delivery"
        | "observed_outcome"
        | "log_observation" => HistoryCausalStage::Outcome,
        "incident" => HistoryCausalStage::Regression,
        "issue" | "user_annotation" => HistoryCausalStage::FollowUp,
        _ => HistoryCausalStage::Context,
    }
}

fn event_summary(payload: &Value, event_kind: &str) -> String {
    ["summary", "subject", "body", "decision", "evidence"]
        .iter()
        .find_map(|key| payload.get(*key).and_then(Value::as_str))
        .map(|value| value.chars().take(1_000).collect())
        .unwrap_or_else(|| event_kind.replace('_', " "))
}

fn resolve_source_path(repo_root: &Path, source_path: &str) -> PathBuf {
    let path = PathBuf::from(source_path);
    if path.is_absolute() {
        path
    } else {
        repo_root.join(path)
    }
}

fn string_array(payload: &Value, key: &str) -> Vec<String> {
    payload
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .take(200)
        .map(str::to_string)
        .collect()
}

fn event_time(event: &HistoryCausalEvent) -> &str {
    event.effective_at.as_deref().unwrap_or(&event.recorded_at)
}

fn within_minutes(left: &str, right: &str, minutes: i64) -> bool {
    let Ok(left) = chrono::DateTime::parse_from_rfc3339(left) else {
        return false;
    };
    let Ok(right) = chrono::DateTime::parse_from_rfc3339(right) else {
        return false;
    };
    (left - right).num_minutes().abs() <= minutes
}

fn stage_order(stage: &HistoryCausalStage) -> u8 {
    match stage {
        HistoryCausalStage::Intent => 0,
        HistoryCausalStage::Implementation => 1,
        HistoryCausalStage::Verification => 2,
        HistoryCausalStage::Release => 3,
        HistoryCausalStage::Outcome => 4,
        HistoryCausalStage::Regression => 5,
        HistoryCausalStage::FollowUp => 6,
        HistoryCausalStage::Context => 7,
    }
}

fn resolve_selector(
    root: &PathBuf,
    selector: HistoryCausalSelector,
) -> Result<HistoryCausalSelector, String> {
    match selector {
        HistoryCausalSelector::Revision { revision } => Ok(HistoryCausalSelector::Revision {
            revision: resolve_revision(root, &revision)?,
        }),
        HistoryCausalSelector::Release { tag } => {
            if tag.trim().is_empty() || tag.starts_with('-') || tag.len() > 128 {
                return Err("A valid release tag is required".to_string());
            }
            Ok(HistoryCausalSelector::Release { tag })
        }
        HistoryCausalSelector::Event { event_id } if event_id.trim().is_empty() => {
            Err("A causal event ID is required".to_string())
        }
        HistoryCausalSelector::Entity { entity_id } if entity_id.trim().is_empty() => {
            Err("A causal entity ID is required".to_string())
        }
        HistoryCausalSelector::EpisodeKey { key } if key.trim().is_empty() => {
            Err("A causal episode key is required".to_string())
        }
        selector => Ok(selector),
    }
}

fn resolve_revision(root: &PathBuf, revision: &str) -> Result<String, String> {
    let revision = revision.trim();
    if revision.is_empty() || revision.starts_with('-') || revision.len() > 128 {
        return Err("A valid Git revision is required".to_string());
    }
    git_text(
        root,
        &["rev-parse", "--verify", &format!("{revision}^{{commit}}")],
    )
}

fn canonical_repo_path(repo_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(repo_path.trim())
        .canonicalize()
        .map_err(|error| format!("Cannot resolve repository path: {error}"))?;
    if !path.is_dir() {
        return Err("Repository path is not a directory".to_string());
    }
    Ok(path)
}

fn git_text(root: &PathBuf, arguments: &[&str]) -> Result<String, String> {
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
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn encode_cursor(recorded_at: &str, id: &str) -> Result<String, String> {
    serde_json::to_string(&(recorded_at, id)).map_err(|error| format!("Encode cursor: {error}"))
}

fn decode_cursor(cursor: &str) -> Result<(String, String), String> {
    serde_json::from_str(cursor).map_err(|_| "Invalid causal trace cursor".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::fs;

    fn stored_event(
        id: &str,
        event_kind: &str,
        recorded_at: &str,
        entity_id: Option<&str>,
        revision_sha: Option<&str>,
        episode_keys: &[&str],
        source_path: Option<&str>,
        summary: &str,
    ) -> StoredHistoryEvent {
        let sources = source_path
            .map(|path| GraphSourceAnchor {
                path: path.to_string(),
                start_line: None,
                start_column: None,
                end_line: None,
                end_column: None,
                excerpt: None,
            })
            .into_iter()
            .collect();
        StoredHistoryEvent {
            event: HistoryCausalEvent {
                id: id.to_string(),
                revision_sha: revision_sha.map(str::to_string),
                event_kind: event_kind.to_string(),
                stage: classify_stage(event_kind),
                summary: summary.to_string(),
                trust: GraphTrust::Extracted,
                origin: "fixture".to_string(),
                source_id: "fixture".to_string(),
                source_cursor: None,
                recorded_at: recorded_at.to_string(),
                effective_at: None,
                entity_id: entity_id.map(str::to_string),
                related_entity_id: None,
                relation_kind: None,
                episode_keys: episode_keys.iter().map(|key| (*key).to_string()).collect(),
                sources,
                source_available: true,
            },
            payload: serde_json::json!({
                "summary": summary,
                "episode_keys": episode_keys,
            }),
            explicit_refs: Vec::new(),
        }
    }

    #[test]
    fn explicit_event_references_assemble_a_complete_causal_thread() {
        let mut events = vec![
            stored_event(
                "intent",
                "decision_marker",
                "2026-01-01T00:00:00Z",
                None,
                None,
                &["review:7"],
                Some("docs/decision.md"),
                "instrument signup",
            ),
            stored_event(
                "implementation",
                "commit",
                "2026-01-01T01:00:00Z",
                Some("event:signup"),
                Some("abc123"),
                &["review:7"],
                Some("src/analytics.ts"),
                "emit signup event",
            ),
            stored_event(
                "verification",
                "synthetic_qa",
                "2026-01-01T02:00:00Z",
                None,
                None,
                &["review:7"],
                None,
                "signup passed",
            ),
            stored_event(
                "release",
                "deploy",
                "2026-01-01T03:00:00Z",
                None,
                None,
                &["review:7", "deploy:42"],
                None,
                "deployed production build",
            ),
            stored_event(
                "outcome",
                "analytics_provider_delivery",
                "2026-01-01T04:00:00Z",
                Some("event:signup"),
                None,
                &["deploy:42"],
                None,
                "provider received signup",
            ),
            stored_event(
                "regression",
                "incident",
                "2026-01-01T05:00:00Z",
                Some("event:signup"),
                None,
                &["deploy:42"],
                None,
                "provider delivery regressed",
            ),
            stored_event(
                "follow-up",
                "issue",
                "2026-01-01T06:00:00Z",
                Some("event:signup"),
                None,
                &["deploy:42"],
                None,
                "follow up on dropped delivery",
            ),
        ];
        for index in 1..events.len() {
            let previous_id = events[index - 1].event.id.clone();
            events[index].explicit_refs.push(previous_id);
        }

        let (episodes, gaps) = assemble_episodes(
            &events,
            &HistoryCausalSelector::EpisodeKey {
                key: "review:7".to_string(),
            },
            20,
        );

        assert!(gaps.is_empty());
        assert_eq!(episodes.len(), 1);
        assert_eq!(episodes[0].events.len(), 7);
        assert!(episodes[0].gaps.is_empty());
        assert_eq!(
            episodes[0].stages_present,
            vec![
                HistoryCausalStage::Intent,
                HistoryCausalStage::Implementation,
                HistoryCausalStage::Verification,
                HistoryCausalStage::Release,
                HistoryCausalStage::Outcome,
                HistoryCausalStage::Regression,
                HistoryCausalStage::FollowUp,
            ]
        );
    }

    #[test]
    fn time_and_path_proximity_stays_a_qualified_lead() {
        let events = vec![
            stored_event(
                "implementation",
                "commit",
                "2026-01-01T00:00:00Z",
                Some("entity:signup"),
                Some("abc123"),
                &[],
                Some("src/analytics.ts"),
                "emit signup",
            ),
            stored_event(
                "nearby-review",
                "review",
                "2026-01-01T00:10:00Z",
                None,
                None,
                &[],
                Some("src/analytics.ts"),
                "nearby review",
            ),
        ];

        let (episodes, _) = assemble_episodes(
            &events,
            &HistoryCausalSelector::Entity {
                entity_id: "entity:signup".to_string(),
            },
            20,
        );

        assert_eq!(episodes[0].events.len(), 1);
        assert_eq!(episodes[0].qualified_leads.len(), 1);
        assert_eq!(episodes[0].qualified_lead_events[0].id, "nearby-review");
        assert_eq!(
            episodes[0].qualified_leads[0].status,
            HistoryCausalLinkStatus::QualifiedLead
        );
    }

    #[test]
    fn shared_revision_and_entity_are_not_evidenced_as_causation() {
        let events = vec![
            stored_event(
                "implementation",
                "commit",
                "2026-01-01T00:00:00Z",
                Some("entity:signup"),
                Some("abc123"),
                &[],
                None,
                "emit signup",
            ),
            stored_event(
                "review",
                "review",
                "2026-01-01T00:05:00Z",
                Some("entity:signup"),
                Some("abc123"),
                &[],
                None,
                "review signup",
            ),
        ];
        let (episodes, _) = assemble_episodes(
            &events,
            &HistoryCausalSelector::Entity {
                entity_id: "entity:signup".to_string(),
            },
            20,
        );
        assert_eq!(episodes[0].events.len(), 1);
        assert!(episodes[0].links.is_empty());
        assert_eq!(episodes[0].qualified_leads.len(), 1);
        assert_eq!(
            episodes[0].qualified_leads[0].status,
            HistoryCausalLinkStatus::QualifiedLead
        );
        assert_eq!(episodes[0].qualified_leads[0].trust, GraphTrust::Inferred);
    }

    #[test]
    fn unlinked_evidence_remains_separate_and_missing_outcome_is_a_gap() {
        let events = vec![
            stored_event(
                "implementation",
                "commit",
                "2026-01-01T00:00:00Z",
                Some("entity:signup"),
                Some("abc123"),
                &[],
                Some("src/analytics.ts"),
                "emit signup",
            ),
            stored_event(
                "unrelated",
                "observed_outcome",
                "2026-01-01T00:05:00Z",
                None,
                None,
                &[],
                Some("src/billing.ts"),
                "billing succeeded",
            ),
        ];

        let (episodes, _) = assemble_episodes(
            &events,
            &HistoryCausalSelector::Entity {
                entity_id: "entity:signup".to_string(),
            },
            20,
        );

        assert_eq!(episodes[0].events.len(), 1);
        assert!(episodes[0].qualified_leads.is_empty());
        assert!(episodes[0]
            .gaps
            .iter()
            .any(|gap| gap.contains("runtime/provider outcome")));
    }

    #[test]
    fn conflicting_qa_results_are_preserved_as_a_contradiction() {
        let events = vec![
            stored_event(
                "qa-pass",
                "synthetic_qa",
                "2026-01-01T00:00:00Z",
                None,
                None,
                &["qa-loop:1"],
                None,
                "browser passed",
            ),
            stored_event(
                "qa-fail",
                "synthetic_qa",
                "2026-01-01T00:01:00Z",
                None,
                None,
                &["qa-loop:1"],
                None,
                "browser failed",
            ),
        ];

        let (episodes, _) = assemble_episodes(
            &events,
            &HistoryCausalSelector::EpisodeKey {
                key: "qa-loop:1".to_string(),
            },
            20,
        );

        assert_eq!(episodes[0].contradictions.len(), 1);
    }

    #[test]
    fn rotated_relative_sources_are_reported_unavailable() {
        let root = std::env::temp_dir().join(format!("cv-history-query-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("artifacts")).expect("fixture");
        fs::write(root.join("artifacts/present.json"), b"{}").expect("source");
        let canonical = root.canonicalize().expect("canonical");
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("migrations");
        connection
            .execute(
                "INSERT INTO history_graph_repositories (
                    repo_path, repository_fingerprint, status, created_at, updated_at
                 ) VALUES (?1, 'fixture', 'ready', '2026-01-01T00:00:00Z',
                    '2026-01-01T00:00:00Z')",
                params![canonical.to_string_lossy()],
            )
            .expect("repository");
        for (id, path) in [
            ("present", "artifacts/present.json"),
            ("rotated", "artifacts/rotated.json"),
        ] {
            let evidence = serde_json::to_string(&vec![GraphSourceAnchor {
                path: path.to_string(),
                start_line: None,
                start_column: None,
                end_line: None,
                end_column: None,
                excerpt: None,
            }])
            .expect("evidence");
            connection
                .execute(
                    "INSERT INTO history_graph_events (
                        id, repo_path, event_kind, trust, origin, source_id,
                        payload_json, evidence_json, recorded_at
                     ) VALUES (?1, ?2, 'verification_attempt', 'extracted', 'fixture',
                        'fixture', '{}', ?3, '2026-01-01T00:00:00Z')",
                    params![id, canonical.to_string_lossy(), evidence],
                )
                .expect("event");
        }

        let (events, truncated) =
            load_event_pool(&connection, &canonical.to_string_lossy(), &canonical, None)
                .expect("event pool");

        assert!(!truncated);
        let availability = events
            .iter()
            .map(|event| (event.event.id.as_str(), event.event.source_available))
            .collect::<HashMap<_, _>>();
        assert!(availability["present"]);
        assert!(!availability["rotated"]);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn episode_ids_and_bounded_traversal_are_deterministic() {
        let events = (0..4)
            .map(|index| {
                stored_event(
                    &format!("event-{index}"),
                    "commit",
                    &format!("2026-01-01T00:0{index}:00Z"),
                    None,
                    None,
                    &["episode:bounded"],
                    None,
                    "bounded",
                )
            })
            .collect::<Vec<_>>();
        let selector = HistoryCausalSelector::EpisodeKey {
            key: "episode:bounded".to_string(),
        };

        let (first, _) = assemble_episodes(&events, &selector, 2);
        let (second, _) = assemble_episodes(&events, &selector, 2);

        assert_eq!(first, second);
        assert!(first[0].truncated);
        assert_eq!(first[0].events.len(), 2);
    }

    #[test]
    fn review_slice_is_file_scoped_cited_and_prompt_bounded() {
        let root = std::env::temp_dir().join(format!("cv-review-history-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).expect("fixture");
        git_text(&root, &["init"]).expect("init");
        git_text(&root, &["config", "user.email", "fixture@example.com"]).expect("email");
        git_text(&root, &["config", "user.name", "Fixture"]).expect("name");
        fs::write(
            root.join("src/analytics.ts"),
            b"export const track = () => 'signup';\n",
        )
        .expect("source");
        git_text(&root, &["add", "src/analytics.ts"]).expect("add");
        git_text(&root, &["commit", "-m", "emit signup analytics"]).expect("commit");
        let canonical = root.canonicalize().expect("canonical");
        let canonical_text = canonical.to_string_lossy().to_string();
        let head = git_text(&canonical, &["rev-parse", "HEAD"]).expect("head");
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("migrations");
        connection
            .execute(
                "INSERT INTO history_graph_repositories (
                    repo_path, repository_fingerprint, indexed_head, status, coverage_json,
                    created_at, updated_at
                 ) VALUES (?1, 'fixture', ?2, 'ready', '{\"coverage_complete\":true}',
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
                params![canonical_text, head],
            )
            .expect("repository");
        let evidence = serde_json::to_string(&vec![GraphSourceAnchor {
            path: "src/analytics.ts".to_string(),
            start_line: Some(1),
            start_column: None,
            end_line: Some(1),
            end_column: None,
            excerpt: None,
        }])
        .expect("evidence");
        connection
            .execute(
                "INSERT INTO history_graph_events (
                    id, repo_path, event_kind, trust, origin, source_id, payload_json,
                    evidence_json, recorded_at
                 ) VALUES
                    ('decision-1', ?1, 'decision_marker', 'extracted', 'fixture', 'fixture',
                     '{\"summary\":\"track signup\",\"episode_keys\":[\"review:1\"]}',
                     ?2, '2026-01-01T00:00:00Z'),
                    ('qa-1', ?1, 'synthetic_qa', 'extracted', 'fixture', 'fixture',
                     '{\"summary\":\"signup flow passed\",\"episode_keys\":[\"review:1\"]}',
                     '[]', '2026-01-01T01:00:00Z')",
                params![canonical_text, evidence],
            )
            .expect("events");

        let slice = build_review_history_slice(
            &connection,
            &canonical_text,
            &["src/analytics.ts".to_string()],
        )
        .expect("review slice");
        let prompt = render_review_history_slice(&slice);
        let agent_context = render_agent_history_context(&slice);

        assert!(!slice.stale);
        assert_eq!(slice.episodes.len(), 1);
        assert_eq!(slice.constraints[0].id, "decision-1");
        assert_eq!(slice.verification[0].id, "qa-1");
        assert!(slice
            .gaps
            .iter()
            .any(|gap| gap.contains("runtime/provider outcome")));
        assert!(prompt.contains("event=decision-1"));
        assert!(prompt.contains("event=qa-1"));
        assert!(prompt.len() <= 3_500);
        assert!(agent_context.contains("history_query.v1 / structural_graph.v3"));
        assert!(agent_context.contains("event `decision-1`"));
        assert!(agent_context.contains("runtime/provider outcome"));
        fs::remove_dir_all(root).expect("remove fixture");
    }
}
