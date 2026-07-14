//! Read-only release-history query service shared by Tauri and MCP.
//!
//! This is the only layer in the MCP path allowed to understand graph/history
//! persistence. The protocol adapter maps typed inputs and outputs only.

use crate::commands::{
    history_graph::{
        canonical_repo_path, history_index_freshness, history_storage_key,
        load_entity_annotation_contradictions, load_entity_occurrences, load_history_revisions,
        load_lineage_family, load_outcome_events, reconstruct_history_as_of,
        repository_tag_fingerprint, resolve_temporal_reference, HistoryAnnotation,
        HistoryAnnotationDecision, HistoryAnnotationPage, HistoryAsOfState, HistoryEntityEvolution,
        HistoryFacet, HistoryFacetPacket, HistoryFacetStatus, HistoryGraphStatus,
        HistorySearchResult, HistoryStructuralState, HistoryTemporalReference,
    },
    history_query::{query_causal_trace, HistoryCausalSelector, HistoryCausalTrace},
    structural_graph::{
        query::{self, GraphSnapshotDiff},
        types::{GraphSourceAnchor, GraphTrust},
    },
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HistorySearchKind {
    Release,
    Commit,
    Entity,
    Event,
    Annotation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistorySearchItem {
    pub kind: HistorySearchKind,
    pub id: String,
    pub label: String,
    pub summary: String,
    pub revision: Option<String>,
    pub recorded_at: Option<String>,
    pub trust: GraphTrust,
    pub source_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryUnifiedSearch {
    pub schema_version: i64,
    pub items: Vec<HistorySearchItem>,
    pub truncated: bool,
    pub next_offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryComparison {
    pub schema_version: i64,
    pub before: HistoryTemporalReference,
    pub after: HistoryTemporalReference,
    pub before_revision: String,
    pub after_revision: String,
    pub structural: GraphSnapshotDiff,
    pub changed_paths: Vec<String>,
    pub event_kind_counts: BTreeMap<String, usize>,
    pub gaps: Vec<String>,
    pub stale: bool,
    pub indexed_head: Option<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEvidenceDetail {
    pub schema_version: i64,
    pub id: String,
    pub event_kind: String,
    pub revision_sha: Option<String>,
    pub entity_id: Option<String>,
    pub related_entity_id: Option<String>,
    pub relation_kind: Option<String>,
    pub trust: GraphTrust,
    pub origin: String,
    pub source_id: String,
    pub source_cursor: Option<String>,
    pub summary: Option<String>,
    pub sources: Vec<GraphSourceAnchor>,
    pub recorded_at: String,
    pub available: bool,
}

pub struct HistoryReadService<'a> {
    connection: &'a Connection,
    root: PathBuf,
    repo_path: String,
    storage_key: String,
    current_head: String,
}

impl<'a> HistoryReadService<'a> {
    pub fn new(connection: &'a Connection, repo_path: &str) -> Result<Self, String> {
        let root = canonical_repo_path(repo_path)?;
        let current_head = git_text(&root, &["rev-parse", "HEAD"])?;
        Self::new_with_current_head(connection, root, current_head)
    }

    pub fn new_with_current_head(
        connection: &'a Connection,
        root: PathBuf,
        current_head: String,
    ) -> Result<Self, String> {
        let repo_path = root.to_string_lossy().to_string();
        let storage_key = history_storage_key(&repo_path);
        Ok(Self {
            connection,
            root,
            repo_path,
            storage_key,
            current_head,
        })
    }

    pub fn status(&self) -> Result<HistoryGraphStatus, String> {
        let current_tags = repository_tag_fingerprint(&self.root).ok();
        self.status_with_tag_fingerprint(current_tags.as_deref())
    }

    pub fn status_with_tag_fingerprint(
        &self,
        current_tags: Option<&str>,
    ) -> Result<HistoryGraphStatus, String> {
        let stored = self
            .connection
            .query_row(
                "SELECT indexed_head, indexed_tags_fingerprint, coverage_json, updated_at,
                    (SELECT COUNT(*) FROM history_graph_checkpoints c WHERE c.repo_path = r.repo_path),
                    (SELECT COUNT(*) FROM history_graph_events e WHERE e.repo_path = r.repo_path)
                 FROM history_graph_repositories r WHERE repo_path = ?1",
                [&self.repo_path],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("Load history status: {error}"))?;
        let (indexed_head, indexed_tags, coverage, updated_at, checkpoints, events) = stored
            .map(|(head, tags, coverage, updated, checkpoints, events)| {
                (
                    head,
                    tags,
                    serde_json::from_str(&coverage).unwrap_or(Value::Object(Default::default())),
                    updated,
                    checkpoints.max(0) as usize,
                    events.max(0) as usize,
                )
            })
            .unwrap_or((None, None, Value::Object(Default::default()), None, 0, 0));
        let tags_stale = current_tags
            .zip(indexed_tags.as_deref())
            .is_some_and(|(current, indexed)| current != indexed);
        Ok(HistoryGraphStatus {
            repo_path: self.repo_path.clone(),
            indexed: indexed_head.is_some(),
            backfilling: false,
            stale: indexed_head.as_deref() != Some(self.current_head.as_str()) || tags_stale,
            current_head: self.current_head.clone(),
            indexed_head,
            checkpoint_count: checkpoints,
            event_count: events,
            coverage,
            updated_at,
        })
    }

    pub fn current_head(&self) -> &str {
        &self.current_head
    }

    pub fn list_releases(&self, limit: usize) -> Result<HistorySearchResult, String> {
        self.list_releases_page(limit, 0)
    }

    pub fn list_releases_page(
        &self,
        limit: usize,
        offset: usize,
    ) -> Result<HistorySearchResult, String> {
        let fetch_limit = limit.saturating_add(offset).saturating_add(1).min(501);
        let mut result =
            load_history_revisions(self.connection, &self.repo_path, None, true, fetch_limit)?;
        let available = result.revisions.len();
        result.revisions = result
            .revisions
            .into_iter()
            .skip(offset)
            .take(limit)
            .collect();
        result.truncated = available > offset.saturating_add(result.revisions.len());
        Ok(result)
    }

    pub fn search(
        &self,
        text: &str,
        limit: usize,
        offset: usize,
    ) -> Result<HistoryUnifiedSearch, String> {
        let needle = text.trim().to_lowercase();
        if needle.is_empty() {
            return Err("A non-empty history search query is required".to_string());
        }
        let fetch_limit = limit.saturating_add(offset).saturating_add(1).clamp(1, 501);
        let mut items = Vec::new();
        for revision in load_history_revisions(
            self.connection,
            &self.repo_path,
            Some(&needle),
            false,
            fetch_limit,
        )?
        .revisions
        {
            items.push(HistorySearchItem {
                kind: if revision.is_release {
                    HistorySearchKind::Release
                } else {
                    HistorySearchKind::Commit
                },
                id: revision.sha.clone(),
                label: revision
                    .tags
                    .first()
                    .cloned()
                    .unwrap_or_else(|| revision.short_sha.clone()),
                summary: revision.subject,
                revision: Some(revision.sha),
                recorded_at: Some(revision.committed_at),
                trust: GraphTrust::Extracted,
                source_ids: vec!["git".to_string()],
            });
        }
        if let Some(snapshot) = reconstruct_history_as_of(
            self.connection,
            &self.repo_path,
            &self.storage_key,
            &self.current_head,
        )? {
            for hit in
                query::search(&snapshot, &needle, &Default::default(), Some(fetch_limit)).hits
            {
                items.push(HistorySearchItem {
                    kind: HistorySearchKind::Entity,
                    id: hit.node.id,
                    label: hit.node.label,
                    summary: format!("{} · {}", hit.node.kind, hit.matched_by),
                    revision: snapshot.repo_head.clone(),
                    recorded_at: Some(snapshot.created_at.clone()),
                    trust: hit.node.trust,
                    source_ids: hit
                        .node
                        .sources
                        .iter()
                        .map(|source| source.path.clone())
                        .collect(),
                });
            }
        }
        let like = format!("%{needle}%");
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, event_kind, revision_sha, entity_id, trust, source_id, recorded_at
                 FROM history_graph_events
                 WHERE repo_path = ?1 AND (
                    lower(event_kind) LIKE ?2 OR lower(COALESCE(entity_id, '')) LIKE ?2 OR
                    lower(COALESCE(related_entity_id, '')) LIKE ?2 OR lower(source_id) LIKE ?2
                 )
                 ORDER BY recorded_at DESC, id DESC LIMIT ?3",
            )
            .map_err(|error| format!("Prepare evidence search: {error}"))?;
        let rows = statement
            .query_map(params![self.repo_path, like, fetch_limit as i64], |row| {
                Ok(HistorySearchItem {
                    kind: HistorySearchKind::Event,
                    id: row.get(0)?,
                    label: row.get(1)?,
                    summary: row
                        .get::<_, Option<String>>(3)?
                        .unwrap_or_else(|| "Historical evidence".to_string()),
                    revision: row.get(2)?,
                    trust: GraphTrust::from_storage(&row.get::<_, String>(4)?),
                    source_ids: vec![row.get(5)?],
                    recorded_at: Some(row.get(6)?),
                })
            })
            .map_err(|error| format!("Query evidence search: {error}"))?;
        items.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Read evidence search: {error}"))?,
        );
        items.sort_by(|left, right| {
            right
                .recorded_at
                .cmp(&left.recorded_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        items.dedup_by(|left, right| left.kind == right.kind && left.id == right.id);
        let available = items.len().saturating_sub(offset);
        let truncated = available > limit;
        let items = items
            .into_iter()
            .skip(offset)
            .take(limit)
            .collect::<Vec<_>>();
        Ok(HistoryUnifiedSearch {
            schema_version: 1,
            next_offset: truncated.then(|| offset + items.len()),
            items,
            truncated,
        })
    }

    pub fn state(
        &self,
        reference: HistoryTemporalReference,
        max_nodes: usize,
    ) -> Result<HistoryAsOfState, String> {
        let revision = resolve_temporal_reference(&self.root, &reference)?;
        let committed_at = git_text(&self.root, &["show", "-s", "--format=%cI", &revision])?;
        let snapshot = reconstruct_history_as_of(
            self.connection,
            &self.repo_path,
            &self.storage_key,
            &revision,
        )?
        .ok_or_else(|| {
            "Historical state is unavailable in the persisted index; build or refresh it in CodeVetter"
                .to_string()
        })?;
        let path_changes = self.persisted_path_changes(&revision)?;
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
                repo_path: self.repo_path.clone(),
                revision,
                snapshot_id: snapshot.id.clone(),
                cached: true,
                projection: query::overview(&snapshot, Some(max_nodes)),
                analysis: query::analysis_summary(&snapshot),
                changed_paths,
                path_changes,
                indexed_files: snapshot.coverage.indexed_files,
                node_count: snapshot.nodes.len(),
                edge_count: snapshot.edges.len(),
                generated_at: snapshot.created_at,
            },
        })
    }

    pub fn lineage(
        &self,
        entity: &str,
        reference: HistoryTemporalReference,
        limit: usize,
    ) -> Result<HistoryEntityEvolution, String> {
        let revision = resolve_temporal_reference(&self.root, &reference)?;
        let snapshot = reconstruct_history_as_of(
            self.connection,
            &self.repo_path,
            &self.storage_key,
            &revision,
        )?
        .ok_or_else(|| "Historical state is unavailable in the persisted index".to_string())?;
        let node = query::resolve_node(&snapshot, entity)?.clone();
        let (mut lineage, family_ids, lineage_truncated) =
            load_lineage_family(self.connection, &self.repo_path, &node.id, limit)?;
        if lineage.len() > limit {
            lineage.truncate(limit);
        }
        let (mut occurrences, occurrence_truncated) =
            load_entity_occurrences(self.connection, &self.repo_path, &family_ids, limit * 4)?;
        if occurrences.len() > limit * 4 {
            occurrences.truncate(limit * 4);
        }
        let first_seen = occurrences.first().cloned();
        let last_present = occurrences.last().cloned();
        let mut last_changed = None;
        let mut previous_signature = None;
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
            history_index_freshness(self.connection, &self.repo_path, &self.current_head)?;
        let coverage_complete = coverage
            .get("coverage_complete")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let truncated = lineage_truncated || occurrence_truncated;
        Ok(HistoryEntityEvolution {
            schema_version: 1,
            repo_path: self.repo_path.clone(),
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
            coverage_gap: if truncated {
                Some("Entity evolution exceeded the requested bound".to_string())
            } else if !coverage_complete {
                Some("First/last moments are bounded by indexed history coverage".to_string())
            } else {
                None
            },
            truncated,
            next_cursor: None,
        })
    }

    pub fn explain(
        &self,
        entity: &str,
        reference: HistoryTemporalReference,
    ) -> Result<HistoryFacetPacket, String> {
        let revision = resolve_temporal_reference(&self.root, &reference)?;
        let snapshot = reconstruct_history_as_of(
            self.connection,
            &self.repo_path,
            &self.storage_key,
            &revision,
        )?
        .ok_or_else(|| "Historical state is unavailable in the persisted index".to_string())?;
        let node = query::resolve_node(&snapshot, entity)?.clone();
        let node_path = node.path.clone().unwrap_or_default();
        let related_edges = snapshot
            .edges
            .iter()
            .filter(|edge| edge.from == node.id || edge.to == node.id)
            .collect::<Vec<_>>();
        let latest_change = self
            .connection
            .query_row(
                "SELECT r.sha, r.subject, r.committed_at
                 FROM history_graph_revision_paths p
                 JOIN history_graph_revisions r
                   ON r.repo_path = p.repo_path AND r.sha = p.revision_sha
                 WHERE p.repo_path = ?1 AND (p.path = ?2 OR p.old_path = ?2)
                 ORDER BY r.ordinal DESC LIMIT 1",
                params![self.repo_path, node_path],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("Load entity intent evidence: {error}"))?;
        let first_change = self
            .connection
            .query_row(
                "SELECT r.sha, r.committed_at
                 FROM history_graph_revision_paths p
                 JOIN history_graph_revisions r
                   ON r.repo_path = p.repo_path AND r.sha = p.revision_sha
                 WHERE p.repo_path = ?1 AND (p.path = ?2 OR p.old_path = ?2)
                 ORDER BY r.ordinal ASC LIMIT 1",
                params![self.repo_path, node_path],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|error| format!("Load first entity change: {error}"))?;
        let mut facets = Vec::new();
        facets.push(HistoryFacet {
            name: "what".to_string(),
            status: HistoryFacetStatus::Evidenced,
            summary: format!(
                "{} '{}' is present at this historical state",
                node.kind, node.label
            ),
            trust: node.trust,
            sources: node.sources.clone(),
            event_ids: Vec::new(),
        });
        facets.push(match latest_change {
            Some((sha, subject, _)) => HistoryFacet {
                name: "why".to_string(),
                status: HistoryFacetStatus::QualifiedLead,
                summary: format!("Latest path-changing commit says: {subject}"),
                trust: GraphTrust::Inferred,
                sources: node.sources.clone(),
                event_ids: vec![sha],
            },
            None => unknown_facet("why", "No local intent evidence is linked to this entity"),
        });
        facets.push(match (first_change, self.latest_path_change(&node_path)?) {
            (Some((first_sha, first_at)), Some((last_sha, last_at))) => HistoryFacet {
                name: "when".to_string(),
                status: HistoryFacetStatus::Evidenced,
                summary: format!("First observed at {first_at}; last changed at {last_at}"),
                trust: GraphTrust::Extracted,
                sources: node.sources.clone(),
                event_ids: vec![first_sha, last_sha],
            },
            _ => unknown_facet("when", "No bounded path history is indexed for this entity"),
        });
        let mut relation_kinds = related_edges
            .iter()
            .map(|edge| edge.kind.clone())
            .collect::<Vec<_>>();
        relation_kinds.sort();
        relation_kinds.dedup();
        facets.push(if relation_kinds.is_empty() {
            unknown_facet("how", "No structural relationships explain this entity")
        } else {
            HistoryFacet {
                name: "how".to_string(),
                status: HistoryFacetStatus::Evidenced,
                summary: format!("Structural relationships: {}", relation_kinds.join(", ")),
                trust: weakest_trust(related_edges.iter().map(|edge| edge.trust)),
                sources: related_edges
                    .iter()
                    .flat_map(|edge| edge.sources.iter().cloned())
                    .take(20)
                    .collect(),
                event_ids: Vec::new(),
            }
        });
        let verification = related_edges
            .iter()
            .filter(|edge| {
                matches!(
                    edge.kind.as_str(),
                    "tests" | "tested_by" | "verifies" | "covered_by"
                )
            })
            .collect::<Vec<_>>();
        facets.push(if verification.is_empty() {
            unknown_facet(
                "verification",
                "No source-backed verification relationship is linked",
            )
        } else {
            HistoryFacet {
                name: "verification".to_string(),
                status: HistoryFacetStatus::Evidenced,
                summary: format!(
                    "{} verification relationship(s) are linked",
                    verification.len()
                ),
                trust: weakest_trust(verification.iter().map(|edge| edge.trust)),
                sources: verification
                    .iter()
                    .flat_map(|edge| edge.sources.iter().cloned())
                    .take(20)
                    .collect(),
                event_ids: Vec::new(),
            }
        });
        let outcomes = load_outcome_events(self.connection, &self.repo_path, &node.id)?;
        facets.push(if outcomes.is_empty() {
            unknown_facet(
                "outcome",
                if node.kind == "analytics_event" {
                    "Code emission is evidenced, but provider ingestion/delivery is unknown without configured provider evidence"
                } else {
                    "No local runtime, deploy, incident, analytics, or observed outcome is linked"
                },
            )
        } else {
            HistoryFacet {
                name: "outcome".to_string(),
                status: HistoryFacetStatus::Evidenced,
                summary: format!("{} observed outcome event(s) are linked", outcomes.len()),
                trust: weakest_trust(outcomes.iter().map(|(_, _, trust)| *trust)),
                sources: Vec::new(),
                event_ids: outcomes.into_iter().map(|(id, _, _)| id).collect(),
            }
        });
        let gaps = facets
            .iter()
            .filter(|facet| facet.status == HistoryFacetStatus::Unknown)
            .map(|facet| format!("{}: {}", facet.name, facet.summary))
            .collect::<Vec<_>>();
        let contradictions =
            load_entity_annotation_contradictions(self.connection, &self.repo_path, &node.id)?;
        let mut trust_summary = BTreeMap::new();
        for facet in &facets {
            *trust_summary
                .entry(facet.trust.as_str().to_string())
                .or_insert(0usize) += 1;
        }
        let (indexed_head, stale, _) =
            history_index_freshness(self.connection, &self.repo_path, &self.current_head)?;
        Ok(HistoryFacetPacket {
            schema_version: 1,
            repo_path: self.repo_path.clone(),
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
    }

    pub fn trace(
        &self,
        selector: HistoryCausalSelector,
        limit: usize,
        cursor: Option<(String, String)>,
    ) -> Result<HistoryCausalTrace, String> {
        query_causal_trace(
            self.connection,
            &self.root,
            &self.current_head,
            selector,
            limit,
            cursor,
        )
    }

    pub fn compare(
        &self,
        before: HistoryTemporalReference,
        after: HistoryTemporalReference,
    ) -> Result<HistoryComparison, String> {
        let before_revision = resolve_temporal_reference(&self.root, &before)?;
        let after_revision = resolve_temporal_reference(&self.root, &after)?;
        let before_snapshot = reconstruct_history_as_of(
            self.connection,
            &self.repo_path,
            &self.storage_key,
            &before_revision,
        )?
        .ok_or_else(|| {
            "The before state is unavailable in the persisted history index".to_string()
        })?;
        let after_snapshot = reconstruct_history_as_of(
            self.connection,
            &self.repo_path,
            &self.storage_key,
            &after_revision,
        )?
        .ok_or_else(|| {
            "The after state is unavailable in the persisted history index".to_string()
        })?;
        let structural = query::diff_snapshots(&before_snapshot, &after_snapshot);
        let (before_ordinal, after_ordinal) =
            self.ordinal_range(&before_revision, &after_revision)?;
        let mut statement = self
            .connection
            .prepare(
                "SELECT e.event_kind, COUNT(*)
                 FROM history_graph_events e
                 LEFT JOIN history_graph_revisions r
                   ON r.repo_path = e.repo_path AND r.sha = e.revision_sha
                 WHERE e.repo_path = ?1 AND r.ordinal > ?2 AND r.ordinal <= ?3
                 GROUP BY e.event_kind ORDER BY e.event_kind",
            )
            .map_err(|error| format!("Prepare comparison evidence: {error}"))?;
        let event_kind_counts = statement
            .query_map(
                params![self.repo_path, before_ordinal, after_ordinal],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?.max(0) as usize,
                    ))
                },
            )
            .map_err(|error| format!("Query comparison evidence: {error}"))?
            .collect::<Result<BTreeMap<_, _>, _>>()
            .map_err(|error| format!("Read comparison evidence: {error}"))?;
        let mut changed_paths = self.paths_in_range(before_ordinal, after_ordinal)?;
        let truncated = changed_paths.len() > 500;
        changed_paths.truncate(500);
        let (indexed_head, stale, coverage) =
            history_index_freshness(self.connection, &self.repo_path, &self.current_head)?;
        let mut gaps = Vec::new();
        if !coverage
            .get("coverage_complete")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            gaps.push("Comparison is bounded by partial indexed history coverage".to_string());
        }
        gaps.push(
            "Event adjacency is a delta inventory, not proof that one event caused another"
                .to_string(),
        );
        Ok(HistoryComparison {
            schema_version: 1,
            before,
            after,
            before_revision,
            after_revision,
            structural,
            changed_paths,
            event_kind_counts,
            gaps,
            stale,
            indexed_head: Some(indexed_head),
            truncated,
        })
    }

    pub fn evidence(&self, ids: &[String]) -> Result<Vec<HistoryEvidenceDetail>, String> {
        let mut details = Vec::new();
        for id in ids {
            let row = self
                .connection
                .query_row(
                    "SELECT event_kind, revision_sha, entity_id, related_entity_id,
                            relation_kind, trust, origin, source_id, source_cursor,
                            payload_json, evidence_json, recorded_at
                     FROM history_graph_events WHERE repo_path = ?1 AND id = ?2",
                    params![self.repo_path, id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, Option<String>>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, String>(7)?,
                            row.get::<_, Option<String>>(8)?,
                            row.get::<_, String>(9)?,
                            row.get::<_, String>(10)?,
                            row.get::<_, String>(11)?,
                        ))
                    },
                )
                .optional()
                .map_err(|error| format!("Load history evidence: {error}"))?;
            let Some((
                event_kind,
                revision_sha,
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
            )) = row
            else {
                continue;
            };
            let payload: Value = serde_json::from_str(&payload_json).unwrap_or(Value::Null);
            let summary = ["summary", "subject", "decision", "status", "outcome"]
                .iter()
                .find_map(|key| payload.get(key).and_then(Value::as_str))
                .map(|value| value.chars().take(800).collect::<String>());
            let mut sources: Vec<GraphSourceAnchor> =
                serde_json::from_str(&evidence_json).unwrap_or_default();
            sources.truncate(20);
            let available = sources.iter().all(source_is_available);
            details.push(HistoryEvidenceDetail {
                schema_version: 1,
                id: id.clone(),
                event_kind,
                revision_sha,
                entity_id,
                related_entity_id,
                relation_kind,
                trust: GraphTrust::from_storage(&trust),
                origin,
                source_id,
                source_cursor,
                summary,
                sources,
                recorded_at,
                available,
            });
        }
        Ok(details)
    }

    pub fn annotations(
        &self,
        revision_sha: Option<&str>,
        entity_id: Option<&str>,
        limit: usize,
        cursor: Option<(String, String)>,
    ) -> Result<HistoryAnnotationPage, String> {
        let (cursor_time, cursor_id) = cursor
            .map(|(time, id)| (Some(time), Some(id)))
            .unwrap_or_default();
        let mut statement = self
            .connection
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
                    self.repo_path,
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
            .map(|annotation| {
                serde_json::to_string(&(annotation.created_at.as_str(), annotation.id.as_str()))
                    .map_err(|error| format!("Encode annotation cursor: {error}"))
            })
            .transpose()?;
        Ok(HistoryAnnotationPage {
            annotations,
            truncated,
            next_cursor,
        })
    }

    fn persisted_path_changes(
        &self,
        revision: &str,
    ) -> Result<Vec<crate::commands::history_graph::HistoryPathChange>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT path, change_kind, old_path, additions, deletions
                 FROM history_graph_revision_paths
                 WHERE repo_path = ?1 AND revision_sha = ?2 ORDER BY path",
            )
            .map_err(|error| format!("Prepare path changes: {error}"))?;
        let rows = statement
            .query_map(params![self.repo_path, revision], |row| {
                Ok(crate::commands::history_graph::HistoryPathChange {
                    path: row.get(0)?,
                    change_kind: row.get(1)?,
                    old_path: row.get(2)?,
                    additions: row
                        .get::<_, Option<i64>>(3)?
                        .map(|value| value.max(0) as usize),
                    deletions: row
                        .get::<_, Option<i64>>(4)?
                        .map(|value| value.max(0) as usize),
                })
            })
            .map_err(|error| format!("Query path changes: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Read path changes: {error}"))
    }

    fn latest_path_change(&self, path: &str) -> Result<Option<(String, String)>, String> {
        self.connection
            .query_row(
                "SELECT r.sha, r.committed_at
                 FROM history_graph_revision_paths p
                 JOIN history_graph_revisions r
                   ON r.repo_path = p.repo_path AND r.sha = p.revision_sha
                 WHERE p.repo_path = ?1 AND (p.path = ?2 OR p.old_path = ?2)
                 ORDER BY r.ordinal DESC LIMIT 1",
                params![self.repo_path, path],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| format!("Load last path change: {error}"))
    }

    fn ordinal_range(&self, before: &str, after: &str) -> Result<(i64, i64), String> {
        let before_ordinal = self.ordinal(before)?;
        let after_ordinal = self.ordinal(after)?;
        if before_ordinal > after_ordinal {
            return Err("The before selector must precede the after selector".to_string());
        }
        Ok((before_ordinal, after_ordinal))
    }

    fn ordinal(&self, revision: &str) -> Result<i64, String> {
        self.connection
            .query_row(
                "SELECT ordinal FROM history_graph_revisions WHERE repo_path = ?1 AND sha = ?2",
                params![self.repo_path, revision],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Load history ordinal: {error}"))?
            .ok_or_else(|| "Selected revision is outside indexed history coverage".to_string())
    }

    fn paths_in_range(&self, before: i64, after: i64) -> Result<Vec<String>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT DISTINCT p.path
                 FROM history_graph_revision_paths p
                 JOIN history_graph_revisions r
                   ON r.repo_path = p.repo_path AND r.sha = p.revision_sha
                 WHERE p.repo_path = ?1 AND r.ordinal > ?2 AND r.ordinal <= ?3
                 ORDER BY p.path LIMIT 501",
            )
            .map_err(|error| format!("Prepare comparison paths: {error}"))?;
        let rows = statement
            .query_map(params![self.repo_path, before, after], |row| row.get(0))
            .map_err(|error| format!("Query comparison paths: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Read comparison paths: {error}"))
    }
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

