#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RawSessionAdapterSummary {
    pub adapter_id: String,
    pub agent_type: String,
    pub stable_id: Option<String>,
    pub source_ref: String,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    pub cli_version: Option<String>,
    pub model_used: Option<String>,
    pub first_timestamp: Option<String>,
    pub last_timestamp: Option<String>,
    pub message_count: i64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_creation_tokens: i64,
    pub compaction_count: i64,
    pub slug: Option<String>,
    pub day_counts: BTreeMap<String, i64>,
    pub archive_messages: Vec<RawSessionArchiveMessage>,
    pub parse_warnings: Vec<String>,
    /// True when the token fields are a SESSION-CUMULATIVE total (legacy Codex
    /// logs only expose `total_token_usage`), false when they are per-call
    /// deltas to be summed (Claude and current Codex `last_token_usage`). The
    /// incremental indexer must SET cumulative totals but ADD deltas.
    #[serde(default)]
    pub tokens_are_cumulative: bool,
    /// Per-model breakdown of the token fields above, keyed by model id.
    /// Claude sessions can span multiple models (mid-session /model switches,
    /// subagent turns), so session-level `model_used` (last model wins)
    /// misattributes cost. Empty for adapters whose transcripts don't carry a
    /// per-message model; consumers fall back to `model_used` when empty.
    #[serde(default)]
    pub model_usage: BTreeMap<String, ModelTokenUsage>,
    /// Usage-dedup key ("message.id:requestId") of the last counted message.
    /// Claude writes one JSONL line per content block, each repeating the same
    /// final usage object; the parser counts usage once per key and this field
    /// lets the next incremental read continue the dedup across the boundary.
    #[serde(default)]
    pub last_usage_key: Option<String>,
    /// Content-free, timestamped Codex token evidence. Other adapters leave
    /// this empty. `source_line` is relative to the parsed chunk; the indexer
    /// adds the persisted line cursor before storage.
    #[serde(default)]
    pub codex_usage_observations: Vec<CodexUsageObservation>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodexTokenTotals {
    pub input: i64,
    pub cached: i64,
    pub output: i64,
    pub reasoning: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodexUsageObservation {
    pub source_line: i64,
    pub timestamp: Option<String>,
    pub day: Option<String>,
    pub model: String,
    pub input_tokens: i64,
    pub cache_read_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_tokens: i64,
    pub total: Option<CodexTokenTotals>,
    pub disposition: String,
}

impl CodexUsageObservation {
    fn zero() -> Self {
        Self {
            source_line: 0,
            timestamp: None,
            day: None,
            model: "unknown".into(),
            input_tokens: 0,
            cache_read_tokens: 0,
            output_tokens: 0,
            reasoning_tokens: 0,
            total: None,
            disposition: "unsupported".into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
struct CodexAccountingState {
    session_id: Option<String>,
    current_model: Option<String>,
    last_total: Option<CodexTokenTotals>,
    watermark: Option<CodexTokenTotals>,
    counted: Option<CodexTokenTotals>,
    seen_totals: Vec<CodexTokenTotals>,
    interleaved: bool,
    fork_direct: bool,
    fork_pending_replay: bool,
    fork_baseline: Option<CodexTokenTotals>,
    fork_prefix_total: Option<CodexTokenTotals>,
}

pub fn codex_state_with_fork_baseline(baseline: CodexTokenTotals) -> Option<String> {
    serde_json::to_string(&CodexAccountingState {
        fork_direct: true,
        fork_baseline: Some(baseline),
        ..CodexAccountingState::default()
    })
    .ok()
}

/// Token usage attributed to one model within a session. Same semantics as the
/// session totals: `input_tokens` includes cache read + cache creation tokens.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ModelTokenUsage {
    pub message_count: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_creation_tokens: i64,
    /// Portion of `cache_creation_tokens` billed at Anthropic's 1-hour cache
    /// write tier (2x input price) rather than the default 5-minute tier
    /// (~1.25x input price). Claude's `usage.cache_creation` object splits
    /// `ephemeral_1h_input_tokens` / `ephemeral_5m_input_tokens`; other
    /// providers never populate this, so it stays 0 for them.
    pub cache_creation_1h_tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RawSessionArchiveMessage {
    pub source_line: Option<i64>,
    pub role: Option<String>,
    pub kind: String,
    pub timestamp: Option<String>,
    pub content_text: Option<String>,
    pub tool_name: Option<String>,
    pub tool_call_id: Option<String>,
    pub raw_type: Option<String>,
}

pub trait SessionSourceAdapter {
    fn adapter_id(&self) -> &'static str;
    fn agent_type(&self) -> &'static str;
    fn parse_raw(&self, source_ref: &str, raw: &str) -> RawSessionAdapterSummary;
    /// Parse with cross-read state. `prior_usage_key` is the usage-dedup key of
    /// the last message counted by the previous incremental read, so a duplicate
    /// group split across reads is still counted once. Adapters without
    /// duplicate usage lines ignore it.
    fn parse_raw_with_state(
        &self,
        source_ref: &str,
        raw: &str,
        _prior_usage_key: Option<&str>,
    ) -> RawSessionAdapterSummary {
        self.parse_raw(source_ref, raw)
    }
}

pub struct ClaudeCodeAdapter;
pub struct CodexAdapter;
pub struct CursorAdapter;

/// Forked/subagent Codex rollouts can begin with a replay of the parent's
/// token-count history. Codex rewrites those copied events to the fork's
/// creation second; the first real child event advances to a later second.
///
/// This is the same observable boundary used by ccusage and CodexBar. Requiring
/// both an ancestry marker and two usage events in the same second avoids
/// suppressing ordinary sessions that happen to emit one quick token update.
fn codex_replay_second(raw: &str) -> Option<String> {
    if !raw.contains("thread_spawn") && !raw.contains("forked_from_id") {
        return None;
    }

    let mut first_second: Option<String> = None;
    for line in raw.lines() {
        let parsed: Value = match serde_json::from_str(line.trim()) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };
        if parsed.get("type").and_then(Value::as_str) != Some("event_msg") {
            continue;
        }
        let Some(payload) = parsed.get("payload") else {
            continue;
        };
        if payload.get("type").and_then(Value::as_str) != Some("token_count") {
            continue;
        }
        let info = payload.get("info");
        if info
            .and_then(|value| value.get("last_token_usage"))
            .is_none()
            && info
                .and_then(|value| value.get("total_token_usage"))
                .is_none()
        {
            continue;
        }
        let Some(second) = parsed
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(|timestamp| timestamp.get(..19))
            .map(str::to_string)
        else {
            continue;
        };
        match first_second {
            None => first_second = Some(second),
            Some(first) if first == second => return Some(first),
            Some(_) => return None,
        }
    }
    None
}

fn codex_has_replayed_parent_meta(raw: &str) -> bool {
    let mut first_id: Option<String> = None;
    for line in raw.lines() {
        let Ok(parsed) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if parsed.get("type").and_then(Value::as_str) != Some("session_meta") {
            continue;
        }
        let Some(id) = parsed
            .get("payload")
            .and_then(|payload| payload.get("id"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        match first_id.as_deref() {
            None => first_id = Some(id.to_string()),
            Some(first) if first != id => return true,
            Some(_) => {}
        }
    }
    false
}

fn empty_summary(adapter_id: &str, agent_type: &str, source_ref: &str) -> RawSessionAdapterSummary {
    RawSessionAdapterSummary {
        adapter_id: adapter_id.to_string(),
        agent_type: agent_type.to_string(),
        stable_id: None,
        source_ref: source_ref.to_string(),
        cwd: None,
        git_branch: None,
        cli_version: None,
        model_used: None,
        first_timestamp: None,
        last_timestamp: None,
        message_count: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        compaction_count: 0,
        slug: None,
        day_counts: BTreeMap::new(),
        archive_messages: Vec::new(),
        parse_warnings: Vec::new(),
        tokens_are_cumulative: false,
        model_usage: BTreeMap::new(),
        last_usage_key: None,
        codex_usage_observations: Vec::new(),
    }
}

fn codex_totals(value: Option<&Value>) -> Option<CodexTokenTotals> {
    let value = value?;
    Some(CodexTokenTotals {
        input: value
            .get("input_tokens")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .max(0),
        cached: value
            .get("cached_input_tokens")
            .or_else(|| value.get("cache_read_input_tokens"))
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .max(0),
        output: value
            .get("output_tokens")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .max(0),
        reasoning: value
            .get("reasoning_output_tokens")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .max(0),
    })
}

fn codex_component_delta(
    current: &CodexTokenTotals,
    prior: Option<&CodexTokenTotals>,
) -> CodexTokenTotals {
    let prior = prior.cloned().unwrap_or_default();
    CodexTokenTotals {
        input: (current.input - prior.input).max(0),
        cached: (current.cached - prior.cached).max(0),
        output: (current.output - prior.output).max(0),
        reasoning: (current.reasoning - prior.reasoning).max(0),
    }
}

fn codex_contained_delta(
    watermark: Option<&CodexTokenTotals>,
    counted: Option<&CodexTokenTotals>,
    current: &CodexTokenTotals,
) -> CodexTokenTotals {
    let watermark = watermark.cloned().unwrap_or_default();
    let counted = counted.cloned().unwrap_or_default();
    let component = |water: i64, already_counted: i64, value: i64| {
        if value >= water {
            (value - water.max(already_counted)).max(0)
        } else {
            (value - already_counted).max(0)
        }
    };
    CodexTokenTotals {
        input: component(watermark.input, counted.input, current.input),
        cached: component(watermark.cached, counted.cached, current.cached),
        output: component(watermark.output, counted.output, current.output),
        reasoning: component(watermark.reasoning, counted.reasoning, current.reasoning),
    }
}

fn codex_add_totals(left: Option<&CodexTokenTotals>, right: &CodexTokenTotals) -> CodexTokenTotals {
    let left = left.cloned().unwrap_or_default();
    CodexTokenTotals {
        input: left.input + right.input,
        cached: left.cached + right.cached,
        output: left.output + right.output,
        reasoning: left.reasoning + right.reasoning,
    }
}

fn codex_subtract_totals(
    value: &CodexTokenTotals,
    baseline: &CodexTokenTotals,
) -> CodexTokenTotals {
    CodexTokenTotals {
        input: (value.input - baseline.input).max(0),
        cached: (value.cached - baseline.cached).max(0),
        output: (value.output - baseline.output).max(0),
        reasoning: (value.reasoning - baseline.reasoning).max(0),
    }
}

fn codex_totals_at_or_above(left: &CodexTokenTotals, right: &CodexTokenTotals) -> bool {
    left.input >= right.input
        && left.cached >= right.cached
        && left.output >= right.output
        && left.reasoning >= right.reasoning
}

fn codex_min_totals(left: &CodexTokenTotals, right: &CodexTokenTotals) -> CodexTokenTotals {
    CodexTokenTotals {
        input: left.input.min(right.input),
        cached: left.cached.min(right.cached),
        output: left.output.min(right.output),
        reasoning: left.reasoning.min(right.reasoning),
    }
}

fn codex_max_totals(left: Option<&CodexTokenTotals>, right: &CodexTokenTotals) -> CodexTokenTotals {
    let left = left.cloned().unwrap_or_default();
    CodexTokenTotals {
        input: left.input.max(right.input),
        cached: left.cached.max(right.cached),
        output: left.output.max(right.output),
        reasoning: left.reasoning.max(right.reasoning),
    }
}

fn codex_local_day(timestamp: Option<&str>) -> Option<String> {
    timestamp
        .and_then(|raw| chrono::DateTime::parse_from_rfc3339(raw).ok())
        .map(|value| {
            value
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d")
                .to_string()
        })
}

fn update_timestamp(summary: &mut RawSessionAdapterSummary, timestamp: Option<String>) {
    if summary.first_timestamp.is_none() {
        summary.first_timestamp = timestamp.clone();
    }
    if timestamp.is_some() {
        summary.last_timestamp = timestamp;
    }
}

fn record_day(summary: &mut RawSessionAdapterSummary, timestamp: Option<&str>) {
    if let Some(timestamp) = timestamp {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(timestamp) {
            let day = dt
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d")
                .to_string();
            *summary.day_counts.entry(day).or_insert(0) += 1;
        }
    }
}

fn value_string(value: Option<&Value>, key: &str) -> Option<String> {
    value?
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(String::from)
}

fn millis_to_rfc3339(value: Option<&Value>) -> Option<String> {
    value?
        .as_i64()
        .and_then(chrono::DateTime::from_timestamp_millis)
        .map(|dt| dt.to_rfc3339())
}

fn bounded_text(raw: impl Into<String>) -> Option<String> {
    let mut value = raw.into().trim().to_string();
    if value.is_empty() {
        return None;
    }
    const MAX_ARCHIVE_TEXT: usize = 12_000;
    if value.len() > MAX_ARCHIVE_TEXT {
        let truncate_at = value
            .char_indices()
            .map(|(idx, _)| idx)
            .take_while(|idx| *idx <= MAX_ARCHIVE_TEXT)
            .last()
            .unwrap_or(0);
        value.truncate(truncate_at);
        value.push_str("\n[truncated]");
    }
    Some(value)
}

fn value_text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(s) => bounded_text(s),
        Value::Null => None,
        other => bounded_text(other.to_string()),
    }
}

fn archive_message(
    summary: &mut RawSessionAdapterSummary,
    source_line: Option<i64>,
    role: Option<String>,
    kind: impl Into<String>,
    timestamp: Option<String>,
    content_text: Option<String>,
    tool_name: Option<String>,
    tool_call_id: Option<String>,
    raw_type: Option<String>,
) {
    summary.archive_messages.push(RawSessionArchiveMessage {
        source_line,
        role,
        kind: kind.into(),
        timestamp,
        content_text,
        tool_name,
        tool_call_id,
        raw_type,
    });
}

fn first_tool_use(blocks: &[Value]) -> Option<&Value> {
    blocks.iter().find(|block| {
        block
            .get("type")
            .and_then(|v| v.as_str())
            .is_some_and(|kind| kind == "tool_use" || kind == "tool_call")
    })
}

fn first_tool_result(blocks: &[Value]) -> Option<&Value> {
    blocks.iter().find(|block| {
        block
            .get("type")
            .and_then(|v| v.as_str())
            .is_some_and(|kind| kind == "tool_result")
    })
}

fn claude_archive_fields(
    message: Option<&Value>,
) -> (String, Option<String>, Option<String>, Option<String>) {
    let Some(message) = message else {
        return ("message".to_string(), None, None, None);
    };
    let Some(content) = message.get("content") else {
        return ("message".to_string(), None, None, None);
    };
    if let Some(text) = content.as_str() {
        return ("message".to_string(), bounded_text(text), None, None);
    }
    if let Some(blocks) = content.as_array() {
        if let Some(tool) = first_tool_use(blocks) {
            return (
                "tool_call".to_string(),
                value_text(tool.get("input")),
                value_string(Some(tool), "name"),
                value_string(Some(tool), "id").or_else(|| value_string(Some(tool), "tool_call_id")),
            );
        }
        if let Some(result) = first_tool_result(blocks) {
            return (
                "tool_result".to_string(),
                value_text(result.get("content")),
                None,
                value_string(Some(result), "tool_use_id"),
            );
        }
        let text = blocks
            .iter()
            .filter_map(|block| {
                if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                    block.get("text").and_then(|v| v.as_str())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        return ("message".to_string(), bounded_text(text), None, None);
    }
    ("message".to_string(), value_text(Some(content)), None, None)
}

fn codex_archive_fields(
    payload: Option<&Value>,
) -> (
    Option<String>,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let role = payload.and_then(|p| value_string(Some(p), "role"));
    let content = payload
        .and_then(|p| {
            p.get("content")
                .or_else(|| p.get("text"))
                .or_else(|| p.get("message"))
        })
        .and_then(|v| value_text(Some(v)));
    let tool_name = payload.and_then(|p| {
        value_string(Some(p), "name").or_else(|| {
            p.get("tool_calls")
                .or_else(|| p.get("toolCalls"))
                .and_then(|v| v.as_array())
                .and_then(|calls| calls.first())
                .and_then(|call| {
                    value_string(Some(call), "name").or_else(|| {
                        call.get("function")
                            .and_then(|function| value_string(Some(function), "name"))
                    })
                })
        })
    });
    let tool_call_id = payload.and_then(|p| {
        value_string(Some(p), "call_id")
            .or_else(|| value_string(Some(p), "id"))
            .or_else(|| value_string(Some(p), "tool_call_id"))
    });
    let kind = if tool_name.is_some() {
        "tool_call"
    } else if role.as_deref() == Some("tool") {
        "tool_result"
    } else {
        "message"
    };
    (role, kind.to_string(), content, tool_name, tool_call_id)
}

impl SessionSourceAdapter for ClaudeCodeAdapter {
    fn adapter_id(&self) -> &'static str {
        "claude-code"
    }

    fn agent_type(&self) -> &'static str {
        "claude-code"
    }

    fn parse_raw(&self, source_ref: &str, raw: &str) -> RawSessionAdapterSummary {
        self.parse_raw_with_state(source_ref, raw, None)
    }

    fn parse_raw_with_state(
        &self,
        source_ref: &str,
        raw: &str,
        prior_usage_key: Option<&str>,
    ) -> RawSessionAdapterSummary {
        let mut summary = empty_summary(self.adapter_id(), self.agent_type(), source_ref);
        // Subagent/sidechain transcripts (one file per Task sub-run, under
        // `<session>/subagents/`) carry the PARENT session's `sessionId`. Keyed
        // by that, every sidechain of a session collapses onto one DB row whose
        // path is the parent's — so the per-file path never matches on lookup and
        // the indexer full-reparses + DELETE/re-INSERTs their archive on EVERY
        // pass (profiled to ~95% of a core). Track it and key sidechains by their
        // own path below so each indexes once and is then skipped.
        let mut is_sidechain = false;
        // One API response = one usage object, but Claude Code writes a JSONL
        // line PER CONTENT BLOCK, each repeating that same final usage — 50%+
        // of usage lines in real transcripts are such repeats, and summing them
        // inflated all Claude token/cost numbers ~2.2×. Duplicate lines are
        // strictly adjacent among usage-bearing lines, so remembering the last
        // counted key is exact. Seeded from the previous incremental read: the
        // blocks of one message can be flushed up to ~40s apart, spanning reads.
        let mut last_usage_key: Option<String> = prior_usage_key.map(str::to_string);

        for (idx, line) in raw.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let parsed: Value = match serde_json::from_str(line) {
                Ok(value) => value,
                Err(_) => {
                    summary
                        .parse_warnings
                        .push(format!("line {} is not valid JSON", idx + 1));
                    continue;
                }
            };

            let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if matches!(
                msg_type,
                "progress"
                    | "file-history-snapshot"
                    | "queue-operation"
                    | "last-prompt"
                    | "permission-mode"
                    | "pr-link"
                    | "agent-name"
                    | "custom-title"
                    | "attachment"
            ) {
                continue;
            }

            if msg_type == "summary"
                || parsed
                    .get("autoCompact")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                || parsed
                    .get("isCompacted")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
            {
                summary.compaction_count += 1;
            }

            if parsed
                .get("isSidechain")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                is_sidechain = true;
            }
            if summary.stable_id.is_none() {
                summary.stable_id = value_string(Some(&parsed), "sessionId");
            }
            if summary.cli_version.is_none() {
                summary.cli_version = value_string(Some(&parsed), "version");
            }
            if summary.git_branch.is_none() {
                summary.git_branch = value_string(Some(&parsed), "gitBranch");
            }
            if summary.cwd.is_none() {
                summary.cwd = value_string(Some(&parsed), "cwd");
            }
            if let Some(slug) = value_string(Some(&parsed), "slug") {
                summary.slug = Some(slug);
            }

            let timestamp = value_string(Some(&parsed), "timestamp");
            record_day(&mut summary, timestamp.as_deref());
            update_timestamp(&mut summary, timestamp.clone());

            let message = parsed.get("message");
            let role = message.and_then(|m| value_string(Some(m), "role"));
            let (mut archive_kind, content_text, tool_name, tool_call_id) =
                claude_archive_fields(message);
            if msg_type == "summary" {
                archive_kind = "compaction".to_string();
            }
            archive_message(
                &mut summary,
                Some((idx + 1) as i64),
                role,
                archive_kind,
                timestamp,
                content_text,
                tool_name,
                tool_call_id,
                Some(msg_type.to_string()),
            );

            let usage = parsed
                .get("message")
                .and_then(|message| message.get("usage"));
            // Count each API response's usage once: repeated lines for the same
            // (message.id, requestId) carry byte-identical usage snapshots.
            // Lines without a message id are never treated as duplicates and
            // don't disturb the dedup key.
            let usage_key = parsed
                .get("message")
                .and_then(|message| message.get("id"))
                .and_then(|v| v.as_str())
                .map(|id| {
                    let request_id = parsed
                        .get("requestId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    format!("{id}:{request_id}")
                });
            let is_duplicate_usage = usage.is_some()
                && usage_key.is_some()
                && usage_key.as_deref() == last_usage_key.as_deref();
            if usage.is_some() {
                if let Some(key) = usage_key {
                    last_usage_key = Some(key);
                }
            }
            let usage = if is_duplicate_usage { None } else { usage };
            let input = usage
                .and_then(|u| u.get("input_tokens"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let cache_creation = usage
                .and_then(|u| u.get("cache_creation_input_tokens"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            // Claude also reports the 1h/5m split of cache-creation tokens
            // under a nested `cache_creation` object (1h cache writes bill at
            // 2x input price vs ~1.25x for 5m) — extract it so cost estimates
            // can price each tier correctly instead of assuming everything is
            // 5m.
            let cache_creation_1h = usage
                .and_then(|u| u.get("cache_creation"))
                .and_then(|c| c.get("ephemeral_1h_input_tokens"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let cache_read = usage
                .and_then(|u| u.get("cache_read_input_tokens"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let output = usage
                .and_then(|u| u.get("output_tokens"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            summary.total_input_tokens += input + cache_creation + cache_read;
            summary.total_output_tokens += output;
            summary.cache_read_tokens += cache_read;
            summary.cache_creation_tokens += cache_creation;

            // Attribute this message's tokens to its own model. `<synthetic>`
            // is Claude Code's marker for internal non-API messages, not a
            // billable model — bucket it (and missing models) under "unknown".
            if input + cache_creation + cache_read + output > 0 {
                let model_key = parsed
                    .get("message")
                    .and_then(|message| message.get("model"))
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty() && *s != "<synthetic>")
                    .unwrap_or("unknown");
                let entry = summary
                    .model_usage
                    .entry(model_key.to_string())
                    .or_default();
                entry.message_count += 1;
                entry.input_tokens += input + cache_creation + cache_read;
                entry.output_tokens += output;
                entry.cache_read_tokens += cache_read;
                entry.cache_creation_tokens += cache_creation;
                entry.cache_creation_1h_tokens += cache_creation_1h;
            }

            if let Some(model) = parsed
                .get("message")
                .and_then(|message| message.get("model"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
            {
                summary.model_used = Some(model.to_string());
            }

            summary.message_count += 1;
        }

        // Sidechains: replace the parent-shared sessionId with a path-unique id so
        // each subagent transcript is its own session row (found by path on the
        // next pass → skipped, not re-parsed). Deterministic, so re-indexing the
        // same file is stable.
        if is_sidechain {
            summary.stable_id = Some(format!("sidechain::{source_ref}"));
        }

        if summary.stable_id.is_none() {
            summary
                .parse_warnings
                .push("missing stable session id".to_string());
        }
        summary.last_usage_key = last_usage_key;
        summary
    }
}

impl SessionSourceAdapter for CodexAdapter {
    fn adapter_id(&self) -> &'static str {
        "codex"
    }

    fn agent_type(&self) -> &'static str {
        "codex"
    }

    fn parse_raw(&self, source_ref: &str, raw: &str) -> RawSessionAdapterSummary {
        self.parse_raw_with_state(source_ref, raw, None)
    }

    fn parse_raw_with_state(
        &self,
        source_ref: &str,
        raw: &str,
        prior_usage_key: Option<&str>,
    ) -> RawSessionAdapterSummary {
        let mut summary = empty_summary(self.adapter_id(), self.agent_type(), source_ref);
        let mut accounting_state = prior_usage_key
            .and_then(|raw| serde_json::from_str::<CodexAccountingState>(raw).ok())
            .unwrap_or_default();
        let has_replayed_parent_meta = codex_has_replayed_parent_meta(raw);
        summary.model_used = accounting_state.current_model.clone();
        let mut has_last_token_usage = false;
        let mut final_cumulative_usage: Option<(i64, i64, i64, i64)> = None;
        let mut response_input_tokens = 0;
        let mut response_output_tokens = 0;

        for (idx, line) in raw.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let parsed: Value = match serde_json::from_str(line) {
                Ok(value) => value,
                Err(_) => {
                    summary
                        .parse_warnings
                        .push(format!("line {} is not valid JSON", idx + 1));
                    continue;
                }
            };
            let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let payload = parsed.get("payload");

            if msg_type == "session_meta" {
                if let Some(payload) = payload {
                    let meta_id = value_string(Some(payload), "id");
                    if accounting_state.session_id.is_none() {
                        accounting_state.session_id = meta_id.clone();
                    } else if meta_id.as_deref() != accounting_state.session_id.as_deref()
                        && accounting_state.fork_baseline.is_none()
                    {
                        accounting_state.fork_direct = false;
                        accounting_state.fork_pending_replay = true;
                    }
                    // Replayed child logs can contain the parent's session_meta
                    // after the child's. Keep the first identity from the file.
                    if summary.stable_id.is_none() {
                        summary.stable_id = meta_id;
                    }
                    if summary.cwd.is_none() {
                        summary.cwd = value_string(Some(payload), "cwd");
                    }
                    if summary.cli_version.is_none() {
                        summary.cli_version = value_string(Some(payload), "cli_version");
                    }
                    if summary.slug.is_none() {
                        summary.slug = value_string(Some(payload), "title");
                    }
                    if summary.git_branch.is_none() {
                        summary.git_branch = payload
                            .get("git")
                            .and_then(|git| git.get("branch"))
                            .and_then(|v| v.as_str())
                            .map(String::from);
                    }
                    if summary.model_used.is_none() {
                        summary.model_used = value_string(Some(payload), "model").or_else(|| {
                            value_string(Some(payload), "model_provider").map(|provider| {
                                if provider == "openai" {
                                    "o3".to_string()
                                } else {
                                    provider
                                }
                            })
                        });
                    }
                    if payload
                        .get("forked_from_id")
                        .and_then(Value::as_str)
                        .is_some()
                    {
                        accounting_state.fork_direct = true;
                    }
                    if payload
                        .get("source")
                        .and_then(|source| source.get("subagent"))
                        .and_then(|subagent| subagent.get("thread_spawn"))
                        .and_then(|spawn| spawn.get("parent_thread_id"))
                        .and_then(Value::as_str)
                        .is_some()
                    {
                        if has_replayed_parent_meta && accounting_state.fork_baseline.is_none() {
                            accounting_state.fork_pending_replay = true;
                        } else {
                            accounting_state.fork_direct = true;
                        }
                    }
                }
                continue;
            }

            // Newer Codex CLIs dropped `model` from session_meta (it only has
            // model_provider, which the fallback above maps to the o3-era
            // default) and record the real model id on per-turn turn_context
            // rows instead. Last turn wins, overriding the fallback.
            if msg_type == "turn_context" {
                if let Some(model) = value_string(payload, "model") {
                    accounting_state.current_model = Some(model.clone());
                    summary.model_used = Some(model);
                }
                continue;
            }

            if msg_type == "event_msg" {
                let sub_type = payload
                    .and_then(|p| p.get("type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if sub_type == "token_count" {
                    let info = payload.and_then(|p| p.get("info"));
                    let timestamp = parsed
                        .get("timestamp")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    let raw_total =
                        codex_totals(info.and_then(|value| value.get("total_token_usage")));
                    let last = codex_totals(info.and_then(|value| value.get("last_token_usage")));

                    if accounting_state.fork_pending_replay {
                        if let Some(current) = raw_total.as_ref() {
                            let still_prefix = accounting_state
                                .fork_prefix_total
                                .as_ref()
                                .is_none_or(|prior| codex_totals_at_or_above(current, prior));
                            if still_prefix {
                                accounting_state.fork_prefix_total = Some(current.clone());
                                summary
                                    .codex_usage_observations
                                    .push(CodexUsageObservation {
                                        source_line: (idx + 1) as i64,
                                        timestamp: timestamp.clone(),
                                        day: codex_local_day(timestamp.as_deref()),
                                        model: summary
                                            .model_used
                                            .clone()
                                            .unwrap_or_else(|| "unknown".into()),
                                        total: raw_total,
                                        disposition: "inherited_replay".into(),
                                        ..CodexUsageObservation::zero()
                                    });
                                continue;
                            }
                            accounting_state.fork_pending_replay = false;
                            accounting_state.last_total = None;
                            accounting_state.watermark = None;
                            accounting_state.counted = None;
                            accounting_state.seen_totals.clear();
                            accounting_state.interleaved = false;
                        } else {
                            summary
                                .codex_usage_observations
                                .push(CodexUsageObservation {
                                    source_line: (idx + 1) as i64,
                                    timestamp: timestamp.clone(),
                                    day: codex_local_day(timestamp.as_deref()),
                                    model: summary
                                        .model_used
                                        .clone()
                                        .unwrap_or_else(|| "unknown".into()),
                                    total: None,
                                    disposition: "unresolved_fork".into(),
                                    ..CodexUsageObservation::zero()
                                });
                            continue;
                        }
                    }

                    if accounting_state.fork_direct && accounting_state.fork_baseline.is_none() {
                        match (raw_total.as_ref(), last.as_ref()) {
                            (Some(current), Some(last))
                                if codex_totals_at_or_above(current, last) =>
                            {
                                let baseline = codex_subtract_totals(current, last);
                                if baseline == CodexTokenTotals::default() {
                                    accounting_state.fork_direct = false;
                                    accounting_state.fork_pending_replay = true;
                                    accounting_state.fork_prefix_total = Some(current.clone());
                                    summary
                                        .codex_usage_observations
                                        .push(CodexUsageObservation {
                                            source_line: (idx + 1) as i64,
                                            timestamp: timestamp.clone(),
                                            day: codex_local_day(timestamp.as_deref()),
                                            model: summary
                                                .model_used
                                                .clone()
                                                .unwrap_or_else(|| "unknown".into()),
                                            total: raw_total,
                                            disposition: "inherited_replay".into(),
                                            ..CodexUsageObservation::zero()
                                        });
                                    continue;
                                }
                                accounting_state.fork_baseline = Some(baseline);
                            }
                            _ => {
                                summary
                                    .codex_usage_observations
                                    .push(CodexUsageObservation {
                                        source_line: (idx + 1) as i64,
                                        timestamp: timestamp.clone(),
                                        day: codex_local_day(timestamp.as_deref()),
                                        model: summary
                                            .model_used
                                            .clone()
                                            .unwrap_or_else(|| "unknown".into()),
                                        total: raw_total,
                                        disposition: "unresolved_fork".into(),
                                        ..CodexUsageObservation::zero()
                                    });
                                continue;
                            }
                        }
                    }
                    let total = raw_total.as_ref().map(|current| {
                        accounting_state
                            .fork_baseline
                            .as_ref()
                            .map(|baseline| codex_subtract_totals(current, baseline))
                            .unwrap_or_else(|| current.clone())
                    });

                    let duplicate = total.as_ref().is_some_and(|candidate| {
                        accounting_state
                            .seen_totals
                            .iter()
                            .any(|seen| seen == candidate)
                    });
                    let mut disposition = if duplicate { "duplicate" } else { "accepted" };
                    let delta = if duplicate {
                        CodexTokenTotals::default()
                    } else if let Some(current) = total.as_ref() {
                        if let Some(watermark) = accounting_state.watermark.as_ref() {
                            if current.input < watermark.input
                                || current.cached < watermark.cached
                                || current.output < watermark.output
                            {
                                accounting_state.interleaved = true;
                            }
                        }
                        let contained = if accounting_state.interleaved {
                            codex_contained_delta(
                                accounting_state.watermark.as_ref(),
                                accounting_state.counted.as_ref(),
                                current,
                            )
                        } else {
                            codex_component_delta(current, accounting_state.last_total.as_ref())
                        };
                        if accounting_state.fork_baseline.is_some() && !accounting_state.interleaved
                        {
                            contained
                        } else {
                            last.as_ref()
                                .map(|last| codex_min_totals(last, &contained))
                                .unwrap_or(contained)
                        }
                    } else if let Some(last) = last.as_ref() {
                        last.clone()
                    } else {
                        disposition = "unsupported";
                        CodexTokenTotals::default()
                    };

                    if let Some(current) = total.as_ref() {
                        accounting_state.watermark = Some(codex_max_totals(
                            accounting_state.watermark.as_ref(),
                            current,
                        ));
                        accounting_state.last_total = Some(current.clone());
                        if !duplicate {
                            accounting_state.seen_totals.push(current.clone());
                            if accounting_state.seen_totals.len() > 64 {
                                accounting_state.seen_totals.remove(0);
                            }
                        }
                        final_cumulative_usage =
                            Some((current.input, current.output, current.cached, 0));
                    }

                    has_last_token_usage |= last.is_some();
                    summary.total_input_tokens += delta.input;
                    summary.total_output_tokens += delta.output;
                    summary.cache_read_tokens += delta.cached;
                    accounting_state.counted =
                        Some(codex_add_totals(accounting_state.counted.as_ref(), &delta));

                    let model_key = summary
                        .model_used
                        .clone()
                        .unwrap_or_else(|| "unknown".into());
                    if delta.input > 0 || delta.output > 0 || delta.cached > 0 {
                        let model_usage = summary.model_usage.entry(model_key.clone()).or_default();
                        model_usage.message_count += 1;
                        model_usage.input_tokens += delta.input;
                        model_usage.output_tokens += delta.output;
                        model_usage.cache_read_tokens += delta.cached;
                    }
                    summary
                        .codex_usage_observations
                        .push(CodexUsageObservation {
                            source_line: (idx + 1) as i64,
                            timestamp: timestamp.clone(),
                            day: codex_local_day(timestamp.as_deref()),
                            model: model_key,
                            input_tokens: delta.input,
                            cache_read_tokens: delta.cached,
                            output_tokens: delta.output,
                            reasoning_tokens: delta.reasoning,
                            total,
                            disposition: disposition.into(),
                        });
                }
                continue;
            }

            if msg_type == "response_item" {
                let timestamp = value_string(Some(&parsed), "timestamp");
                record_day(&mut summary, timestamp.as_deref());
                update_timestamp(&mut summary, timestamp.clone());
                let (role, kind, content_text, tool_name, tool_call_id) =
                    codex_archive_fields(payload);
                archive_message(
                    &mut summary,
                    Some((idx + 1) as i64),
                    role,
                    kind,
                    timestamp,
                    content_text,
                    tool_name,
                    tool_call_id,
                    Some(msg_type.to_string()),
                );
                if let Some(usage) = payload.and_then(|p| p.get("usage")) {
                    response_input_tokens += usage
                        .get("input_tokens")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    response_output_tokens += usage
                        .get("output_tokens")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                }
                summary.message_count += 1;
            }
        }

        if !has_last_token_usage {
            summary.model_usage.clear();
            if let Some((input, output, cache_read, cache_creation)) = final_cumulative_usage {
                // Older Codex logs do not expose per-call `last_token_usage`.
                // Their final cumulative total is session-scoped, so preserve
                // SET semantics for incremental indexing of that legacy shape.
                summary.total_input_tokens = input;
                summary.total_output_tokens = output;
                summary.cache_read_tokens = cache_read;
                summary.cache_creation_tokens = cache_creation;
                summary.tokens_are_cumulative = true;
            } else {
                summary.total_input_tokens = response_input_tokens;
                summary.total_output_tokens = response_output_tokens;
            }
        }

        if summary.stable_id.is_none() {
            summary
                .parse_warnings
                .push("missing session_meta id".to_string());
        }
        if summary.cwd.is_none() {
            summary
                .parse_warnings
                .push("missing session_meta cwd".to_string());
        }
        accounting_state.current_model = summary.model_used.clone();
        summary.last_usage_key = serde_json::to_string(&accounting_state).ok();
        summary
    }
}

impl SessionSourceAdapter for CursorAdapter {
    fn adapter_id(&self) -> &'static str {
        "cursor"
    }

    fn agent_type(&self) -> &'static str {
        "cursor"
    }

    fn parse_raw(&self, source_ref: &str, raw: &str) -> RawSessionAdapterSummary {
        let mut summary = empty_summary(self.adapter_id(), self.agent_type(), source_ref);
        let parsed: Value = match serde_json::from_str(raw) {
            Ok(value) => value,
            Err(_) => {
                summary
                    .parse_warnings
                    .push("cursor fixture is not valid JSON".to_string());
                return summary;
            }
        };

        let composer_id = parsed
            .get("composer_id")
            .and_then(|v| v.as_str())
            .or_else(|| parsed.get("composerId").and_then(|v| v.as_str()))
            .unwrap_or("unknown");
        summary.stable_id = Some(format!("cursor-{composer_id}"));

        let composer = parsed.get("composer").unwrap_or(&parsed);
        summary.slug = composer
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(String::from);
        summary.cwd = composer
            .pointer("/workspaceIdentifier/uri/fsPath")
            .and_then(|v| v.as_str())
            .map(String::from)
            .or_else(|| {
                composer
                    .get("trackedGitRepos")
                    .and_then(|v| v.as_array())
                    .and_then(|repos| repos.first())
                    .and_then(|repo| {
                        repo.get("path")
                            .or_else(|| repo.get("repoPath"))
                            .or_else(|| repo.get("rootPath"))
                    })
                    .and_then(|v| v.as_str())
                    .map(String::from)
            });
        summary.model_used = composer
            .pointer("/modelConfig/modelName")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty() && *s != "default")
            .map(String::from);
        summary.first_timestamp = millis_to_rfc3339(composer.get("createdAt"));
        summary.last_timestamp = millis_to_rfc3339(composer.get("lastUpdatedAt"));

        let bubbles = parsed
            .get("bubbles")
            .and_then(|v| v.as_array())
            .or_else(|| parsed.get("messages").and_then(|v| v.as_array()));
        if let Some(bubbles) = bubbles {
            for (idx, bubble) in bubbles.iter().enumerate() {
                let timestamp = bubble.get("createdAt").and_then(|v| {
                    v.as_str().map(String::from).or_else(|| {
                        v.as_i64()
                            .and_then(chrono::DateTime::from_timestamp_millis)
                            .map(|dt| dt.to_rfc3339())
                    })
                });
                record_day(&mut summary, timestamp.as_deref());
                update_timestamp(&mut summary, timestamp.clone());
                let bubble_type = bubble.get("type").and_then(|v| v.as_i64());
                let role = match bubble_type {
                    Some(1) => Some("user".to_string()),
                    Some(2) => Some("assistant".to_string()),
                    _ => bubble
                        .get("role")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                };
                let tool_name = value_string(Some(bubble), "toolName")
                    .or_else(|| value_string(Some(bubble), "name"));
                let kind = if tool_name.is_some() {
                    "tool_call"
                } else {
                    "message"
                };
                archive_message(
                    &mut summary,
                    Some((idx + 1) as i64),
                    role,
                    kind,
                    timestamp,
                    value_text(bubble.get("text").or_else(|| bubble.get("content"))),
                    tool_name,
                    value_string(Some(bubble), "toolCallId"),
                    Some("bubble".to_string()),
                );
                summary.message_count += 1;
            }
        } else if let Some(headers) = composer
            .get("fullConversationHeadersOnly")
            .and_then(|v| v.as_array())
        {
            summary.message_count = headers.len() as i64;
        }

        if summary.message_count == 0 {
            summary
                .parse_warnings
                .push("cursor conversation has no indexed bubbles".to_string());
        }
        if summary.cwd.is_none() {
            summary
                .parse_warnings
                .push("cursor conversation missing workspace path".to_string());
        }
        summary
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct CodexOracleCase {
        file: String,
        model: String,
        local_day: String,
        input: i64,
        cached: i64,
        output: i64,
        dispositions: Vec<String>,
    }

    fn parse_codex_chunks(
        raw: &str,
        boundaries: usize,
    ) -> (i64, i64, i64, Vec<(String, String, Option<String>)>) {
        let lines = raw.lines().collect::<Vec<_>>();
        let mut state = None;
        let mut input = 0;
        let mut cached = 0;
        let mut output = 0;
        let mut dispositions = Vec::new();
        let mut start = 0;
        for boundary in 0..lines.len().saturating_sub(1) {
            if boundaries & (1usize << boundary) == 0 {
                continue;
            }
            let chunk = lines[start..=boundary].join("\n") + "\n";
            let summary =
                CodexAdapter.parse_raw_with_state("oracle.jsonl", &chunk, state.as_deref());
            input += summary.total_input_tokens;
            cached += summary.cache_read_tokens;
            output += summary.total_output_tokens;
            dispositions.extend(
                summary
                    .codex_usage_observations
                    .into_iter()
                    .map(|observation| {
                        (observation.disposition, observation.model, observation.day)
                    }),
            );
            state = summary.last_usage_key;
            start = boundary + 1;
        }
        let chunk = lines[start..].join("\n") + "\n";
        let summary = CodexAdapter.parse_raw_with_state("oracle.jsonl", &chunk, state.as_deref());
        input += summary.total_input_tokens;
        cached += summary.cache_read_tokens;
        output += summary.total_output_tokens;
        dispositions.extend(
            summary
                .codex_usage_observations
                .into_iter()
                .map(|observation| (observation.disposition, observation.model, observation.day)),
        );
        (input, cached, output, dispositions)
    }

    #[test]
    fn codex_accounting_matches_independent_oracle_for_every_line_partition() {
        let fixture_dir = std::path::Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/codex-accounting"
        ));
        let oracle: Vec<CodexOracleCase> = serde_json::from_str(
            &std::fs::read_to_string(fixture_dir.join("oracle.json")).expect("oracle"),
        )
        .expect("valid oracle");
        for case in oracle {
            let raw = std::fs::read_to_string(fixture_dir.join(&case.file)).expect("fixture");
            let line_count = raw.lines().count();
            for boundaries in 0..(1usize << line_count.saturating_sub(1)) {
                let actual = parse_codex_chunks(&raw, boundaries);
                assert_eq!(
                    actual.0, case.input,
                    "{} partition {boundaries:b}",
                    case.file
                );
                assert_eq!(
                    actual.1, case.cached,
                    "{} partition {boundaries:b}",
                    case.file
                );
                assert_eq!(
                    actual.2, case.output,
                    "{} partition {boundaries:b}",
                    case.file
                );
                assert_eq!(
                    actual
                        .3
                        .iter()
                        .map(|item| item.0.as_str())
                        .collect::<Vec<_>>(),
                    case.dispositions
                        .iter()
                        .map(String::as_str)
                        .collect::<Vec<_>>(),
                    "{} partition {boundaries:b}",
                    case.file
                );
                assert!(actual.3.iter().all(|item| item.1 == case.model));
                assert!(actual
                    .3
                    .iter()
                    .all(|item| item.2.as_deref() == Some(case.local_day.as_str())));
            }
        }
    }

    #[test]
    fn parses_claude_fixture_into_normalized_summary() {
        let raw = include_str!("../../tests/fixtures/session_adapters/claude-code.jsonl");
        let summary = ClaudeCodeAdapter.parse_raw("/fixtures/claude-code.jsonl", raw);

        assert_eq!(summary.adapter_id, "claude-code");
        assert_eq!(summary.stable_id.as_deref(), Some("claude-session-1"));
        assert_eq!(summary.cwd.as_deref(), Some("/repo/codevetter"));
        assert_eq!(summary.git_branch.as_deref(), Some("main"));
        assert_eq!(summary.message_count, 3);
        assert_eq!(summary.total_input_tokens, 135);
        assert_eq!(summary.total_output_tokens, 40);
        assert_eq!(summary.cache_read_tokens, 25);
        assert_eq!(summary.cache_creation_tokens, 10);
        assert_eq!(summary.compaction_count, 1);
        assert_eq!(summary.slug, None);
        assert_eq!(summary.day_counts.get("2026-06-12"), Some(&3));
        assert_eq!(summary.archive_messages.len(), 3);
        assert_eq!(summary.archive_messages[0].role.as_deref(), Some("user"));
        assert_eq!(summary.archive_messages[0].kind, "message");
        assert_eq!(summary.archive_messages[2].kind, "compaction");
        assert_eq!(
            summary.archive_messages[2].raw_type.as_deref(),
            Some("summary")
        );
        assert!(summary.parse_warnings.is_empty());
        // Per-model attribution: both usage-bearing messages are sonnet.
        let sonnet = summary
            .model_usage
            .get("claude-sonnet-4")
            .expect("sonnet row");
        assert_eq!(sonnet.message_count, 2);
        assert_eq!(sonnet.input_tokens, 135);
        assert_eq!(sonnet.output_tokens, 40);
        assert_eq!(sonnet.cache_read_tokens, 25);
        assert_eq!(sonnet.cache_creation_tokens, 10);
    }

    #[test]
    fn claude_cache_creation_1h_tier_is_split_from_5m() {
        // Real Claude Code usage nests the TTL split under
        // usage.cache_creation.{ephemeral_1h_input_tokens,ephemeral_5m_input_tokens}.
        // Anthropic bills 1h writes at 2x input vs ~1.25x for 5m, so losing
        // this split silently underprices any session using 1h caching.
        let raw = concat!(
            r#"{"type":"assistant","sessionId":"s1","timestamp":"2026-07-10T10:00:00.000Z","requestId":"r1","message":{"id":"m1","role":"assistant","model":"claude-sonnet-4-5","usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":5,"cache_creation_input_tokens":100,"cache_creation":{"ephemeral_1h_input_tokens":80,"ephemeral_5m_input_tokens":20}},"content":[{"type":"text","text":"hi"}]}}"#,
            "\n",
            r#"{"type":"assistant","sessionId":"s1","timestamp":"2026-07-10T10:01:00.000Z","requestId":"r2","message":{"id":"m2","role":"assistant","model":"claude-sonnet-4-5","usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":5,"cache_creation_input_tokens":50,"cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":50}},"content":[{"type":"text","text":"hi"}]}}"#,
        );
        let summary = ClaudeCodeAdapter.parse_raw("/fixtures/cache-tier.jsonl", raw);

        // Session-level cache_creation_tokens stays the lumped total (used by
        // the no-breakdown fallback); the per-model 1h field carries just the
        // 1h portion so cost estimation can split it out.
        assert_eq!(summary.cache_creation_tokens, 150);
        let sonnet = summary
            .model_usage
            .get("claude-sonnet-4-5")
            .expect("sonnet row");
        assert_eq!(sonnet.cache_creation_tokens, 150);
        assert_eq!(sonnet.cache_creation_1h_tokens, 80);
    }

    fn usage_line(msg_id: &str, request_id: &str, output: i64) -> String {
        format!(
            r#"{{"type":"assistant","sessionId":"s1","timestamp":"2026-07-10T10:00:00.000Z","requestId":"{request_id}","message":{{"id":"{msg_id}","role":"assistant","model":"claude-fable-5","usage":{{"input_tokens":10,"output_tokens":{output},"cache_read_input_tokens":5,"cache_creation_input_tokens":2}},"content":[{{"type":"text","text":"hi"}}]}}}}"#
        )
    }

    #[test]
    fn claude_usage_counted_once_per_message_despite_repeated_lines() {
        // Claude Code writes one JSONL line per content block, each repeating
        // the SAME final usage object — real transcripts are 50%+ repeats.
        // Usage must be counted once per (message.id, requestId).
        let raw = [
            usage_line("msg_a", "req_1", 100),
            usage_line("msg_a", "req_1", 100), // repeated content-block line
            usage_line("msg_a", "req_1", 100), // and again
            usage_line("msg_b", "req_2", 7),
        ]
        .join("\n");
        let summary = ClaudeCodeAdapter.parse_raw("/t.jsonl", &raw);
        assert_eq!(summary.total_output_tokens, 107);
        assert_eq!(summary.total_input_tokens, 2 * (10 + 5 + 2));
        assert_eq!(summary.cache_read_tokens, 10);
        let fable = summary.model_usage.get("claude-fable-5").expect("fable");
        assert_eq!(fable.message_count, 2);
        assert_eq!(summary.last_usage_key.as_deref(), Some("msg_b:req_2"));
        // All four lines still archive/count as lines.
        assert_eq!(summary.message_count, 4);
    }

    #[test]
    fn claude_usage_dedup_survives_split_incremental_reads() {
        // A message's content-block lines can be flushed ~40s apart, so an
        // incremental tail read can start mid-duplicate-group. The prior read's
        // last usage key must suppress the leading repeats.
        let first = usage_line("msg_a", "req_1", 100);
        let second = [
            usage_line("msg_a", "req_1", 100), // continuation of msg_a
            usage_line("msg_b", "req_2", 7),
        ]
        .join("\n");
        let s1 = ClaudeCodeAdapter.parse_raw_with_state("/t.jsonl", &first, None);
        assert_eq!(s1.total_output_tokens, 100);
        let s2 = ClaudeCodeAdapter.parse_raw_with_state(
            "/t.jsonl",
            &second,
            s1.last_usage_key.as_deref(),
        );
        assert_eq!(s2.total_output_tokens, 7);
        assert_eq!(s2.last_usage_key.as_deref(), Some("msg_b:req_2"));
    }

    #[test]
    fn claude_usage_lines_without_message_id_always_count() {
        let no_id = r#"{"type":"assistant","sessionId":"s1","timestamp":"2026-07-10T10:00:00.000Z","message":{"role":"assistant","model":"claude-fable-5","usage":{"input_tokens":1,"output_tokens":3,"cache_read_input_tokens":0,"cache_creation_input_tokens":0},"content":[{"type":"text","text":"hi"}]}}"#;
        let raw = format!("{no_id}\n{no_id}");
        let summary = ClaudeCodeAdapter.parse_raw("/t.jsonl", &raw);
        // No id → no dedup key → both lines count (conservative).
        assert_eq!(summary.total_output_tokens, 6);
        assert_eq!(summary.last_usage_key, None);
    }

    #[test]
    fn codex_turn_context_model_overrides_provider_fallback() {
        // Newer Codex CLIs omit `model` from session_meta (only
        // model_provider), which the fallback maps to the o3-era default —
        // the real model lives on per-turn turn_context rows and must win.
        let raw = concat!(
            r#"{"type":"session_meta","payload":{"id":"c1","cwd":"/repo","model_provider":"openai"}}"#,
            "\n",
            r#"{"type":"turn_context","payload":{"model":"gpt-5.5","effort":"high"}}"#,
            "\n",
            r#"{"type":"response_item","timestamp":"2026-07-04T10:00:00Z","payload":{"role":"assistant","usage":{"input_tokens":10,"output_tokens":5}}}"#,
        );
        let summary = CodexAdapter.parse_raw("/fixtures/codex-gpt55.jsonl", raw);
        assert_eq!(summary.model_used.as_deref(), Some("gpt-5.5"));

        // Legacy files without turn_context keep the o3 fallback.
        let legacy = r#"{"type":"session_meta","payload":{"id":"c2","cwd":"/repo","model_provider":"openai"}}"#;
        let summary = CodexAdapter.parse_raw("/fixtures/codex-legacy.jsonl", legacy);
        assert_eq!(summary.model_used.as_deref(), Some("o3"));
    }

    fn codex_token_line(
        timestamp: &str,
        input: i64,
        cached: i64,
        output: i64,
        total_input: i64,
        total_cached: i64,
        total_output: i64,
    ) -> String {
        format!(
            r#"{{"timestamp":"{timestamp}","type":"event_msg","payload":{{"type":"token_count","info":{{"last_token_usage":{{"input_tokens":{input},"cached_input_tokens":{cached},"output_tokens":{output},"reasoning_output_tokens":1}},"total_token_usage":{{"input_tokens":{total_input},"cached_input_tokens":{total_cached},"output_tokens":{total_output},"reasoning_output_tokens":1}}}}}}}}"#
        )
    }

    #[test]
    fn codex_unchanged_cumulative_snapshot_is_not_recounted() {
        let first = codex_token_line("2026-08-10T01:00:00Z", 100, 80, 10, 100, 80, 10);
        let duplicate = codex_token_line("2026-08-10T01:00:05Z", 100, 80, 10, 100, 80, 10);
        let raw = format!("{first}\n{duplicate}");
        let summary = CodexAdapter.parse_raw("/fixtures/codex-duplicate.jsonl", &raw);
        assert_eq!(summary.total_input_tokens, 100);
        assert_eq!(summary.total_output_tokens, 10);
        assert_eq!(summary.codex_usage_observations.len(), 2);
        assert_eq!(summary.codex_usage_observations[1].disposition, "duplicate");
        assert_eq!(summary.codex_usage_observations[1].input_tokens, 0);
    }

    #[test]
    fn codex_duplicate_suppression_survives_incremental_boundary() {
        let first = codex_token_line("2026-08-10T01:00:00Z", 100, 80, 10, 100, 80, 10);
        let duplicate = codex_token_line("2026-08-10T01:00:05Z", 100, 80, 10, 100, 80, 10);
        let next = codex_token_line("2026-08-10T01:01:00Z", 50, 40, 5, 150, 120, 15);
        let one = CodexAdapter.parse_raw_with_state("/fixtures/codex.jsonl", &first, None);
        let two = CodexAdapter.parse_raw_with_state(
            "/fixtures/codex.jsonl",
            &format!("{duplicate}\n{next}"),
            one.last_usage_key.as_deref(),
        );
        assert_eq!(one.total_input_tokens + two.total_input_tokens, 150);
        assert_eq!(one.total_output_tokens + two.total_output_tokens, 15);
        assert_eq!(two.codex_usage_observations[0].disposition, "duplicate");
    }

    #[test]
    fn codex_interleaved_totals_only_count_growth_above_watermark() {
        let raw = [
            codex_token_line("2026-08-10T01:00:00Z", 100, 80, 10, 100, 80, 10),
            // A second lineage drops below the watermark: no new contained growth.
            codex_token_line("2026-08-10T01:00:10Z", 40, 30, 4, 40, 30, 4),
            // Only 20/10/2 exceeds the original component-wise watermark.
            codex_token_line("2026-08-10T01:00:20Z", 80, 60, 8, 120, 90, 12),
        ]
        .join("\n");
        let summary = CodexAdapter.parse_raw("/fixtures/codex-interleaved.jsonl", &raw);
        assert_eq!(summary.total_input_tokens, 120);
        assert_eq!(summary.cache_read_tokens, 90);
        assert_eq!(summary.total_output_tokens, 12);
    }

    #[test]
    fn codex_observations_keep_event_day_and_model() {
        let raw = format!(
            "{}\n{}\n{}",
            r#"{"type":"session_meta","payload":{"id":"s","cwd":"/repo","model_provider":"openai"}}"#,
            r#"{"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
            codex_token_line("2026-08-10T01:00:00Z", 100, 80, 10, 100, 80, 10),
        );
        let summary = CodexAdapter.parse_raw("/fixtures/codex-day.jsonl", &raw);
        let observation = &summary.codex_usage_observations[0];
        assert_eq!(observation.model, "gpt-5.6-sol");
        assert!(observation.day.is_some());
        assert_eq!(observation.reasoning_tokens, 1);
    }

    #[test]
    fn codex_attributes_last_usage_instead_of_inherited_cumulative_total() {
        let raw = concat!(
            r#"{"type":"session_meta","payload":{"id":"child","cwd":"/repo","model_provider":"openai","source":{"subagent":{"thread_spawn":{"parent_thread_id":"parent"}}}}}"#,
            "\n",
            r#"{"type":"turn_context","payload":{"model":"gpt-5.6-sol","effort":"high"}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":120,"cached_input_tokens":100,"output_tokens":8},"total_token_usage":{"input_tokens":2000000120,"cached_input_tokens":1900000100,"output_tokens":5000008}}}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":140,"cached_input_tokens":110,"output_tokens":12},"total_token_usage":{"input_tokens":2000000260,"cached_input_tokens":1900000210,"output_tokens":5000020}}}}"#,
        );

        let summary = CodexAdapter.parse_raw("/fixtures/codex-child.jsonl", raw);

        assert_eq!(summary.total_input_tokens, 260);
        assert_eq!(summary.cache_read_tokens, 210);
        assert_eq!(summary.total_output_tokens, 20);
        assert!(!summary.tokens_are_cumulative);
        let model = summary.model_usage.get("gpt-5.6-sol").expect("model usage");
        assert_eq!(model.input_tokens, 260);
        assert_eq!(model.cache_read_tokens, 210);
        assert_eq!(model.output_tokens, 20);
    }

    #[test]
    fn codex_skips_replayed_parent_events_in_spawned_session() {
        let raw = concat!(
            r#"{"timestamp":"2026-07-20T08:03:00.000Z","type":"session_meta","payload":{"id":"child","cwd":"/repo","model_provider":"openai","source":{"subagent":{"thread_spawn":{"parent_thread_id":"parent"}}}}}"#,
            "\n",
            // A replayed parent session_meta must not replace the child id.
            r#"{"timestamp":"2026-07-20T08:03:00.000Z","type":"session_meta","payload":{"id":"parent"}}"#,
            "\n",
            r#"{"timestamp":"2026-07-20T08:03:00.000Z","type":"turn_context","payload":{"model":"gpt-5.6-sol","effort":"high"}}"#,
            "\n",
            r#"{"timestamp":"2026-07-20T08:03:00.100Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000,"cached_input_tokens":900,"output_tokens":200},"total_token_usage":{"input_tokens":1000,"cached_input_tokens":900,"output_tokens":200}}}}"#,
            "\n",
            r#"{"timestamp":"2026-07-20T08:03:00.200Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":500,"cached_input_tokens":400,"output_tokens":100},"total_token_usage":{"input_tokens":1500,"cached_input_tokens":1300,"output_tokens":300}}}}"#,
            "\n",
            r#"{"timestamp":"2026-07-20T08:04:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"cached_input_tokens":80,"output_tokens":20},"total_token_usage":{"input_tokens":100,"cached_input_tokens":80,"output_tokens":20}}}}"#,
            "\n",
            r#"{"timestamp":"2026-07-20T08:05:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":50,"cached_input_tokens":40,"output_tokens":10},"total_token_usage":{"input_tokens":150,"cached_input_tokens":120,"output_tokens":30}}}}"#,
        );

        let summary = CodexAdapter.parse_raw("/fixtures/codex-child.jsonl", raw);

        assert_eq!(summary.stable_id.as_deref(), Some("child"));
        assert_eq!(summary.total_input_tokens, 150);
        assert_eq!(summary.cache_read_tokens, 120);
        assert_eq!(summary.total_output_tokens, 30);
        let model = summary.model_usage.get("gpt-5.6-sol").expect("model usage");
        assert_eq!(model.input_tokens, 150);
        assert_eq!(model.cache_read_tokens, 120);
        assert_eq!(model.output_tokens, 30);
    }

    #[test]
    fn multi_model_claude_session_splits_usage_per_model() {
        // A session that switches models mid-way must NOT book everything to
        // the last model seen (the bug that misattributed opus usage to
        // fable). `<synthetic>` and model-less usage fold into "unknown".
        let raw = concat!(
            r#"{"type":"message","sessionId":"s1","timestamp":"2026-06-12T16:00:00Z","message":{"role":"assistant","model":"claude-opus-4-7","usage":{"input_tokens":10,"cache_read_input_tokens":1000,"output_tokens":50}}}"#,
            "\n",
            r#"{"type":"message","sessionId":"s1","timestamp":"2026-06-12T16:01:00Z","message":{"role":"assistant","model":"claude-fable-5","usage":{"input_tokens":5,"cache_read_input_tokens":200,"output_tokens":25}}}"#,
            "\n",
            r#"{"type":"message","sessionId":"s1","timestamp":"2026-06-12T16:02:00Z","message":{"role":"assistant","model":"<synthetic>","usage":{"input_tokens":3,"output_tokens":1}}}"#,
            "\n",
        );
        let summary = ClaudeCodeAdapter.parse_raw("/fixtures/multi-model.jsonl", raw);

        // Session-level model_used stays last-wins (display fallback only).
        assert_eq!(summary.model_used.as_deref(), Some("<synthetic>"));

        let opus = summary
            .model_usage
            .get("claude-opus-4-7")
            .expect("opus row");
        assert_eq!(opus.input_tokens, 1010);
        assert_eq!(opus.cache_read_tokens, 1000);
        assert_eq!(opus.output_tokens, 50);

        let fable = summary
            .model_usage
            .get("claude-fable-5")
            .expect("fable row");
        assert_eq!(fable.input_tokens, 205);
        assert_eq!(fable.output_tokens, 25);

        let unknown = summary.model_usage.get("unknown").expect("unknown row");
        assert_eq!(unknown.input_tokens, 3);
        assert_eq!(unknown.output_tokens, 1);
        assert!(!summary.model_usage.contains_key("<synthetic>"));

        // The split reconciles with the session totals.
        let split_input: i64 = summary.model_usage.values().map(|u| u.input_tokens).sum();
        assert_eq!(split_input, summary.total_input_tokens);
        let split_output: i64 = summary.model_usage.values().map(|u| u.output_tokens).sum();
        assert_eq!(split_output, summary.total_output_tokens);
    }

    #[test]
    fn parses_codex_fixture_into_normalized_summary() {
        let raw = include_str!("../../tests/fixtures/session_adapters/codex.jsonl");
        let summary = CodexAdapter.parse_raw("/fixtures/codex.jsonl", raw);

        assert_eq!(summary.adapter_id, "codex");
        assert_eq!(summary.stable_id.as_deref(), Some("codex-session-1"));
        assert_eq!(summary.cwd.as_deref(), Some("/repo/codevetter"));
        assert_eq!(summary.git_branch.as_deref(), Some("feature/adapter"));
        assert_eq!(summary.model_used.as_deref(), Some("o3"));
        assert_eq!(summary.message_count, 2);
        assert_eq!(summary.total_input_tokens, 500);
        assert_eq!(summary.total_output_tokens, 150);
        assert_eq!(summary.cache_read_tokens, 100);
        assert!(summary.tokens_are_cumulative);
        assert_eq!(summary.slug, None);
        assert_eq!(summary.day_counts.get("2026-06-12"), Some(&2));
        assert_eq!(summary.archive_messages.len(), 2);
        assert_eq!(summary.archive_messages[0].role.as_deref(), Some("user"));
        assert_eq!(
            summary.archive_messages[1].role.as_deref(),
            Some("assistant")
        );
        assert_eq!(
            summary.archive_messages[1].raw_type.as_deref(),
            Some("response_item")
        );
        assert!(summary.parse_warnings.is_empty());
    }

    #[test]
    fn parses_cursor_fixture_into_normalized_summary() {
        let raw = include_str!("../../tests/fixtures/session_adapters/cursor.json");
        let summary = CursorAdapter.parse_raw("/fixtures/cursor.json", raw);

        assert_eq!(summary.adapter_id, "cursor");
        assert_eq!(summary.stable_id.as_deref(), Some("cursor-composer-1"));
        assert_eq!(summary.cwd.as_deref(), Some("/repo/codevetter"));
        assert_eq!(summary.model_used.as_deref(), Some("cursor-small"));
        assert_eq!(summary.slug.as_deref(), Some("Fix checkout test"));
        assert_eq!(summary.message_count, 2);
        assert_eq!(
            summary.first_timestamp.as_deref(),
            Some("2026-06-12T16:00:00+00:00")
        );
        assert_eq!(
            summary.last_timestamp.as_deref(),
            Some("2026-06-12T16:02:00+00:00")
        );
        assert_eq!(summary.day_counts.get("2026-06-12"), Some(&2));
        assert_eq!(summary.archive_messages.len(), 2);
        assert_eq!(summary.archive_messages[0].role.as_deref(), Some("user"));
        assert_eq!(
            summary.archive_messages[0].content_text.as_deref(),
            Some("Fix checkout test")
        );
        assert_eq!(
            summary.archive_messages[1].role.as_deref(),
            Some("assistant")
        );
        assert!(summary.parse_warnings.is_empty());
    }

    #[test]
    fn malformed_adapter_input_degrades_to_parse_warning() {
        let summary = CodexAdapter.parse_raw("/fixtures/bad.jsonl", "{not-json");

        assert_eq!(summary.message_count, 0);
        assert!(summary
            .parse_warnings
            .iter()
            .any(|warning| warning.contains("not valid JSON")));
        assert!(summary
            .parse_warnings
            .iter()
            .any(|warning| warning.contains("missing session_meta id")));
    }

    #[test]
    fn archive_text_truncation_handles_unicode_boundaries() {
        let raw = "न".repeat(12_001);
        let text = bounded_text(raw).expect("bounded unicode text");

        assert!(text.ends_with("\n[truncated]"));
        assert!(text.is_char_boundary(text.len()));
    }
}
