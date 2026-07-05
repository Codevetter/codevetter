//! Shared DTOs for Repo Unpacked.

use crate::commands::unpack_scan::InventoryDirNode;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LanguageCount {
    pub language: String,
    pub files: usize,
    pub bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ManifestSummary {
    pub path: String,
    pub kind: String,
    pub name: Option<String>,
    pub version: Option<String>,
    pub dependencies: Vec<String>,
    pub scripts: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EntrypointHint {
    pub path: String,
    pub kind: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DocFile {
    pub path: String,
    pub bytes: u64,
    pub preview: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DirSummary {
    pub path: String,
    pub file_count: usize,
    pub bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InventoryCoverageSummary {
    pub schema_version: i64,
    pub strategy: String,
    pub sampled_files: usize,
    pub total_files: Option<usize>,
    pub sample_percent: Option<f64>,
    pub languages: Vec<LanguageCount>,
    pub top_level_dirs: Vec<DirSummary>,
    pub notes: Vec<String>,
}

impl Default for InventoryCoverageSummary {
    fn default() -> Self {
        Self {
            schema_version: 1,
            strategy: "full_walk".to_string(),
            sampled_files: 0,
            total_files: None,
            sample_percent: None,
            languages: Vec::new(),
            top_level_dirs: Vec::new(),
            notes: Vec::new(),
        }
    }
}

pub(crate) fn default_inventory_coverage() -> InventoryCoverageSummary {
    InventoryCoverageSummary::default()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceUnitSummary {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub manifest_path: Option<String>,
    pub build_system: Option<String>,
    pub file_count: usize,
    pub languages: Vec<LanguageCount>,
    pub scripts: Vec<String>,
    pub entrypoints: Vec<String>,
    pub test_files: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QaReadinessSignal {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
    pub sources: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QaSuggestedFlow {
    pub id: String,
    pub route: String,
    pub goal: String,
    pub sources: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QaReadiness {
    pub score: i64,
    pub status: String,
    pub summary: String,
    pub signals: Vec<QaReadinessSignal>,
    pub suggested_flows: Vec<QaSuggestedFlow>,
}

impl Default for QaReadiness {
    fn default() -> Self {
        Self {
            score: 0,
            status: "missing".to_string(),
            summary: "No synthetic QA readiness signals were captured for this inventory."
                .to_string(),
            signals: Vec::new(),
            suggested_flows: Vec::new(),
        }
    }
}

pub(crate) fn default_qa_readiness() -> QaReadiness {
    QaReadiness::default()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoGraphNode {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub path: Option<String>,
    pub detail: Option<String>,
    pub sources: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoGraphEdge {
    pub from: String,
    pub to: String,
    pub kind: String,
    pub evidence: String,
    pub sources: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoGraph {
    pub schema_version: i64,
    pub nodes: Vec<RepoGraphNode>,
    pub edges: Vec<RepoGraphEdge>,
    pub truncated: bool,
}

impl Default for RepoGraph {
    fn default() -> Self {
        Self {
            schema_version: 1,
            nodes: Vec::new(),
            edges: Vec::new(),
            truncated: false,
        }
    }
}

pub(crate) fn default_repo_graph() -> RepoGraph {
    RepoGraph::default()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoHistoryCommit {
    pub sha: String,
    pub date: Option<String>,
    pub subject: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoHistoryDecision {
    pub marker: String,
    pub text: String,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoHistoryTestHint {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoTemporalCoupling {
    pub files: Vec<String>,
    pub commit_count: usize,
    pub last_commit: Option<String>,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoHistoryBrief {
    pub schema_version: i64,
    pub summary: String,
    pub recent_commits: Vec<RepoHistoryCommit>,
    pub decisions: Vec<RepoHistoryDecision>,
    pub test_hints: Vec<RepoHistoryTestHint>,
    #[serde(default)]
    pub temporal_couplings: Vec<RepoTemporalCoupling>,
    pub sources: Vec<String>,
    pub truncated: bool,
}

impl Default for RepoHistoryBrief {
    fn default() -> Self {
        Self {
            schema_version: 1,
            summary: "No local history brief was captured for this inventory.".to_string(),
            recent_commits: Vec::new(),
            decisions: Vec::new(),
            test_hints: Vec::new(),
            temporal_couplings: Vec::new(),
            sources: Vec::new(),
            truncated: false,
        }
    }
}

pub(crate) fn default_history_brief() -> RepoHistoryBrief {
    RepoHistoryBrief::default()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoHealthFinding {
    pub id: String,
    pub label: String,
    pub dimension: String,
    pub severity: String,
    pub detail: String,
    pub sources: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoHealthFile {
    pub path: String,
    pub score: f64,
    pub bucket: String,
    pub lines: usize,
    pub bytes: u64,
    pub churn: usize,
    pub has_test_signal: bool,
    pub findings: Vec<RepoHealthFinding>,
    pub refactoring_targets: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoHealth {
    pub schema_version: i64,
    pub summary: String,
    pub average_score: f64,
    pub hotspot_count: usize,
    pub files_analyzed: usize,
    pub files_with_test_signal: usize,
    pub top_files: Vec<RepoHealthFile>,
    pub truncated: bool,
}

impl Default for RepoHealth {
    fn default() -> Self {
        Self {
            schema_version: 1,
            summary: "No deterministic repo-health signals were captured for this inventory."
                .to_string(),
            average_score: 10.0,
            hotspot_count: 0,
            files_analyzed: 0,
            files_with_test_signal: 0,
            top_files: Vec::new(),
            truncated: false,
        }
    }
}

pub(crate) fn default_repo_health() -> RepoHealth {
    RepoHealth::default()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoInventory {
    pub repo_path: String,
    pub repo_name: String,
    pub commit_sha: Option<String>,
    pub branch: Option<String>,
    pub remote_url: Option<String>,
    pub files_scanned: usize,
    pub files_skipped: usize,
    pub bytes_scanned: u64,
    pub max_files_hit: bool,
    #[serde(default)]
    pub estimated_total_files: Option<usize>,
    pub languages: Vec<LanguageCount>,
    pub manifests: Vec<ManifestSummary>,
    pub entrypoints: Vec<EntrypointHint>,
    pub top_level_dirs: Vec<DirSummary>,
    pub docs: Vec<DocFile>,
    pub config_files: Vec<String>,
    pub stack_tags: Vec<String>,
    #[serde(default)]
    pub workspace_units: Vec<WorkspaceUnitSummary>,
    #[serde(default = "default_qa_readiness")]
    pub qa_readiness: QaReadiness,
    #[serde(default = "default_repo_graph")]
    pub repo_graph: RepoGraph,
    #[serde(default = "default_history_brief")]
    pub history_brief: RepoHistoryBrief,
    #[serde(default = "default_repo_health")]
    pub repo_health: RepoHealth,
    pub all_files: Vec<String>,
    pub ignored_dirs: Vec<String>,
    #[serde(default = "default_inventory_coverage")]
    pub coverage: InventoryCoverageSummary,
    #[serde(default)]
    pub all_files_capped: bool,
    #[serde(default = "default_dir_tree_preview")]
    pub dir_tree_preview: InventoryDirNode,
}

pub(crate) fn default_dir_tree_preview() -> InventoryDirNode {
    InventoryDirNode {
        name: String::new(),
        path: String::new(),
        is_dir: true,
        file_count: 0,
        children: Vec::new(),
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReportClaim {
    pub claim: String,
    pub sources: Vec<String>,
    pub kind: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReportSection {
    pub title: String,
    pub summary: String,
    pub claims: Vec<ReportClaim>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SnapshotChangedFile {
    pub path: String,
    pub additions: u64,
    pub deletions: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SnapshotCommitEvidence {
    pub sha: String,
    pub date: String,
    pub author: String,
    pub subject: String,
    pub additions: u64,
    pub deletions: u64,
    pub files: Vec<SnapshotChangedFile>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SnapshotCommitRange {
    pub base_commit: String,
    pub head_commit: String,
    pub commit_count: u64,
    pub commits: Vec<SnapshotCommitEvidence>,
    pub truncated: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UnpackOutcomeReviewEvidence {
    pub id: String,
    pub review_type: Option<String>,
    pub status: String,
    pub review_action: Option<String>,
    pub findings_count: Option<i64>,
    pub score_composite: Option<f64>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UnpackOutcomeQaEvidence {
    pub id: String,
    pub review_id: Option<String>,
    pub loop_id: String,
    pub runner_type: String,
    pub route: Option<String>,
    pub goal: Option<String>,
    pub pass: bool,
    pub duration_ms: i64,
    pub console_errors: i64,
    pub error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UnpackOutcomeProcedureEvidence {
    pub id: String,
    pub review_id: String,
    pub step_id: String,
    pub status: String,
    pub source: String,
    pub summary: String,
    pub artifact: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UnpackOutcomeFindingEvidence {
    pub file_path: Option<String>,
    pub title: Option<String>,
    pub severity: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UnpackOutcomeTrustAction {
    pub priority: String,
    pub label: String,
    pub detail: String,
    pub source_kind: String,
    pub source_id: Option<String>,
    pub source_path: Option<String>,
    pub command: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UnpackOutcomeTrendWindow {
    pub label: String,
    pub proof_count: usize,
    pub failure_count: usize,
    pub finding_count: usize,
    pub review_failure_count: usize,
    pub oldest_at: Option<String>,
    pub newest_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UnpackOutcomeTrend {
    pub direction: String,
    pub confidence: String,
    pub total_signals: usize,
    pub recent: UnpackOutcomeTrendWindow,
    pub prior: UnpackOutcomeTrendWindow,
    pub summary: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UnpackOutcomeEvidence {
    pub repo_path: String,
    pub reviews: Vec<UnpackOutcomeReviewEvidence>,
    pub qa_runs: Vec<UnpackOutcomeQaEvidence>,
    pub procedure_events: Vec<UnpackOutcomeProcedureEvidence>,
    pub recurring_findings: Vec<UnpackOutcomeFindingEvidence>,
    pub review_count: usize,
    pub failed_review_count: usize,
    pub qa_pass_count: usize,
    pub qa_fail_count: usize,
    pub procedure_pass_count: usize,
    pub procedure_fail_count: usize,
    pub calibration: String,
    pub summary: String,
    pub trend: UnpackOutcomeTrend,
    pub trust_actions: Vec<UnpackOutcomeTrustAction>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct UnpackReport {
    pub system_map: Option<ReportSection>,
    pub feature_catalog: Option<ReportSection>,
    pub data_flow: Option<ReportSection>,
    pub behavior_traces: Option<ReportSection>,
    pub testing_signals: Option<ReportSection>,
    pub risk_map: Option<ReportSection>,
    pub extension_points: Option<ReportSection>,
    pub agent_handoff: Option<ReportSection>,
    pub agent_prompt: Option<String>,
    pub overview: Option<String>,
}
