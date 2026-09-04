use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::review::resolve_cli_path;

const CODEX_TIMEOUT: Duration = Duration::from_secs(8);
const CLAUDE_STARTUP_TIMEOUT: Duration = Duration::from_secs(5);
const CLAUDE_TIMEOUT: Duration = Duration::from_secs(15);
const OUTPUT_LIMIT_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderQuotaSelection {
    All,
    Claude,
    Codex,
}

impl ProviderQuotaSelection {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "all" => Ok(Self::All),
            "claude" | "anthropic" => Ok(Self::Claude),
            "codex" | "openai" => Ok(Self::Codex),
            _ => Err("--provider must be all, claude, or codex".to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProviderQuotaReceipt {
    pub schema_version: String,
    pub generated_at: String,
    pub providers: Vec<ProviderQuotaStatus>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProviderQuotaStatus {
    pub provider: String,
    pub status: String,
    pub source: String,
    pub checked_at: String,
    pub plan: Option<String>,
    pub windows: Vec<ProviderQuotaWindow>,
    pub credits: Option<ProviderCreditBalance>,
    pub reset_credits: Option<u64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProviderQuotaWindow {
    pub id: String,
    pub label: String,
    pub used_percent: f64,
    pub remaining_percent: f64,
    pub window_duration_minutes: Option<u64>,
    pub resets_at_unix: Option<i64>,
    pub reset_description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProviderCreditBalance {
    pub used_percent: Option<f64>,
    pub remaining_percent: Option<f64>,
    pub used_amount: Option<f64>,
    pub limit_amount: Option<f64>,
    pub currency: Option<String>,
    pub reset_description: Option<String>,
}

pub fn collect_provider_quotas(selection: ProviderQuotaSelection) -> ProviderQuotaReceipt {
    let mut providers = Vec::new();
    if matches!(
        selection,
        ProviderQuotaSelection::All | ProviderQuotaSelection::Claude
    ) {
        providers.push(collect_claude_quota());
    }
    if matches!(
        selection,
        ProviderQuotaSelection::All | ProviderQuotaSelection::Codex
    ) {
        providers.push(collect_codex_quota());
    }
    ProviderQuotaReceipt {
        schema_version: "codevetter.provider-quota/v1".to_string(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        providers,
        limitations: vec![
            "Provider quota is reported independently from local token and cost history."
                .to_string(),
            "Claude is read through Claude Code's own interactive /usage view; Codex is read through the official app-server account/rateLimits/read method."
                .to_string(),
            "Unavailable provider telemetry is never represented as zero usage.".to_string(),
        ],
    }
}

fn unavailable(provider: &str, source: &str, message: impl Into<String>) -> ProviderQuotaStatus {
    ProviderQuotaStatus {
        provider: provider.to_string(),
        status: "unavailable".to_string(),
        source: source.to_string(),
        checked_at: chrono::Utc::now().to_rfc3339(),
        plan: None,
        windows: Vec::new(),
        credits: None,
        reset_credits: None,
        message: Some(message.into()),
    }
}

fn collect_codex_quota() -> ProviderQuotaStatus {
    let executable = resolve_cli_path("codex");
    let mut child = match Command::new(&executable)
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            return unavailable(
                "codex",
                "codex app-server account/rateLimits/read",
                format!("Codex app-server is unavailable: {error}"),
            );
        }
    };

    let Some(mut stdin) = child.stdin.take() else {
        let _ = child.kill();
        return unavailable(
            "codex",
            "codex app-server account/rateLimits/read",
            "Codex app-server stdin is unavailable",
        );
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        return unavailable(
            "codex",
            "codex app-server account/rateLimits/read",
            "Codex app-server stdout is unavailable",
        );
    };

    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    let requests = [
        json!({
            "method": "initialize",
            "id": 0,
            "params": {
                "clientInfo": {
                    "name": "codevetter",
                    "title": "CodeVetter",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        }),
        json!({"method": "initialized", "params": {}}),
        json!({"method": "account/rateLimits/read", "id": 1}),
    ];
    for request in requests {
        if writeln!(stdin, "{request}").is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return unavailable(
                "codex",
                "codex app-server account/rateLimits/read",
                "Could not write the Codex rate-limit request",
            );
        }
    }
    let _ = stdin.flush();

    let deadline = Instant::now() + CODEX_TIMEOUT;
    let result = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break Err("Codex rate-limit request timed out".to_string());
        }
        match rx.recv_timeout(remaining.min(Duration::from_millis(500))) {
            Ok(Ok(line)) => {
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if value.get("id").and_then(Value::as_i64) == Some(1) {
                    break parse_codex_rate_limits(&value);
                }
            }
            Ok(Err(error)) => break Err(format!("Could not read Codex app-server: {error}")),
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break Err("Codex app-server closed before returning rate limits".to_string());
            }
        }
    };
    let _ = child.kill();
    let _ = child.wait();
    result.unwrap_or_else(|error| {
        unavailable("codex", "codex app-server account/rateLimits/read", error)
    })
}

fn parse_codex_rate_limits(response: &Value) -> Result<ProviderQuotaStatus, String> {
    if let Some(error) = response.get("error") {
        return Err(format!("Codex returned an error: {error}"));
    }
    let result = response
        .get("result")
        .ok_or_else(|| "Codex returned no rate-limit result".to_string())?;
    let buckets = result
        .get("rateLimitsByLimitId")
        .and_then(Value::as_object)
        .or_else(|| {
            result
                .get("rateLimits")
                .and_then(Value::as_object)
                .map(|_| result.as_object().expect("result is an object"))
        });
    let mut windows = Vec::new();
    let mut plan = None;
    if let Some(buckets) = buckets {
        if let Some(single) = result
            .get("rateLimits")
            .filter(|_| !result["rateLimitsByLimitId"].is_object())
        {
            append_codex_bucket("codex", single, &mut windows, &mut plan);
        } else if let Some(account) = buckets.get("codex") {
            // The account-level Codex allowance is the useful product signal. Model-specific
            // promotional buckets (for example Spark) are intentionally not mixed into it.
            append_codex_bucket("codex", account, &mut windows, &mut plan);
        } else {
            for (bucket_id, bucket) in buckets {
                if bucket_id == "rateLimits" || bucket_id == "rateLimitResetCredits" {
                    continue;
                }
                let bucket_name = bucket
                    .get("limitName")
                    .and_then(Value::as_str)
                    .unwrap_or(bucket_id);
                if bucket_id.to_ascii_lowercase().contains("spark")
                    || bucket_name.to_ascii_lowercase().contains("spark")
                {
                    continue;
                }
                append_codex_bucket(bucket_id, bucket, &mut windows, &mut plan);
            }
        }
    }
    if windows.is_empty() {
        return Err("Codex did not report any quota windows for this account".to_string());
    }
    windows.sort_by(|left, right| {
        left.window_duration_minutes
            .unwrap_or(u64::MAX)
            .cmp(&right.window_duration_minutes.unwrap_or(u64::MAX))
            .then_with(|| left.label.cmp(&right.label))
    });
    let reset_credits = result
        .pointer("/rateLimitResetCredits/availableCount")
        .and_then(Value::as_u64);
    Ok(ProviderQuotaStatus {
        provider: "codex".to_string(),
        status: "ready".to_string(),
        source: "codex app-server account/rateLimits/read".to_string(),
        checked_at: chrono::Utc::now().to_rfc3339(),
        plan,
        windows,
        credits: None,
        reset_credits,
        message: None,
    })
}

fn append_codex_bucket(
    bucket_id: &str,
    bucket: &Value,
    windows: &mut Vec<ProviderQuotaWindow>,
    plan: &mut Option<String>,
) {
    if plan.is_none() {
        *plan = bucket
            .get("planType")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    let bucket_name = bucket
        .get("limitName")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(if bucket_id == "codex" {
            "Codex"
        } else {
            bucket_id
        });
    for (window_id, suffix) in [("primary", "primary"), ("secondary", "secondary")] {
        let Some(window) = bucket.get(window_id) else {
            continue;
        };
        let Some(used) = window.get("usedPercent").and_then(Value::as_f64) else {
            continue;
        };
        let duration = window.get("windowDurationMins").and_then(Value::as_u64);
        let duration_label = match duration {
            Some(300) => "5-hour window".to_string(),
            Some(10_080) => "Weekly window".to_string(),
            Some(minutes) if minutes % 1_440 == 0 => format!("{}-day window", minutes / 1_440),
            Some(minutes) if minutes % 60 == 0 => format!("{}-hour window", minutes / 60),
            Some(minutes) => format!("{minutes}-minute window"),
            None => suffix.to_string(),
        };
        let label = if bucket_id == "codex" {
            duration_label
        } else {
            format!("{bucket_name} · {duration_label}")
        };
        windows.push(ProviderQuotaWindow {
            id: format!("{bucket_id}.{window_id}"),
            label,
            used_percent: used.clamp(0.0, 100.0),
            remaining_percent: (100.0 - used).clamp(0.0, 100.0),
            window_duration_minutes: duration,
            resets_at_unix: window.get("resetsAt").and_then(Value::as_i64),
            reset_description: None,
        });
    }
}

fn collect_claude_quota() -> ProviderQuotaStatus {
    let executable = resolve_cli_path("claude");
    let pty_system = native_pty_system();
    let pair = match pty_system.openpty(PtySize {
        rows: 64,
        cols: 132,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(pair) => pair,
        Err(error) => {
            return unavailable(
                "claude",
                "Claude Code /usage",
                format!("Could not open a hidden Claude terminal: {error}"),
            );
        }
    };
    let mut reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(error) => {
            return unavailable(
                "claude",
                "Claude Code /usage",
                format!("Could not read the hidden Claude terminal: {error}"),
            );
        }
    };
    let mut writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(error) => {
            return unavailable(
                "claude",
                "Claude Code /usage",
                format!("Could not write to the hidden Claude terminal: {error}"),
            );
        }
    };
    let mut command = CommandBuilder::new(&executable);
    command.arg("--safe-mode");
    command.arg("--ax-screen-reader");
    command.cwd(std::env::temp_dir());
    let mut child = match pair.slave.spawn_command(command) {
        Ok(child) => child,
        Err(error) => {
            return unavailable(
                "claude",
                "Claude Code /usage",
                format!("Claude Code is unavailable: {error}"),
            );
        }
    };
    drop(pair.slave);
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    if tx.send(buffer[..count].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    let mut bytes = Vec::new();
    wait_for_claude_startup(&rx, &mut bytes);
    if writer.write_all(b"/usage\r").is_err() || writer.flush().is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return unavailable(
            "claude",
            "Claude Code /usage",
            "Could not request Claude Code usage",
        );
    }

    let deadline = Instant::now() + CLAUDE_TIMEOUT;
    let mut last_output = Instant::now();
    loop {
        if Instant::now() >= deadline {
            break;
        }
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(chunk) => {
                last_output = Instant::now();
                let remaining = OUTPUT_LIMIT_BYTES.saturating_sub(bytes.len());
                bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                if claude_capture_complete(&bytes) {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if claude_required_windows_available(&bytes)
                    && last_output.elapsed() >= Duration::from_millis(900)
                {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    let output = strip_terminal_sequences(&String::from_utf8_lossy(&bytes));
    parse_claude_usage_text(&output)
        .unwrap_or_else(|error| unavailable("claude", "Claude Code /usage", error))
}

fn wait_for_claude_startup(rx: &mpsc::Receiver<Vec<u8>>, bytes: &mut Vec<u8>) {
    let deadline = Instant::now() + CLAUDE_STARTUP_TIMEOUT;
    let mut saw_banner = false;
    let mut last_output = Instant::now();
    loop {
        if Instant::now() >= deadline {
            break;
        }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(chunk) => {
                last_output = Instant::now();
                let remaining = OUTPUT_LIMIT_BYTES.saturating_sub(bytes.len());
                bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                saw_banner = strip_terminal_sequences(&String::from_utf8_lossy(bytes))
                    .contains("Claude Code v");
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if saw_banner && last_output.elapsed() >= Duration::from_millis(400) {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn claude_capture_complete(bytes: &[u8]) -> bool {
    if !claude_required_windows_available(bytes) {
        return false;
    }
    let output = strip_terminal_sequences(&String::from_utf8_lossy(bytes));
    let Ok(status) = parse_claude_usage_text(&output) else {
        return false;
    };
    status
        .credits
        .as_ref()
        .and_then(|credits| credits.reset_description.as_ref())
        .is_some()
}

fn claude_required_windows_available(bytes: &[u8]) -> bool {
    let output = strip_terminal_sequences(&String::from_utf8_lossy(bytes));
    let Ok(status) = parse_claude_usage_text(&output) else {
        return false;
    };
    status.windows.iter().any(|window| window.id == "current")
        && status.windows.iter().any(|window| window.id == "weekly")
}

fn parse_claude_usage_text(output: &str) -> Result<ProviderQuotaStatus, String> {
    #[derive(Clone)]
    enum Section {
        Current,
        Weekly,
        ModelWeekly(String),
        Credits,
    }
    let mut section = None;
    let mut windows: Vec<ProviderQuotaWindow> = Vec::new();
    let mut credits: Option<ProviderCreditBalance> = None;
    let mut credit_reset = None;
    let mut pending_percent: Option<f64> = None;
    let mut plan = None;

    // PTY redraws can delimit cells with a bare carriage return. Splitting only on `lines()`
    // made the current-session heading and percentage intermittently share one logical line.
    for raw_line in output.split(['\n', '\r']) {
        let line = raw_line.trim();
        if line.contains(" · Claude ") && plan.is_none() {
            plan = line
                .split(" · ")
                .nth(1)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
        }
        if line == "Current session" {
            section = Some(Section::Current);
            pending_percent = None;
            continue;
        }
        if line == "Current week (all models)" {
            section = Some(Section::Weekly);
            pending_percent = None;
            continue;
        }
        if line.starts_with("Current week (") {
            let model = line
                .trim_start_matches("Current week (")
                .trim_end_matches(')')
                .trim()
                .to_string();
            section = Some(Section::ModelWeekly(model));
            pending_percent = None;
            continue;
        }
        if line == "Usage credits" {
            section = Some(Section::Credits);
            pending_percent = None;
            continue;
        }
        if let Some(percent) = parse_used_percent(line) {
            pending_percent = Some(percent);
            continue;
        }
        if line.starts_with("Resets ") {
            let reset = line.trim_start_matches("Resets ").trim().to_string();
            match (&section, pending_percent) {
                (Some(Section::Current), Some(used_percent)) => upsert_window(
                    &mut windows,
                    "current",
                    "Current window",
                    used_percent,
                    Some(reset),
                ),
                (Some(Section::Weekly), Some(used_percent)) => upsert_window(
                    &mut windows,
                    "weekly",
                    "Weekly window",
                    used_percent,
                    Some(reset),
                ),
                (Some(Section::ModelWeekly(model)), Some(used_percent)) => upsert_window(
                    &mut windows,
                    &format!("weekly_model_{}", quota_id_component(model)),
                    &format!("{model} weekly window"),
                    used_percent,
                    Some(reset),
                ),
                (Some(Section::Credits), _) => {
                    if credit_reset.is_none() {
                        credit_reset = Some(reset);
                    }
                    if let Some(balance) = credits.as_mut() {
                        if balance.reset_description.is_none() {
                            balance.reset_description.clone_from(&credit_reset);
                        }
                    }
                }
                _ => {}
            }
            pending_percent = None;
            continue;
        }
        let Some(used_percent) = pending_percent else {
            continue;
        };
        if matches!(&section, Some(Section::Credits)) && line.contains(" / $") {
            let (used_amount, limit_amount) = parse_credit_amounts(line);
            if credit_reset.is_none() {
                credit_reset = line
                    .split("Resets ")
                    .nth(1)
                    .map(str::trim)
                    .map(str::to_string);
            }
            credits = Some(ProviderCreditBalance {
                used_percent: Some(used_percent),
                remaining_percent: Some((100.0 - used_percent).clamp(0.0, 100.0)),
                used_amount,
                limit_amount,
                currency: Some("USD".to_string()),
                reset_description: credit_reset.clone(),
            });
            pending_percent = None;
        }
    }

    if !windows.iter().any(|window| window.id == "current")
        || !windows.iter().any(|window| window.id == "weekly")
    {
        return Err(
            "Claude Code did not expose complete current and weekly quota windows. Open Claude Code and run /usage."
                .to_string(),
        );
    }
    windows.sort_by_key(|window| match window.id.as_str() {
        "current" => 0,
        "weekly" => 1,
        _ => 2,
    });
    Ok(ProviderQuotaStatus {
        provider: "claude".to_string(),
        status: "ready".to_string(),
        source: "Claude Code /usage".to_string(),
        checked_at: chrono::Utc::now().to_rfc3339(),
        plan,
        windows,
        credits,
        reset_credits: None,
        message: None,
    })
}

fn quota_id_component(value: &str) -> String {
    let normalized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    normalized.trim_matches('_').to_string()
}

fn parse_used_percent(line: &str) -> Option<f64> {
    if !line.ends_with("used") {
        return None;
    }
    line.split_whitespace()
        .find_map(|part| part.strip_suffix('%')?.parse::<f64>().ok())
        .map(|value| value.clamp(0.0, 100.0))
}

fn parse_credit_amounts(line: &str) -> (Option<f64>, Option<f64>) {
    let before_spent = line.split("spent").next().unwrap_or(line);
    let mut amounts = before_spent.split('/').filter_map(|part| {
        let value = part
            .chars()
            .filter(|character| character.is_ascii_digit() || *character == '.')
            .collect::<String>();
        value.parse::<f64>().ok()
    });
    (amounts.next(), amounts.next())
}

fn upsert_window(
    windows: &mut Vec<ProviderQuotaWindow>,
    id: &str,
    label: &str,
    used_percent: f64,
    reset_description: Option<String>,
) {
    let window = ProviderQuotaWindow {
        id: id.to_string(),
        label: label.to_string(),
        used_percent,
        remaining_percent: (100.0 - used_percent).clamp(0.0, 100.0),
        window_duration_minutes: None,
        resets_at_unix: None,
        reset_description,
    };
    if let Some(existing) = windows.iter_mut().find(|window| window.id == id) {
        *existing = window;
    } else {
        windows.push(window);
    }
}

fn strip_terminal_sequences(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut output = String::with_capacity(input.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == 0x1b {
            index += 1;
            if index >= bytes.len() {
                break;
            }
            match bytes[index] {
                b'[' => {
                    index += 1;
                    while index < bytes.len() {
                        let byte = bytes[index];
                        index += 1;
                        if (0x40..=0x7e).contains(&byte) {
                            break;
                        }
                    }
                }
                b']' => {
                    index += 1;
                    while index < bytes.len() {
                        if bytes[index] == 0x07 {
                            index += 1;
                            break;
                        }
                        if bytes[index] == 0x1b
                            && index + 1 < bytes.len()
                            && bytes[index + 1] == b'\\'
                        {
                            index += 2;
                            break;
                        }
                        index += 1;
                    }
                }
                _ => index += 1,
            }
            continue;
        }
        let byte = bytes[index];
        index += 1;
        match byte {
            b'\r' => output.push('\n'),
            b'\n' | b'\t' => output.push(byte as char),
            0x20..=0x7e => output.push(byte as char),
            _ if byte >= 0x80 => {
                let start = index - 1;
                let width = utf8_char_width(byte);
                if start + width <= bytes.len() {
                    if let Ok(value) = std::str::from_utf8(&bytes[start..start + width]) {
                        output.push_str(value);
                        index = start + width;
                    }
                }
            }
            _ => {}
        }
    }
    output
}

fn utf8_char_width(byte: u8) -> usize {
    match byte {
        0x00..=0x7f => 1,
        0xc0..=0xdf => 2,
        0xe0..=0xef => 3,
        _ => 4,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_parser_projects_remaining_windows_without_account_identity() {
        let response = json!({
            "id": 1,
            "result": {
                "rateLimitsByLimitId": {
                    "codex": {
                        "limitId": "codex",
                        "primary": {
                            "usedPercent": 92,
                            "windowDurationMins": 10080,
                            "resetsAt": 1788750854
                        },
                        "planType": "pro"
                    },
                    "spark": {
                        "limitName": "Spark",
                        "primary": {
                            "usedPercent": 2,
                            "windowDurationMins": 300,
                            "resetsAt": 1788470093
                        }
                    }
                },
                "rateLimitResetCredits": {"availableCount": 1},
                "accountId": "must-not-be-projected"
            }
        });
        let quota = parse_codex_rate_limits(&response).expect("Codex quota");
        assert_eq!(quota.plan.as_deref(), Some("pro"));
        assert_eq!(quota.reset_credits, Some(1));
        assert_eq!(quota.windows.len(), 1);
        assert_eq!(quota.windows[0].id, "codex.primary");
        assert_eq!(quota.windows[0].remaining_percent, 8.0);
        assert!(quota
            .windows
            .iter()
            .all(|window| !window.label.contains("Spark")));
        assert!(!serde_json::to_string(&quota)
            .unwrap()
            .contains("must-not-be-projected"));
    }

    #[test]
    fn claude_parser_uses_provider_display_and_never_infers_missing_windows() {
        let output = "Claude Code v2.1.236\nOpus 5 · Claude Team · Example\n\
Current session\n3% 3% used\nResets 2:20am (Asia/Calcutta)\n\
Current week (all models)\n32% 32% used\nResets Sep 6 at 5:30pm (Asia/Calcutta)\n\
Current week (Fable)\n4% 4% used\nResets Sep 6 at 5:30pm (Asia/Calcutta)\n\
Usage credits\n0% 0% used\n$0.00 / $150.00 spent · Resets Oct 1 (Asia/Calcutta)\n";
        let quota = parse_claude_usage_text(output).expect("Claude quota");
        assert_eq!(quota.plan.as_deref(), Some("Claude Team"));
        assert_eq!(quota.windows[0].remaining_percent, 97.0);
        assert_eq!(quota.windows[1].remaining_percent, 68.0);
        assert_eq!(quota.windows[2].label, "Fable weekly window");
        assert_eq!(quota.windows[2].remaining_percent, 96.0);
        assert_eq!(quota.credits.as_ref().unwrap().limit_amount, Some(150.0));
        assert!(parse_claude_usage_text("Usage unavailable").is_err());
    }

    #[test]
    fn claude_parser_keeps_credit_reset_when_terminal_wraps_it_to_the_next_line() {
        let output = "Current session\n12% used\nResets 2:20am (Asia/Calcutta)\n\
Current week (all models)\n33% used\nResets Sep 6 at 5:30pm (Asia/Calcutta)\n\
Usage credits\n0% used\n$0.00 / $150.00 spent\nResets Oct 1 (Asia/Calcutta)\n";
        let quota = parse_claude_usage_text(output).expect("Claude quota");
        assert_eq!(quota.windows.len(), 2);
        assert_eq!(
            quota.credits.as_ref().unwrap().reset_description.as_deref(),
            Some("Oct 1 (Asia/Calcutta)")
        );
    }

    #[test]
    fn claude_parser_does_not_misclassify_in_place_current_reset_as_credit_reset() {
        let output = "Current session\n12% used\nResets 2:20am (Asia/Calcutta)\n\
Current week (all models)\n33% used\nResets Sep 6 at 5:30pm (Asia/Calcutta)\n\
Usage credits\n0% used\n$0.00 / $150.00 spent · Resets Oct 1 (Asia/Calcutta)\n\
Resets 2:19am (Asia/Calcutta)\nCurrent week (all models)\n33% used\n";
        let quota = parse_claude_usage_text(output).expect("Claude quota");
        assert_eq!(
            quota.credits.as_ref().unwrap().reset_description.as_deref(),
            Some("Oct 1 (Asia/Calcutta)")
        );
    }

    #[test]
    fn claude_parser_handles_bare_carriage_return_redraws() {
        let output = "Current session\r12% used\rResets 2:20am (Asia/Calcutta)\r\
Current week (all models)\r34% used\rResets Sep 6 at 5:30pm (Asia/Calcutta)\r\
Usage credits\r0% used\r$0.00 / $150.00 spent\rResets Oct 1 (Asia/Calcutta)\r";
        let quota = parse_claude_usage_text(output).expect("Claude quota");
        assert_eq!(quota.windows[0].id, "current");
        assert_eq!(quota.windows[0].remaining_percent, 88.0);
        assert_eq!(quota.windows[1].id, "weekly");
        assert_eq!(quota.windows[1].remaining_percent, 66.0);
    }

    #[test]
    fn claude_capture_can_finish_after_required_windows_settle_without_credits() {
        let output = b"Current session\n12% used\nResets 2:20am\n\
Current week (all models)\n34% used\nResets Sep 6 at 5:30pm\n";
        assert!(claude_required_windows_available(output));
        assert!(!claude_capture_complete(output));
    }

    #[test]
    fn terminal_sequence_stripping_preserves_unicode_and_lines() {
        let cleaned = strip_terminal_sequences("\u{1b}[2KClaude · 3% used\r\nResets 2:20am\u{7}");
        assert!(cleaned.contains("Claude · 3% used"));
        assert!(cleaned.contains("Resets 2:20am"));
        assert!(!cleaned.contains('\u{1b}'));
    }
}
