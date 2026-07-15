use super::language::SupportedLanguage;
use super::types::{
    stable_graph_id, GraphOrigin, GraphSourceAnchor, GraphTrust, LanguageCoverage,
    StructuralGraphCoverage, StructuralGraphDiagnostic, StructuralGraphEdge,
    StructuralGraphFileRecord, StructuralGraphMetricFact, StructuralGraphNode,
};
use std::collections::{BTreeMap, HashSet};
use std::path::Path;

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

pub(crate) use assembly::is_sensitive_path;
