use crate::{
    commands::{history_read::HistorySearchKind, structural_graph::query::GraphQueryFilter},
    mcp::{
        contracts::tool_fields,
        limits::{MAX_HOPS, MAX_PAGE_SIZE},
    },
};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct McpHistoryFilter {
    kinds: Vec<HistorySearchKind>,
    from: Option<String>,
    to: Option<String>,
}

impl McpHistoryFilter {
    pub(crate) fn validate(&self) -> Result<(), String> {
        let from = self.from.as_deref().map(parse_filter_time).transpose()?;
        let to = self.to.as_deref().map(parse_filter_time).transpose()?;
        if from.zip(to).is_some_and(|(from, to)| from > to) {
            return Err("History filter 'from' must not be after 'to'".to_string());
        }
        Ok(())
    }

    pub(crate) fn includes_kind(&self, kind: &HistorySearchKind) -> bool {
        self.kinds.is_empty() || self.kinds.contains(kind)
    }

    pub(crate) fn includes_time(&self, value: Option<&str>) -> bool {
        let Some(value) = value.and_then(|value| parse_filter_time(value).ok()) else {
            return self.from.is_none() && self.to.is_none();
        };
        let after_start = self
            .from
            .as_deref()
            .and_then(|value| parse_filter_time(value).ok())
            .is_none_or(|from| value >= from);
        let before_end = self
            .to
            .as_deref()
            .and_then(|value| parse_filter_time(value).ok())
            .is_none_or(|to| value <= to);
        after_start && before_end
    }
}

fn parse_filter_time(value: &str) -> Result<chrono::DateTime<chrono::FixedOffset>, String> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map_err(|_| "History filter dates must be RFC 3339 timestamps".to_string())
}

pub(crate) fn validate_tool_arguments(
    name: &str,
    arguments: &Map<String, Value>,
) -> Result<(), String> {
    let allowed = tool_fields(name).ok_or_else(|| "Unknown CodeVetter history tool".to_string())?;
    if let Some(field) = arguments
        .keys()
        .find(|field| !allowed.contains(&field.as_str()))
    {
        return Err(format!("Unknown '{field}' argument for {name}"));
    }

    for field in ["query", "node", "from", "to", "entity"] {
        if let Some(value) = arguments.get(field) {
            let text = value
                .as_str()
                .filter(|text| text.len() <= 4_096)
                .ok_or_else(|| format!("'{field}' must be a bounded string"))?;
            if text.trim().is_empty() {
                return Err(format!("'{field}' must not be empty"));
            }
        }
    }
    if let Some(value) = arguments.get("cursor") {
        value
            .as_str()
            .filter(|cursor| cursor.len() <= 2_048)
            .ok_or_else(|| "'cursor' must be a bounded string".to_string())?;
    }
    validate_integer(arguments, "limit", 1, MAX_PAGE_SIZE)?;
    validate_integer(arguments, "depth", 1, MAX_HOPS)?;

    if let Some(value) = arguments.get("filter") {
        validate_object_keys(value, "filter", &["node_kinds", "edge_kinds", "trust"])?;
        let filter: GraphQueryFilter = serde_json::from_value(value.clone())
            .map_err(|_| "'filter' has an invalid shape".to_string())?;
        if filter.node_kinds.len() > 32 || filter.edge_kinds.len() > 32 || filter.trust.len() > 4 {
            return Err("'filter' exceeds its bounded arrays".to_string());
        }
    }
    if let Some(value) = arguments.get("history_filter") {
        validate_object_keys(value, "history_filter", &["kinds", "from", "to"])?;
        let filter: McpHistoryFilter = serde_json::from_value(value.clone())
            .map_err(|_| "'history_filter' has an invalid shape".to_string())?;
        if filter.kinds.len() > 5 {
            return Err("'history_filter.kinds' exceeds 5 values".to_string());
        }
        filter.validate()?;
    }
    for field in ["reference", "before", "after"] {
        if let Some(value) = arguments.get(field) {
            validate_tagged_selector(
                value,
                field,
                &[("revision", "revision"), ("release", "tag"), ("date", "at")],
            )?;
        }
    }
    if let Some(value) = arguments.get("selector") {
        validate_tagged_selector(
            value,
            "selector",
            &[
                ("event", "event_id"),
                ("entity", "entity_id"),
                ("revision", "revision"),
                ("release", "tag"),
                ("episode_key", "key"),
            ],
        )?;
    }
    Ok(())
}

fn validate_integer(
    arguments: &Map<String, Value>,
    field: &str,
    minimum: usize,
    maximum: usize,
) -> Result<(), String> {
    let Some(value) = arguments.get(field) else {
        return Ok(());
    };
    let value = value
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| (*value >= minimum) && (*value <= maximum))
        .ok_or_else(|| format!("'{field}' must be between {minimum} and {maximum}"))?;
    let _ = value;
    Ok(())
}

fn validate_object_keys(value: &Value, field: &str, allowed: &[&str]) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("'{field}' must be an object"))?;
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(format!("'{field}' contains an unknown field"));
    }
    Ok(())
}

fn validate_tagged_selector(
    value: &Value,
    field: &str,
    variants: &[(&str, &str)],
) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("'{field}' must be an object"))?;
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("'{field}.kind' is required"))?;
    let payload = variants
        .iter()
        .find_map(|(variant, payload)| (*variant == kind).then_some(*payload))
        .ok_or_else(|| format!("'{field}.kind' is invalid"))?;
    if object.len() != 2 || object.keys().any(|key| key != "kind" && key != payload) {
        return Err(format!("'{field}' contains an unknown field"));
    }
    object
        .get(payload)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 4_096)
        .ok_or_else(|| format!("'{field}.{payload}' must be a bounded string"))?;
    Ok(())
}
