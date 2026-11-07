use std::collections::BTreeMap;
use std::path::PathBuf;

use codevetter_core::commands::finding_wording::{explain_findings, validate_wording_endpoint};
use codevetter_core::commands::verification_outcomes::{
    list_outcomes, record_outcome, OutcomeEvent, OutcomeObservation, OverrideAction,
};
use codevetter_core::db;

pub(super) struct LearningArguments {
    command: LearningCommand,
    json: bool,
}

enum LearningCommand {
    Outcomes {
        repo: PathBuf,
        run_id: String,
        operation: OutcomeOperation,
    },
    Explain {
        repo: PathBuf,
        run_id: String,
        endpoint: String,
        model: String,
    },
}

enum OutcomeOperation {
    Record(OutcomeObservation),
    List,
    Summary,
}

pub(super) fn parse(
    command: &str,
    arguments: impl Iterator<Item = String>,
) -> Result<LearningArguments, String> {
    let mut arguments = arguments.peekable();
    let mut values = BTreeMap::new();
    let mut json = false;
    while let Some(argument) = arguments.next() {
        if argument == "--json" {
            if json {
                return Err("Duplicate --json".into());
            }
            json = true;
            continue;
        }
        let allowed = match command {
            "outcomes" => &[
                "--repo",
                "--run-id",
                "--operation",
                "--event-id",
                "--kind",
                "--reason",
                "--evidence-ref",
                "--group-id",
                "--basis",
                "--action",
            ][..],
            "explain" => &["--repo", "--run-id", "--endpoint", "--model"][..],
            _ => return Err("Unknown verification learning command".into()),
        };
        if !allowed.contains(&argument.as_str()) {
            return Err(format!("Unknown {command} argument {argument}"));
        }
        let value = arguments
            .next()
            .filter(|value| !value.starts_with("--"))
            .ok_or_else(|| format!("{argument} requires a value"))?;
        if values.insert(argument.clone(), value).is_some() {
            return Err(format!("Duplicate {argument}"));
        }
    }
    let repo = PathBuf::from(take_required(&mut values, "--repo")?);
    let run_id = take_required(&mut values, "--run-id")?;
    let command = if command == "explain" {
        let endpoint = take_required(&mut values, "--endpoint")?;
        validate_wording_endpoint(&endpoint)?;
        LearningCommand::Explain {
            repo,
            run_id,
            endpoint,
            model: take_required(&mut values, "--model")?,
        }
    } else {
        let operation = match take_required(&mut values, "--operation")?.as_str() {
            "list" => OutcomeOperation::List,
            "summary" => OutcomeOperation::Summary,
            "record" => {
                let event = match take_required(&mut values, "--kind")?.as_str() {
                    "incident" => OutcomeEvent::Incident,
                    "revert" => OutcomeEvent::Revert,
                    "confirmed_safe" => OutcomeEvent::ConfirmedSafe {
                        basis: take_required(&mut values, "--basis")?,
                    },
                    "human_override" => OutcomeEvent::HumanOverride {
                        action: match take_required(&mut values, "--action")?.as_str() {
                            "accept" => OverrideAction::Accept,
                            "reject" => OverrideAction::Reject,
                            "defer" => OverrideAction::Defer,
                            _ => {
                                return Err(
                                    "Override action must be accept, reject, or defer".into()
                                )
                            }
                        },
                    },
                    _ => return Err(
                        "Outcome kind must be incident, revert, confirmed_safe, or human_override"
                            .into(),
                    ),
                };
                OutcomeOperation::Record(OutcomeObservation {
                    event_id: take_required(&mut values, "--event-id")?,
                    reason: take_required(&mut values, "--reason")?,
                    evidence_ref: take_required(&mut values, "--evidence-ref")?,
                    group_id: values.remove("--group-id"),
                    event,
                })
            }
            _ => return Err("Outcomes operation must be record, list, or summary".into()),
        };
        LearningCommand::Outcomes {
            repo,
            run_id,
            operation,
        }
    };
    if !values.is_empty() {
        return Err("Argument is not valid for the selected operation or outcome kind".into());
    }
    Ok(LearningArguments { command, json })
}

