//! Optional ccusage Claude project attribution. The unified daily ledger stays authoritative.
use super::{LocalUsageReport, LocalUsageTotals};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LocalUsageProject {
    pub project: String,
    pub agent: String,
    pub totals: LocalUsageTotals,
}

#[derive(Deserialize)]
struct ProjectReport {
    projects: BTreeMap<String, Vec<ProjectDay>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectDay {
    date: String,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_tokens: u64,
    cache_read_tokens: u64,
    total_tokens: u64,
    total_cost: f64,
}

fn within(value: &LocalUsageTotals, limit: &LocalUsageTotals) -> bool {
    value.input_tokens <= limit.input_tokens
        && value.output_tokens <= limit.output_tokens
        && value.cache_creation_tokens <= limit.cache_creation_tokens
        && value.cache_read_tokens <= limit.cache_read_tokens
        && value.total_tokens <= limit.total_tokens
        && value.cost_usd.is_finite()
        && value.cost_usd >= 0.0
        && value.cost_usd <= limit.cost_usd + 0.000_001
}

pub(super) fn attach(report: &mut LocalUsageReport, bytes: &[u8]) -> Result<(), String> {
    let raw: ProjectReport = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let mut days: BTreeMap<String, Vec<LocalUsageProject>> = BTreeMap::new();
    let mut seen = BTreeSet::new();
    for (project, rows) in raw.projects {
        if project.trim().is_empty()
            || project.len() > 4096
            || project.chars().any(char::is_control)
        {
            return Err("Invalid ccusage project identity".into());
        }
        for row in rows {
            if chrono::NaiveDate::parse_from_str(&row.date, "%Y-%m-%d").is_err()
                || !seen.insert((project.clone(), row.date.clone()))
            {
                return Err("Invalid or duplicate project day".into());
            }
            let totals = LocalUsageTotals {
                input_tokens: row.input_tokens,
                output_tokens: row.output_tokens,
                cache_creation_tokens: row.cache_creation_tokens,
                cache_read_tokens: row.cache_read_tokens,
                total_tokens: row.total_tokens,
                cost_usd: row.total_cost,
            };
            if !totals.cost_usd.is_finite() || totals.cost_usd < 0.0 {
                return Err("Invalid project cost".into());
            }
            days.entry(row.date).or_default().push(LocalUsageProject {
                project: project.clone(),
                agent: "claude".into(),
                totals,
            });
        }
    }
    // Two scans can race with a new log entry. Reject mismatched days rather than
    // attributing more tokens or cost than the canonical provider ledger contains.
    let mut reconciled = Vec::new();
    for (index, day) in report.daily.iter().enumerate() {
        let Some(rows) = days.remove(&day.period) else {
            continue;
        };
        let Some(claude) = day.agents.iter().find(|a| a.agent == "claude") else {
            continue;
        };
        let summed = rows
            .iter()
            .try_fold(LocalUsageTotals::default(), |sum, row| {
                sum.checked_add(&row.totals)
            })?;
        if within(&summed, &claude.totals) {
            reconciled.push((index, rows));
        }
    }
    for (index, rows) in reconciled {
        report.daily[index].projects = rows;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(input: u64, cost: f64) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"projects":{"repo-a":[{
            "date":"2026-08-16", "inputTokens":input,"outputTokens":0,
            "cacheCreationTokens":0,"cacheReadTokens":0,"totalTokens":input,"totalCost":cost
        }]}}))
        .unwrap()
    }
    fn report() -> LocalUsageReport {
        let mut report = super::super::normalize_report(
            include_bytes!("../../tests/fixtures/ccusage/unified.json"),
            "UTC",
            &[],
        )
        .unwrap();
        report.daily[0].period = "2026-08-16".into();
        report
    }
    #[test]
    fn projects_reconcile_without_changing_accounting() {
        let mut report = report();
        let totals = report.totals.clone();
        attach(&mut report, &fixture(1, 0.0)).unwrap();
        assert_eq!(report.daily[0].projects[0].project, "repo-a");
        assert_eq!(report.totals, totals);
    }
    #[test]
    fn excess_or_invalid_attribution_does_not_replace_the_ledger() {
        let mut report = report();
        attach(&mut report, &fixture(u64::MAX, 0.0)).unwrap();
        assert!(report.daily[0].projects.is_empty());
        assert!(attach(&mut report, &fixture(1, -1.0)).is_err());
        assert!(attach(&mut report, b"{}").is_err());
    }

    #[test]
    fn overflow_does_not_partially_enrich_a_report() {
        let mut report = report();
        let mut second = report.daily[0].clone();
        second.period = "2026-08-17".into();
        report.daily.push(second);
        let mut raw: serde_json::Value = serde_json::from_slice(&fixture(1, 0.0)).unwrap();
        let mut huge = raw["projects"]["repo-a"][0].clone();
        huge["date"] = "2026-08-17".into();
        huge["inputTokens"] = u64::MAX.into();
        raw["projects"]["repo-a"]
            .as_array_mut()
            .unwrap()
            .push(huge.clone());
        raw["projects"]["repo-b"] = serde_json::json!([huge]);
        assert!(attach(&mut report, &serde_json::to_vec(&raw).unwrap()).is_err());
        assert!(report.daily.iter().all(|day| day.projects.is_empty()));
    }
}
