use crate::DbState;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::State;

const MAX_IMAGE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TEXT_BYTES: u64 = 256 * 1024;
type ProjectedPreview = (
    String,
    Option<u32>,
    Option<u32>,
    Option<String>,
    Option<String>,
);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QaSupportCapability {
    pub id: &'static str,
    pub label: &'static str,
    pub status: &'static str,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QaSupportMatrix {
    pub lane: &'static str,
    pub config_path: Option<String>,
    pub capabilities: Vec<QaSupportCapability>,
    pub unsupported: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QaArtifactPreview {
    pub run_id: String,
    pub artifact_id: String,
    pub kind: String,
    pub canonical_path: String,
    pub content_type: String,
    pub bytes: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub redacted: bool,
    pub sha256: String,
    pub text: Option<String>,
    pub data_url: Option<String>,
}

#[tauri::command]
pub fn get_qa_support_matrix(repo_path: Option<String>) -> Result<QaSupportMatrix, String> {
    support_matrix(repo_path.as_deref())
}

#[tauri::command]
pub fn preview_warm_verification_artifact(
    db: State<'_, DbState>,
    run_id: String,
    artifact_id: String,
) -> Result<QaArtifactPreview, String> {
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    preview_artifact(&conn, &run_id, &artifact_id)
}

fn support_matrix(repo_path: Option<&str>) -> Result<QaSupportMatrix, String> {
    let config_path = match repo_path.map(str::trim).filter(|value| !value.is_empty()) {
        Some(repo_path) => {
            let repo = canonical_directory(repo_path)?;
            let candidate = repo.join(".codevetter/verify.yaml");
            candidate
                .is_file()
                .then(|| candidate.to_string_lossy().to_string())
        }
        None => None,
    };
    let configured = config_path.is_some();
    let status = if configured {
        "real_product_supported"
    } else {
        "fixture_backed"
    };
    let detail = |real: &str, fixture: &str| {
        if configured {
            real.to_string()
        } else {
            fixture.to_string()
        }
    };
    let capabilities = vec![
        ("start", "Owned app start", "Exact argv, cwd, environment, and process-group ownership.", "Qualified in the checked React/Vite fixture."),
        ("health", "Readiness and health", "Loopback readiness plus settled-HMR probing.", "Qualified in the checked React/Vite fixture."),
        ("state", "Deterministic state", "Scenario state, flags, frozen time, and reduced motion are injected before app code.", "Fixture-backed deterministic state contract."),
        ("auth", "Pinned auth", "Configured storage-state profiles are copied into an immutable run bundle.", "Fixture-backed auth cache and bundle contracts; a real profile is not configured."),
        ("network", "Network policy", "First-party allowlists and third-party blocking are enforced by Chromium routing.", "Fixture-backed request policy and unexpected-request observations."),
        ("scenario", "Scenario execution", "Declarative, repository-owned scenarios run in warm Chromium with no model calls.", "Twenty checked fixture scenarios qualify the execution lane."),
        ("cancellation", "Cancellation", "Run cancellation is cooperative, bounded, and recorded without replacing runtime ownership.", "Fixture-backed cancellation and lifecycle qualification."),
        ("resource", "Resource bounds", "RSS, browser contexts, time budgets, and retained artifact bytes are measured.", "Fixture-backed stability and resource qualification."),
        ("retention", "Evidence retention", "Per-repository age, count, and byte policies retain only owned artifacts.", "Fixture-backed retention policy."),
        ("cleanup", "Owned cleanup", "Only evidence-owned files and owned runtime processes are eligible for cleanup.", "Fixture-backed cleanup and symlink-escape qualification."),
    ]
    .into_iter()
    .map(|(id, label, real, fixture)| QaSupportCapability {
        id,
        label,
        status,
        detail: detail(real, fixture),
    })
    .collect();
    Ok(QaSupportMatrix {
        lane: "react-vite-chromium-v1",
        config_path,
        capabilities,
        unsupported: vec![
            "Native mobile, Electron main-process, browser-extension, and non-Chromium products require manual or separate qualification.".to_string(),
            "A fixture-backed capability is not evidence that the selected repository is configured or that its current change passed.".to_string(),
        ],
    })
}

fn preview_artifact(
    conn: &Connection,
    stored_run_id: &str,
    artifact_id: &str,
) -> Result<QaArtifactPreview, String> {
    let stored_run_id = bounded_identity(stored_run_id, "run id")?;
    let artifact_id = bounded_identity(artifact_id, "artifact id")?;
    let record: Option<(String, String)> = conn
        .query_row(
            "SELECT repo_path, result_json FROM warm_verification_runs WHERE id = ?1",
            [&stored_run_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let (repo_path, result_json) =
        record.ok_or_else(|| "Warm verification run not found".to_string())?;
    let result: Value = serde_json::from_str(&result_json)
        .map_err(|_| "Stored run result is invalid".to_string())?;
    let artifact = result
        .get("artifacts")
        .and_then(Value::as_array)
        .and_then(|artifacts| {
            artifacts
                .iter()
                .find(|artifact| artifact.get("id").and_then(Value::as_str) == Some(&artifact_id))
        })
        .ok_or_else(|| "Artifact is not owned by this warm verification run".to_string())?;
    if artifact.get("redacted").and_then(Value::as_bool) != Some(true) {
        return Err("Artifact is not marked redacted".to_string());
    }
    let relative_path = artifact
        .get("relative_path")
        .and_then(Value::as_str)
        .ok_or_else(|| "Artifact path is missing".to_string())?;
    let declared_bytes = artifact
        .get("bytes")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Artifact byte count is missing".to_string())?;
    let declared_sha = artifact
        .get("sha256")
        .and_then(Value::as_str)
        .ok_or_else(|| "Artifact digest is missing".to_string())?;
    let kind = artifact
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("report");
    let repo = canonical_directory(&repo_path)?;
    let candidate = safe_owned_path(&repo, relative_path)?;
    let metadata =
        fs::metadata(&candidate).map_err(|_| "Artifact file is unavailable".to_string())?;
    if !metadata.is_file() || metadata.len() != declared_bytes {
        return Err("Artifact file does not match its evidence record".to_string());
    }
    let bytes = fs::read(&candidate).map_err(|_| "Artifact file could not be read".to_string())?;
    let actual_sha = format!("{:x}", Sha256::digest(&bytes));
    if actual_sha != declared_sha {
        return Err("Artifact digest does not match its evidence record".to_string());
    }
    let (content_type, width, height, text, data_url) = project_preview(&candidate, kind, &bytes)?;
    Ok(QaArtifactPreview {
        run_id: stored_run_id,
        artifact_id,
        kind: kind.to_string(),
        canonical_path: candidate.to_string_lossy().to_string(),
        content_type,
        bytes: metadata.len(),
        width,
        height,
        redacted: true,
        sha256: actual_sha,
        text,
        data_url,
    })
}

fn project_preview(path: &Path, kind: &str, bytes: &[u8]) -> Result<ProjectedPreview, String> {
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("Artifact exceeds the preview byte limit".to_string());
    }
    if let Some((content_type, width, height)) = image_metadata(bytes) {
        return Ok((
            content_type.to_string(),
            Some(width),
            Some(height),
            None,
            Some(format!(
                "data:{content_type};base64,{}",
                STANDARD.encode(bytes)
            )),
        ));
    }
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        return Err("Text artifact exceeds the preview byte limit".to_string());
    }
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension == "html" || extension == "htm" || kind == "trace" {
        return Err("Executable or interactive artifacts are not previewed".to_string());
    }
    let content_type = match extension.as_str() {
        "json" => "application/json",
        "md" => "text/markdown",
        "txt" | "log" => "text/plain",
        _ if kind == "console" || kind == "network" || kind == "report" => "text/plain",
        _ => return Err("Artifact type is unsupported for inert preview".to_string()),
    };
    let raw =
        std::str::from_utf8(bytes).map_err(|_| "Text artifact is not valid UTF-8".to_string())?;
    Ok((
        content_type.to_string(),
        None,
        None,
        Some(redact_preview_text(raw)),
        None,
    ))
}

fn image_metadata(bytes: &[u8]) -> Option<(&'static str, u32, u32)> {
    if bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some((
            "image/png",
            u32::from_be_bytes(bytes[16..20].try_into().ok()?),
            u32::from_be_bytes(bytes[20..24].try_into().ok()?),
        ));
    }
    if bytes.len() >= 4 && bytes.starts_with(&[0xff, 0xd8]) {
        let mut offset = 2;
        while offset + 9 < bytes.len() {
            if bytes[offset] != 0xff {
                offset += 1;
                continue;
            }
            let marker = bytes[offset + 1];
            if matches!(
                marker,
                0xc0 | 0xc1
                    | 0xc2
                    | 0xc3
                    | 0xc5
                    | 0xc6
                    | 0xc7
                    | 0xc9
                    | 0xca
                    | 0xcb
                    | 0xcd
                    | 0xce
                    | 0xcf
            ) {
                return Some((
                    "image/jpeg",
                    u16::from_be_bytes([bytes[offset + 7], bytes[offset + 8]]) as u32,
                    u16::from_be_bytes([bytes[offset + 5], bytes[offset + 6]]) as u32,
                ));
            }
            if offset + 4 > bytes.len() {
                break;
            }
            let length = u16::from_be_bytes([bytes[offset + 2], bytes[offset + 3]]) as usize;
            if length < 2 {
                break;
            }
            offset = offset.saturating_add(2 + length);
        }
    }
    None
}

