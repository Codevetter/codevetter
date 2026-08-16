use crate::db::queries;
use crate::DbState;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::State;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::Mutex;

const CCUSAGE_VERSION: &str = "20.0.20";
const CACHE_TTL: Duration = Duration::from_secs(30);
const EXECUTION_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_STDOUT_BYTES: usize = 32 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 1024 * 1024;
const ACCOUNTED_AGENTS: [&str; 2] = ["claude", "codex"];

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct LocalUsageTotals {
    pub input_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub cost_usd: f64,
}

impl LocalUsageTotals {
    pub fn generated_tokens(&self) -> u64 {
        self.input_tokens.saturating_add(self.output_tokens)
    }

    fn checked_add(&self, other: &Self) -> Result<Self, String> {
        Ok(Self {
            input_tokens: self
                .input_tokens
                .checked_add(other.input_tokens)
                .ok_or_else(|| "ccusage input token total overflowed".to_string())?,
            cache_creation_tokens: self
                .cache_creation_tokens
                .checked_add(other.cache_creation_tokens)
                .ok_or_else(|| "ccusage cache creation total overflowed".to_string())?,
            cache_read_tokens: self
                .cache_read_tokens
                .checked_add(other.cache_read_tokens)
                .ok_or_else(|| "ccusage cache read total overflowed".to_string())?,
            output_tokens: self
                .output_tokens
                .checked_add(other.output_tokens)
                .ok_or_else(|| "ccusage output token total overflowed".to_string())?,
            total_tokens: self
                .total_tokens
                .checked_add(other.total_tokens)
                .ok_or_else(|| "ccusage token total overflowed".to_string())?,
            cost_usd: self.cost_usd + other.cost_usd,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LocalUsageModel {
    pub model: String,
    pub totals: LocalUsageTotals,
    pub fallback: bool,
    pub priced: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LocalUsageAgent {
    pub agent: String,
    pub totals: LocalUsageTotals,
    pub models: Vec<LocalUsageModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LocalUsagePeriod {
    pub period: String,
    pub totals: LocalUsageTotals,
    pub agents: Vec<LocalUsageAgent>,
    pub models: Vec<LocalUsageModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LocalUsageSession {
    pub session_id: String,
    pub agent: String,
    pub last_activity: Option<String>,
    pub reasoning_output_tokens: u64,
    pub totals: LocalUsageTotals,
    pub models: Vec<LocalUsageModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LocalUsageProvenance {
    pub engine: String,
    pub version: String,
    pub generated_at: String,
    pub timezone: String,
    pub window: String,
    pub detected_agents: Vec<String>,
    pub excluded_agents: Vec<String>,
    pub codex_roots: Vec<String>,
    pub source_fingerprint: String,
    pub pricing_complete: bool,
    pub fallback_models: Vec<String>,
    pub unpriced_models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LocalUsageFailure {
    pub category: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LocalUsageReport {
    pub status: String,
    pub stale: bool,
    pub error: Option<LocalUsageFailure>,
    pub provenance: LocalUsageProvenance,
    pub daily: Vec<LocalUsagePeriod>,
    pub weekly: Vec<LocalUsagePeriod>,
    pub monthly: Vec<LocalUsagePeriod>,
    pub sessions: Vec<LocalUsageSession>,
    pub totals: LocalUsageTotals,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawReport {
    #[serde(default)]
    daily: Vec<RawPeriod>,
    #[serde(default)]
    weekly: Vec<RawPeriod>,
    #[serde(default)]
    monthly: Vec<RawPeriod>,
    #[serde(default, rename = "session")]
    sessions: Vec<RawSession>,
    totals: RawTotals,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawPeriod {
    agent: String,
    #[serde(default)]
    agents: Vec<RawAgent>,
    #[serde(flatten)]
    totals: RawTotals,
    #[serde(default)]
    metadata: RawMetadata,
    #[serde(default)]
    model_breakdowns: Vec<RawModel>,
    #[serde(default)]
    models_used: Vec<String>,
    period: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawAgent {
    agent: String,
    #[serde(flatten)]
    totals: RawTotals,
    #[serde(default)]
    model_breakdowns: Vec<RawModel>,
    #[serde(default)]
    models_used: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawSession {
    agent: String,
    #[serde(flatten)]
    totals: RawTotals,
    #[serde(default)]
    metadata: RawMetadata,
    #[serde(default)]
    model_breakdowns: Vec<RawModel>,
    #[serde(default)]
    models_used: Vec<String>,
    period: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawMetadata {
    #[serde(default)]
    agents: Vec<String>,
    last_activity: Option<String>,
    #[serde(default)]
    reasoning_output_tokens: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawModel {
    cache_creation_tokens: u64,
    cache_read_tokens: u64,
    cost: f64,
    input_tokens: u64,
    #[serde(default)]
    is_fallback: bool,
    model_name: String,
    output_tokens: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawTotals {
    cache_creation_tokens: u64,
    cache_read_tokens: u64,
    input_tokens: u64,
    output_tokens: u64,
    total_cost: f64,
    total_tokens: u64,
}

impl From<&RawTotals> for LocalUsageTotals {
    fn from(value: &RawTotals) -> Self {
        Self {
            input_tokens: value.input_tokens,
            cache_creation_tokens: value.cache_creation_tokens,
            cache_read_tokens: value.cache_read_tokens,
            output_tokens: value.output_tokens,
            total_tokens: value.total_tokens,
            cost_usd: value.total_cost,
        }
    }
}

#[derive(Default)]
struct UsageCache {
    report: Option<LocalUsageReport>,
    cached_at: Option<Instant>,
}

fn cache() -> &'static Arc<Mutex<UsageCache>> {
    static CACHE: OnceLock<Arc<Mutex<UsageCache>>> = OnceLock::new();
    CACHE.get_or_init(|| Arc::new(Mutex::new(UsageCache::default())))
}

#[tauri::command]
pub async fn get_local_usage_report(
    db: State<'_, DbState>,
    refresh: Option<bool>,
    timezone: Option<String>,
) -> Result<LocalUsageReport, String> {
    let roots = codex_roots(&db)?;
    let timezone = normalize_timezone(timezone.as_deref());
    let mut cache = cache().lock().await;
    if !refresh.unwrap_or(false) {
        if let (Some(report), Some(cached_at)) = (&cache.report, cache.cached_at) {
            if cached_at.elapsed() < CACHE_TTL && report.provenance.timezone == timezone {
                return Ok(report.clone());
            }
        }
    }

    match load_report(&timezone, &roots).await {
        Ok(report) => {
            cache.report = Some(report.clone());
            cache.cached_at = Some(Instant::now());
            Ok(report)
        }
        Err(failure) => {
            if let Some(report) = cache.report.as_mut() {
                report.status = "stale".into();
                report.stale = true;
                report.error = Some(failure);
                return Ok(report.clone());
            }
            Ok(unavailable_report(timezone, roots, failure))
        }
    }
}

fn codex_roots(db: &State<'_, DbState>) -> Result<Vec<String>, String> {
    let mut roots = BTreeSet::new();
    if let Ok(value) = std::env::var("CODEX_HOME") {
        roots.extend(
            value
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty() && !value.contains(','))
                .map(str::to_string),
        );
    }
    if roots.is_empty() {
        if let Ok(home) = std::env::var("HOME") {
            roots.insert(
                PathBuf::from(home)
                    .join(".codex")
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    if let Ok(Some(raw)) = queries::get_preference(&conn, "codex_usage_import_roots") {
        if let Ok(imports) = serde_json::from_str::<Vec<String>>(&raw) {
            roots.extend(
                imports
                    .into_iter()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty() && !value.contains(',')),
            );
        }
    }
    Ok(roots.into_iter().collect())
}

async fn load_report(
    timezone: &str,
    roots: &[String],
) -> Result<LocalUsageReport, LocalUsageFailure> {
    let binary = resolve_ccusage_binary().ok_or_else(|| {
        failure(
            "missing_binary",
            "The bundled ccusage executable is missing. Reinstall or update CodeVetter.",
        )
    })?;
    let stdout = run_ccusage(&binary, timezone, roots, ExecutionLimits::default()).await?;
    normalize_report(&stdout, timezone, roots).map_err(|message| failure("invalid_report", message))
}

#[derive(Clone, Copy)]
struct ExecutionLimits {
    timeout: Duration,
    stdout_bytes: usize,
    stderr_bytes: usize,
}

impl Default for ExecutionLimits {
    fn default() -> Self {
        Self {
            timeout: EXECUTION_TIMEOUT,
            stdout_bytes: MAX_STDOUT_BYTES,
            stderr_bytes: MAX_STDERR_BYTES,
        }
    }
}

async fn run_ccusage(
    binary: &Path,
    timezone: &str,
    roots: &[String],
    limits: ExecutionLimits,
) -> Result<Vec<u8>, LocalUsageFailure> {
    let config_path = std::env::temp_dir().join(format!(
        "codevetter-ccusage-config-{}.json",
        std::process::id()
    ));
    std::fs::write(&config_path, b"{}")
        .map_err(|error| failure("config", format!("Create ccusage config: {error}")))?;
    let mut command = Command::new(binary);
    command
        .args([
            "daily",
            "--json",
            "--offline",
            "--sections",
            "daily,weekly,monthly,session",
            "--by-agent",
            "--timezone",
            timezone,
            "--config",
        ])
        .arg(&config_path)
        .arg("--no-color")
        .current_dir(std::env::temp_dir())
        .env_remove("CCUSAGE_TIMEZONE")
        .env_remove("LOG_LEVEL")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if !roots.is_empty() {
        command.env("CODEX_HOME", roots.join(","));
    }
    let mut child = command
        .spawn()
        .map_err(|error| failure("launch", format!("Launch bundled ccusage: {error}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| failure("launch", "ccusage stdout was unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| failure("launch", "ccusage stderr was unavailable"))?;
    let execution = tokio::time::timeout(limits.timeout, async {
        let (status, stdout, stderr) = tokio::join!(
            child.wait(),
            read_capped(stdout, limits.stdout_bytes),
            read_capped(stderr, limits.stderr_bytes)
        );
        (status, stdout, stderr)
    })
    .await;
    let _ = std::fs::remove_file(&config_path);

    let (status, stdout, stderr) = match execution {
        Ok(result) => result,
        Err(_) => {
            let _ = child.kill().await;
            return Err(failure(
                "timeout",
                format!(
                    "ccusage exceeded the {} second limit",
                    limits.timeout.as_secs()
                ),
            ));
        }
    };
    let status = status.map_err(|error| failure("wait", format!("Wait for ccusage: {error}")))?;
    let (stdout, stdout_exceeded) =
        stdout.map_err(|error| failure("read", format!("Read ccusage output: {error}")))?;
    let (stderr, stderr_exceeded) =
        stderr.map_err(|error| failure("read", format!("Read ccusage diagnostics: {error}")))?;
    if stdout_exceeded {
        return Err(failure(
            "oversized_output",
            format!("ccusage output exceeded {} bytes", limits.stdout_bytes),
        ));
    }
    if stderr_exceeded {
        return Err(failure(
            "oversized_diagnostics",
            format!("ccusage diagnostics exceeded {} bytes", limits.stderr_bytes),
        ));
    }
    if !status.success() {
        let detail = String::from_utf8_lossy(&stderr);
        return Err(failure(
            "non_zero_exit",
            format!("ccusage exited with {status}: {}", detail.trim()),
        ));
    }
    Ok(stdout)
}

async fn read_capped<R: AsyncRead + Unpin>(
    mut reader: R,
    limit: usize,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut output = Vec::with_capacity(limit.min(64 * 1024));
    let mut exceeded = false;
    let mut buffer = [0u8; 8192];
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        let remaining = limit.saturating_sub(output.len());
        if remaining > 0 {
            output.extend_from_slice(&buffer[..read.min(remaining)]);
        }
        if read > remaining {
            exceeded = true;
        }
    }
    Ok((output, exceeded))
}

fn normalize_report(
    bytes: &[u8],
    timezone: &str,
    roots: &[String],
) -> Result<LocalUsageReport, String> {
    let raw: RawReport = serde_json::from_slice(bytes)
        .map_err(|error| format!("Parse pinned ccusage JSON contract: {error}"))?;
    validate_report(&raw)?;

    let daily = raw
        .daily
        .iter()
        .map(normalize_accounted_period)
        .collect::<Result<Vec<_>, _>>()?;
    let weekly = raw
        .weekly
        .iter()
        .map(normalize_accounted_period)
        .collect::<Result<Vec<_>, _>>()?;
    let monthly = raw
        .monthly
        .iter()
        .map(normalize_accounted_period)
        .collect::<Result<Vec<_>, _>>()?;
    let sessions = raw
        .sessions
        .iter()
        .filter(|session| is_accounted_agent(&session.agent))
        .map(|session| LocalUsageSession {
            session_id: session.period.clone(),
            agent: session.agent.clone(),
            last_activity: session.metadata.last_activity.clone(),
            reasoning_output_tokens: session.metadata.reasoning_output_tokens,
            totals: (&session.totals).into(),
            models: normalize_models(&session.model_breakdowns),
        })
        .collect::<Vec<_>>();
    let totals = daily
        .iter()
        .try_fold(LocalUsageTotals::default(), |totals, period| {
            totals.checked_add(&period.totals)
        })?;
    let session_totals = sessions
        .iter()
        .try_fold(LocalUsageTotals::default(), |totals, session| {
            totals.checked_add(&session.totals)
        })?;
    compare_totals(&session_totals, &totals, "accounted session")?;
    let mut detected_agents = BTreeSet::new();
    let mut excluded_agents = BTreeSet::new();
    for period in &raw.daily {
        for agent in period
            .metadata
            .agents
            .iter()
            .chain(period.agents.iter().map(|agent| &agent.agent))
        {
            if is_accounted_agent(agent) {
                detected_agents.insert(agent.clone());
            } else {
                excluded_agents.insert(agent.clone());
            }
        }
    }
    for session in &raw.sessions {
        if is_accounted_agent(&session.agent) {
            detected_agents.insert(session.agent.clone());
        } else {
            excluded_agents.insert(session.agent.clone());
        }
    }
    let models = daily
        .iter()
        .flat_map(|period| period.agents.iter())
        .flat_map(|agent| agent.models.iter())
        .chain(sessions.iter().flat_map(|session| session.models.iter()));
    let mut fallback_models = BTreeSet::new();
    let mut unpriced_models = BTreeSet::new();
    for model in models {
        if model.fallback {
            fallback_models.insert(model.model.clone());
        }
        if !model.priced {
            unpriced_models.insert(model.model.clone());
        }
    }
    let fingerprint = format!("sha256:{:x}", Sha256::digest(bytes));
    Ok(LocalUsageReport {
        status: "ready".into(),
        stale: false,
        error: None,
        provenance: LocalUsageProvenance {
            engine: "ccusage".into(),
            version: CCUSAGE_VERSION.into(),
            generated_at: Utc::now().to_rfc3339(),
            timezone: timezone.into(),
            window: "all".into(),
            detected_agents: detected_agents.into_iter().collect(),
            excluded_agents: excluded_agents.into_iter().collect(),
            codex_roots: roots.to_vec(),
            source_fingerprint: fingerprint,
            pricing_complete: unpriced_models.is_empty(),
            fallback_models: fallback_models.into_iter().collect(),
            unpriced_models: unpriced_models.into_iter().collect(),
        },
        daily,
        weekly,
        monthly,
        sessions,
        totals,
    })
}

fn normalize_accounted_period(period: &RawPeriod) -> Result<LocalUsagePeriod, String> {
    let _ = (&period.agent, &period.models_used);
    let agents = period
        .agents
        .iter()
        .filter(|agent| is_accounted_agent(&agent.agent))
        .map(|agent| {
            let _ = &agent.models_used;
            LocalUsageAgent {
                agent: agent.agent.clone(),
                totals: (&agent.totals).into(),
                models: normalize_models(&agent.model_breakdowns),
            }
        })
        .collect::<Vec<_>>();
    let totals = agents
        .iter()
        .try_fold(LocalUsageTotals::default(), |totals, agent| {
            totals.checked_add(&agent.totals)
        })?;
    let models = merge_models(agents.iter().flat_map(|agent| agent.models.iter()))?;
    Ok(LocalUsagePeriod {
        period: period.period.clone(),
        totals,
        agents,
        models,
    })
}

fn is_accounted_agent(agent: &str) -> bool {
    ACCOUNTED_AGENTS.contains(&agent)
}

fn merge_models<'a>(
    models: impl Iterator<Item = &'a LocalUsageModel>,
) -> Result<Vec<LocalUsageModel>, String> {
    let mut merged = std::collections::BTreeMap::<String, LocalUsageModel>::new();
    for model in models {
        match merged.get_mut(&model.model) {
            Some(current) => {
                current.totals = current.totals.checked_add(&model.totals)?;
                current.fallback |= model.fallback;
                current.priced &= model.priced;
            }
            None => {
                merged.insert(model.model.clone(), model.clone());
            }
        }
    }
    Ok(merged.into_values().collect())
}

fn normalize_models(models: &[RawModel]) -> Vec<LocalUsageModel> {
    models
        .iter()
        .map(|model| {
            let totals = LocalUsageTotals {
                input_tokens: model.input_tokens,
                cache_creation_tokens: model.cache_creation_tokens,
                cache_read_tokens: model.cache_read_tokens,
                output_tokens: model.output_tokens,
                total_tokens: model.input_tokens
                    + model.cache_creation_tokens
                    + model.cache_read_tokens
                    + model.output_tokens,
                cost_usd: model.cost,
            };
            LocalUsageModel {
                model: model.model_name.clone(),
                fallback: model.is_fallback,
                priced: totals.total_tokens == 0 || totals.cost_usd > 0.0,
                totals,
            }
        })
        .collect()
}

fn validate_report(report: &RawReport) -> Result<(), String> {
    validate_totals(&report.totals, "totals")?;
    validate_section(&report.daily, &report.totals, "daily")?;
    validate_section(&report.weekly, &report.totals, "weekly")?;
    validate_section(&report.monthly, &report.totals, "monthly")?;
    let session_total =
        report
            .sessions
            .iter()
            .try_fold(LocalUsageTotals::default(), |total, session| {
                validate_totals(&session.totals, "session")?;
                validate_models(&session.model_breakdowns, &session.totals, "session models")?;
                total.checked_add(&LocalUsageTotals::from(&session.totals))
            })?;
    compare_totals(
        &session_total,
        &LocalUsageTotals::from(&report.totals),
        "session",
    )?;
    Ok(())
}

fn validate_section(rows: &[RawPeriod], expected: &RawTotals, label: &str) -> Result<(), String> {
    let total = rows
        .iter()
        .try_fold(LocalUsageTotals::default(), |total, row| {
            validate_totals(&row.totals, label)?;
            validate_models(
                &row.model_breakdowns,
                &row.totals,
                &format!("{label} models"),
            )?;
            if !row.agents.is_empty() {
                let agent_total = row.agents.iter().try_fold(
                    LocalUsageTotals::default(),
                    |agent_total, agent| {
                        validate_totals(&agent.totals, &format!("{label} agent"))?;
                        validate_models(
                            &agent.model_breakdowns,
                            &agent.totals,
                            &format!("{label} agent models"),
                        )?;
                        agent_total.checked_add(&LocalUsageTotals::from(&agent.totals))
                    },
                )?;
                compare_totals(&agent_total, &LocalUsageTotals::from(&row.totals), label)?;
            }
            total.checked_add(&LocalUsageTotals::from(&row.totals))
        })?;
    compare_totals(&total, &LocalUsageTotals::from(expected), label)
}

fn validate_models(models: &[RawModel], expected: &RawTotals, label: &str) -> Result<(), String> {
    if models.is_empty() {
        return Ok(());
    }
    let total = models
        .iter()
        .try_fold(LocalUsageTotals::default(), |total, model| {
            if !model.cost.is_finite() || model.cost < 0.0 {
                return Err(format!("{label} contains an invalid cost"));
            }
            total.checked_add(&LocalUsageTotals {
                input_tokens: model.input_tokens,
                cache_creation_tokens: model.cache_creation_tokens,
                cache_read_tokens: model.cache_read_tokens,
                output_tokens: model.output_tokens,
                total_tokens: model.input_tokens
                    + model.cache_creation_tokens
                    + model.cache_read_tokens
                    + model.output_tokens,
                cost_usd: model.cost,
            })
        })?;
    compare_totals(&total, &LocalUsageTotals::from(expected), label)
}

fn validate_totals(totals: &RawTotals, label: &str) -> Result<(), String> {
    if !totals.total_cost.is_finite() || totals.total_cost < 0.0 {
        return Err(format!("{label} contains an invalid cost"));
    }
    let computed = totals
        .input_tokens
        .checked_add(totals.cache_creation_tokens)
        .and_then(|value| value.checked_add(totals.cache_read_tokens))
        .and_then(|value| value.checked_add(totals.output_tokens))
        .ok_or_else(|| format!("{label} token total overflowed"))?;
    if computed != totals.total_tokens {
        return Err(format!(
            "{label} totalTokens did not reconcile: expected {}, computed {computed}",
            totals.total_tokens
        ));
    }
    Ok(())
}

fn compare_totals(
    actual: &LocalUsageTotals,
    expected: &LocalUsageTotals,
    label: &str,
) -> Result<(), String> {
    if actual.input_tokens != expected.input_tokens
        || actual.cache_creation_tokens != expected.cache_creation_tokens
        || actual.cache_read_tokens != expected.cache_read_tokens
        || actual.output_tokens != expected.output_tokens
        || actual.total_tokens != expected.total_tokens
        || !cost_close(actual.cost_usd, expected.cost_usd)
    {
        return Err(format!(
            "{label} breakdown did not reconcile with the report total"
        ));
    }
    Ok(())
}

fn cost_close(left: f64, right: f64) -> bool {
    (left - right).abs() <= 0.000_001_f64.max(right.abs() * 0.000_000_001)
}

fn unavailable_report(
    timezone: String,
    roots: Vec<String>,
    error: LocalUsageFailure,
) -> LocalUsageReport {
    LocalUsageReport {
        status: "unavailable".into(),
        stale: false,
        error: Some(error),
        provenance: LocalUsageProvenance {
            engine: "ccusage".into(),
            version: CCUSAGE_VERSION.into(),
            generated_at: Utc::now().to_rfc3339(),
            timezone,
            window: "all".into(),
            detected_agents: Vec::new(),
            excluded_agents: Vec::new(),
            codex_roots: roots,
            source_fingerprint: String::new(),
            pricing_complete: false,
            fallback_models: Vec::new(),
            unpriced_models: Vec::new(),
        },
        daily: Vec::new(),
        weekly: Vec::new(),
        monthly: Vec::new(),
        sessions: Vec::new(),
        totals: LocalUsageTotals::default(),
    }
}

fn normalize_timezone(value: Option<&str>) -> String {
    let value = value.unwrap_or("UTC").trim();
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'_' | b'-' | b'+'))
    {
        "UTC".into()
    } else {
        value.into()
    }
}

fn resolve_ccusage_binary() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CODEVETTER_CCUSAGE_BIN") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    let name = if cfg!(windows) {
        "ccusage.exe"
    } else {
        "ccusage"
    };
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            let bundled = parent.join(name);
            if bundled.is_file() {
                return Some(bundled);
            }
        }
    }
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!(
            "ccusage-{}{}",
            host_target(),
            if cfg!(windows) { ".exe" } else { "" }
        ));
    development.is_file().then_some(development)
}

fn host_target() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "aarch64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
        "aarch64-pc-windows-msvc"
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else {
        "unsupported"
    }
}

fn failure(category: impl Into<String>, message: impl Into<String>) -> LocalUsageFailure {
    LocalUsageFailure {
        category: category.into(),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use tempfile::TempDir;

    const UNIFIED: &[u8] = include_bytes!("../../tests/fixtures/ccusage/unified.json");
    const EMPTY: &[u8] = include_bytes!("../../tests/fixtures/ccusage/empty.json");

    #[test]
    fn normalizes_pinned_unified_contract() {
        let report = normalize_report(UNIFIED, "Asia/Kolkata", &["/tmp/codex".into()]).unwrap();
        assert_eq!(report.status, "ready");
        assert_eq!(report.totals.total_tokens, 37);
        assert_eq!(report.daily[0].agents.len(), 2);
        assert_eq!(report.sessions.len(), 2);
        assert_eq!(report.provenance.fallback_models, vec!["gpt-5.6-sol"]);
        assert_eq!(report.provenance.unpriced_models, vec!["claude-opus-5"]);
        assert!(!report.provenance.pricing_complete);
    }

    #[test]
    fn accepts_an_empty_report() {
        let report = normalize_report(EMPTY, "UTC", &[]).unwrap();
        assert_eq!(report.totals, LocalUsageTotals::default());
        assert!(report.daily.is_empty());
        assert!(report.provenance.pricing_complete);
    }

    #[test]
    fn rejects_invalid_json_and_non_reconciling_totals() {
        assert!(normalize_report(b"not-json", "UTC", &[]).is_err());
        let invalid = String::from_utf8(UNIFIED.to_vec()).unwrap().replacen(
            "\"totalTokens\": 37",
            "\"totalTokens\": 38",
            1,
        );
        assert!(normalize_report(invalid.as_bytes(), "UTC", &[])
            .unwrap_err()
            .contains("did not reconcile"));
    }

    #[test]
    fn normalizes_only_safe_timezone_values() {
        assert_eq!(normalize_timezone(Some("Asia/Kolkata")), "Asia/Kolkata");
        assert_eq!(normalize_timezone(Some("$(touch nope)")), "UTC");
    }

    #[cfg(unix)]
    fn executable(script: &str) -> (TempDir, PathBuf) {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("ccusage");
        fs::write(&path, script).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();
        (directory, path)
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn executes_a_real_process_and_reads_json() {
        let (directory, binary) =
            executable("#!/bin/sh\nexec /bin/cat \"$(dirname \"$0\")/report.json\"\n");
        fs::write(directory.path().join("report.json"), EMPTY).unwrap();
        let output = run_ccusage(
            &binary,
            "UTC",
            &[],
            ExecutionLimits {
                timeout: Duration::from_secs(2),
                stdout_bytes: 4096,
                stderr_bytes: 4096,
            },
        )
        .await
        .unwrap();
        assert!(normalize_report(&output, "UTC", &[]).is_ok());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn categorizes_nonzero_oversized_and_timeout_failures() {
        let (_directory, binary) = executable("#!/bin/sh\necho broken >&2\nexit 7\n");
        let error = run_ccusage(&binary, "UTC", &[], ExecutionLimits::default())
            .await
            .unwrap_err();
        assert_eq!(error.category, "non_zero_exit");

        let (_directory, binary) = executable("#!/bin/sh\nprintf '123456789'\n");
        let error = run_ccusage(
            &binary,
            "UTC",
            &[],
            ExecutionLimits {
                timeout: Duration::from_secs(2),
                stdout_bytes: 4,
                stderr_bytes: 4,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.category, "oversized_output");

        let (_directory, binary) = executable("#!/bin/sh\nsleep 2\n");
        let error = run_ccusage(
            &binary,
            "UTC",
            &[],
            ExecutionLimits {
                timeout: Duration::from_millis(20),
                stdout_bytes: 4,
                stderr_bytes: 4,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.category, "timeout");
    }
}
