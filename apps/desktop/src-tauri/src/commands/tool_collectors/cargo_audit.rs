use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::process::Command;

use super::{
    elapsed_ms, error_result, error_result_with_tool, execute_bounded, resolve_rust_manifest,
    safe_diagnostic, safe_text, sha256_file, tool_identity, CollectorKind, CollectorResult,
    CollectorStatus, ProductBinary, MAX_REPORT_BYTES, MAX_STDERR_BYTES,
};

const DATABASE_FILE_LIMIT: usize = 5_000;
const DATABASE_BYTE_LIMIT: u64 = 64 * 1024 * 1024;
const BUNDLED_DATABASE_COMMIT: &str = "5a0ebedfe8bdd2e295b171f4162f8c977bcad9a5";
const BUNDLED_DATABASE_ARCHIVE_SHA256: &str =
    "b139452940da08da4428041130c80a30303a8b838901da7ab764972dc8350fe0";
const BUNDLED_DATABASE_TREE_SHA256: &str =
    "902b61e08debfdd10f65807dfebc5d5603daf14879562189ff9033de758036e7";

#[derive(Debug, Serialize)]
struct AuditFinding {
    advisory_id: String,
    kind: String,
    package: String,
    version: String,
    title: String,
    url: String,
    patched_versions: Vec<String>,
}

#[derive(Debug)]
struct DatabaseIdentity {
    path: PathBuf,
    source: &'static str,
    sha256: String,
    file_count: usize,
    bytes: u64,
}

pub(super) async fn run(
    binary: &ProductBinary,
    repo: &Path,
    requested_manifest: Option<&Path>,
    requested_database: Option<&Path>,
    started: Instant,
) -> CollectorResult {
    let identity = match tool_identity(CollectorKind::CargoAudit, binary).await {
        Ok(identity) => identity,
        Err(error) => return error_result(CollectorKind::CargoAudit, started, error),
    };
    let manifest = match resolve_rust_manifest(repo, requested_manifest) {
        Ok(manifest) => manifest,
        Err(reason) => {
            return unavailable_with_tool(started, identity, reason);
        }
    };
    let lockfile = manifest
        .parent()
        .expect("manifest parent")
        .join("Cargo.lock");
    if !lockfile.is_file() {
        return unavailable_with_tool(
            started,
            identity,
            format!(
                "Cargo.lock is unavailable beside {}",
                manifest.strip_prefix(repo).unwrap_or(&manifest).display()
            ),
        );
    }
    let database = match resolve_database(requested_database) {
        Ok(database) => database,
        Err(reason) => return unavailable_with_tool(started, identity, reason),
    };

    let mut command = Command::new(&binary.path);
    command
        .args(["audit", "--no-fetch", "--json", "--color", "never", "--db"])
        .arg(&database.path)
        .arg("--file")
        .arg(&lockfile)
        .current_dir(manifest.parent().expect("manifest parent"))
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin")
        .env("NO_COLOR", "1")
        .env("CARGO_NET_OFFLINE", "true")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = match execute_bounded(
        command,
        Duration::from_secs(120),
        MAX_REPORT_BYTES,
        MAX_STDERR_BYTES,
    )
    .await
    {
        Ok(output) => output,
        Err(error) => {
            return error_result_with_tool(
                CollectorKind::CargoAudit,
                started,
                identity.clone(),
                error,
            )
        }
    };
    if !matches!(output.code, 0 | 1) {
        return error_result_with_tool(
            CollectorKind::CargoAudit,
            started,
            identity.clone(),
            format!(
                "cargo-audit exited with {}: {}",
                output.code,
                safe_diagnostic(&output.stderr)
            ),
        );
    }
    let findings = match parse_report(&output.stdout) {
        Ok(findings) => findings,
        Err(error) => {
            return error_result_with_tool(CollectorKind::CargoAudit, started, identity, error)
        }
    };
    let status = if findings.is_empty() {
        CollectorStatus::Clean
    } else {
        CollectorStatus::Findings
    };
    CollectorResult {
        collector: CollectorKind::CargoAudit,
        status,
        duration_ms: elapsed_ms(started),
        tool: Some(identity),
        finding_count: findings.len(),
        evidence: json!({
            "lockfile": {
                "path": lockfile.strip_prefix(repo).unwrap_or(&lockfile).to_string_lossy(),
                "sha256": sha256_file(&lockfile).unwrap_or_else(|_| "unavailable".into()),
            },
            "database": {
                "source": database.source,
                "sha256": database.sha256,
                "file_count": database.file_count,
                "bytes": database.bytes,
            },
            "network_policy": "--no-fetch plus CARGO_NET_OFFLINE=true",
            "process_exit_code": output.code,
            "findings": findings,
        }),
        limitations: Vec::new(),
    }
}

fn unavailable_with_tool(
    started: Instant,
    identity: super::CollectorToolIdentity,
    reason: String,
) -> CollectorResult {
    CollectorResult {
        collector: CollectorKind::CargoAudit,
        status: CollectorStatus::Unavailable,
        duration_ms: elapsed_ms(started),
        tool: Some(identity),
        finding_count: 0,
        evidence: json!({"preflight": "unavailable"}),
        limitations: vec![reason],
    }
}