fn weakest_trust(values: impl Iterator<Item = GraphTrust>) -> GraphTrust {
    values
        .max_by_key(|trust| match trust {
            GraphTrust::Extracted => 0,
            GraphTrust::Inferred => 1,
            GraphTrust::Ambiguous => 2,
            GraphTrust::Legacy => 3,
        })
        .unwrap_or(GraphTrust::Inferred)
}

fn source_is_available(source: &GraphSourceAnchor) -> bool {
    if source.path.is_empty() {
        true
    } else {
        PathBuf::from(&source.path).exists()
    }
}

fn git_text(root: &std::path::Path, args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|error| format!("Run git: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn evidence_hydration_returns_only_selected_bounded_fields() {
        let root = std::env::temp_dir().join(format!("cv-history-read-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("fixture");
        run_git(&root, &["init"]);
        run_git(&root, &["config", "user.email", "fixture@local"]);
        run_git(&root, &["config", "user.name", "Fixture"]);
        fs::write(root.join("main.rs"), "fn main() {}\n").expect("file");
        run_git(&root, &["add", "."]);
        run_git(&root, &["commit", "-m", "initial"]);
        let connection = Connection::open_in_memory().expect("database");
        crate::db::schema::run_migrations(&connection).expect("schema");
        let canonical = root
            .canonicalize()
            .expect("canonical")
            .to_string_lossy()
            .to_string();
        connection
            .execute(
                "INSERT INTO history_graph_repositories (
                    repo_path, repository_fingerprint, indexed_head, status,
                    created_at, updated_at
                 ) VALUES (?1, 'fixture', 'head', 'ready', '2026-01-01T00:00:00Z',
                    '2026-01-01T00:00:00Z')",
                [&canonical],
            )
            .expect("repo");
        connection
            .execute(
                "INSERT INTO history_graph_events (
                    id, repo_path, event_kind, trust, origin, source_id,
                    payload_json, evidence_json, recorded_at
                 ) VALUES ('event', ?1, 'verification', 'extracted', 'metadata', 'test',
                    '{\"summary\":\"passed\",\"secret\":\"must-not-return\"}', '[]',
                    '2026-01-01T00:00:00Z')",
                [&canonical],
            )
            .expect("event");
        let service = HistoryReadService::new(&connection, &canonical).expect("service");
        let details = service.evidence(&["event".to_string()]).expect("evidence");
        let encoded = serde_json::to_string(&details).expect("json");
        assert!(encoded.contains("passed"));
        assert!(!encoded.contains("must-not-return"));
        let _ = fs::remove_dir_all(root);
    }

    fn run_git(root: &std::path::Path, args: &[&str]) {
        let status = std::process::Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .status()
            .expect("git");
        assert!(status.success());
    }
}
