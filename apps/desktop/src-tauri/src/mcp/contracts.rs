use crate::mcp::limits::{MAX_EVIDENCE_IDS, MAX_HOPS, MAX_PAGE_SIZE};
use rmcp::model::{JsonObject, Tool, ToolAnnotations};
use serde_json::{json, Map, Value};
use std::sync::Arc;

pub(crate) fn tool_definitions() -> Vec<Tool> {
    let specs = [
        (
            "graph_query",
            "Search the canonical structural graph or return a compact overview",
            &[] as &[&str],
        ),
        (
            "graph_get_node",
            "Explain one stable graph node with source-backed relationships",
            &["node"],
        ),
        (
            "graph_get_neighbors",
            "Return bounded filtered neighbors for one graph node",
            &["node"],
        ),
        (
            "graph_path",
            "Find a trust-weighted structural path between two graph nodes",
            &["from", "to"],
        ),
        (
            "graph_impact",
            "Return bounded upstream or downstream structural impact leads",
            &["node"],
        ),
        (
            "history_list_releases",
            "List compact indexed release summaries",
            &[],
        ),
        (
            "history_search",
            "Search releases, commits, entities, events, and annotations",
            &["query"],
        ),
        (
            "history_get_state",
            "Reconstruct a persisted as-of release, commit, or date state",
            &["reference"],
        ),
        (
            "history_lineage",
            "Follow one entity across moves, renames, splits, merges, and removals",
            &["entity", "reference"],
        ),
        (
            "history_explain",
            "Explain what, why, when, how, verification, and outcome with cited gaps",
            &["entity", "reference"],
        ),
        (
            "history_trace",
            "Trace bounded qualified evidence from intent through verification and outcome",
            &["selector"],
        ),
        (
            "history_compare",
            "Compare two persisted historical states without implying unsupported causation",
            &["before", "after"],
        ),
        (
            "history_get_evidence",
            "Hydrate only selected stable evidence identifiers",
            &["ids"],
        ),
    ];
    specs
        .into_iter()
        .map(|(name, description, required)| {
            Tool::new(name, description, input_schema(name, required))
                .with_raw_output_schema(output_schema())
                .with_annotations(
                    ToolAnnotations::new()
                        .read_only(true)
                        .destructive(false)
                        .idempotent(true)
                        .open_world(false),
                )
        })
        .collect()
}

fn input_schema(name: &str, required: &[&str]) -> Arc<JsonObject> {
    let mut properties = Map::new();
    for field in ["query", "node", "from", "to", "entity", "cursor"] {
        properties.insert(
            field.to_string(),
            json!({"type": "string", "maxLength": 4096}),
        );
    }
    properties.insert(
        "limit".to_string(),
        json!({"type": "integer", "minimum": 1, "maximum": MAX_PAGE_SIZE}),
    );
    properties.insert(
        "depth".to_string(),
        json!({"type": "integer", "minimum": 1, "maximum": MAX_HOPS}),
    );
    properties.insert(
        "direction".to_string(),
        json!({"type": "string", "enum": ["incoming", "outgoing", "both"]}),
    );
    properties.insert(
        "filter".to_string(),
        json!({"type": "object", "additionalProperties": false, "properties": {
            "node_kinds": {"type": "array", "items": {"type": "string"}, "maxItems": 32},
            "edge_kinds": {"type": "array", "items": {"type": "string"}, "maxItems": 32},
            "trust": {"type": "array", "items": {"type": "string"}, "maxItems": 4}
        }}),
    );
    properties.insert(
        "history_filter".to_string(),
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "kinds": {
                    "type": "array",
                    "maxItems": 5,
                    "uniqueItems": true,
                    "items": {"type": "string", "enum": ["release", "commit", "entity", "event", "annotation"]}
                },
                "from": {"type": "string", "format": "date-time"},
                "to": {"type": "string", "format": "date-time"}
            }
        }),
    );
    for field in ["reference", "before", "after"] {
        properties.insert(field.to_string(), temporal_schema());
    }
    properties.insert("selector".to_string(), selector_schema());
    properties.insert("ids".to_string(), json!({"type": "array", "items": {"type": "string", "maxLength": 4096}, "minItems": 1, "maxItems": MAX_EVIDENCE_IDS}));
    let applicable = tool_fields(name).unwrap_or_default();
    properties.retain(|key, _| applicable.contains(&key.as_str()));
    Arc::new(
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": properties,
            "required": required,
        })
        .as_object()
        .expect("tool schema object")
        .clone(),
    )
}