fn resolve_database(requested: Option<&Path>) -> Result<DatabaseIdentity, String> {
    let (candidate, source) = match requested {
        Some(path) => (path.to_path_buf(), "explicit_operator_input_unpinned"),
        None => {
            let executable = std::env::current_exe()
                .map_err(|_| "The bundled RustSec advisory database is unavailable".to_string())?;
            let contents = executable.parent().and_then(Path::parent).ok_or_else(|| {
                "The bundled RustSec advisory database is unavailable".to_string()
            })?;
            (
                contents.join("Resources/rustsec-advisory-db/snapshot"),
                "application_bundle_resource",
            )
        }
    };
    let path = candidate.canonicalize().map_err(|_| {
        "A pinned local RustSec advisory database is required; no fetch is performed".to_string()
    })?;
    if !path.is_dir() || !path.join("crates").is_dir() {
        return Err("The selected RustSec advisory database is incomplete".into());
    }
    let (sha256, file_count, bytes) = hash_database(&path)?;
    if source == "application_bundle_resource" {
        validate_bundled_database(&path, &sha256)?;
    }
    Ok(DatabaseIdentity {
        path,
        source,
        sha256,
        file_count,
        bytes,
    })
}

fn validate_bundled_database(root: &Path, tree_sha256: &str) -> Result<(), String> {
    validate_database_identity(
        root,
        tree_sha256,
        BUNDLED_DATABASE_TREE_SHA256,
        BUNDLED_DATABASE_COMMIT,
        BUNDLED_DATABASE_ARCHIVE_SHA256,
    )
}

fn validate_database_identity(
    root: &Path,
    tree_sha256: &str,
    expected_tree_sha256: &str,
    expected_commit: &str,
    expected_archive_sha256: &str,
) -> Result<(), String> {
    if tree_sha256 != expected_tree_sha256 {
        return Err("The bundled RustSec advisory database tree identity does not match the pinned snapshot".into());
    }
    let identity: Value = serde_json::from_slice(
        &std::fs::read(root.join("CODEVETTER_DB_IDENTITY.json"))
            .map_err(|_| "The bundled RustSec advisory database identity is missing")?,
    )
    .map_err(|_| "The bundled RustSec advisory database identity is malformed")?;
    if identity.get("commit").and_then(Value::as_str) != Some(expected_commit)
        || identity.get("sha256").and_then(Value::as_str) != Some(expected_archive_sha256)
    {
        return Err(
            "The bundled RustSec advisory database metadata does not match the pinned snapshot"
                .into(),
        );
    }
    Ok(())
}

fn hash_database(root: &Path) -> Result<(String, usize, u64), String> {
    let mut files = Vec::new();
    collect_files(root, root, &mut files)?;
    files.sort();
    if files.len() > DATABASE_FILE_LIMIT {
        return Err("The RustSec advisory database exceeds the file-count bound".into());
    }
    let mut digest = Sha256::new();
    let mut total = 0_u64;
    for relative in &files {
        let contents = std::fs::read(root.join(relative))
            .map_err(|error| format!("Read RustSec advisory database: {error}"))?;
        total = total.saturating_add(contents.len() as u64);
        if total > DATABASE_BYTE_LIMIT {
            return Err("The RustSec advisory database exceeds the byte bound".into());
        }
        digest.update(relative.to_string_lossy().as_bytes());
        digest.update([0]);
        digest.update(&contents);
    }
    Ok((format!("{:x}", digest.finalize()), files.len(), total))
}

fn collect_files(root: &Path, directory: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in std::fs::read_dir(directory)
        .map_err(|error| format!("Read RustSec advisory database: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Read RustSec advisory database: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Inspect RustSec advisory database: {error}"))?;
        if file_type.is_symlink() {
            return Err("The RustSec advisory database must not contain symlinks".into());
        }
        if file_type.is_dir() {
            if entry.file_name() != ".git" {
                collect_files(root, &entry.path(), files)?;
            }
        } else if file_type.is_file() {
            files.push(
                entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|_| "RustSec database path escaped its root")?
                    .to_path_buf(),
            );
        }
    }
    Ok(())
}

fn parse_report(bytes: &[u8]) -> Result<Vec<AuditFinding>, String> {
    let report: Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("parse cargo-audit report: {error}"))?;
    let mut findings = Vec::new();
    if let Some(items) = report
        .pointer("/vulnerabilities/list")
        .and_then(Value::as_array)
    {
        for item in items {
            findings.push(normalize_finding(item, "vulnerability")?);
        }
    }
    if let Some(warnings) = report.get("warnings").and_then(Value::as_object) {
        for (kind, items) in warnings {
            let Some(items) = items.as_array() else {
                return Err("cargo-audit returned malformed warning evidence".into());
            };
            for item in items {
                findings.push(normalize_finding(item, kind)?);
            }
        }
    }
    findings.sort_by(|left, right| {
        (&left.package, &left.version, &left.advisory_id).cmp(&(
            &right.package,
            &right.version,
            &right.advisory_id,
        ))
    });
    Ok(findings)
}

