use crate::{
    commands::secret_policy::{contains_sensitive_path, looks_like_secret},
    mcp::limits::{MAX_EXCERPT_BYTES, MAX_RESPONSE_BYTES},
};
use serde_json::{Map, Value};

const OMITTED: &str = "[redacted]";

pub fn sanitize_response(mut value: Value) -> Result<Value, String> {
    sanitize_value(None, &mut value);
    let bytes =
        serde_json::to_vec(&value).map_err(|error| format!("Serialize MCP response: {error}"))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(format!(
            "MCP response exceeds the {} byte limit; narrow the request",
            MAX_RESPONSE_BYTES
        ));
    }
    Ok(value)
}

fn sanitize_value(key: Option<&str>, value: &mut Value) {
    match value {
        Value::Object(map) => sanitize_map(map),
        Value::Array(values) => {
            for value in values {
                sanitize_value(key, value);
            }
        }
        Value::String(text) => {
            if (key.is_some_and(is_sensitive_reference_key) && contains_sensitive_path(text))
                || looks_like_secret(text)
            {
                *text = OMITTED.to_string();
            } else if key.is_some_and(is_excerpt_key) && text.len() > MAX_EXCERPT_BYTES {
                *text = truncate_utf8_bytes(text, MAX_EXCERPT_BYTES).to_string();
            }
        }
        _ => {}
    }
}

fn truncate_utf8_bytes(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

fn sanitize_map(map: &mut Map<String, Value>) {
    for key in ["repo_path", "repository_path", "database_path", "command"] {
        map.remove(key);
    }
    for (key, value) in map.iter_mut() {
        sanitize_value(Some(key), value);
    }
}

fn is_sensitive_reference_key(key: &str) -> bool {
    matches!(
        key,
        "path" | "old_path" | "source_path" | "file" | "filename" | "label" | "detail"
    )
}

fn is_excerpt_key(key: &str) -> bool {
    matches!(key, "summary" | "detail" | "excerpt" | "text" | "subject")
}

pub fn sanitize_error_message(message: &str, repo_path: &str) -> String {
    if contains_sensitive_path(message) || looks_like_secret(message) {
        return "Requested content is unavailable under CodeVetter redaction policy".to_string();
    }
    message.replace(repo_path, "[repository]")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn removes_local_scope_and_sensitive_content() {
        let value = sanitize_response(json!({
            "repo_path": "/private/repo",
            "sources": [{"path": ".env", "summary": "sk-proj-secret"}],
            "safe": {"path": "src/main.rs"}
        }))
        .expect("sanitize");
        assert!(value.get("repo_path").is_none());
        assert_eq!(value["sources"][0]["path"], OMITTED);
        assert_eq!(value["sources"][0]["summary"], OMITTED);
        assert_eq!(value["safe"]["path"], "src/main.rs");
        assert_eq!(
            sanitize_error_message("Could not read .env in /private/repo", "/private/repo"),
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
}
