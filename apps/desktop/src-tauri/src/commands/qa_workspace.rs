use crate::db::queries;
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const QA_WORKSPACE_SCHEMA: &str = "codevetter.qa-workspace/v1";
const NATIVE_WORKFLOW_PREFIX: &str = "native_testing_qa_workflows_v1";
const LEGACY_WORKFLOW_PREFIX: &str = "quick_review_qa_workflows";
const LEGACY_PRESET_PREFIX: &str = "quick_review_qa_preset";
const MAX_WORKFLOWS: usize = 12;
const MAX_TARGETS: usize = 16;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QaTargetPreset {
    pub id: String,
    pub name: String,
    pub route: String,
    pub goal: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoredQaWorkflow {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub loop_id: String,
    #[serde(default = "default_runner")]
    pub runner_type: String,
    #[serde(default)]
    pub goal: String,
    #[serde(default)]
    pub repo_spec_path: String,
    #[serde(default = "default_trace_mode")]
    pub repo_trace_mode: String,
    #[serde(default)]
    pub target_route: String,
    #[serde(default)]
    pub allow_remote_target: bool,
    #[serde(default)]
    pub targets: Vec<QaTargetPreset>,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QaWorkflow {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub loop_id: String,
    pub runner_type: String,
    pub goal: String,
    pub repo_spec_path: String,
    pub repo_trace_mode: String,
    pub target_route: String,
    pub allow_remote_target: bool,
    pub targets: Vec<QaTargetPreset>,
    pub updated_at: String,
    pub editable: bool,
    pub limitation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QaSpecCandidate {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QaRerunRun {
    pub id: String,
    pub created_at: String,
    pub runner_type: String,
    pub base_url: String,
    pub loop_id: String,
    pub route: String,
    pub goal: String,
    pub pass: bool,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QaPostFixPreparation {
    pub status: String,
    pub summary: String,
    pub before: QaRerunRun,
    pub after: Option<QaRerunRun>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QaWorkspaceReceipt {
    pub schema_version: String,
    pub repo_path: String,
    pub preference_key: String,
    pub source: String,
    pub workflows: Vec<QaWorkflow>,
    pub specs: Vec<QaSpecCandidate>,
    pub post_fix: Option<QaPostFixPreparation>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone)]
pub enum QaWorkspaceMutation {
    Inspect,
    SaveWorkflow(StoredQaWorkflow),
    DeleteWorkflow {
        workflow_id: String,
    },
    SaveTarget {
        workflow_id: String,
        target: QaTargetPreset,
    },
    DeleteTarget {
        workflow_id: String,
        target_id: String,
    },
}

fn default_runner() -> String {
    "playwright_builtin".to_string()
}

fn default_trace_mode() -> String {
    "retain-on-failure".to_string()
}

fn stable_preference_suffix(value: &str) -> String {
    let mut hash: u32 = 2_166_136_261;
    for unit in value.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(16_777_619);
    }
    to_base36(hash)
}

fn to_base36(mut value: u32) -> String {
    if value == 0 {
        return "0".to_string();
    }
    let mut out = Vec::new();
    while value > 0 {
        let digit = value % 36;
        out.push(if digit < 10 {
            (b'0' + digit as u8) as char
        } else {
            (b'a' + (digit - 10) as u8) as char
        });
        value /= 36;
    }
    out.iter().rev().collect()
}

fn scoped_key(prefix: &str, repo_path: &str) -> String {
    format!(
        "{prefix}_repo_{}",
        stable_preference_suffix(repo_path.trim())
    )
}

fn required_text(value: &str, field: &str, max: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{field} is required"));
    }
    if value.chars().count() > max {
        return Err(format!("{field} must be at most {max} characters"));
    }
    Ok(value.to_string())
}

fn normalize_route(value: &str) -> Result<String, String> {
    let value = required_text(value, "route", 240)?;
    if !value.starts_with('/') || value.starts_with("//") {
        return Err("route must be a repository-relative browser path beginning with /".into());
    }
    Ok(value)
}

fn normalize_spec_path(repo: &Path, value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    let relative = Path::new(value);
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("repo_spec_path must remain repository-relative".into());
    }
    let candidate = repo.join(relative);
    if !candidate.is_file() {
        return Err(format!("repo_spec_path does not exist: {value}"));
    }
    Ok(value.replace('\\', "/"))
}

fn normalize_target(target: QaTargetPreset) -> Result<QaTargetPreset, String> {
    Ok(QaTargetPreset {
        id: required_text(&target.id, "target id", 100)?,
        name: required_text(&target.name, "target name", 100)?,
        route: normalize_route(&target.route)?,
        goal: required_text(&target.goal, "target goal", 500)?,
    })
}

fn normalize_workflow(repo: &Path, workflow: StoredQaWorkflow) -> Result<StoredQaWorkflow, String> {
    let runner_type = required_text(&workflow.runner_type, "runner_type", 40)?;
    if !matches!(
        runner_type.as_str(),
        "playwright_builtin" | "repo_playwright"
    ) {
        return Err("native QA workflows support playwright_builtin or repo_playwright; arbitrary external commands remain legacy-only".into());
    }
    let repo_trace_mode = required_text(&workflow.repo_trace_mode, "repo_trace_mode", 40)?;
    if !matches!(repo_trace_mode.as_str(), "off" | "retain-on-failure" | "on") {
        return Err("repo_trace_mode must be off, retain-on-failure, or on".into());
    }
    let mut targets = workflow
        .targets
        .into_iter()
        .map(normalize_target)
        .collect::<Result<Vec<_>, _>>()?;
    targets.truncate(MAX_TARGETS);
    let base_url = workflow.base_url.trim().trim_end_matches('/').to_string();
    if !base_url.is_empty() {
        let url = reqwest::Url::parse(&base_url)
            .map_err(|_| "base_url must be a valid HTTP(S) URL".to_string())?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err("base_url must be a valid HTTP(S) URL".into());
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err("base_url must not contain embedded credentials".into());
        }
    }
    Ok(StoredQaWorkflow {
        id: required_text(&workflow.id, "workflow id", 100)?,
        name: required_text(&workflow.name, "workflow name", 100)?,
        base_url,
        loop_id: required_text(&workflow.loop_id, "loop_id", 100)?,
        runner_type,
        goal: required_text(&workflow.goal, "goal", 500)?,
        repo_spec_path: normalize_spec_path(repo, &workflow.repo_spec_path)?,
        repo_trace_mode,
        target_route: normalize_route(&workflow.target_route)?,
        allow_remote_target: workflow.allow_remote_target,
        targets,
        updated_at: Utc::now().to_rfc3339(),
    })
}

fn project_workflow(workflow: StoredQaWorkflow) -> QaWorkflow {
    let editable = matches!(
        workflow.runner_type.as_str(),
        "playwright_builtin" | "repo_playwright"
    );
    let mut limitations = Vec::new();
    if !editable {
        limitations.push(
            "This legacy workflow uses an arbitrary external command. Native Testing will not expose or execute it."
                .to_string(),
        );
    }
    let base_url = match reqwest::Url::parse(workflow.base_url.trim()) {
        Ok(url)
            if matches!(url.scheme(), "http" | "https")
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none() =>
        {
            workflow.base_url
        }
        _ if workflow.base_url.trim().is_empty() => String::new(),
        _ => {
            limitations.push(
                "The legacy preview URL was omitted because it was invalid or credential-bearing."
                    .to_string(),
            );
            String::new()
        }
    };
    QaWorkflow {
        id: workflow.id,
        name: workflow.name,
        base_url,
        loop_id: workflow.loop_id,
        runner_type: workflow.runner_type,
        goal: workflow.goal,
        repo_spec_path: workflow.repo_spec_path,
        repo_trace_mode: workflow.repo_trace_mode,
        target_route: workflow.target_route,
        allow_remote_target: workflow.allow_remote_target,
        targets: workflow.targets.into_iter().take(MAX_TARGETS).collect(),
        updated_at: workflow.updated_at,
        editable,
        limitation: (!limitations.is_empty()).then(|| limitations.join(" ")),
    }
}

fn parse_workflows(raw: Option<String>) -> Vec<StoredQaWorkflow> {
    raw.and_then(|value| serde_json::from_str::<Vec<StoredQaWorkflow>>(&value).ok())
        .unwrap_or_default()
        .into_iter()
        .take(MAX_WORKFLOWS)
        .collect()
}

fn legacy_preset(raw: Option<String>) -> Vec<StoredQaWorkflow> {
    raw.and_then(|value| serde_json::from_str::<StoredQaWorkflow>(&value).ok())
        .map(|mut workflow| {
            workflow.id = "legacy-preset".into();
            if workflow.name.trim().is_empty() {
                workflow.name = "Legacy QA preset".into();
            }
            vec![workflow]
        })
        .unwrap_or_default()
}

fn load_workflows(
    connection: &Connection,
    repo_path: &str,
) -> Result<(String, Vec<StoredQaWorkflow>), String> {
    let native_key = scoped_key(NATIVE_WORKFLOW_PREFIX, repo_path);
    let native_raw = queries::get_preference(connection, &native_key).map_err(|e| e.to_string())?;
    if native_raw.is_some() {
        return Ok(("native".into(), parse_workflows(native_raw)));
    }
    let scoped_legacy_key = scoped_key(LEGACY_WORKFLOW_PREFIX, repo_path);
    let scoped_legacy = parse_workflows(
        queries::get_preference(connection, &scoped_legacy_key).map_err(|e| e.to_string())?,
    );
    if !scoped_legacy.is_empty() {
        return Ok(("legacy_projected".into(), scoped_legacy));
    }
    let global_legacy = parse_workflows(
        queries::get_preference(connection, LEGACY_WORKFLOW_PREFIX).map_err(|e| e.to_string())?,
    );
    if !global_legacy.is_empty() {
        return Ok(("legacy_global_projected".into(), global_legacy));
    }
    let scoped_preset_key = scoped_key(LEGACY_PRESET_PREFIX, repo_path);
    let scoped_preset = legacy_preset(
        queries::get_preference(connection, &scoped_preset_key).map_err(|e| e.to_string())?,
    );
    if !scoped_preset.is_empty() {
        return Ok(("legacy_preset_projected".into(), scoped_preset));
    }
    let global_preset = legacy_preset(
        queries::get_preference(connection, LEGACY_PRESET_PREFIX).map_err(|e| e.to_string())?,
    );
    Ok((
        if global_preset.is_empty() {
            "empty"
        } else {
            "legacy_global_preset_projected"
        }
        .into(),
        global_preset,
    ))
}

fn save_workflows(
    connection: &Connection,
    repo_path: &str,
    workflows: &[StoredQaWorkflow],
) -> Result<(), String> {
    let value =
        serde_json::to_string(workflows).map_err(|e| format!("serialize QA workflows: {e}"))?;
    queries::set_preference(
        connection,
        &scoped_key(NATIVE_WORKFLOW_PREFIX, repo_path),
        &value,
    )
    .map_err(|e| e.to_string())
}

fn flow_key(run: &queries::SyntheticQaRunRow) -> String {
    format!(
        "{}\0{}\0{}\0{}\0{}",
        run.runner_type,
        run.base_url.as_deref().unwrap_or_default(),
        run.loop_id,
        run.route.as_deref().unwrap_or_default(),
        run.goal.as_deref().unwrap_or_default()
    )
}

fn rerun_projection(run: &queries::SyntheticQaRunRow) -> QaRerunRun {
    QaRerunRun {
        id: run.id.clone(),
        created_at: run.created_at.clone(),
        runner_type: run.runner_type.clone(),
        base_url: run.base_url.clone().unwrap_or_default(),
        loop_id: run.loop_id.clone(),
        route: run.route.clone().unwrap_or_else(|| "/".into()),
        goal: run.goal.clone().unwrap_or_else(|| run.loop_id.clone()),
        pass: run.pass,
        duration_ms: run.duration_ms,
    }
}

fn post_fix_preparation(
    connection: &Connection,
    repo_path: &str,
    fix_completed_at: Option<&str>,
) -> Result<Option<QaPostFixPreparation>, String> {
    let Some(fix_completed_at) = fix_completed_at else {
        return Ok(None);
    };
    let fix_time = DateTime::parse_from_rfc3339(fix_completed_at)
        .map_err(|_| "fix_completed_at must be an RFC3339 timestamp".to_string())?
        .with_timezone(&Utc);
    let runs = queries::list_synthetic_qa_runs_for_repo(connection, repo_path, 50)
        .map_err(|e| e.to_string())?;
    let before = runs.iter().find(|run| {
        DateTime::parse_from_rfc3339(&run.created_at)
            .map(|time| time.with_timezone(&Utc) <= fix_time)
            .unwrap_or(false)
    });
    let Some(before) = before else {
        return Ok(None);
    };
    let key = flow_key(before);
    let after = runs.iter().find(|run| {
        DateTime::parse_from_rfc3339(&run.created_at)
            .map(|time| time.with_timezone(&Utc) > fix_time)
            .unwrap_or(false)
            && flow_key(run) == key
    });
    let (status, summary) = match after {
        None => (
            "needs_rerun",
            format!(
                "Fix is ready for QA comparison: rerun {} with the same {} flow.",
                before.route.as_deref().unwrap_or(&before.loop_id),
                before.runner_type
            ),
        ),
        Some(after) if !before.pass && after.pass => (
            "fixed",
            "Post-fix QA passed; the prior matching flow failed and the rerun passed.".into(),
        ),
        Some(after) if !before.pass && !after.pass => (
            "still_broken",
            "Post-fix QA still fails; both matching runs failed.".into(),
        ),
        Some(after) if before.pass && !after.pass => (
            "regressed",
            "Post-fix QA regressed; the prior matching flow passed and the rerun failed.".into(),
        ),
        Some(_) => (
            "still_passing",
            "Post-fix QA still passes for the matching flow.".into(),
        ),
    };
    Ok(Some(QaPostFixPreparation {
        status: status.into(),
        summary,
        before: rerun_projection(before),
        after: after.map(rerun_projection),
    }))
}

pub fn run_qa_workspace_headless(
    connection: &Connection,
    repo_path: PathBuf,
    mutation: QaWorkspaceMutation,
    fix_completed_at: Option<&str>,
) -> Result<QaWorkspaceReceipt, String> {
    let repo_path = std::fs::canonicalize(&repo_path)
        .map_err(|e| format!("repository {} is unavailable: {e}", repo_path.display()))?;
    if !repo_path.is_dir() {
        return Err("repo must be an existing directory".into());
    }
    let repo = repo_path.to_string_lossy().into_owned();
    let (mut source, mut workflows) = load_workflows(connection, &repo)?;
    match mutation {
        QaWorkspaceMutation::Inspect => {}
        QaWorkspaceMutation::SaveWorkflow(workflow) => {
            let mut workflow = normalize_workflow(&repo_path, workflow)?;
            if workflow.targets.is_empty() {
                if let Some(existing) = workflows
                    .iter()
                    .find(|candidate| candidate.id == workflow.id)
                {
                    workflow.targets = existing.targets.clone();
                }
            }
            workflows.retain(|candidate| candidate.id != workflow.id);
            workflows.insert(0, workflow);
            workflows.truncate(MAX_WORKFLOWS);
            save_workflows(connection, &repo, &workflows)?;
            source = "native".into();
        }
        QaWorkspaceMutation::DeleteWorkflow { workflow_id } => {
            let workflow_id = required_text(&workflow_id, "workflow id", 100)?;
            workflows.retain(|candidate| candidate.id != workflow_id);
            save_workflows(connection, &repo, &workflows)?;
            source = "native".into();
        }
        QaWorkspaceMutation::SaveTarget {
            workflow_id,
            target,
        } => {
            let workflow_id = required_text(&workflow_id, "workflow id", 100)?;
            let target = normalize_target(target)?;
            let workflow = workflows
                .iter_mut()
                .find(|candidate| candidate.id == workflow_id)
                .ok_or_else(|| format!("workflow not found: {workflow_id}"))?;
            if !matches!(
                workflow.runner_type.as_str(),
                "playwright_builtin" | "repo_playwright"
            ) {
                return Err(
                    "legacy external-command workflows are read-only in native Testing".into(),
                );
            }
            workflow
                .targets
                .retain(|candidate| candidate.id != target.id);
            workflow.targets.insert(0, target);
            workflow.targets.truncate(MAX_TARGETS);
            workflow.updated_at = Utc::now().to_rfc3339();
            save_workflows(connection, &repo, &workflows)?;
            source = "native".into();
        }
        QaWorkspaceMutation::DeleteTarget {
            workflow_id,
            target_id,
        } => {
            let workflow_id = required_text(&workflow_id, "workflow id", 100)?;
            let target_id = required_text(&target_id, "target id", 100)?;
            let workflow = workflows
                .iter_mut()
                .find(|candidate| candidate.id == workflow_id)
                .ok_or_else(|| format!("workflow not found: {workflow_id}"))?;
            workflow
                .targets
                .retain(|candidate| candidate.id != target_id);
            workflow.updated_at = Utc::now().to_rfc3339();
            save_workflows(connection, &repo, &workflows)?;
            source = "native".into();
        }
    }

    let specs = super::synthetic_qa::discover_playwright_specs_headless(&repo_path)
        .into_iter()
        .map(|candidate| QaSpecCandidate {
            path: candidate.path,
            reason: candidate.reason,
        })
        .collect();
    let projected = workflows
        .into_iter()
        .map(project_workflow)
        .collect::<Vec<_>>();
    let mut limitations = vec![
        "Credential-bearing storage-state paths are never projected into this receipt.".into(),
        "Arbitrary external-command workflows remain legacy-only and cannot execute from native Testing.".into(),
        "Preparing a post-fix flow does not grant preview network consent or start browser execution.".into(),
    ];
    if projected.iter().any(|workflow| !workflow.editable) {
        limitations.push("At least one projected legacy workflow is read-only.".into());
    }
    Ok(QaWorkspaceReceipt {
        schema_version: QA_WORKSPACE_SCHEMA.into(),
        repo_path: repo.clone(),
        preference_key: scoped_key(NATIVE_WORKFLOW_PREFIX, &repo),
        source,
        workflows: projected,
        specs,
        post_fix: post_fix_preparation(connection, &repo, fix_completed_at)?,
        limitations,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workflow(repo_spec_path: &str) -> StoredQaWorkflow {
        StoredQaWorkflow {
            id: "checkout".into(),
            name: "Checkout".into(),
            base_url: "http://localhost:1420/".into(),
            loop_id: "checkout".into(),
            runner_type: "repo_playwright".into(),
            goal: "Complete checkout".into(),
            repo_spec_path: repo_spec_path.into(),
            repo_trace_mode: "retain-on-failure".into(),
            target_route: "/checkout".into(),
            allow_remote_target: false,
            targets: vec![QaTargetPreset {
                id: "primary".into(),
                name: "Primary checkout".into(),
                route: "/checkout".into(),
                goal: "Complete checkout".into(),
            }],
            updated_at: String::new(),
        }
    }

    #[test]
    fn scoped_key_matches_the_frontend_fnv_contract() {
        assert_eq!(
            scoped_key("quick_review_qa_workflows", "/fixture/repo"),
            "quick_review_qa_workflows_repo_sfx8og"
        );
    }

    #[test]
    fn saves_safe_workflow_without_touching_legacy_preference() {
        let repo = tempfile::tempdir().expect("repo");
        std::fs::create_dir_all(repo.path().join("tests")).expect("tests");
        std::fs::write(
            repo.path().join("tests/checkout.spec.ts"),
            "import { test } from '@playwright/test';",
        )
        .expect("spec");
        let connection = Connection::open_in_memory().expect("db");
        connection
            .execute_batch("CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .expect("schema");
        queries::set_preference(&connection, LEGACY_WORKFLOW_PREFIX, "legacy-value")
            .expect("legacy");

        let receipt = run_qa_workspace_headless(
            &connection,
            repo.path().to_path_buf(),
            QaWorkspaceMutation::SaveWorkflow(workflow("tests/checkout.spec.ts")),
            None,
        )
        .expect("receipt");

        assert_eq!(receipt.schema_version, QA_WORKSPACE_SCHEMA);
        assert_eq!(receipt.source, "native");
        assert_eq!(receipt.workflows.len(), 1);
        assert_eq!(receipt.specs[0].path, "tests/checkout.spec.ts");
        assert_eq!(
            queries::get_preference(&connection, LEGACY_WORKFLOW_PREFIX).expect("legacy read"),
            Some("legacy-value".into())
        );
        let persisted = queries::get_preference(&connection, &receipt.preference_key)
            .expect("native read")
            .expect("native value");
        assert!(!persisted.contains("storageStatePath"));
        assert!(!persisted.contains("externalCommand"));
    }

    #[test]
    fn rejects_external_command_runner_and_parent_spec_paths() {
        let repo = tempfile::tempdir().expect("repo");
        let mut candidate = workflow("../secret.json");
        candidate.runner_type = "external_skill".into();
        let error = normalize_workflow(repo.path(), candidate).expect_err("external rejected");
        assert!(error.contains("external commands"));

        let error = normalize_workflow(repo.path(), workflow("../secret.json"))
            .expect_err("parent path rejected");
        assert!(error.contains("repository-relative"));
    }

    #[test]
    fn native_empty_state_does_not_resurface_legacy_and_legacy_urls_are_scrubbed() {
        let repo = tempfile::tempdir().expect("repo");
        let connection = Connection::open_in_memory().expect("db");
        connection
            .execute_batch("CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .expect("schema");
        let repo_path = std::fs::canonicalize(repo.path()).expect("canonical repo");
        let repo_text = repo_path.to_string_lossy();
        queries::set_preference(
            &connection,
            LEGACY_WORKFLOW_PREFIX,
            r#"[{"id":"legacy","name":"Legacy","baseUrl":"https://user:password@example.test","loopId":"legacy","runnerType":"playwright_builtin","goal":"Smoke","targetRoute":"/"}]"#,
        )
        .expect("legacy");
        let projected = run_qa_workspace_headless(
            &connection,
            repo_path.clone(),
            QaWorkspaceMutation::Inspect,
            None,
        )
        .expect("projected");
        assert_eq!(projected.workflows[0].base_url, "");
        assert!(projected.workflows[0]
            .limitation
            .as_deref()
            .is_some_and(|value| value.contains("credential-bearing")));

        queries::set_preference(
            &connection,
            &scoped_key(NATIVE_WORKFLOW_PREFIX, &repo_text),
            "[]",
        )
        .expect("native empty");
        let empty =
            run_qa_workspace_headless(&connection, repo_path, QaWorkspaceMutation::Inspect, None)
                .expect("native empty receipt");
        assert_eq!(empty.source, "native");
        assert!(empty.workflows.is_empty());
    }
}
