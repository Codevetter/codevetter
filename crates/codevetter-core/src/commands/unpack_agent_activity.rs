//! Parse live CLI agent streams into human-readable unpack progress activities.

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct UnpackAgentActivity {
    pub kind: String,
    pub label: String,
    pub detail: Option<String>,
}

pub fn emit_unpack_agent_activity(
    app: &AppHandle,
    stream_id: &str,
    repo_path: &str,
    activity: &UnpackAgentActivity,
) {
    let _ = app.emit(
        "unpack-agent-activity",
        serde_json::json!({
            "stream_id": stream_id,
            "repo_path": repo_path,
            "kind": activity.kind,
            "label": activity.label,
            "detail": activity.detail,
        }),
    );
}

pub fn agent_uses_stream_json(agent: &str) -> bool {
    matches!(agent, "claude" | "command-code" | "codex" | "grok")
}

pub fn ingest_agent_stream_line(
    agent: &str,
    line: &str,
    assembled: &mut String,
) -> Vec<UnpackAgentActivity> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    match agent {
        "claude" | "command-code" => ingest_claude_stream_line(trimmed, assembled),
        "codex" => ingest_codex_stream_line(trimmed, assembled),
        "grok" => ingest_grok_stream_line(trimmed, assembled),
        _ => ingest_plain_stream_line(trimmed, assembled),
    }
}

pub fn finalize_assembled_output(agent: &str, raw: &str, assembled: &str) -> String {
    if !assembled.trim().is_empty() {
        return assembled.to_string();
    }
    let mut rebuilt = String::new();
    for line in raw.lines() {
        match agent {
            "claude" | "command-code" => append_claude_text_line(line.trim(), &mut rebuilt),
            "codex" => append_codex_text_line(line.trim(), &mut rebuilt),
            "grok" => append_grok_text_line(line.trim(), &mut rebuilt),
            _ => {}
        }
    }
    if !rebuilt.trim().is_empty() {
        rebuilt
    } else {
        raw.to_string()
    }
}

fn ingest_claude_stream_line(line: &str, assembled: &mut String) -> Vec<UnpackAgentActivity> {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return heuristic_plaintext_activities(line);
    };

    let mut activities = Vec::new();
    match value.get("type").and_then(Value::as_str) {
        Some("system") => {
            if value.get("subtype").and_then(Value::as_str) == Some("init") {
                activities.push(UnpackAgentActivity {
                    kind: "status".into(),
                    label: "Agent started".into(),
                    detail: Some("Investigating the repository with file tools".into()),
                });
            }
        }
        Some("assistant") => {
            append_claude_text_line(line, assembled);
            activities.extend(tool_activities_from_content(
                value
                    .pointer("/message/content")
                    .or_else(|| value.get("content")),
            ));
        }
        Some("content_block_delta") => {
            if let Some(text) = value.pointer("/delta/text").and_then(Value::as_str) {
                assembled.push_str(text);
                if text.contains('{') || text.len() > 24 {
                    activities.push(UnpackAgentActivity {
                        kind: "write".into(),
                        label: "Drafting response".into(),
                        detail: None,
                    });
                }
            }
        }
        Some("content_block_start") => {
            if value.pointer("/content_block/type").and_then(Value::as_str) == Some("tool_use") {
                let name = value
                    .pointer("/content_block/name")
                    .and_then(Value::as_str)
                    .unwrap_or("tool");
                activities.push(activity_from_tool_name(name, &Value::Null));
            }
        }
        Some("tool_use") | Some("tool_call") => {
            let name = value.get("name").and_then(Value::as_str).unwrap_or("tool");
            let input = value.get("input").unwrap_or(&Value::Null);
            activities.push(activity_from_tool_name(name, input));
        }
        Some("result") => {
            activities.push(UnpackAgentActivity {
                kind: "status".into(),
                label: "Finishing up".into(),
                detail: None,
            });
        }
        _ => {}
    }
    activities
}

fn ingest_codex_stream_line(line: &str, assembled: &mut String) -> Vec<UnpackAgentActivity> {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return heuristic_plaintext_activities(line);
    };

    let mut activities = Vec::new();
    let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
    if event_type == "item.completed"
        && value.pointer("/item/type").and_then(Value::as_str) == Some("agent_message")
    {
        if let Some(text) = value.pointer("/item/text").and_then(Value::as_str) {
            assembled.push_str(text);
            activities.push(UnpackAgentActivity {
                kind: "write".into(),
                label: "Drafting response".into(),
                detail: None,
            });
        }
    } else if event_type.contains("tool") || value.get("tool_name").is_some() {
        let name = value
            .get("tool_name")
            .or_else(|| value.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("tool");
        let input = value
            .get("input")
            .or_else(|| value.get("arguments"))
            .unwrap_or(&Value::Null);
        activities.push(activity_from_tool_name(name, input));
    }
    activities
}

