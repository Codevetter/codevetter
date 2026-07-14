use super::language::{supported_language_names, SupportedLanguage};
use super::types::{
    stable_graph_id, GraphOrigin, GraphSourceAnchor, GraphTrust, LanguageCoverage,
    StructuralGraphBuildInput, StructuralGraphCancellation, StructuralGraphCoverage,
    StructuralGraphDiagnostic, StructuralGraphEdge, StructuralGraphEngine,
    StructuralGraphEngineInfo, StructuralGraphError, StructuralGraphFileRecord,
    StructuralGraphNode, StructuralGraphProgress, StructuralGraphProgressSink,
    StructuralGraphSnapshot, BUNDLED_ENGINE_ID, BUNDLED_ENGINE_VERSION,
    STRUCTURAL_GRAPH_SCHEMA_VERSION,
};
use super::{analysis::analyze_graph, resolve::resolve_cross_file};
use chrono::Utc;
use rayon::prelude::*;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use tree_sitter::{Node, Parser};

const IGNORE_POLICY_VERSION: &str = "structural-ignore-v1";

#[derive(Debug, Default)]
pub struct BundledTreeSitterEngine;

#[derive(Debug)]
struct FileContribution {
    path: String,
    language: Option<String>,
    content_hash: Option<String>,
    byte_size: u64,
    nodes: Vec<StructuralGraphNode>,
    edges: Vec<StructuralGraphEdge>,
    diagnostics: Vec<StructuralGraphDiagnostic>,
    disposition: FileDisposition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FileDisposition {
    Indexed,
    Unsupported,
    Generated,
    Sensitive,
    Binary,
    TooLarge,
    Error,
}

impl FileDisposition {
    fn as_str(self) -> &'static str {
        match self {
            Self::Indexed => "indexed",
            Self::Unsupported => "unsupported",
            Self::Generated => "generated",
            Self::Sensitive => "sensitive",
            Self::Binary => "binary",
            Self::TooLarge => "too_large",
            Self::Error => "error",
        }
    }
}

impl StructuralGraphEngine for BundledTreeSitterEngine {
    fn info(&self) -> StructuralGraphEngineInfo {
        StructuralGraphEngineInfo {
            id: BUNDLED_ENGINE_ID.to_string(),
            version: BUNDLED_ENGINE_VERSION.to_string(),
            bundled: true,
            syntax_aware: true,
            supported_languages: supported_language_names(),
        }
    }

