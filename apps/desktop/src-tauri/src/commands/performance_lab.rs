use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::Manager;

const PERFORMANCE_LAB_SCHEMA_VERSION: &str = "runtime-performance-lab-run/v6";
const PERFORMANCE_RUNTIME_ENTRY: &str = "runtime-failure-capsule/cli.mjs";
const MAX_RUNTIME_OUTPUT_BYTES: usize = 512 * 1024;
const MAX_RECEIPT_BYTES: u64 = 256 * 1024;
const MAX_HISTORY_RECEIPTS: usize = 24;
const MAX_HISTORY_ENTRIES_SCANNED: usize = 256;
const MAX_RECEIPT_LIMITATIONS: usize = 16;

#[derive(Debug, Clone, Serialize)]
pub struct PerformanceLabRecord {
    pub lab_id: String,
    pub receipt_path: String,
    pub recorded_at: Option<String>,
    pub receipt: Value,
}

#[tauri::command]
pub async fn run_performance_lab(
    app: tauri::AppHandle,
    repo_path: String,
    lab_id: String,
    max_steps: Option<u8>,
) -> Result<PerformanceLabRecord, String> {
    validate_lab_id(&lab_id)?;
    let steps = max_steps.unwrap_or(8);
    if !(1..=8).contains(&steps) {
        return Err("maxSteps must be between 1 and 8".to_string());
    }
    let repository = canonical_repository(&repo_path)?;
    let runtime = resolve_performance_runtime(&app)?;
    let lab_id_for_process = lab_id.clone();
    let repository_for_process = repository.clone();

    let receipt = tauri::async_runtime::spawn_blocking(move || {
        execute_performance_lab(
            &runtime,
            &repository_for_process,
            &lab_id_for_process,
            steps,
        )
    })
    .await
    .map_err(|error| format!("Local performance laboratory could not finish: {error}"))??;

    record_from_receipt(&lab_id, receipt)
}

#[tauri::command]
pub async fn list_performance_lab_receipts(
    repo_path: String,
) -> Result<Vec<PerformanceLabRecord>, String> {
    let repository = canonical_repository(&repo_path)?;
    tauri::async_runtime::spawn_blocking(move || read_performance_lab_receipts(&repository))
        .await
        .map_err(|error| format!("Local performance receipts could not be read: {error}"))?
}

fn canonical_repository(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw.trim());
    if raw.trim().is_empty() {
        return Err("Select a repository before starting a laboratory".to_string());
    }
    let canonical = fs::canonicalize(&path)
        .map_err(|error| format!("Repository {} is unavailable: {error}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!(
            "Repository {} is not a directory",
            canonical.display()
        ));
    }
    if !canonical.join(".git").exists() {
        return Err(format!(
            "Repository {} has no local Git identity",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn resolve_performance_runtime(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(PERFORMANCE_RUNTIME_ENTRY));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../scripts/runtime-failure-capsule/cli.mjs"),
    );
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "CodeVetter's packaged performance runtime is unavailable; no project execution started"
                .to_string()
        })
}

fn execute_performance_lab(
    runtime: &Path,
    repository: &Path,
    lab_id: &str,
    max_steps: u8,
) -> Result<Value, String> {
    let output = Command::new("node")
        .arg(runtime)
        .arg("run-performance-lab")
        .arg("--repo")
        .arg(repository)
        .arg("--lab-id")
        .arg(lab_id)
        .arg("--max-steps")
        .arg(max_steps.to_string())
        .arg("--json")
        .current_dir(repository)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "Node.js is required for local performance labs; CodeVetter did not download a runtime"
                    .to_string()
            } else {
                format!("Could not start the local performance laboratory: {error}")
            }
        })?;

    if output.stdout.len() > MAX_RUNTIME_OUTPUT_BYTES
        || output.stderr.len() > MAX_RUNTIME_OUTPUT_BYTES
    {
        return Err(
            "The local performance laboratory exceeded its bounded output limit".to_string(),
        );
    }
    if output.stdout.is_empty() {
        let stderr = bounded_message(&String::from_utf8_lossy(&output.stderr));
        return Err(if stderr.is_empty() {
            "The local performance laboratory returned no receipt".to_string()
        } else {
            format!("The local performance laboratory did not return evidence: {stderr}")
        });
    }

    let receipt: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("The local performance receipt was invalid JSON: {error}"))?;
    validate_receipt(&receipt, lab_id)?;
    Ok(receipt)
}