fn ingest_grok_stream_line(line: &str, assembled: &mut String) -> Vec<UnpackAgentActivity> {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return heuristic_plaintext_activities(line);
    };

    match value.get("type").and_then(Value::as_str) {
        Some("text") => {
            if let Some(text) = value.get("data").and_then(Value::as_str) {
                assembled.push_str(text);
                return vec![UnpackAgentActivity {
                    kind: "write".into(),
                    label: "Drafting response".into(),
                    detail: None,
                }];
            }
        }
        Some("thought") => {
            return vec![UnpackAgentActivity {
                kind: "plan".into(),
                label: "Reasoning through task".into(),
                detail: None,
            }];
        }
        Some("error") => {
            return vec![UnpackAgentActivity {
                kind: "status".into(),
                label: "Grok reported an error".into(),
                detail: value
                    .get("message")
                    .and_then(Value::as_str)
                    .map(|message| truncate_label(message, 120)),
            }];
        }
        Some("end") => {
            return vec![UnpackAgentActivity {
                kind: "status".into(),
                label: "Finishing up".into(),
                detail: None,
            }];
        }
        _ => {}
    }

    Vec::new()
}

fn ingest_plain_stream_line(line: &str, assembled: &mut String) -> Vec<UnpackAgentActivity> {
    assembled.push_str(line);
    assembled.push('\n');
    heuristic_plaintext_activities(line)
}

fn append_claude_text_line(line: &str, assembled: &mut String) {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return;
    };
    match value.get("type").and_then(Value::as_str) {
        Some("assistant") => {
            if let Some(content) = value.pointer("/message/content").and_then(Value::as_array) {
                for block in content {
                    if block.get("type").and_then(Value::as_str) == Some("text") {
                        if let Some(text) = block.get("text").and_then(Value::as_str) {
                            assembled.push_str(text);
                        }
                    }
                }
            }
        }
        Some("content_block_delta") => {
            if let Some(text) = value.pointer("/delta/text").and_then(Value::as_str) {
                assembled.push_str(text);
            }
        }
        _ => {}
    }
}

fn append_codex_text_line(line: &str, assembled: &mut String) {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return;
    };
    if value.get("type").and_then(Value::as_str) == Some("item.completed")
        && value.pointer("/item/type").and_then(Value::as_str) == Some("agent_message")
    {
        if let Some(text) = value.pointer("/item/text").and_then(Value::as_str) {
            assembled.push_str(text);
        }
    }
}

fn append_grok_text_line(line: &str, assembled: &mut String) {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return;
    };
    if value.get("type").and_then(Value::as_str) == Some("text") {
        if let Some(text) = value.get("data").and_then(Value::as_str) {
            assembled.push_str(text);
        }
    }
}

fn tool_activities_from_content(content: Option<&Value>) -> Vec<UnpackAgentActivity> {
    let Some(items) = content.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut activities = Vec::new();
    for item in items {
        if item.get("type").and_then(Value::as_str) != Some("tool_use") {
            continue;
        }
        let name = item.get("name").and_then(Value::as_str).unwrap_or("tool");
        let input = item.get("input").unwrap_or(&Value::Null);
        activities.push(activity_from_tool_name(name, input));
    }
    activities
}