fn take_required(values: &mut BTreeMap<String, String>, key: &str) -> Result<String, String> {
    values
        .remove(key)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{key} is required"))
}

pub(super) async fn run(arguments: LearningArguments) -> Result<i32, String> {
    let repo = match &arguments.command {
        LearningCommand::Outcomes { repo, .. } | LearningCommand::Explain { repo, .. } => repo,
    };
    let repo = repo
        .canonicalize()
        .map_err(|_| "Repository path is unavailable")?;
    if !repo.is_dir() || !repo.join(".git").exists() {
        return Err("A local Git repository root is required".into());
    }
    let repo = repo.to_str().ok_or("Repository path must be UTF-8")?;
    let connection = db::init_db(super::default_app_data_dir()?)
        .map_err(|error| format!("Open CodeVetter database: {error}"))?;
    let value = match arguments.command {
        LearningCommand::Outcomes { run_id, operation, .. } => match operation {
            OutcomeOperation::Record(observation) => serde_json::to_value(record_outcome(&connection, repo, &run_id, observation)?),
            OutcomeOperation::List => serde_json::to_value(list_outcomes(&connection, repo, &run_id)?),
            OutcomeOperation::Summary => {
                let projection = list_outcomes(&connection, repo, &run_id)?;
                Ok(serde_json::json!({"schema_version":projection.schema_version, "source":projection.source, "summary":projection.summary}))
            }
        },
        LearningCommand::Explain { run_id, endpoint, model, .. } => serde_json::to_value(explain_findings(&connection, repo, &run_id, &endpoint, &model).await?),
    }.map_err(|error| error.to_string())?;
    let rendered = if arguments.json {
        serde_json::to_string(&value)
    } else {
        serde_json::to_string_pretty(&value)
    }
    .map_err(|error| error.to_string())?;
    println!("{rendered}");
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_args(command: &str, args: &[&str]) -> Result<LearningArguments, String> {
        parse(command, args.iter().map(|value| value.to_string()))
    }

    #[test]
    fn verification_learning_cli_requires_exact_record_and_rejects_source_spoofing() {
        let valid = [
            "--operation",
            "record",
            "--repo",
            "/fixture/repo",
            "--run-id",
            "run-1",
            "--event-id",
            "event-1",
            "--kind",
            "confirmed_safe",
            "--basis",
            "Executed regression fixture",
            "--reason",
            "Reviewed result",
            "--evidence-ref",
            "fixture:result",
            "--json",
        ];
        assert!(parse_args("outcomes", &valid).is_ok());
        assert!(parse_args("outcomes", &valid[..valid.len() - 1]).is_ok());
        let mut spoofed = valid.to_vec();
        spoofed.extend(["--head", "caller-head"]);
        assert!(parse_args("outcomes", &spoofed).is_err());
        assert!(parse_args(
            "outcomes",
            &[
                "--operation",
                "record",
                "--repo",
                "/fixture",
                "--run-id",
                "r",
                "--kind",
                "confirmed_safe"
            ]
        )
        .is_err());
        assert!(parse_args(
            "outcomes",
            &[
                "--operation",
                "summary",
                "--repo",
                "/fixture",
                "--run-id",
                "r",
                "--reason",
                "unused"
            ]
        )
        .is_err());
        assert!(parse_args(
            "explain",
            &[
                "--repo",
                "/fixture",
                "--run-id",
                "r",
                "--endpoint",
                "http://example.com/v1",
                "--model",
                "local"
            ]
        )
        .is_err());
        assert!(parse_args(
            "explain",
            &[
                "--repo",
                "/fixture",
                "--run-id",
                "r",
                "--endpoint",
                "http://127.0.0.1:9999/v1",
                "--model",
                "local",
                "--json"
            ]
        )
        .is_ok());
    }
}