fn temporal_schema() -> Value {
    json!({
        "oneOf": [
            {"type": "object", "additionalProperties": false, "properties": {"kind": {"const": "revision"}, "revision": {"type": "string"}}, "required": ["kind", "revision"]},
            {"type": "object", "additionalProperties": false, "properties": {"kind": {"const": "release"}, "tag": {"type": "string"}}, "required": ["kind", "tag"]},
            {"type": "object", "additionalProperties": false, "properties": {"kind": {"const": "date"}, "at": {"type": "string"}}, "required": ["kind", "at"]}
        ]
    })
}

fn selector_schema() -> Value {
    json!({
        "oneOf": [
            {"type": "object", "additionalProperties": false, "properties": {"kind": {"const": "event"}, "event_id": {"type": "string", "maxLength": 4096}}, "required": ["kind", "event_id"]},
            {"type": "object", "additionalProperties": false, "properties": {"kind": {"const": "entity"}, "entity_id": {"type": "string", "maxLength": 4096}}, "required": ["kind", "entity_id"]},
            {"type": "object", "additionalProperties": false, "properties": {"kind": {"const": "revision"}, "revision": {"type": "string", "maxLength": 4096}}, "required": ["kind", "revision"]},
            {"type": "object", "additionalProperties": false, "properties": {"kind": {"const": "release"}, "tag": {"type": "string", "maxLength": 4096}}, "required": ["kind", "tag"]},
            {"type": "object", "additionalProperties": false, "properties": {"kind": {"const": "episode_key"}, "key": {"type": "string", "maxLength": 4096}}, "required": ["kind", "key"]}
        ]
    })
}

fn output_schema() -> Arc<JsonObject> {
    Arc::new(
        json!({
            "type": "object",
            "oneOf": [
                {
                    "additionalProperties": false,
                    "required": ["schemaVersion", "repository", "freshness", "limits", "links", "data"],
                    "properties": {
                        "schemaVersion": {"const": 1},
                        "repository": {"type": "object"},
                        "freshness": {"type": "object"},
                        "limits": {"type": "object"},
                        "links": {"type": "array"},
                        "data": {"type": "object"}
                    }
                },
                {
                    "additionalProperties": false,
                    "required": ["schemaVersion", "error"],
                    "properties": {
                        "schemaVersion": {"const": 1},
                        "error": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["code", "message"],
                            "properties": {
                                "code": {"type": "string"},
                                "message": {"type": "string"}
                            }
                        }
                    }
                }
            ]
        })
        .as_object()
        .expect("output schema object")
        .clone(),
    )
}

pub(crate) fn tool_fields(name: &str) -> Option<&'static [&'static str]> {
    Some(match name {
        "graph_query" => &["query", "filter", "limit", "cursor"],
        "graph_get_node" => &["node"],
        "graph_get_neighbors" => &["node", "direction", "filter", "limit", "cursor"],
        "graph_path" => &["from", "to", "filter"],
        "graph_impact" => &["node", "direction", "depth", "filter", "limit"],
        "history_list_releases" => &["limit", "cursor", "history_filter"],
        "history_search" => &["query", "limit", "cursor", "history_filter"],
        "history_get_state" => &["reference"],
        "history_lineage" => &["entity", "reference", "limit", "cursor"],
        "history_explain" => &["entity", "reference"],
        "history_trace" => &["selector", "limit", "cursor"],
        "history_compare" => &["before", "after"],
        "history_get_evidence" => &["ids"],
        _ => return None,
    })
}
