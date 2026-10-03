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
        "safe": {"path": "src/main.rs"},
        "raw_prompt": "private instructions",
        "content_hash": "raw-content-hash-marker",
        "reviewer": "person@example.com",
        "freshness": {
            "human_review_decisions_present": true,
            "human_review_decisions_stale": true,
            "human_review_stale_reasons": ["repository_revision_changed"]
        },
        "nested": {"value": "/Users/private/project/source.cbl"}
    }))
    .expect("sanitize");
    assert!(value.get("repo_path").is_none());
    assert_eq!(value["sources"][0]["path"], OMITTED);
    assert_eq!(value["sources"][0]["summary"], OMITTED);
    assert_eq!(value["sources"][1]["path"], OMITTED);
    assert_eq!(value["safe"]["path"], "src/main.rs");
    assert!(value.get("raw_prompt").is_none());
    assert!(value.get("content_hash").is_none());
    assert_eq!(value["reviewer"], OMITTED);
    assert_eq!(value["freshness"]["human_review_decisions_present"], true);
    assert_eq!(value["freshness"]["human_review_decisions_stale"], true);
    assert_eq!(
        value["freshness"]["human_review_stale_reasons"][0],
        "repository_revision_changed"
    );
    assert_eq!(value["nested"]["value"], OMITTED);
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
    let value = sanitize_response(json!({"label": "a".repeat(MAX_EXCERPT_BYTES + 1)}))
        .expect("truncate label");
    assert!(value["label"].as_str().expect("label").len() <= MAX_EXCERPT_BYTES);

    let oversized = json!({
        "items": (0..(MAX_RESPONSE_BYTES / 4))
            .map(|index| format!("safe-{index}"))
            .collect::<Vec<_>>()
    });
    assert!(sanitize_response(oversized).is_err());
}

#[test]
fn redacts_absolute_paths_embedded_in_text() {
    let value = sanitize_response(json!({
        "unix": "Build failed at /Users/alice/project/src/main.rs:12",
        "windows": r"Build failed at C:\Users\alice\project\src\main.rs:12",
        "relative": "Build failed at src/main.rs:12"
    }))
    .expect("sanitize embedded paths");
    assert_eq!(value["unix"], OMITTED);
    assert_eq!(value["windows"], OMITTED);
    assert_eq!(value["relative"], "Build failed at src/main.rs:12");
}

#[test]
fn invocation_command_exception_is_path_schema_provenance_and_enum_bound() {
    let event = json!({"source_schema_version":"codevetter.skill-invocation/v1",
        "command_provenance":"invocation_metadata", "command":"scope",
        "nested":{"command":"scope"}, "repo_path":"/private/repo"});
    let envelope = json!({"command":"scope", "data":{"operation":"invocation_list",
        "data":{"schema_version":"codevetter.invocation-events/v1", "invocations":[event]}}});
    let sanitized = sanitize_invocation_response(envelope.clone()).unwrap();
    assert_eq!(
        sanitized["data"]["data"]["invocations"][0]["command"],
        "scope"
    );
    assert!(sanitized.get("command").is_none());
    assert!(sanitized["data"]["data"]["invocations"][0]["nested"]
        .get("command")
        .is_none());
    assert!(sanitized["data"]["data"]["invocations"][0]
        .get("repo_path")
        .is_none());
    assert!(
        sanitize_response(envelope.clone()).unwrap()["data"]["data"]["invocations"][0]
            .get("command")
            .is_none()
    );
    for (pointer, invalid) in [
        ("/data/operation", json!("other")),
        ("/data/data/schema_version", json!("other")),
        (
            "/data/data/invocations/0/source_schema_version",
            json!("other"),
        ),
        (
            "/data/data/invocations/0/command_provenance",
            json!("untrusted"),
        ),
        (
            "/data/data/invocations/0/command",
            json!("scope --raw PRIVATE_SENTINEL"),
        ),
    ] {
        let mut value = envelope.clone();
        *value.pointer_mut(pointer).unwrap() = invalid;
        let sanitized = sanitize_invocation_response(value).unwrap();
        assert!(
            sanitized["data"]["data"]["invocations"][0]
                .get("command")
                .is_none(),
            "{pointer}"
        );
    }
}