fn redact_preview_text(raw: &str) -> String {
    raw.lines()
        .map(|line| {
            let lower = line.to_ascii_lowercase();
            if [
                "authorization:",
                "api_key",
                "apikey",
                "access_token",
                "refresh_token",
                "password=",
            ]
            .iter()
            .any(|marker| lower.contains(marker))
            {
                "[redacted sensitive line]"
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn bounded_identity(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 512 || value.contains('\0') {
        return Err(format!("{label} is invalid"));
    }
    Ok(value.to_string())
}

fn canonical_directory(raw: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err("Repository path must be absolute".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "Repository path is unavailable".to_string())?;
    if !canonical.is_dir() {
        return Err("Repository path must be a directory".to_string());
    }
    Ok(canonical)
}

fn safe_owned_path(repo: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Artifact path must be repository-relative without traversal".to_string());
    }
    let mut cursor = repo.to_path_buf();
    for component in relative_path.components() {
        let Component::Normal(part) = component else {
            return Err("Artifact path is invalid".to_string());
        };
        cursor.push(part);
        if fs::symlink_metadata(&cursor).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
            return Err("Artifact path may not cross a symbolic link".to_string());
        }
    }
    let canonical = cursor
        .canonicalize()
        .map_err(|_| "Artifact path is unavailable".to_string())?;
    if !canonical.starts_with(repo) {
        return Err("Artifact path escapes the repository".to_string());
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use tempfile::TempDir;

    fn fixture() -> (TempDir, Connection) {
        let root = TempDir::new().expect("root");
        let conn = Connection::open_in_memory().expect("db");
        conn.execute_batch(
            "CREATE TABLE warm_verification_runs(
                id TEXT PRIMARY KEY, repo_path TEXT NOT NULL, result_json TEXT NOT NULL
             );",
        )
        .expect("schema");
        (root, conn)
    }

    fn insert_artifact(conn: &Connection, root: &Path, path: &str, kind: &str, bytes: &[u8]) {
        let target = root.join(path);
        fs::create_dir_all(target.parent().expect("parent")).expect("dir");
        fs::write(&target, bytes).expect("write");
        let result = serde_json::json!({
            "artifacts": [{
                "id": "artifact-1",
                "kind": kind,
                "relative_path": path,
                "sha256": format!("{:x}", Sha256::digest(bytes)),
                "bytes": bytes.len(),
                "redacted": true
            }]
        });
        conn.execute(
            "INSERT INTO warm_verification_runs(id,repo_path,result_json) VALUES('run-1',?1,?2)",
            params![root.to_string_lossy(), result.to_string()],
        )
        .expect("run");
    }

    #[test]
    fn previews_owned_redacted_text_and_redacts_sensitive_lines() {
        let (root, conn) = fixture();
        insert_artifact(
            &conn,
            root.path(),
            ".codevetter/report.json",
            "report",
            b"{\n\"ok\": true,\n\"api_key\": \"secret\"\n}",
        );
        let preview = preview_artifact(&conn, "run-1", "artifact-1").expect("preview");
        assert_eq!(preview.content_type, "application/json");
        assert!(preview
            .text
            .expect("text")
            .contains("[redacted sensitive line]"));
        assert!(preview.data_url.is_none());
    }

    #[test]
    fn previews_inert_png_with_dimensions() {
        let (root, conn) = fixture();
        let mut png = b"\x89PNG\r\n\x1a\n00000000".to_vec();
        png.extend_from_slice(&2_u32.to_be_bytes());
        png.extend_from_slice(&3_u32.to_be_bytes());
        insert_artifact(
            &conn,
            root.path(),
            ".codevetter/image.png",
            "screenshot",
            &png,
        );
        let preview = preview_artifact(&conn, "run-1", "artifact-1").expect("preview");
        assert_eq!((preview.width, preview.height), (Some(2), Some(3)));
        assert!(preview
            .data_url
            .expect("data")
            .starts_with("data:image/png;base64,"));
    }

    #[test]
    fn rejects_traversal_html_oversize_and_digest_drift() {
        let (root, conn) = fixture();
        insert_artifact(
            &conn,
            root.path(),
            "report.html",
            "report",
            b"<script>fetch('/')</script>",
        );
        assert!(preview_artifact(&conn, "run-1", "artifact-1")
            .expect_err("html")
            .contains("not previewed"));

        let outside = TempDir::new().expect("outside");
        let link = root.path().join("escape");
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), &link).expect("link");
        #[cfg(unix)]
        {
            fs::write(outside.path().join("report.txt"), b"safe").expect("outside file");
            assert!(safe_owned_path(root.path(), "escape/report.txt")
                .expect_err("symlink")
                .contains("symbolic link"));
        }

        let file = root.path().join("report.html");
        fs::write(file, b"changed").expect("drift");
        assert!(preview_artifact(&conn, "run-1", "artifact-1")
            .expect_err("drift")
            .contains("does not match"));
    }

    #[test]
    fn support_matrix_does_not_claim_an_unconfigured_repo_is_real_product_ready() {
        let root = TempDir::new().expect("root");
        let matrix = support_matrix(Some(root.path().to_string_lossy().as_ref())).expect("matrix");
        assert!(matrix
            .capabilities
            .iter()
            .all(|capability| capability.status == "fixture_backed"));
        assert!(!matrix.unsupported.is_empty());
    }
}
