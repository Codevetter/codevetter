use super::contracts::extract_contracts;
use super::language::{supported_language_names, SupportedLanguage};
use super::metrics::{detect_clone_groups, extract_scope_metrics, finalize_metric_degrees};
use super::types::{
    stable_graph_id, GraphOrigin, GraphSourceAnchor, GraphTrust, LanguageCoverage,
    StructuralGraphBuildInput, StructuralGraphCancellation, StructuralGraphCoverage,
    StructuralGraphDiagnostic, StructuralGraphEdge, StructuralGraphEngine,
    StructuralGraphEngineInfo, StructuralGraphError, StructuralGraphFileRecord,
    StructuralGraphMetricFact, StructuralGraphNode, StructuralGraphProgress,
    StructuralGraphProgressSink, StructuralGraphSnapshot, BUNDLED_ENGINE_ID,
    BUNDLED_ENGINE_VERSION, STRUCTURAL_GRAPH_SCHEMA_VERSION,
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

#[derive(Debug)]
struct FileContribution {
    path: String,
    language: Option<String>,
    content_hash: Option<String>,
    byte_size: u64,
    nodes: Vec<StructuralGraphNode>,
    edges: Vec<StructuralGraphEdge>,
    metrics: Vec<StructuralGraphMetricFact>,
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

mod assembly;
mod engine;
mod files;
mod history;
mod metadata;
mod syntax;

use assembly::{
    coverage_from_file_records, deduplicate_edges, deduplicate_metrics, deduplicate_nodes,
    file_record_from_contribution, is_binary_path, is_generated_path, metadata_file_contribution,
    node_belongs_to_paths, parse_error_contribution, skipped_contribution, sources_touch_paths,
};
#[cfg(test)]
use files::extract_metadata_path;
use files::{discover_paths, extract_blob, extract_path};
use metadata::{attach_metadata_to_syntax_owners, extract_metadata_signals};
use syntax::{extract_source, make_edge};

pub(crate) use assembly::is_sensitive_path;
pub use engine::BundledTreeSitterEngine;
pub use history::{build_snapshot_from_blob_delta, build_snapshot_from_blobs, HistoricalFileBlob};

#[cfg(test)]
mod tests;