fn read_performance_lab_receipts(repository: &Path) -> Result<Vec<PerformanceLabRecord>, String> {
    let root = repository.join(".codevetter/performance-labs");
    if !root.exists() {
        return Ok(Vec::new());
    }
    let metadata = fs::symlink_metadata(&root)
        .map_err(|error| format!("Could not inspect performance receipt directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Performance receipt directory is not a contained local directory".to_string());
    }

    let mut records = Vec::new();
    let entries = fs::read_dir(&root)
        .map_err(|error| format!("Could not list performance receipts: {error}"))?;
    for (entry_index, entry) in entries.flatten().enumerate() {
        if entry_index >= MAX_HISTORY_ENTRIES_SCANNED {
            break;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let Some(lab_id) = entry.file_name().to_str().map(ToOwned::to_owned) else {
            continue;
        };
        if validate_lab_id(&lab_id).is_err() {
            continue;
        }
        let receipt_path = entry.path().join("receipt.json");
        let Ok(receipt_metadata) = fs::symlink_metadata(&receipt_path) else {
            continue;
        };
        if receipt_metadata.file_type().is_symlink()
            || !receipt_metadata.is_file()
            || receipt_metadata.len() > MAX_RECEIPT_BYTES
        {
            continue;
        }
        let Ok(bytes) = fs::read(&receipt_path) else {
            continue;
        };
        let Ok(receipt) = serde_json::from_slice::<Value>(&bytes) else {
            continue;
        };
        if validate_receipt(&receipt, &lab_id).is_err() {
            continue;
        }
        if let Ok(record) = record_from_receipt(&lab_id, receipt) {
            records.push(record);
        }
    }
    records.sort_by(|left, right| right.recorded_at.cmp(&left.recorded_at));
    records.truncate(MAX_HISTORY_RECEIPTS);
    Ok(records)
}

fn record_from_receipt(lab_id: &str, receipt: Value) -> Result<PerformanceLabRecord, String> {
    validate_receipt(&receipt, lab_id)?;
    let recorded_at = receipt
        .pointer("/lifecycle/completed_at")
        .or_else(|| receipt.pointer("/lifecycle/started_at"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    Ok(PerformanceLabRecord {
        lab_id: lab_id.to_string(),
        receipt_path: format!(".codevetter/performance-labs/{lab_id}/receipt.json"),
        recorded_at,
        receipt,
    })
}

fn validate_receipt(receipt: &Value, lab_id: &str) -> Result<(), String> {
    if receipt.get("schema_version").and_then(Value::as_str) != Some(PERFORMANCE_LAB_SCHEMA_VERSION)
        || receipt.get("lab_id").and_then(Value::as_str) != Some(lab_id)
    {
        return Err("The local performance receipt identity is invalid".to_string());
    }

    let state = receipt
        .get("state")
        .and_then(Value::as_str)
        .filter(|state| matches!(*state, "running" | "completed" | "stopped" | "failed"))
        .ok_or_else(|| "The local performance receipt state is invalid".to_string())?;
    if !receipt.get("subject").is_some_and(Value::is_object) {
        return Err("The local performance receipt subject is invalid".to_string());
    }

    let policy = receipt
        .get("policy")
        .and_then(Value::as_object)
        .ok_or_else(|| "The local performance receipt policy is invalid".to_string())?;
    let max_steps = policy.get("max_steps").and_then(Value::as_u64);
    let warmups = policy.get("warmups").and_then(Value::as_u64);
    let timeout_ms = policy.get("timeout_ms").and_then(Value::as_u64);
    if !max_steps.is_some_and(|value| (1..=8).contains(&value))
        || policy.get("samples").and_then(Value::as_u64) != Some(10)
        || warmups.is_none()
        || !timeout_ms.is_some_and(|value| (100..=120_000).contains(&value))
    {
        return Err("The local performance receipt policy is invalid".to_string());
    }

    let lifecycle = receipt
        .get("lifecycle")
        .and_then(Value::as_object)
        .ok_or_else(|| "The local performance receipt lifecycle is invalid".to_string())?;
    if lifecycle
        .get("started_at")
        .and_then(Value::as_str)
        .is_none()
        || (state == "running" && !lifecycle.get("completed_at").is_some_and(Value::is_null))
        || (state != "running"
            && lifecycle
                .get("completed_at")
                .and_then(Value::as_str)
                .is_none())
    {
        return Err("The local performance receipt lifecycle is invalid".to_string());
    }

    for summary in ["initial_summary", "final_summary"] {
        if !receipt
            .get(summary)
            .is_some_and(|value| value.is_null() || value.is_object())
        {
            return Err(format!(
                "The local performance receipt {summary} is invalid"
            ));
        }
    }

    let steps = receipt
        .get("steps")
        .and_then(Value::as_array)
        .filter(|steps| steps.len() <= 8)
        .ok_or_else(|| "The local performance receipt steps are invalid".to_string())?;
    for (index, step) in steps.iter().enumerate() {
        let step = step
            .as_object()
            .ok_or_else(|| "The local performance receipt step is invalid".to_string())?;
        if step.get("index").and_then(Value::as_u64) != Some((index + 1) as u64)
            || step.get("action").and_then(Value::as_str).is_none()
            || step
                .get("coverage_action")
                .and_then(Value::as_str)
                .is_none()
            || step.get("result").and_then(Value::as_str).is_none()
        {
            return Err("The local performance receipt step is invalid".to_string());
        }
    }

    let limitations = receipt
        .get("limitations")
        .and_then(Value::as_array)
        .filter(|items| items.len() <= MAX_RECEIPT_LIMITATIONS)
        .ok_or_else(|| "The local performance receipt limitations are invalid".to_string())?;
    if limitations.iter().any(|item| {
        item.as_str()
            .is_none_or(|text| text.is_empty() || text.chars().count() > 1_000)
    }) {
        return Err("The local performance receipt limitations are invalid".to_string());
    }

    let stop = receipt.get("stop");
    if (state == "running" && !stop.is_some_and(Value::is_null))
        || (state != "running"
            && !stop.is_some_and(|value| {
                value.get("kind").and_then(Value::as_str).is_some()
                    && value.get("reason").and_then(Value::as_str).is_some()
            }))
    {
        return Err("The local performance receipt stop reason is invalid".to_string());
    }
    Ok(())
}

fn validate_lab_id(value: &str) -> Result<(), String> {
    let mut characters = value.chars();
    let valid_first = characters
        .next()
        .is_some_and(|character| character.is_ascii_lowercase() || character.is_ascii_digit());
    if value.is_empty()
        || value.len() > 64
        || !valid_first
        || !value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
    {
        return Err("labId must use at most 64 lowercase letters, digits, and hyphens".to_string());
    }
    Ok(())
}

fn bounded_message(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control() || *character == '\n' || *character == '\t')
        .take(2_000)
        .collect::<String>()
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn lab_id_validation_is_closed_and_bounded() {
        assert!(validate_lab_id("anime-local-1").is_ok());
        for invalid in ["", "Uppercase", "-leading", "with/slash", &"a".repeat(65)] {
            assert!(validate_lab_id(invalid).is_err(), "accepted {invalid}");
        }
    }

    #[test]
    fn receipt_history_skips_invalid_and_orders_newest_first() {
        let repository = tempfile::tempdir().expect("temporary repository");
        let root = repository.path().join(".codevetter/performance-labs");
        for (lab_id, completed_at) in [
            ("older", "2026-08-13T10:00:00Z"),
            ("newer", "2026-08-14T10:00:00Z"),
        ] {
            let directory = root.join(lab_id);
            fs::create_dir_all(&directory).expect("receipt directory");
            let receipt = serde_json::json!({
                "schema_version": PERFORMANCE_LAB_SCHEMA_VERSION,
                "lab_id": lab_id,
                "state": "stopped",
                "subject": { "repository_revision": null, "source_snapshot_sha256": null, "dirty": null },
                "policy": { "max_steps": 8, "samples": 10, "warmups": 1, "timeout_ms": 30_000 },
                "lifecycle": { "started_at": completed_at, "completed_at": completed_at },
                "initial_summary": {},
                "final_summary": {},
                "steps": [],
                "stop": { "kind": "search_exhausted", "reason": "No candidate remained." },
                "limitations": ["Local evidence only."]
            });
            fs::write(
                directory.join("receipt.json"),
                serde_json::to_vec(&receipt).expect("receipt JSON"),
            )
            .expect("write receipt");
        }
        fs::create_dir_all(root.join("invalid")).expect("invalid directory");
        fs::write(root.join("invalid/receipt.json"), b"not-json").expect("invalid receipt");

        let records = read_performance_lab_receipts(repository.path()).expect("receipt history");
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].lab_id, "newer");
        assert_eq!(records[1].lab_id, "older");
    }
}
