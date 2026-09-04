use serde_json::{json, Value};

/// Check whether prerequisite CLI tools are installed and authenticated.
///
/// - `claude_code`: true if `claude` is on PATH
/// - `github_cli`: true if `gh auth status` succeeds (authenticated)
/// - `codex`: true if `codex` is on PATH
#[tauri::command]
pub async fn check_prerequisites() -> Result<Value, String> {
    let claude = std::process::Command::new("which")
        .arg("claude")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let gh = std::process::Command::new("gh")
        .arg("auth")
        .arg("status")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let codex = std::process::Command::new("which")
        .arg("codex")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    Ok(json!({
        "claude_code": claude,
        "github_cli": gh,
        "codex": codex,
    }))
}