    fn build(
        &self,
        input: &StructuralGraphBuildInput,
        cancellation: &StructuralGraphCancellation,
        progress: &dyn StructuralGraphProgressSink,
    ) -> Result<StructuralGraphSnapshot, StructuralGraphError> {
        let root = input.repo_root.canonicalize().map_err(|error| {
            StructuralGraphError::InvalidRepository(format!(
                "Cannot resolve repository {}: {error}",
                input.repo_root.display()
            ))
        })?;
        if !root.is_dir() {
            return Err(StructuralGraphError::InvalidRepository(format!(
                "Repository path is not a directory: {}",
                root.display()
            )));
        }
        if let Some(previous) = input.previous_snapshot.as_deref() {
            if input.previous_cursor != previous.cursor {
                return Err(StructuralGraphError::Parse(
                    "Incremental graph cursor does not match the previous snapshot; rebuild the index"
                        .to_string(),
                ));
            }
        }

        progress.report(StructuralGraphProgress {
            phase: "discover".to_string(),
            completed: 0,
            total: 0,
            detail: "Discovering repository files from Git".to_string(),
        });
        let incremental = input.previous_snapshot.is_some();
        let mut paths = if incremental {
            input
                .changed_files
                .iter()
                .map(PathBuf::from)
                .collect::<Vec<_>>()
        } else {
            discover_paths(&root)?
        };
        paths.sort();
        paths.dedup();
        let truncated = paths.len() > input.max_files;
        paths.truncate(input.max_files);

        if cancellation.is_cancelled() {
            return Err(StructuralGraphError::Cancelled);
        }

        let completed = AtomicUsize::new(0);
        let total = paths.len();
        let contributions = paths
            .par_iter()
            .map(|path| {
                if cancellation.is_cancelled() {
                    return Err(StructuralGraphError::Cancelled);
                }
                let contribution = extract_path(&root, path, input.max_bytes_per_file);
                let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                if done == total || done.is_multiple_of(100) {
                    progress.report(StructuralGraphProgress {
                        phase: "extract".to_string(),
                        completed: done,
                        total,
                        detail: path.to_string_lossy().replace('\\', "/"),
                    });
                }
                Ok(contribution)
            })
            .collect::<Result<Vec<_>, StructuralGraphError>>()?;

        if cancellation.is_cancelled() {
            return Err(StructuralGraphError::Cancelled);
        }

        progress.report(StructuralGraphProgress {
            phase: "assemble".to_string(),
            completed: total,
            total,
            detail: "Assembling deterministic structural graph".to_string(),
        });

        let affected_paths = input
            .changed_files
            .iter()
            .chain(input.deleted_files.iter())
            .map(|path| path.replace('\\', "/"))
            .collect::<HashSet<_>>();
        let (mut files, mut nodes, mut edges, mut diagnostics, inherited_truncation) =
            if let Some(previous) = input.previous_snapshot.as_deref() {
                let mut nodes = previous
                    .nodes
                    .iter()
                    .filter(|node| !node_belongs_to_paths(node, &affected_paths))
                    .cloned()
                    .collect::<Vec<_>>();
                let retained_node_ids = nodes
                    .iter()
                    .map(|node| node.id.as_str())
                    .collect::<HashSet<_>>();
                let mut edges = previous
                    .edges
                    .iter()
                    .filter(|edge| {
                        !matches!(edge.origin, GraphOrigin::Resolution | GraphOrigin::Analysis)
                            && retained_node_ids.contains(edge.from.as_str())
                            && retained_node_ids.contains(edge.to.as_str())
                            && !sources_touch_paths(&edge.sources, &affected_paths)
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                let mut diagnostics = previous
                    .diagnostics
                    .iter()
                    .filter(|diagnostic| {
                        diagnostic
                            .path
                            .as_ref()
                            .is_none_or(|path| !affected_paths.contains(path))
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                let mut files = previous
                    .files
                    .iter()
                    .filter(|file| !affected_paths.contains(&file.path))
                    .cloned()
                    .collect::<Vec<_>>();
                nodes.extend(
                    contributions
                        .iter()
                        .flat_map(|contribution| contribution.nodes.iter().cloned()),
                );
                edges.extend(
                    contributions
                        .iter()
                        .flat_map(|contribution| contribution.edges.iter().cloned()),
                );
                diagnostics.extend(
                    contributions
                        .iter()
                        .flat_map(|contribution| contribution.diagnostics.iter().cloned()),
                );
                files.extend(contributions.iter().map(file_record_from_contribution));
                (files, nodes, edges, diagnostics, previous.truncated)
            } else {
                (
                    contributions
                        .iter()
                        .map(file_record_from_contribution)
                        .collect(),
                    contributions
                        .iter()
                        .flat_map(|contribution| contribution.nodes.iter().cloned())
                        .collect(),
                    contributions
                        .iter()
                        .flat_map(|contribution| contribution.edges.iter().cloned())
                        .collect(),
                    contributions
                        .iter()
                        .flat_map(|contribution| contribution.diagnostics.iter().cloned())
                        .collect(),
                    false,
                )
            };
        files.sort_by(|left, right| left.path.cmp(&right.path));
        files.dedup_by(|left, right| left.path == right.path);
        let coverage = coverage_from_file_records(&files);
        deduplicate_nodes(&mut nodes);
        deduplicate_edges(&mut edges);
        resolve_cross_file(&nodes, &mut edges);
        deduplicate_edges(&mut edges);
        let communities = analyze_graph(&mut nodes, &edges);
        diagnostics.sort_by(|left, right| {
            left.path
                .cmp(&right.path)
                .then_with(|| left.code.cmp(&right.code))
                .then_with(|| left.message.cmp(&right.message))
        });

        let cursor_identity = files
            .iter()
            .map(|file| {
                file.content_hash
                    .as_ref()
                    .map(|hash| format!("{}\0{hash}", file.path))
                    .unwrap_or_else(|| format!("{}\0{}", file.path, file.disposition))
            })
            .collect::<Vec<_>>()
            .join("\0");
        let cursor = stable_graph_id("cursor", &cursor_identity);
        let repo_path = root.to_string_lossy().to_string();
        let snapshot_id = stable_graph_id(
            "snapshot",
            &format!(
                "{}\0{}\0{}\0{}",
                repo_path,
                input.repo_head.as_deref().unwrap_or("working-tree"),
                BUNDLED_ENGINE_VERSION,
                cursor
            ),
        );

        Ok(StructuralGraphSnapshot {
            schema_version: STRUCTURAL_GRAPH_SCHEMA_VERSION,
            id: snapshot_id,
            repo_path,
            repo_head: input.repo_head.clone(),
            created_at: Utc::now().to_rfc3339(),
            engine: self.info(),
            cursor: Some(cursor),
            ignore_fingerprint: Some(stable_graph_id("ignore", IGNORE_POLICY_VERSION)),
            coverage,
            diagnostics,
            communities,
            files,
            nodes,
            edges,
            truncated: truncated || inherited_truncation,
        })
    }
}

#[derive(Debug, Clone)]
pub struct HistoricalFileBlob {
    pub path: String,
    pub bytes: Vec<u8>,
}

pub fn build_snapshot_from_blobs(
    storage_repo_path: &str,
    revision: &str,
    mut blobs: Vec<HistoricalFileBlob>,
    cancellation: &StructuralGraphCancellation,
    progress: &dyn StructuralGraphProgressSink,
) -> Result<StructuralGraphSnapshot, StructuralGraphError> {
    blobs.sort_by(|left, right| left.path.cmp(&right.path));
    blobs.dedup_by(|left, right| left.path == right.path);
    let truncated = blobs.len() > 25_000;
    blobs.truncate(25_000);
    let total = blobs.len();
    let completed = AtomicUsize::new(0);
    let contributions = blobs
        .par_iter()
        .map(|blob| {
            if cancellation.is_cancelled() {
                return Err(StructuralGraphError::Cancelled);
            }
            let contribution = extract_blob(&blob.path, &blob.bytes, 2 * 1024 * 1024);
            let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
            if done == total || done.is_multiple_of(100) {
                progress.report(StructuralGraphProgress {
                    phase: "historical_extract".to_string(),
                    completed: done,
                    total,
                    detail: blob.path.clone(),
                });
            }
            Ok(contribution)
        })
        .collect::<Result<Vec<_>, StructuralGraphError>>()?;
    if cancellation.is_cancelled() {
        return Err(StructuralGraphError::Cancelled);
    }
    let files = contributions
        .iter()
        .map(file_record_from_contribution)
        .collect::<Vec<_>>();
    let nodes = contributions
        .iter()
        .flat_map(|contribution| contribution.nodes.iter().cloned())
        .collect::<Vec<_>>();
    let edges = contributions
        .iter()
        .flat_map(|contribution| contribution.edges.iter().cloned())
        .collect::<Vec<_>>();
    let diagnostics = contributions
        .iter()
        .flat_map(|contribution| contribution.diagnostics.iter().cloned())
        .collect::<Vec<_>>();
    finalize_historical_snapshot(
        storage_repo_path,
        revision,
        files,
        nodes,
        edges,
        diagnostics,
        truncated,
    )
}

pub fn build_snapshot_from_blob_delta(
    storage_repo_path: &str,
    revision: &str,
    previous: &StructuralGraphSnapshot,
    mut changed_blobs: Vec<HistoricalFileBlob>,
    deleted_paths: &[String],
    cancellation: &StructuralGraphCancellation,
    progress: &dyn StructuralGraphProgressSink,
) -> Result<StructuralGraphSnapshot, StructuralGraphError> {
    changed_blobs.sort_by(|left, right| left.path.cmp(&right.path));
    changed_blobs.dedup_by(|left, right| left.path == right.path);
    let total = changed_blobs.len();
    let completed = AtomicUsize::new(0);
    let contributions = changed_blobs
        .par_iter()
        .map(|blob| {
            if cancellation.is_cancelled() {
                return Err(StructuralGraphError::Cancelled);
            }
            let contribution = extract_blob(&blob.path, &blob.bytes, 2 * 1024 * 1024);
            let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
            if done == total || done.is_multiple_of(100) {
                progress.report(StructuralGraphProgress {
                    phase: "historical_delta_extract".to_string(),
                    completed: done,
                    total,
                    detail: blob.path.clone(),
                });
            }
            Ok(contribution)
        })
        .collect::<Result<Vec<_>, StructuralGraphError>>()?;
    if cancellation.is_cancelled() {
        return Err(StructuralGraphError::Cancelled);
    }
    let affected_paths = changed_blobs
        .iter()
        .map(|blob| blob.path.replace('\\', "/"))
        .chain(deleted_paths.iter().map(|path| path.replace('\\', "/")))
        .collect::<HashSet<_>>();
    let mut nodes = previous
        .nodes
        .iter()
        .filter(|node| !node_belongs_to_paths(node, &affected_paths))
        .cloned()
        .collect::<Vec<_>>();
    let retained_node_ids = nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    let mut edges = previous
        .edges
        .iter()
        .filter(|edge| {
            !matches!(edge.origin, GraphOrigin::Resolution | GraphOrigin::Analysis)
                && retained_node_ids.contains(edge.from.as_str())
                && retained_node_ids.contains(edge.to.as_str())
                && !sources_touch_paths(&edge.sources, &affected_paths)
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut diagnostics = previous
        .diagnostics
        .iter()
        .filter(|diagnostic| {
            diagnostic
                .path
                .as_ref()
                .is_none_or(|path| !affected_paths.contains(path))
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut files = previous
        .files
        .iter()
        .filter(|file| !affected_paths.contains(&file.path))
        .cloned()
        .collect::<Vec<_>>();
    nodes.extend(
        contributions
            .iter()
            .flat_map(|contribution| contribution.nodes.iter().cloned()),
    );
    edges.extend(
        contributions
            .iter()
            .flat_map(|contribution| contribution.edges.iter().cloned()),
    );
    diagnostics.extend(
        contributions
            .iter()
            .flat_map(|contribution| contribution.diagnostics.iter().cloned()),
    );
    files.extend(contributions.iter().map(file_record_from_contribution));
    finalize_historical_snapshot(
        storage_repo_path,
        revision,
        files,
        nodes,
        edges,
        diagnostics,
        previous.truncated,
    )
}

fn finalize_historical_snapshot(
    storage_repo_path: &str,
    revision: &str,
    mut files: Vec<StructuralGraphFileRecord>,
    mut nodes: Vec<StructuralGraphNode>,
    mut edges: Vec<StructuralGraphEdge>,
    mut diagnostics: Vec<StructuralGraphDiagnostic>,
    truncated: bool,
) -> Result<StructuralGraphSnapshot, StructuralGraphError> {
    files.sort_by(|left, right| left.path.cmp(&right.path));
    files.dedup_by(|left, right| left.path == right.path);
    let coverage = coverage_from_file_records(&files);
    deduplicate_nodes(&mut nodes);
    deduplicate_edges(&mut edges);
    resolve_cross_file(&nodes, &mut edges);
    deduplicate_edges(&mut edges);
    let communities = analyze_graph(&mut nodes, &edges);
    diagnostics.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then_with(|| left.code.cmp(&right.code))
            .then_with(|| left.message.cmp(&right.message))
    });
    let cursor_identity = files
        .iter()
        .map(|file| {
            file.content_hash
                .as_ref()
                .map(|hash| format!("{}\0{hash}", file.path))
                .unwrap_or_else(|| format!("{}\0{}", file.path, file.disposition))
        })
        .collect::<Vec<_>>()
        .join("\0");
    let cursor = stable_graph_id("cursor", &cursor_identity);
    let snapshot_id = stable_graph_id(
        "historical-snapshot",
        &format!(
            "{storage_repo_path}\0{revision}\0{}\0{cursor}",
            BUNDLED_ENGINE_VERSION
        ),
    );
    Ok(StructuralGraphSnapshot {
        schema_version: STRUCTURAL_GRAPH_SCHEMA_VERSION,
        id: snapshot_id,
        repo_path: storage_repo_path.to_string(),
        repo_head: Some(revision.to_string()),
        created_at: Utc::now().to_rfc3339(),
        engine: BundledTreeSitterEngine.info(),
        cursor: Some(cursor),
        ignore_fingerprint: Some(stable_graph_id("ignore", IGNORE_POLICY_VERSION)),
        coverage,
        diagnostics,
        communities,
        files,
        nodes,
        edges,
        truncated,
    })
}

fn extract_blob(path: &str, bytes: &[u8], max_bytes: usize) -> FileContribution {
    let normalized_path = path.replace('\\', "/");
    let relative_path = Path::new(&normalized_path);
    let language = SupportedLanguage::from_path(relative_path);
    if is_sensitive_path(&normalized_path) {
        return skipped_contribution(
            stable_graph_id("sensitive_path", &normalized_path),
            language,
            FileDisposition::Sensitive,
        );
    }
    if is_binary_path(&normalized_path) {
        return skipped_contribution(normalized_path, language, FileDisposition::Binary);
    }
    if is_generated_path(&normalized_path) {
        return metadata_file_contribution(normalized_path, language, FileDisposition::Generated);
    }
    if bytes.len() > max_bytes {
        return metadata_file_contribution(normalized_path, language, FileDisposition::TooLarge);
    }
    let Ok(source) = std::str::from_utf8(bytes) else {
        return skipped_contribution(normalized_path, language, FileDisposition::Binary);
    };
    if let Some(language) = language {
        return extract_source(&normalized_path, language, source);
    }
    if !is_metadata_text_path(relative_path) {
        return metadata_file_contribution(normalized_path, None, FileDisposition::Unsupported);
    }
    let file_id = stable_graph_id("file", &normalized_path);
    let mut nodes = vec![StructuralGraphNode {
        id: file_id.clone(),
        kind: "file".to_string(),
        label: normalized_path.clone(),
        qualified_name: Some(normalized_path.clone()),
        path: Some(normalized_path.clone()),
        detail: Some("historical metadata-indexed text file".to_string()),
        language: None,
        community_id: None,
        trust: GraphTrust::Extracted,
        origin: GraphOrigin::Metadata,
        sources: vec![GraphSourceAnchor::path(&normalized_path)],
    }];
    let mut edges = Vec::new();
    extract_metadata_signals(
        &normalized_path,
        source,
        &file_id,
        None,
        &mut nodes,
        &mut edges,
    );
    attach_metadata_to_syntax_owners(&nodes, &mut edges);
    FileContribution {
        path: normalized_path,
        language: None,
        content_hash: Some(stable_graph_id("content", source)),
        byte_size: bytes.len() as u64,
        nodes,
        edges,
        diagnostics: Vec::new(),
        disposition: FileDisposition::Indexed,
    }
}

fn discover_paths(root: &Path) -> Result<Vec<PathBuf>, StructuralGraphError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["ls-files", "-co", "--exclude-standard", "-z"])
        .output()
        .map_err(|error| {
            StructuralGraphError::Io(format!("Failed to discover Git files: {error}"))
        })?;
    if !output.status.success() {
        return Err(StructuralGraphError::InvalidRepository(format!(
            "Git file discovery failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|bytes| !bytes.is_empty())
        .map(|bytes| PathBuf::from(String::from_utf8_lossy(bytes).into_owned()))
        .collect())
}

fn extract_path(root: &Path, relative_path: &Path, max_bytes: u64) -> FileContribution {
    let normalized_path = relative_path.to_string_lossy().replace('\\', "/");
    let language = SupportedLanguage::from_path(relative_path);
    if is_sensitive_path(&normalized_path) {
        return skipped_contribution(
            stable_graph_id("sensitive_path", &normalized_path),
            language,
            FileDisposition::Sensitive,
        );
    }
    if is_binary_path(&normalized_path) {
        return skipped_contribution(normalized_path, language, FileDisposition::Binary);
    }
    if is_generated_path(&normalized_path) {
        return metadata_file_contribution(normalized_path, language, FileDisposition::Generated);
    }
    let Some(language) = language else {
        return extract_metadata_path(root, relative_path, &normalized_path, max_bytes);
    };

    let absolute_path = root.join(relative_path);
    let metadata = match std::fs::metadata(&absolute_path) {
        Ok(metadata) => metadata,
        Err(error) => {
            return FileContribution {
                path: normalized_path.clone(),
                language: Some(language.name().to_string()),
                content_hash: None,
                byte_size: 0,
                nodes: Vec::new(),
                edges: Vec::new(),
                diagnostics: vec![StructuralGraphDiagnostic {
                    severity: "warning".to_string(),
                    code: "file_metadata_failed".to_string(),
                    message: error.to_string(),
                    path: Some(normalized_path),
                    language: Some(language.name().to_string()),
                }],
                disposition: FileDisposition::Error,
            };
        }
    };
    if metadata.len() > max_bytes {
        return metadata_file_contribution(
            normalized_path,
            Some(language),
            FileDisposition::TooLarge,
        );
    }
    let bytes = match std::fs::read(&absolute_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            return FileContribution {
                path: normalized_path.clone(),
                language: Some(language.name().to_string()),
                content_hash: None,
                byte_size: metadata.len(),
                nodes: Vec::new(),
                edges: Vec::new(),
                diagnostics: vec![StructuralGraphDiagnostic {
                    severity: "warning".to_string(),
                    code: "file_read_failed".to_string(),
                    message: error.to_string(),
                    path: Some(normalized_path),
                    language: Some(language.name().to_string()),
                }],
                disposition: FileDisposition::Error,
            };
        }
    };
    let source = match String::from_utf8(bytes) {
        Ok(source) => source,
        Err(_) => {
            return skipped_contribution(normalized_path, Some(language), FileDisposition::Binary);
        }
    };
    extract_source(&normalized_path, language, &source)
}

fn extract_metadata_path(
    root: &Path,
    relative_path: &Path,
    normalized_path: &str,
    max_bytes: u64,
) -> FileContribution {
    if !is_metadata_text_path(relative_path) {
        return metadata_file_contribution(
            normalized_path.to_string(),
            None,
            FileDisposition::Unsupported,
        );
    }
    let absolute_path = root.join(relative_path);
    let metadata = match std::fs::metadata(&absolute_path) {
        Ok(metadata) if metadata.len() <= max_bytes => metadata,
        Ok(_) => {
            return metadata_file_contribution(
                normalized_path.to_string(),
                None,
                FileDisposition::TooLarge,
            )
        }
        Err(error) => {
            return metadata_read_error(normalized_path, "file_metadata_failed", error.to_string())
        }
    };
    let bytes = match std::fs::read(&absolute_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            return metadata_read_error(normalized_path, "file_read_failed", error.to_string())
        }
    };
    let source = match String::from_utf8(bytes) {
        Ok(source) => source,
        Err(_) => {
            return skipped_contribution(normalized_path.to_string(), None, FileDisposition::Binary)
        }
    };
    let file_id = stable_graph_id("file", normalized_path);
    let mut nodes = vec![StructuralGraphNode {
        id: file_id.clone(),
        kind: "file".to_string(),
        label: normalized_path.to_string(),
        qualified_name: Some(normalized_path.to_string()),
        path: Some(normalized_path.to_string()),
        detail: Some("metadata-indexed text file".to_string()),
        language: None,
        community_id: None,
        trust: GraphTrust::Extracted,
        origin: GraphOrigin::Metadata,
        sources: vec![GraphSourceAnchor::path(normalized_path)],
    }];
    let mut edges = Vec::new();
    extract_metadata_signals(
        normalized_path,
        &source,
        &file_id,
        None,
        &mut nodes,
        &mut edges,
    );
    attach_metadata_to_syntax_owners(&nodes, &mut edges);
    FileContribution {
        path: normalized_path.to_string(),
        language: None,
        content_hash: Some(stable_graph_id("content", &source)),
        byte_size: metadata.len(),
        nodes,
        edges,
        diagnostics: Vec::new(),
        disposition: FileDisposition::Indexed,
    }
}

fn metadata_read_error(path: &str, code: &str, message: String) -> FileContribution {
    FileContribution {
        path: path.to_string(),
        language: None,
        content_hash: None,
        byte_size: 0,
        nodes: Vec::new(),
        edges: Vec::new(),
        diagnostics: vec![StructuralGraphDiagnostic {
            severity: "warning".to_string(),
            code: code.to_string(),
            message,
            path: Some(path.to_string()),
            language: None,
        }],
        disposition: FileDisposition::Error,
    }
}

fn is_metadata_text_path(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        extension.as_str(),
        "md" | "mdx" | "sql" | "json" | "jsonc" | "toml" | "yaml" | "yml" | "ini" | "sh"
    ) || matches!(
        name.as_str(),
        "dockerfile" | "makefile" | "justfile" | "procfile"
    )
}

fn extract_metadata_signals(
    path: &str,
    source: &str,
    file_id: &str,
    language: Option<&str>,
    nodes: &mut Vec<StructuralGraphNode>,
    edges: &mut Vec<StructuralGraphEdge>,
) {
    let lower_path = path.to_ascii_lowercase();
    let file_name = lower_path.rsplit('/').next().unwrap_or(&lower_path);
    if is_config_name(file_name) {
        push_metadata_signal(
            path,
            source,
            file_id,
            language,
            1,
            "configuration",
            file_name,
            "configures",
            "repository configuration file",
            nodes,
            edges,
        );
    }

    let lines = source.lines().collect::<Vec<_>>();
    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        let lower = trimmed.to_ascii_lowercase();
        let line_number = index + 1;

        if lower.contains("create table") {
            if let Some(label) = sql_object_name(trimmed, "table") {
                push_metadata_signal(
                    path,
                    source,
                    file_id,
                    language,
                    line_number,
                    "db_table",
                    &label,
                    "declares",
                    "SQL table declaration",
                    nodes,
                    edges,
                );
            }
        }
        if lower.contains("create index") {
            if let Some(label) = sql_object_name(trimmed, "index") {
                push_metadata_signal(
                    path,
                    source,
                    file_id,
                    language,
                    line_number,
                    "db_index",
                    &label,
                    "declares",
                    "SQL index declaration",
                    nodes,
                    edges,
                );
            }
        }

        if lower.contains("#[tauri::command]") {
            if let Some(label) = lines
                .iter()
                .skip(index + 1)
                .take(4)
                .find_map(|next| rust_function_name(next))
            {
                push_metadata_signal(
                    path,
                    source,
                    file_id,
                    language,
                    line_number,
                    "tauri_command",
                    &label,
                    "exposes",
                    "Tauri command boundary",
                    nodes,
                    edges,
                );
            }
        }

        for marker in ["<route", "route(", ".route(", "router."] {
            if lower.contains(marker) {
                if let Some(label) = first_quoted(trimmed) {
                    if label.starts_with('/') {
                        push_metadata_signal(
                            path,
                            source,
                            file_id,
                            language,
                            line_number,
                            "route",
                            &label,
                            "routes_to",
                            "application route",
                            nodes,
                            edges,
                        );
                    }
                }
                break;
            }
        }

        if is_analytics_line(&lower) {
            if let Some(label) = first_quoted(trimmed) {
                push_metadata_signal(
                    path,
                    source,
                    file_id,
                    language,
                    line_number,
                    "analytics_event",
                    &label,
                    "emits",
                    "analytics event emission",
                    nodes,
                    edges,
                );
            }
        }

        if is_test_line(&lower, &lower_path) {
            let label = (lower == "#[test]")
                .then(|| {
                    lines
                        .iter()
                        .skip(index + 1)
                        .take(4)
                        .find_map(|next| rust_function_name(next))
                })
                .flatten()
                .or_else(|| first_quoted(trimmed))
                .or_else(|| rust_function_name(trimmed))
                .unwrap_or_else(|| format!("test at line {line_number}"));
            push_metadata_signal(
                path,
                source,
                file_id,
                language,
                line_number,
                "test",
                &label,
                "contains_test",
                "test declaration",
                nodes,
                edges,
            );
        }

        if lower_path.ends_with(".md") || lower_path.ends_with(".mdx") {
            for target in markdown_link_targets(trimmed) {
                push_metadata_signal(
                    path,
                    source,
                    file_id,
                    language,
                    line_number,
                    "documentation_link",
                    &target,
                    "documents",
                    "documentation link",
                    nodes,
                    edges,
                );
            }
            if let Some(label) = rationale_marker(trimmed) {
                push_metadata_signal(
                    path,
                    source,
                    file_id,
                    language,
                    line_number,
                    "decision",
                    &label,
                    "records_decision",
                    "repo rationale marker",
                    nodes,
                    edges,
                );
            }
        }
    }
}

fn attach_metadata_to_syntax_owners(
    nodes: &[StructuralGraphNode],
    edges: &mut Vec<StructuralGraphEdge>,
) {
    let syntax_nodes = nodes
        .iter()
        .filter(|node| node.origin == GraphOrigin::Syntax && node.kind != "file")
        .collect::<Vec<_>>();
    let metadata_nodes = nodes
        .iter()
        .filter(|node| node.origin == GraphOrigin::Metadata && node.kind != "configuration")
        .collect::<Vec<_>>();
    for metadata in metadata_nodes {
        if metadata.kind == "tauri_command" {
            if let Some(implementation) = syntax_nodes.iter().find(|candidate| {
                candidate.label == metadata.label && candidate.path == metadata.path
            }) {
                edges.push(make_edge(
                    &metadata.id,
                    &implementation.id,
                    "implemented_by",
                    GraphTrust::Extracted,
                    GraphOrigin::Metadata,
                    "command annotation and declaration share an exact source-backed name"
                        .to_string(),
                    metadata.sources.clone(),
                    Vec::new(),
                ));
            }
        }
        let Some(source) = metadata.sources.first() else {
            continue;
        };
        let Some(line) = source.start_line else {
            continue;
        };
        let owner = syntax_nodes
            .iter()
            .filter(|candidate| candidate.path == metadata.path)
            .filter_map(|candidate| {
                let anchor = candidate.sources.first()?;
                let start = anchor.start_line?;
                let end = anchor.end_line.unwrap_or(start);
                (start <= line && line <= end).then_some((*candidate, end - start))
            })
            .min_by_key(|(_, span)| *span)
            .map(|(candidate, _)| candidate);
        if let Some(owner) = owner {
            let kind = match metadata.kind.as_str() {
                "analytics_event" => "emits",
                "db_table" | "db_index" => "persists_to",
                "route" => "routes_to",
                "test" => "tests",
                _ => "contains",
            };
            edges.push(make_edge(
                &owner.id,
                &metadata.id,
                kind,
                GraphTrust::Extracted,
                GraphOrigin::Metadata,
                "metadata signal is lexically contained by this declaration".to_string(),
                metadata.sources.clone(),
                Vec::new(),
            ));
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn push_metadata_signal(
    path: &str,
    source: &str,
    file_id: &str,
    language: Option<&str>,
    line_number: usize,
    kind: &str,
    label: &str,
    edge_kind: &str,
    evidence: &str,
    nodes: &mut Vec<StructuralGraphNode>,
    edges: &mut Vec<StructuralGraphEdge>,
) {
    let label = label.trim().trim_matches(['`', '"', '\'', ';']);
    if label.is_empty() || label.len() > 240 {
        return;
    }
    let id = stable_graph_id(kind, &format!("{path}\0{label}"));
    if nodes.iter().any(|node| node.id == id) {
        return;
    }
    let excerpt = source
        .lines()
        .nth(line_number.saturating_sub(1))
        .map(|line| {
            let line = line.trim();
            line.chars().take(240).collect::<String>()
        });
    let anchor = GraphSourceAnchor {
        path: path.to_string(),
        start_line: Some(line_number as u32),
        start_column: Some(1),
        end_line: Some(line_number as u32),
        end_column: None,
        excerpt,
    };
    nodes.push(StructuralGraphNode {
        id: id.clone(),
        kind: kind.to_string(),
        label: label.to_string(),
        qualified_name: Some(format!("{path}::{label}")),
        path: Some(path.to_string()),
        detail: Some(evidence.to_string()),
        language: language.map(str::to_string),
        community_id: None,
        trust: GraphTrust::Extracted,
        origin: GraphOrigin::Metadata,
        sources: vec![anchor.clone()],
    });
    edges.push(make_edge(
        file_id,
        &id,
        edge_kind,
        GraphTrust::Extracted,
        GraphOrigin::Metadata,
        evidence.to_string(),
        vec![anchor],
        Vec::new(),
    ));
}

fn is_config_name(name: &str) -> bool {
    name.ends_with(".config.js")
        || name.ends_with(".config.ts")
        || matches!(
            name,
            "package.json"
                | "cargo.toml"
                | "pyproject.toml"
                | "go.mod"
                | "dockerfile"
                | "docker-compose.yml"
                | "docker-compose.yaml"
                | "wrangler.toml"
                | "wrangler.jsonc"
                | "tauri.conf.json"
        )
}

fn sql_object_name(line: &str, object_kind: &str) -> Option<String> {
    let tokens = line
        .split(|character: char| character.is_whitespace() || matches!(character, '(' | ';'))
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();
    let position = tokens
        .iter()
        .position(|token| token.eq_ignore_ascii_case(object_kind))?;
    tokens
        .iter()
        .skip(position + 1)
        .find(|token| {
            !matches!(
                token.to_ascii_lowercase().as_str(),
                "if" | "not" | "exists" | "unique" | "concurrently"
            )
        })
        .map(|token| token.trim_matches(['`', '"', '\'', '[', ']']).to_string())
}

fn rust_function_name(line: &str) -> Option<String> {
    let function = line.find("fn ")? + 3;
    let rest = &line[function..];
    let name = rest
        .split(|character: char| !character.is_alphanumeric() && character != '_')
        .next()?;
    (!name.is_empty()).then(|| name.to_string())
}

fn first_quoted(line: &str) -> Option<String> {
    for quote in ['"', '\'', '`'] {
        let Some(start) = line.find(quote) else {
            continue;
        };
        let rest = &line[start + quote.len_utf8()..];
        if let Some(end) = rest.find(quote) {
            let value = rest[..end].trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn is_analytics_line(lower: &str) -> bool {
    [
        "capture(",
        ".capture(",
        "track(",
        "trackevent(",
        "track_event(",
        "trackcoreaction(",
        "track_core_action(",
        "analytics.emit(",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn is_test_line(lower: &str, lower_path: &str) -> bool {
    lower == "#[test]"
        || lower.starts_with("it(")
        || lower.starts_with("test(")
        || lower.starts_with("describe(")
        || ((lower_path.contains("/tests/") || lower_path.contains(".test."))
            && lower.contains("fn test_"))
}

fn markdown_link_targets(line: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut remainder = line;
    while let Some(start) = remainder.find("](") {
        let after = &remainder[start + 2..];
        let Some(end) = after.find(')') else {
            break;
        };
        let target = after[..end].trim();
        if !target.is_empty() && !target.starts_with('#') {
            targets.push(target.to_string());
        }
        remainder = &after[end + 1..];
    }
    targets
}

fn rationale_marker(line: &str) -> Option<String> {
    let trimmed = line
        .trim()
        .trim_start_matches(['#', '-', '*', '>', ' '])
        .trim();
    let lower = trimmed.to_ascii_lowercase();
    ["decision:", "rationale:", "why:", "adr:"]
        .iter()
        .find_map(|marker| lower.starts_with(marker).then(|| trimmed.to_string()))
}

fn extract_source(path: &str, language: SupportedLanguage, source: &str) -> FileContribution {
    let mut parser = Parser::new();
    let ts_language = language.tree_sitter_language();
    if let Err(error) = parser.set_language(&ts_language) {
        return parse_error_contribution(path, language, format!("Parser setup failed: {error}"));
    }
    let Some(tree) = parser.parse(source, None) else {
        return parse_error_contribution(path, language, "Parser returned no tree".to_string());
    };

    let file_id = stable_graph_id("file", path);
    let mut nodes = vec![StructuralGraphNode {
        id: file_id.clone(),
        kind: "file".to_string(),
        label: path.to_string(),
        qualified_name: Some(path.to_string()),
        path: Some(path.to_string()),
        detail: Some("syntax-indexed source file".to_string()),
        language: Some(language.name().to_string()),
        community_id: None,
        trust: GraphTrust::Extracted,
        origin: GraphOrigin::Syntax,
        sources: vec![GraphSourceAnchor::path(path)],
    }];
    let mut edges = Vec::new();
    let mut identity_counts = HashMap::new();
    visit_node(
        tree.root_node(),
        source,
        path,
        language,
        &file_id,
        &[],
        &mut identity_counts,
        &mut nodes,
        &mut edges,
    );
    extract_metadata_signals(
        path,
        source,
        &file_id,
        Some(language.name()),
        &mut nodes,
        &mut edges,
    );
    let mut diagnostics = Vec::new();
    if tree.root_node().has_error() {
        diagnostics.push(StructuralGraphDiagnostic {
            severity: "warning".to_string(),
            code: "syntax_error".to_string(),
            message: "Tree-sitter recovered from one or more syntax errors; extracted nodes remain source-backed but coverage may be partial.".to_string(),
            path: Some(path.to_string()),
            language: Some(language.name().to_string()),
        });
    }

    FileContribution {
        path: path.to_string(),
        language: Some(language.name().to_string()),
        content_hash: Some(stable_graph_id("content", source)),
        byte_size: source.len() as u64,
        nodes,
        edges,
        diagnostics,
        disposition: FileDisposition::Indexed,
    }
}

#[allow(clippy::too_many_arguments)]
fn visit_node(
    node: Node<'_>,
    source: &str,
    path: &str,
    language: SupportedLanguage,
    owner_id: &str,
    containers: &[String],
    identity_counts: &mut HashMap<String, usize>,
    nodes: &mut Vec<StructuralGraphNode>,
    edges: &mut Vec<StructuralGraphEdge>,
) {
    let mut child_owner = owner_id.to_string();
    let mut child_containers = containers.to_vec();

    if let Some(kind) = declaration_kind(node.kind()) {
        if let Some(name) = declaration_name(node, source) {
            let qualified_name = if containers.is_empty() {
                name.clone()
            } else {
                format!("{}::{name}", containers.join("::"))
            };
            let identity = format!("{path}\0{kind}\0{qualified_name}");
            let ordinal = identity_counts.entry(identity.clone()).or_insert(0);
            let node_id = stable_graph_id(kind, &format!("{identity}\0{ordinal}"));
            *ordinal += 1;
            let anchor = source_anchor(path, node, source);
            nodes.push(StructuralGraphNode {
                id: node_id.clone(),
                kind: kind.to_string(),
                label: name.clone(),
                qualified_name: Some(format!("{path}::{qualified_name}")),
                path: Some(path.to_string()),
                detail: Some(node.kind().to_string()),
                language: Some(language.name().to_string()),
                community_id: None,
                trust: GraphTrust::Extracted,
                origin: GraphOrigin::Syntax,
                sources: vec![anchor.clone()],
            });
            edges.push(make_edge(
                owner_id,
                &node_id,
                "defines",
                GraphTrust::Extracted,
                GraphOrigin::Syntax,
                format!("{} declaration", node.kind()),
                vec![anchor],
                Vec::new(),
            ));
            if is_explicitly_exported(node) {
                edges.push(make_edge(
                    owner_id,
                    &node_id,
                    "exports",
                    GraphTrust::Extracted,
                    GraphOrigin::Syntax,
                    "declaration is wrapped by an explicit export syntax node".to_string(),
                    vec![source_anchor(path, node, source)],
                    Vec::new(),
                ));
            }
            if kind == "field" {
                if let Some(type_node) = declaration_type_node(node) {
                    if let Some(target) = compact_node_text(type_node, source, 160) {
                        add_reference_edge(
                            path,
                            language,
                            &node_id,
                            type_node,
                            source,
                            &target,
                            "type_reference",
                            "has_type",
                            None,
                            nodes,
                            edges,
                        );
                    }
                }
            }
            child_owner = node_id;
            if is_container_kind(kind) {
                child_containers.push(name);
            }
        }
    }

    if is_call_node(node.kind()) {
        if let Some(target) = call_target(node, source) {
            add_reference_edge(
                path,
                language,
                &child_owner,
                node,
                source,
                &target,
                "symbol_reference",
                "calls",
                None,
                nodes,
                edges,
            );
        }
    }
    if is_import_node(node.kind()) {
        if let Some(target) = import_target(node, source) {
            add_reference_edge(
                path,
                language,
                owner_id,
                node,
                source,
                &target,
                "module_reference",
                "imports",
                compact_node_text(node, source, 500),
                nodes,
                edges,
            );
        }
    }
    if is_inheritance_node(node.kind()) {
        if let Some(target) = compact_node_text(node, source, 160) {
            add_reference_edge(
                path,
                language,
                &child_owner,
                node,
                source,
                &target,
                "type_reference",
                if node.kind().contains("implement") {
                    "implements"
                } else {
                    "inherits"
                },
                None,
                nodes,
                edges,
            );
        }
    }

    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        visit_node(
            child,
            source,
            path,
            language,
            &child_owner,
            &child_containers,
            identity_counts,
            nodes,
            edges,
        );
    }
}

fn is_explicitly_exported(node: Node<'_>) -> bool {
    let mut parent = node.parent();
    for _ in 0..3 {
        let Some(current) = parent else {
            return false;
        };
        if matches!(
            current.kind(),
            "export_statement" | "export_declaration" | "exported_declaration"
        ) {
            return true;
        }
        parent = current.parent();
    }
    false
}

fn declaration_type_node(node: Node<'_>) -> Option<Node<'_>> {
    for field in ["type", "return_type", "type_annotation"] {
        if let Some(candidate) = node.child_by_field_name(field) {
            return Some(candidate);
        }
    }
    let mut cursor = node.walk();
    let candidate = node.named_children(&mut cursor).find(|child| {
        child.kind().contains("type")
            && !matches!(child.kind(), "type_identifier" | "predefined_type")
    });
    candidate
}

#[allow(clippy::too_many_arguments)]
fn add_reference_edge(
    path: &str,
    language: SupportedLanguage,
    owner_id: &str,
    node: Node<'_>,
    source: &str,
    target: &str,
    reference_kind: &str,
    edge_kind: &str,
    reference_detail: Option<String>,
    nodes: &mut Vec<StructuralGraphNode>,
    edges: &mut Vec<StructuralGraphEdge>,
) {
    let normalized_target = normalize_reference(target);
    if normalized_target.is_empty() {
        return;
    }
    let reference_id = stable_graph_id(
        reference_kind,
        &format!("{path}\0{edge_kind}\0{normalized_target}"),
    );
    let anchor = source_anchor(path, node, source);
    nodes.push(StructuralGraphNode {
        id: reference_id.clone(),
        kind: reference_kind.to_string(),
        label: normalized_target.clone(),
        qualified_name: None,
        path: Some(path.to_string()),
        detail: Some(reference_detail.unwrap_or_else(|| format!("unresolved {edge_kind} target"))),
        language: Some(language.name().to_string()),
        community_id: None,
        trust: GraphTrust::Extracted,
        origin: GraphOrigin::Syntax,
        sources: vec![anchor.clone()],
    });
    edges.push(make_edge(
        owner_id,
        &reference_id,
        edge_kind,
        GraphTrust::Extracted,
        GraphOrigin::Syntax,
        format!("{} syntax references `{normalized_target}`", node.kind()),
        vec![anchor],
        Vec::new(),
    ));
}

fn declaration_kind(node_kind: &str) -> Option<&'static str> {
    match node_kind {
        "function_declaration"
        | "function_definition"
        | "function_item"
        | "function_signature"
        | "local_function_statement" => Some("function"),
        "method_definition"
        | "method_declaration"
        | "method_signature"
        | "method"
        | "singleton_method"
        | "method_declaration_with_body" => Some("method"),
        "constructor_declaration" | "init_declaration" => Some("constructor"),
        "class_declaration" | "class_definition" | "class_specifier" | "class" => Some("class"),
        "interface_declaration" | "protocol_declaration" | "trait_item" | "trait_declaration" => {
            Some("interface")
        }
        "struct_item" | "struct_specifier" | "struct_declaration" => Some("struct"),
        "enum_item" | "enum_specifier" | "enum_declaration" => Some("enum"),
        "union_item" | "union_specifier" => Some("union"),
        "type_alias_declaration" | "type_item" | "type_definition" | "type_declaration" => {
            Some("type")
        }
        "field_declaration"
        | "property_declaration"
        | "property_signature"
        | "public_field_definition"
        | "field_definition"
        | "struct_field" => Some("field"),
        "module"
        | "module_declaration"
        | "module_definition"
        | "mod_item"
        | "namespace_definition" => Some("module"),
        "object_declaration" => Some("object"),
        _ => None,
    }
}

fn declaration_name(node: Node<'_>, source: &str) -> Option<String> {
    for field in ["name", "declarator", "type", "identifier"] {
        if let Some(candidate) = node.child_by_field_name(field) {
            if let Some(name) = first_identifier_text(candidate, source, 0) {
                return Some(name);
            }
        }
    }
    first_identifier_text(node, source, 0)
}

fn first_identifier_text(node: Node<'_>, source: &str, depth: usize) -> Option<String> {
    if depth > 5 {
        return None;
    }
    if is_identifier_kind(node.kind()) {
        return compact_node_text(node, source, 120);
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        if let Some(value) = first_identifier_text(child, source, depth + 1) {
            return Some(value);
        }
    }
    None
}

fn is_identifier_kind(kind: &str) -> bool {
    matches!(
        kind,
        "identifier"
            | "name"
            | "type_identifier"
            | "field_identifier"
            | "property_identifier"
            | "namespace_identifier"
            | "constant"
            | "simple_identifier"
    )
}

fn is_container_kind(kind: &str) -> bool {
    matches!(
        kind,
        "class" | "interface" | "struct" | "enum" | "union" | "module" | "object"
    )
}

fn is_call_node(kind: &str) -> bool {
    matches!(
        kind,
        "call_expression"
            | "invocation_expression"
            | "method_invocation"
            | "function_call_expression"
            | "call"
    )
}

fn call_target(node: Node<'_>, source: &str) -> Option<String> {
    for field in ["function", "name", "method", "callee"] {
        if let Some(candidate) = node.child_by_field_name(field) {
            return compact_node_text(candidate, source, 160);
        }
    }
    node.named_child(0)
        .and_then(|candidate| compact_node_text(candidate, source, 160))
}

fn is_import_node(kind: &str) -> bool {
    matches!(
        kind,
        "import_statement"
            | "import_declaration"
            | "import_from_statement"
            | "use_declaration"
            | "using_directive"
            | "namespace_use_declaration"
            | "preproc_include"
    )
}

fn import_target(node: Node<'_>, source: &str) -> Option<String> {
    for field in ["source", "path", "module", "argument"] {
        if let Some(candidate) = node.child_by_field_name(field) {
            return compact_node_text(candidate, source, 240);
        }
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        if matches!(
            child.kind(),
            "string" | "string_literal" | "interpreted_string_literal" | "scoped_identifier"
        ) {
            return compact_node_text(child, source, 240);
        }
    }
    compact_node_text(node, source, 240)
}

fn is_inheritance_node(kind: &str) -> bool {
    matches!(
        kind,
        "extends_clause"
            | "implements_clause"
            | "superclass"
            | "super_interfaces"
            | "base_list"
            | "delegation_specifiers"
    )
}

fn compact_node_text(node: Node<'_>, source: &str, max_chars: usize) -> Option<String> {
    let text = node.utf8_text(source.as_bytes()).ok()?.trim();
    if text.is_empty() {
        return None;
    }
    Some(text.chars().take(max_chars).collect())
}

fn normalize_reference(value: &str) -> String {
    value
        .trim()
        .trim_matches(|character| matches!(character, '"' | '\'' | '`' | '<' | '>'))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn source_anchor(path: &str, node: Node<'_>, source: &str) -> GraphSourceAnchor {
    let start = node.start_position();
    let end = node.end_position();
    GraphSourceAnchor {
        path: path.to_string(),
        start_line: Some(start.row as u32 + 1),
        start_column: Some(start.column as u32 + 1),
        end_line: Some(end.row as u32 + 1),
        end_column: Some(end.column as u32 + 1),
        excerpt: compact_node_text(node, source, 240),
    }
}

fn make_edge(
    from: &str,
    to: &str,
    kind: &str,
    trust: GraphTrust,
    origin: GraphOrigin,
    evidence: String,
    sources: Vec<GraphSourceAnchor>,
    candidates: Vec<String>,
) -> StructuralGraphEdge {
    StructuralGraphEdge {
        id: stable_graph_id("edge", &format!("{kind}\0{from}\0{to}")),
        from: from.to_string(),
        to: to.to_string(),
        kind: kind.to_string(),
        evidence,
        trust,
        origin,
        sources,
        candidates,
    }
}

fn metadata_file_contribution(
    path: String,
    language: Option<SupportedLanguage>,
    disposition: FileDisposition,
) -> FileContribution {
    let language_name = language.map(|language| language.name().to_string());
    let (diagnostic_code, diagnostic_message) = match disposition {
        FileDisposition::Unsupported => (
            "unsupported_language",
            "File is retained as metadata because no syntax grammar is bundled",
        ),
        FileDisposition::Generated => (
            "generated_file_skipped",
            "Generated file is retained as metadata and excluded from syntax extraction",
        ),
        FileDisposition::TooLarge => (
            "file_too_large",
            "File exceeds the configured syntax extraction byte limit",
        ),
        _ => ("metadata_only", "File is indexed as metadata only"),
    };
    FileContribution {
        path: path.clone(),
        language: language_name.clone(),
        content_hash: None,
        byte_size: 0,
        nodes: vec![StructuralGraphNode {
            id: stable_graph_id("file", &path),
            kind: "file".to_string(),
            label: path.clone(),
            qualified_name: Some(path.clone()),
            path: Some(path.clone()),
            detail: Some(
                match disposition {
                    FileDisposition::Unsupported => "metadata-only unsupported file",
                    FileDisposition::Generated => "metadata-only generated file",
                    FileDisposition::TooLarge => "metadata-only oversized source file",
                    _ => "metadata-only file",
                }
                .to_string(),
            ),
            language: language_name.clone(),
            community_id: None,
            trust: GraphTrust::Extracted,
            origin: GraphOrigin::Metadata,
            sources: vec![GraphSourceAnchor::path(path.clone())],
        }],
        edges: Vec::new(),
        diagnostics: vec![StructuralGraphDiagnostic {
            severity: "info".to_string(),
            code: diagnostic_code.to_string(),
            message: diagnostic_message.to_string(),
            path: Some(path),
            language: language_name,
        }],
        disposition,
    }
}

fn skipped_contribution(
    path: String,
    language: Option<SupportedLanguage>,
    disposition: FileDisposition,
) -> FileContribution {
    let (code, message) = match disposition {
        FileDisposition::Sensitive => (
            "sensitive_file_skipped",
            "Sensitive file content and original path were excluded from the graph",
        ),
        FileDisposition::Binary => (
            "binary_file_skipped",
            "Binary file content was excluded from the graph",
        ),
        _ => (
            "file_skipped",
            "File was excluded from structural extraction",
        ),
    };
    FileContribution {
        path: path.clone(),
        language: language.map(|language| language.name().to_string()),
        content_hash: None,
        byte_size: 0,
        nodes: Vec::new(),
        edges: Vec::new(),
        diagnostics: vec![StructuralGraphDiagnostic {
            severity: "info".to_string(),
            code: code.to_string(),
            message: message.to_string(),
            path: Some(path),
            language: language.map(|language| language.name().to_string()),
        }],
        disposition,
    }
}

fn parse_error_contribution(
    path: &str,
    language: SupportedLanguage,
    message: String,
) -> FileContribution {
    FileContribution {
        path: path.to_string(),
        language: Some(language.name().to_string()),
        content_hash: None,
        byte_size: 0,
        nodes: Vec::new(),
        edges: Vec::new(),
        diagnostics: vec![StructuralGraphDiagnostic {
            severity: "error".to_string(),
            code: "parser_failed".to_string(),
            message,
            path: Some(path.to_string()),
            language: Some(language.name().to_string()),
        }],
        disposition: FileDisposition::Error,
    }
}

fn file_record_from_contribution(contribution: &FileContribution) -> StructuralGraphFileRecord {
    StructuralGraphFileRecord {
        path: contribution.path.clone(),
        language: contribution.language.clone(),
        content_hash: contribution.content_hash.clone(),
        disposition: contribution.disposition.as_str().to_string(),
        byte_size: contribution.byte_size,
        node_count: contribution.nodes.len(),
        edge_count: contribution.edges.len(),
    }
}

fn node_belongs_to_paths(node: &StructuralGraphNode, paths: &HashSet<String>) -> bool {
    node.path.as_ref().is_some_and(|path| paths.contains(path))
        || sources_touch_paths(&node.sources, paths)
}

fn sources_touch_paths(sources: &[GraphSourceAnchor], paths: &HashSet<String>) -> bool {
    sources.iter().any(|source| paths.contains(&source.path))
}

fn coverage_from_file_records(files: &[StructuralGraphFileRecord]) -> StructuralGraphCoverage {
    let mut coverage = StructuralGraphCoverage {
        discovered_files: files.len(),
        ..StructuralGraphCoverage::default()
    };
    let mut languages: BTreeMap<String, LanguageCoverage> = BTreeMap::new();
    for file in files {
        let language = file
            .language
            .clone()
            .unwrap_or_else(|| "unsupported".to_string());
        let entry = languages
            .entry(language.clone())
            .or_insert(LanguageCoverage {
                language,
                supported: file.language.is_some(),
                discovered_files: 0,
                indexed_files: 0,
                skipped_files: 0,
                error_files: 0,
            });
        entry.discovered_files += 1;
        match file.disposition.as_str() {
            "indexed" => {
                coverage.indexed_files += 1;
                entry.indexed_files += 1;
            }
            "error" => {
                coverage.error_files += 1;
                entry.error_files += 1;
            }
            "generated" => {
                coverage.generated_files += 1;
                coverage.skipped_files += 1;
                entry.skipped_files += 1;
            }
            "sensitive" => {
                coverage.sensitive_files += 1;
                coverage.skipped_files += 1;
                entry.skipped_files += 1;
            }
            "binary" => {
                coverage.binary_files += 1;
                coverage.skipped_files += 1;
                entry.skipped_files += 1;
            }
            _ => {
                coverage.skipped_files += 1;
                entry.skipped_files += 1;
            }
        }
    }
    coverage.languages = languages.into_values().collect();
    coverage
}

fn deduplicate_nodes(nodes: &mut Vec<StructuralGraphNode>) {
    nodes.sort_by(|left, right| left.id.cmp(&right.id));
    nodes.dedup_by(|left, right| left.id == right.id);
    nodes.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.label.cmp(&right.label))
            .then_with(|| left.id.cmp(&right.id))
    });
}

fn deduplicate_edges(edges: &mut Vec<StructuralGraphEdge>) {
    edges.sort_by(|left, right| left.id.cmp(&right.id));
    edges.dedup_by(|left, right| left.id == right.id);
    edges.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.from.cmp(&right.from))
            .then_with(|| left.to.cmp(&right.to))
    });
}

pub(crate) fn is_sensitive_path(path: &str) -> bool {
    crate::commands::secret_policy::is_sensitive_path(path)
}

fn is_generated_path(path: &str) -> bool {
    let lower = format!("/{}/", path.to_ascii_lowercase().trim_matches('/'));
    [
        "/node_modules/",
        "/target/",
        "/dist/",
        "/build/",
        "/out/",
        "/coverage/",
        "/vendor/",
        "/.next/",
        "/.turbo/",
    ]
    .iter()
    .any(|segment| lower.contains(segment))
        || path.ends_with(".min.js")
        || path.ends_with(".generated.ts")
        || path.ends_with(".g.cs")
}

fn is_binary_path(path: &str) -> bool {
    let extension = Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        extension.as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "ico"
            | "pdf"
            | "zip"
            | "gz"
            | "tar"
            | "7z"
            | "woff"
            | "woff2"
            | "ttf"
            | "otf"
            | "mp3"
            | "mp4"
            | "mov"
            | "wasm"
            | "dylib"
            | "so"
            | "dll"
            | "exe"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn every_promised_language_extracts_a_named_symbol() {
        let fixtures = [
            ("a.ts", "export function alpha() { beta(); }", "alpha"),
            (
                "a.tsx",
                "export function Alpha() { beta(); return <div/>; }",
                "Alpha",
            ),
            ("a.js", "function alpha() { beta(); }", "alpha"),
            (
                "a.jsx",
                "function Alpha() { beta(); return <div/>; }",
                "Alpha",
            ),
            ("a.rs", "fn alpha() { beta(); }", "alpha"),
            ("a.py", "def alpha():\n    beta()\n", "alpha"),
            ("a.go", "package a\nfunc alpha() { beta() }", "alpha"),
            ("A.java", "class A { void alpha() { beta(); } }", "alpha"),
            ("a.c", "void alpha(void) { beta(); }", "alpha"),
            ("a.cpp", "class A { void alpha() { beta(); } };", "alpha"),
            ("A.cs", "class A { void Alpha() { Beta(); } }", "Alpha"),
            ("a.rb", "def alpha\n  beta()\nend", "alpha"),
            ("a.php", "<?php function alpha() { beta(); }", "alpha"),
            ("A.kt", "fun alpha() { beta() }", "alpha"),
            ("A.swift", "func alpha() { beta() }", "alpha"),
        ];
        for (path, source, symbol) in fixtures {
            let language = SupportedLanguage::from_path(Path::new(path)).expect("language");
            let contribution = extract_source(path, language, source);
            assert_eq!(contribution.disposition, FileDisposition::Indexed, "{path}");
            assert!(
                contribution.nodes.iter().any(|node| node.label == symbol),
                "{path} should contain {symbol}; nodes: {:?}; diagnostics: {:?}",
                contribution
                    .nodes
                    .iter()
                    .map(|node| (&node.kind, &node.label))
                    .collect::<Vec<_>>(),
                contribution.diagnostics
            );
            assert!(
                contribution.nodes.iter().any(|node| node.kind == "file"),
                "{path} should include its file/module anchor"
            );
            assert!(
                contribution.edges.iter().any(|edge| edge.kind == "defines"),
                "{path} should include a direct definition edge"
            );
            assert!(
                contribution.edges.iter().any(|edge| edge.kind == "calls"),
                "{path} should include a direct call edge"
            );
            let declaration = contribution
                .nodes
                .iter()
                .find(|node| node.label == symbol)
                .expect("declaration");
            assert_eq!(declaration.sources[0].path, path);
            assert!(declaration.sources[0].start_line.is_some());
        }
    }

    #[test]
    fn modules_fields_and_nested_qualified_names_are_source_located() {
        let rust = extract_source(
            "src/model.rs",
            SupportedLanguage::Rust,
            "mod inner { struct User { name: String } impl User { fn save(&self) {} } }",
        );
        assert!(rust
            .nodes
            .iter()
            .any(|node| node.kind == "module" && node.label == "inner"));
        assert!(rust.nodes.iter().any(|node| {
            node.label == "User"
                && node
                    .qualified_name
                    .as_deref()
                    .is_some_and(|name| name.contains("inner::User"))
        }));

        let typescript = extract_source(
            "src/model.ts",
            SupportedLanguage::TypeScript,
            "export class User { name: string; save(): void {} }",
        );
        assert!(typescript
            .nodes
            .iter()
            .any(|node| node.kind == "field" && node.label == "name"));
        assert!(typescript
            .edges
            .iter()
            .any(|edge| edge.kind == "has_type" && edge.trust == GraphTrust::Extracted));
        assert!(typescript.nodes.iter().any(|node| {
            node.kind == "method"
                && node
                    .qualified_name
                    .as_deref()
                    .is_some_and(|name| name.contains("User::save"))
        }));
        assert!(typescript
            .edges
            .iter()
            .any(|edge| edge.kind == "exports" && edge.trust == GraphTrust::Extracted));
    }

    #[test]
    fn source_locations_are_one_based_and_calls_are_source_backed() {
        let contribution = extract_source(
            "a.rs",
            SupportedLanguage::Rust,
            "fn alpha() {\n    beta();\n}\n",
        );
        let function = contribution
            .nodes
            .iter()
            .find(|node| node.kind == "function")
            .expect("function");
        assert_eq!(function.sources[0].start_line, Some(1));
        let call = contribution
            .edges
            .iter()
            .find(|edge| edge.kind == "calls")
            .expect("call edge");
        assert_eq!(call.sources[0].start_line, Some(2));
        assert_eq!(call.trust, GraphTrust::Extracted);
    }

    #[test]
    fn source_metadata_extracts_product_boundaries_and_analytics() {
        let contribution = extract_source(
            "src/app.tsx",
            SupportedLanguage::Tsx,
            r#"
            <Route path="/settings" element={<Settings />} />
            trackCoreAction('settings_opened');
            test("opens settings", () => {});
            "#,
        );
        for (kind, label) in [
            ("route", "/settings"),
            ("analytics_event", "settings_opened"),
            ("test", "opens settings"),
        ] {
            let node = contribution
                .nodes
                .iter()
                .find(|node| node.kind == kind && node.label == label)
                .unwrap_or_else(|| panic!("missing {kind} {label}"));
            assert_eq!(node.origin, GraphOrigin::Metadata);
            assert_eq!(node.trust, GraphTrust::Extracted);
            assert!(node.sources[0].start_line.is_some());
        }
    }

    #[test]
    fn source_metadata_extracts_tauri_commands_and_sql_objects() {
        let contribution = extract_source(
            "src/main.rs",
            SupportedLanguage::Rust,
            r#"
            #[tauri::command]
            async fn build_graph() {}
            const SQL: &str = "CREATE TABLE IF NOT EXISTS graph_nodes (id TEXT);";
            "#,
        );
        assert!(contribution
            .nodes
            .iter()
            .any(|node| node.kind == "tauri_command" && node.label == "build_graph"));
        assert!(contribution
            .nodes
            .iter()
            .any(|node| node.kind == "db_table" && node.label == "graph_nodes"));
    }

    #[test]
    fn metadata_text_files_extract_docs_links_rationale_and_configuration() {
        let root = std::env::temp_dir().join(format!(
            "codevetter-structural-metadata-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("fixture root");
        fs::write(
            root.join("README.md"),
            "# Notes\nDecision: keep parsing local\n[Architecture](docs/architecture.md)\n",
        )
        .expect("readme");
        fs::write(root.join("package.json"), "{\"name\":\"fixture\"}\n").expect("package config");
        let docs = extract_metadata_path(&root, Path::new("README.md"), "README.md", 1024);
        assert_eq!(docs.disposition, FileDisposition::Indexed);
        assert!(docs.nodes.iter().any(|node| node.kind == "decision"));
        assert!(docs.nodes.iter().any(|node| {
            node.kind == "documentation_link" && node.label == "docs/architecture.md"
        }));
        let config = extract_metadata_path(&root, Path::new("package.json"), "package.json", 1024);
        assert!(config.nodes.iter().any(|node| node.kind == "configuration"));
        fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn duplicate_overloads_have_distinct_stable_ids() {
        let source = "function parse(value: string): string;\nfunction parse(value: number): number;\nfunction parse(value: string | number) { return value; }\n";
        let first = extract_source("parse.ts", SupportedLanguage::TypeScript, source);
        let second = extract_source("parse.ts", SupportedLanguage::TypeScript, source);
        let ids = |contribution: &FileContribution| {
            contribution
                .nodes
                .iter()
                .filter(|node| node.label == "parse")
                .map(|node| node.id.clone())
                .collect::<Vec<_>>()
        };
        let first_ids = ids(&first);
        assert!(first_ids.len() >= 2);
        assert_eq!(first_ids, ids(&second));
        assert_eq!(
            first_ids.iter().collect::<HashSet<_>>().len(),
            first_ids.len()
        );
    }

    #[test]
    fn malformed_unicode_and_generated_files_preserve_honest_coverage() {
        let malformed = extract_source(
            "broken.py",
            SupportedLanguage::Python,
            "def résumé(:\n    pass\n",
        );
        assert!(malformed
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "syntax_error"));

        let unicode = extract_source(
            "unicode.py",
            SupportedLanguage::Python,
            "def résumé():\n    return 1\n",
        );
        assert!(unicode
            .nodes
            .iter()
            .any(|node| node.label == "résumé" && node.sources[0].start_line == Some(1)));

        let generated = extract_path(
            Path::new("/repo"),
            Path::new("src/client.generated.ts"),
            1_024,
        );
        assert_eq!(generated.disposition, FileDisposition::Generated);
        assert!(generated.nodes.iter().all(|node| node.kind == "file"));
        assert!(generated
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "generated_file_skipped"));
    }

    #[test]
    fn sensitive_files_are_not_named_as_graph_nodes() {
        let contribution = extract_path(Path::new("/repo"), Path::new("config/.env.local"), 100);
        assert_eq!(contribution.disposition, FileDisposition::Sensitive);
        assert!(contribution.nodes.is_empty());
    }

    #[test]
    fn incremental_build_reuses_untouched_files_and_removes_deleted_files() {
        let root = std::env::temp_dir().join(format!(
            "codevetter-structural-graph-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create fixture repo");
        run_git(&root, &["init"]);
        fs::write(root.join("a.rs"), "fn alpha() {}\n").expect("a");
        fs::write(root.join("b.rs"), "fn beta() {}\n").expect("b");
        fs::write(root.join("c.rs"), "fn removed() {}\n").expect("c");
        run_git(&root, &["add", "a.rs", "b.rs", "c.rs"]);

        let engine = BundledTreeSitterEngine;
        let cancellation = StructuralGraphCancellation::default();
        let progress = |_: StructuralGraphProgress| {};
        let first = engine
            .build(
                &StructuralGraphBuildInput::full(root.clone(), None),
                &cancellation,
                &progress,
            )
            .expect("full build");
        let beta_id = first
            .nodes
            .iter()
            .find(|node| node.label == "beta")
            .expect("beta")
            .id
            .clone();

        fs::write(root.join("a.rs"), "fn gamma() {}\n").expect("change a");
        fs::remove_file(root.join("c.rs")).expect("delete c");
        let second = engine
            .build(
                &StructuralGraphBuildInput {
                    repo_root: root.clone(),
                    repo_head: None,
                    changed_files: vec!["a.rs".to_string()],
                    deleted_files: vec!["c.rs".to_string()],
                    previous_cursor: first.cursor.clone(),
                    previous_snapshot: Some(Box::new(first)),
                    max_files: 25_000,
                    max_bytes_per_file: 2 * 1024 * 1024,
                },
                &cancellation,
                &progress,
            )
            .expect("incremental build");

        assert!(second.nodes.iter().any(|node| node.label == "gamma"));
        assert!(!second.nodes.iter().any(|node| node.label == "alpha"));
        assert!(!second.nodes.iter().any(|node| node.label == "removed"));
        assert!(second.nodes.iter().any(|node| node.id == beta_id));
        assert_eq!(second.coverage.indexed_files, 2);
        fs::remove_dir_all(root).expect("remove fixture repo");
    }

    #[test]
    fn incremental_build_repairs_a_renamed_file_without_stale_nodes() {
        let root = std::env::temp_dir().join(format!(
            "codevetter-structural-graph-rename-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(root.join("src")).expect("create fixture repo");
        run_git(&root, &["init"]);
        fs::write(root.join("src/old.rs"), "fn carried() {}\n").expect("old");
        run_git(&root, &["add", "src/old.rs"]);

        let engine = BundledTreeSitterEngine;
        let cancellation = StructuralGraphCancellation::default();
        let progress = |_: StructuralGraphProgress| {};
        let first = engine
            .build(
                &StructuralGraphBuildInput::full(root.clone(), None),
                &cancellation,
                &progress,
            )
            .expect("full build");
        fs::rename(root.join("src/old.rs"), root.join("src/new.rs")).expect("rename");
        let second = engine
            .build(
                &StructuralGraphBuildInput {
                    repo_root: root.clone(),
                    repo_head: None,
                    changed_files: vec!["src/new.rs".to_string()],
                    deleted_files: vec!["src/old.rs".to_string()],
                    previous_cursor: first.cursor.clone(),
                    previous_snapshot: Some(Box::new(first)),
                    max_files: 25_000,
                    max_bytes_per_file: 2 * 1024 * 1024,
                },
                &cancellation,
                &progress,
            )
            .expect("rename refresh");

        assert!(second
            .nodes
            .iter()
            .any(|node| { node.label == "carried" && node.path.as_deref() == Some("src/new.rs") }));
        assert!(!second
            .nodes
            .iter()
            .any(|node| node.path.as_deref() == Some("src/old.rs")));
        assert_eq!(second.coverage.indexed_files, 1);
        fs::remove_dir_all(root).expect("remove fixture repo");
    }

    fn run_git(root: &Path, arguments: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(arguments)
            .status()
            .expect("run git");
        assert!(status.success(), "git {arguments:?}");
    }
}
