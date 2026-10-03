//! Repository-scoped adapter over the same ledger reader used by `runs`.
use crate::commands::{
    invocation_events::InvocationFilter,
    invocation_ledger::{read_invocation_ledger, InvocationLedgerReceipt, InvocationLedgerSource},
};
use serde::Deserialize;
use serde_json::{Map, Value};

#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct Query {
    task_id: Option<String>,
    skill: Option<String>,
    state: Option<String>,
    assessment: Option<String>,
    offset: usize,
    limit: Option<usize>,
}

pub fn invocation_list(
    source: Option<&InvocationLedgerSource>,
    repo_path: &str,
    arguments: Map<String, Value>,
) -> Result<InvocationLedgerReceipt, String> {
    super::validation::validate_tool_arguments("invocation_list", &arguments)?;
    let query: Query =
        serde_json::from_value(Value::Object(arguments)).map_err(|_| "invalid_invocation_query")?;
    let source = source.ok_or("invocation_ledger_not_configured")?;
    read_invocation_ledger(
        source,
        &InvocationFilter {
            repo_path: Some(repo_path.into()),
            task_id: query.task_id,
            skill: query.skill,
            state: query.state,
            assessment: query.assessment,
        },
        query.offset,
        query.limit.unwrap_or(20),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn ledger_is_startup_bound_and_queries_cannot_change_repository_or_path() {
        for value in [
            json!({"ledger":"/ignored"}),
            json!({"repo_path":"/ignored"}),
            json!({"offset":-1}),
            json!({"limit":101}),
            json!({"state":true}),
        ] {
            assert!(
                invocation_list(None, "/synthetic", value.as_object().unwrap().clone()).is_err()
            );
        }
        assert_eq!(
            invocation_list(None, "/synthetic", Map::new()).unwrap_err(),
            "invocation_ledger_not_configured"
        );
    }
}
