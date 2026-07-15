use super::*;
use serde_json::json;

#[test]
fn removes_local_scope_and_sensitive_content() {
    let value = sanitize_response(json!({
        "repo_path": "/private/repo",
        "sources": [
            {"path": ".env", "summary": "sk-proj-secret"},
            {"path": "/Users/private/project/src/main.rs", "summary": "safe"}
        ],
        "safe": {"path": "src/main.rs"}
    }))
    .expect("sanitize");
    assert!(value.get("repo_path").is_none());
    assert_eq!(value["sources"][0]["path"], OMITTED);
    assert_eq!(value["sources"][0]["summary"], OMITTED);
    assert_eq!(value["sources"][1]["path"], OMITTED);
    assert_eq!(value["safe"]["path"], "src/main.rs");
    assert_eq!(
        sanitize_error_message("Could not read .env in /private/repo", "/private/repo"),
        "Requested content is unavailable under CodeVetter redaction policy"
    );
    assert_eq!(
        sanitize_error_message(
            "Open failed at /Users/private/project/file.rs",
            "/private/repo"
        ),
        "Requested content is unavailable under CodeVetter redaction policy"
    );
}

#[test]
fn enforces_excerpt_and_total_response_byte_limits() {
    let multibyte = "🦀".repeat(MAX_EXCERPT_BYTES);
    let value = sanitize_response(json!({"excerpt": multibyte})).expect("truncate excerpt");
    assert!(value["excerpt"].as_str().expect("excerpt").len() <= MAX_EXCERPT_BYTES);

    let oversized = json!({
        "items": (0..(MAX_RESPONSE_BYTES / 4))
            .map(|index| format!("safe-{index}"))
            .collect::<Vec<_>>()
    });
    assert!(sanitize_response(oversized).is_err());
}