fn activity_from_tool_name(name: &str, input: &Value) -> UnpackAgentActivity {
    let normalized = name.trim().to_lowercase();
    match normalized.as_str() {
        "read" => {
            let path = path_from_tool_input(input).unwrap_or_else(|| "file".to_string());
            UnpackAgentActivity {
                kind: "read".into(),
                label: format!("Reading {path}"),
                detail: None,
            }
        }
        "grep" | "search" => {
            let pattern = string_field(input, &["pattern", "query", "search", "regex"])
                .unwrap_or_else(|| "pattern".to_string());
            let path = string_field(input, &["path", "file_path", "filePath"]);
            UnpackAgentActivity {
                kind: "search".into(),
                label: format!("Searching for `{pattern}`"),
                detail: path,
            }
        }
        "glob" | "glob_file_search" => {
            let pattern = string_field(input, &["pattern", "glob", "query"])
                .unwrap_or_else(|| "*".to_string());
            UnpackAgentActivity {
                kind: "glob".into(),
                label: format!("Finding files: {pattern}"),
                detail: None,
            }
        }
        "bash" | "shell" | "run_terminal_cmd" | "terminal" => {
            let command =
                command_from_tool_input(input).unwrap_or_else(|| "shell command".to_string());
            UnpackAgentActivity {
                kind: "run".into(),
                label: "Running command".into(),
                detail: Some(command),
            }
        }
        "write" | "edit" | "multiedit" | "notebookedit" | "str_replace" => {
            let path = path_from_tool_input(input).unwrap_or_else(|| "file".to_string());
            UnpackAgentActivity {
                kind: "edit".into(),
                label: format!("Editing {path}"),
                detail: None,
            }
        }
        "list" | "list_dir" | "ls" => {
            let path = path_from_tool_input(input).unwrap_or_else(|| ".".to_string());
            UnpackAgentActivity {
                kind: "list".into(),
                label: format!("Listing {path}"),
                detail: None,
            }
        }
        "webfetch" | "websearch" => {
            let target =
                string_field(input, &["url", "query"]).unwrap_or_else(|| "web".to_string());
            UnpackAgentActivity {
                kind: "web".into(),
                label: format!("Checking {target}"),
                detail: None,
            }
        }
        "task" => UnpackAgentActivity {
            kind: "delegate".into(),
            label: "Delegating sub-task".into(),
            detail: string_field(input, &["description", "prompt"]),
        },
        "todowrite" | "todo_write" => UnpackAgentActivity {
            kind: "plan".into(),
            label: "Planning next steps".into(),
            detail: None,
        },
        _ => UnpackAgentActivity {
            kind: "tool".into(),
            label: format!("Using {name}"),
            detail: path_from_tool_input(input).or_else(|| command_from_tool_input(input)),
        },
    }
}

fn heuristic_plaintext_activities(line: &str) -> Vec<UnpackAgentActivity> {
    let lower = line.to_lowercase();
    let mut activities = Vec::new();
    if lower.contains("reading ") || lower.contains("read file") {
        activities.push(UnpackAgentActivity {
            kind: "read".into(),
            label: truncate_label(line, 96),
            detail: None,
        });
    } else if lower.contains("searching") || lower.contains("grep") {
        activities.push(UnpackAgentActivity {
            kind: "search".into(),
            label: truncate_label(line, 96),
            detail: None,
        });
    }
    activities
}

fn path_from_tool_input(input: &Value) -> Option<String> {
    string_field(
        input,
        &[
            "file_path",
            "filePath",
            "path",
            "target_file",
            "file",
            "notebook_path",
            "directory",
            "dir",
        ],
    )
}

fn command_from_tool_input(input: &Value) -> Option<String> {
    string_field(input, &["command", "cmd", "shell", "script"]).map(|s| truncate_label(&s, 140))
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(text) = value.get(*key).and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn truncate_label(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max {
        trimmed.to_string()
    } else {
        format!("{}…", trimmed.chars().take(max).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_claude_read_tool_use() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"src/main.rs"}}]}}"#;
        let mut assembled = String::new();
        let acts = ingest_claude_stream_line(line, &mut assembled);
        assert_eq!(acts.len(), 1);
        assert_eq!(acts[0].kind, "read");
        assert!(acts[0].label.contains("src/main.rs"));
    }

    #[test]
    fn parses_claude_grep_tool_use() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"auth","path":"src"}}]}}"#;
        let mut assembled = String::new();
        let acts = ingest_claude_stream_line(line, &mut assembled);
        assert_eq!(acts[0].kind, "search");
        assert!(acts[0].label.contains("auth"));
    }

    #[test]
    fn assembles_claude_text_blocks() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"{\"ok\":true}"}]}}"#;
        let mut assembled = String::new();
        ingest_claude_stream_line(line, &mut assembled);
        assert!(assembled.contains("ok"));
    }

    #[test]
    fn assembles_grok_streaming_json_text_chunks() {
        let mut assembled = String::new();

        let acts = ingest_grok_stream_line(r#"{"type":"text","data":"Hello"}"#, &mut assembled);
        ingest_grok_stream_line(r#"{"type":"text","data":" world"}"#, &mut assembled);

        assert_eq!(assembled, "Hello world");
        assert_eq!(acts[0].kind, "write");
    }
}