fn normalize_finding(item: &Value, kind: &str) -> Result<AuditFinding, String> {
    let required = |pointer: &str, label: &str| {
        item.pointer(pointer)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(|value| safe_text(value, 240))
            .ok_or_else(|| format!("cargo-audit finding omitted {label}"))
    };
    let patched_versions = item
        .pointer("/versions/patched")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|value| safe_text(value, 80))
        .take(20)
        .collect();
    let warning_id = format!("cargo-audit-warning:{kind}");
    let warning_title = match kind {
        "yanked" => "Package version has been yanked from the registry".to_string(),
        _ => format!("cargo-audit {kind} warning"),
    };
    let advisory_id = item
        .pointer("/advisory/id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(|value| safe_text(value, 240))
        .unwrap_or(warning_id);
    let title = item
        .pointer("/advisory/title")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(|value| safe_text(value, 240))
        .unwrap_or(warning_title);
    Ok(AuditFinding {
        advisory_id,
        kind: safe_text(kind, 40),
        package: required("/package/name", "package name")?,
        version: required("/package/version", "package version")?,
        title,
        url: item
            .pointer("/advisory/url")
            .and_then(Value::as_str)
            .map(|value| safe_text(value, 500))
            .unwrap_or_default(),
        patched_versions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_normalization_keeps_identity_and_drops_raw_advisory_text() {
        let raw = br#"{
          "vulnerabilities":{"list":[{
            "advisory":{"id":"RUSTSEC-2099-0001","title":"fixture flaw","description":"raw text must not survive","url":"https://example.invalid/advisory"},
            "package":{"name":"fixture","version":"1.2.3","source":"private source detail"},
            "versions":{"patched":[">=1.2.4"]}
          }]},
          "warnings":{"unmaintained":[{
            "advisory":{"id":"RUSTSEC-2099-0002","title":"fixture stale","description":"drop me"},
            "package":{"name":"old-fixture","version":"0.1.0"},
            "versions":{"patched":[]}
          }],"unsound":[],"yanked":[{
            "kind":"yanked",
            "package":{"name":"withdrawn-fixture","version":"9.9.9"},
            "advisory":null,
            "versions":null
          }]}
        }"#;
        let findings = parse_report(raw).expect("report");
        assert_eq!(findings.len(), 3);
        assert_eq!(findings[0].advisory_id, "RUSTSEC-2099-0001");
        assert_eq!(findings[1].kind, "unmaintained");
        assert_eq!(findings[2].advisory_id, "cargo-audit-warning:yanked");
        assert_eq!(findings[2].package, "withdrawn-fixture");
        let serialized = serde_json::to_string(&findings).expect("serialize");
        assert!(!serialized.contains("raw text"));
        assert!(!serialized.contains("private source"));
    }

    #[test]
    fn database_identity_is_deterministic_and_rejects_symlinks() {
        let database = tempfile::tempdir().expect("database");
        std::fs::create_dir(database.path().join("crates")).expect("crates");
        std::fs::write(
            database.path().join("crates/fixture.toml"),
            "id='fixture'\n",
        )
        .expect("advisory");
        let identity = hash_database(database.path()).unwrap();
        assert_eq!(identity, hash_database(database.path()).unwrap());
        assert_eq!(
            identity.0,
            "0d0f9df93274d31a49a4c819d75a33eeb790589021e388626f141c57d92528a3"
        );

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                database.path().join("crates/fixture.toml"),
                database.path().join("crates/link.toml"),
            )
            .expect("symlink");
            assert!(hash_database(database.path()).is_err());
        }
    }

    #[test]
    fn bundled_database_metadata_must_match_the_pinned_source() {
        let database = tempfile::tempdir().expect("database");
        std::fs::create_dir(database.path().join("crates")).expect("crates");
        std::fs::write(
            database.path().join("crates/fixture.toml"),
            "id='fixture'\n",
        )
        .expect("advisory");
        let write_identity = |commit: &str| {
            std::fs::write(
                database.path().join("CODEVETTER_DB_IDENTITY.json"),
                serde_json::to_vec(&json!({
                    "commit": commit,
                    "sha256": "a".repeat(64),
                }))
                .expect("identity json"),
            )
            .expect("identity");
        };
        write_identity("b".repeat(40).as_str());
        let (tree_sha256, _, _) = hash_database(database.path()).expect("database hash");
        validate_database_identity(
            database.path(),
            &tree_sha256,
            &tree_sha256,
            &"b".repeat(40),
            &"a".repeat(64),
        )
        .expect("matching identity");

        write_identity("c".repeat(40).as_str());
        let (changed_tree_sha256, _, _) = hash_database(database.path()).expect("changed hash");
        assert!(validate_database_identity(
            database.path(),
            &changed_tree_sha256,
            &changed_tree_sha256,
            &"b".repeat(40),
            &"a".repeat(64),
        )
        .is_err());
    }
}
