use super::analysis::analyze_graph;
use super::types::{
    stable_graph_id, GraphOrigin, GraphSourceAnchor, GraphTrust, StructuralGraphCommunity,
    StructuralGraphCoverage, StructuralGraphDiagnostic, StructuralGraphEdge,
    StructuralGraphEngineInfo, StructuralGraphFileRecord, StructuralGraphNode,
    StructuralGraphSnapshot, STRUCTURAL_GRAPH_SCHEMA_VERSION,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};

const MAX_IMPORT_BYTES: usize = 32 * 1024 * 1024;
const MAX_IMPORT_NODES: usize = 100_000;
const MAX_IMPORT_EDGES: usize = 250_000;
const EXTENSION_PREFIX: &str = "interchange_extensions:";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StructuralGraphAdapterDescriptor {
    pub id: String,
    pub label: String,
    pub mode: String,
    pub bundled: bool,
    pub mutates_repository: bool,
    pub requires_explicit_action: bool,
    pub runtime_behavior: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructuralGraphInterchangePreview {
    pub snapshot: StructuralGraphSnapshot,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicGraphPackage {
    pub schema_version: i64,
    pub identity: String,
    pub json: String,
    pub svg: String,
    pub markdown: String,
    pub omissions: Vec<String>,
}

pub fn adapter_descriptors() -> Vec<StructuralGraphAdapterDescriptor> {
    vec![
        StructuralGraphAdapterDescriptor {
            id: "node_link-json".to_string(),
            label: "Generic node-link JSON".to_string(),
            mode: "local_import".to_string(),
            bundled: true,
            mutates_repository: false,
            requires_explicit_action: true,
            runtime_behavior: "Parses a user-supplied local JSON document; no Python, process, network, or repository write".to_string(),
        },
    ]
}

pub fn import_node_link_json(
    repo_path: &str,
    json_text: &str,
) -> Result<StructuralGraphInterchangePreview, String> {
    if json_text.len() > MAX_IMPORT_BYTES {
        return Err(format!(
            "node-link import exceeds the {} MiB local safety limit",
            MAX_IMPORT_BYTES / 1024 / 1024
        ));
    }
    let document: Value = serde_json::from_str(json_text)
        .map_err(|error| format!("node-link JSON is invalid: {error}"))?;
    let object = document
        .as_object()
        .ok_or_else(|| "node-link JSON must be an object".to_string())?;
    let raw_nodes = object
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "node-link JSON requires a nodes array".to_string())?;
    let raw_edges = object
        .get("links")
        .or_else(|| object.get("edges"))
        .and_then(Value::as_array)
        .ok_or_else(|| "node-link JSON requires a links or edges array".to_string())?;
    if raw_nodes.len() > MAX_IMPORT_NODES || raw_edges.len() > MAX_IMPORT_EDGES {
        return Err(format!(
            "node-link import exceeds bounded graph limits ({MAX_IMPORT_NODES} nodes, {MAX_IMPORT_EDGES} edges)"
        ));
    }

    let mut id_map = HashMap::new();
    let mut nodes = Vec::with_capacity(raw_nodes.len());
    for raw in raw_nodes {
        let fields = raw
            .as_object()
            .ok_or_else(|| "Every node-link node must be an object".to_string())?;
        let upstream_id = required_string(fields, "id", "node-link node")?;
        if id_map.contains_key(upstream_id) {
            return Err(format!("node-link node id is duplicated: {upstream_id}"));
        }
        let id = stable_graph_id("node_link-node", upstream_id);
        id_map.insert(upstream_id.to_string(), id.clone());
        let label = fields
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or(upstream_id)
            .to_string();
        let path = fields
            .get("source_file")
            .and_then(Value::as_str)
            .map(normalize_path);
        let source = source_anchor(fields);
        let community_id = fields
            .get("community")
            .filter(|value| !value.is_null())
            .map(|value| stable_graph_id("node_link-community", &value.to_string()));
        nodes.push(StructuralGraphNode {
            id,
            kind: infer_node_kind(&label, path.as_deref()),
            label,
            qualified_name: Some(upstream_id.to_string()),
            path,
            detail: extension_detail(
                fields,
                &[
                    "id",
                    "label",
                    "file_type",
                    "source_file",
                    "source_location",
                    "community",
                ],
            ),
            language: None,
            community_id,
            trust: GraphTrust::Inferred,
            origin: GraphOrigin::ImportedNodeLink,
            sources: source.into_iter().collect(),
        });
    }

    let mut edges = Vec::with_capacity(raw_edges.len());
    for (ordinal, raw) in raw_edges.iter().enumerate() {
        let fields = raw
            .as_object()
            .ok_or_else(|| "Every node-link link must be an object".to_string())?;
        let source_id = endpoint_string(fields, "source", "_src")?;
        let target_id = endpoint_string(fields, "target", "_tgt")?;
        let from = id_map.get(source_id).ok_or_else(|| {
            format!("node-link link {ordinal} references missing source node {source_id}")
        })?;
        let to = id_map.get(target_id).ok_or_else(|| {
            format!("node-link link {ordinal} references missing target node {target_id}")
        })?;
        let kind = fields
            .get("relation")
            .or_else(|| fields.get("kind"))
            .and_then(Value::as_str)
            .unwrap_or("related_to")
            .to_ascii_lowercase();
        let trust = node_link_trust(fields.get("confidence").and_then(Value::as_str));
        let sources = source_anchor(fields).into_iter().collect::<Vec<_>>();
        let extensions = extension_detail(
            fields,
            &[
                "source",
                "target",
                "_src",
                "_tgt",
                "relation",
                "kind",
                "confidence",
                "source_file",
                "source_location",
            ],
        );
        edges.push(StructuralGraphEdge {
            id: stable_graph_id(
                "node_link-edge",
                &format!("{ordinal}\0{from}\0{to}\0{kind}"),
            ),
            from: from.clone(),
            to: to.clone(),
            kind,
            evidence: extensions
                .unwrap_or_else(|| "Imported from generic node-link JSON".to_string()),
            trust,
            origin: GraphOrigin::ImportedNodeLink,
            sources,
            candidates: Vec::new(),
        });
    }

    let explicit_communities = imported_communities(&nodes);
    let communities = if explicit_communities.is_empty() {
        analyze_graph(&mut nodes, &edges)
    } else {
        explicit_communities
    };
    let files = imported_files(&nodes);
    let mut top_level_extensions = object.clone();
    for key in ["nodes", "links", "edges", "directed", "multigraph", "graph"] {
        top_level_extensions.remove(key);
    }
    let diagnostics = (!top_level_extensions.is_empty())
        .then(|| StructuralGraphDiagnostic {
            severity: "info".to_string(),
            code: "node_link_top_level_extensions".to_string(),
            message: format!("{EXTENSION_PREFIX}{}", Value::Object(top_level_extensions)),
            path: None,
            language: None,
        })
        .into_iter()
        .collect();
    let snapshot_id = stable_graph_id("node_link-snapshot", json_text);
    Ok(StructuralGraphInterchangePreview {
        snapshot: StructuralGraphSnapshot {
            schema_version: STRUCTURAL_GRAPH_SCHEMA_VERSION,
            id: snapshot_id,
            repo_path: repo_path.to_string(),
            repo_head: None,
            created_at: Utc::now().to_rfc3339(),
            engine: StructuralGraphEngineInfo {
                id: "node_link-json-import".to_string(),
                version: "node-link".to_string(),
                bundled: true,
                syntax_aware: true,
                supported_languages: Vec::new(),
            },
            cursor: None,
            ignore_fingerprint: None,
            coverage: StructuralGraphCoverage {
                discovered_files: files.len(),
                indexed_files: files.len(),
                ..StructuralGraphCoverage::default()
            },
            diagnostics,
            communities,
            files,
            nodes,
            edges,
            metrics: Vec::new(),
            clone_groups: Vec::new(),
            truncated: false,
        },
        warnings: vec![
            "Preview only: importing node-link JSON does not replace the canonical CodeVetter index"
                .to_string(),
        ],
    })
}

/// Serializes a snapshot as the CodeVetter interchange document.
///
/// Encoded compactly on purpose. `import_codevetter_json` enforces
/// `MAX_IMPORT_BYTES` against the raw document length, and on real repositories
/// roughly a third of a pretty-printed graph is indentation whitespace
/// (measured: gin 17.8 MiB -> 11.4 MiB, fastify 29.5 MiB -> 19.7 MiB). Spending
/// a third of the import budget on padding shrank the repository size the
/// product could round-trip for no reader's benefit: `export_markdown` is the
/// human-readable rendering, and `export_public_package` stays indented because
/// it is a small sanitized artifact people read directly.
pub fn export_json(snapshot: &StructuralGraphSnapshot) -> Result<String, String> {
    #[derive(Serialize)]
    struct Export<'a> {
        format: &'static str,
        schema_version: i64,
        exported_at: String,
        snapshot: &'a StructuralGraphSnapshot,
    }
    serde_json::to_string(&Export {
        format: "codevetter-structural-graph",
        schema_version: STRUCTURAL_GRAPH_SCHEMA_VERSION,
        exported_at: Utc::now().to_rfc3339(),
        snapshot,
    })
    .map_err(|error| format!("Could not export structural graph JSON: {error}"))
}

pub fn import_codevetter_json(json_text: &str) -> Result<StructuralGraphSnapshot, String> {
    if json_text.len() > MAX_IMPORT_BYTES {
        return Err(format!(
            "CodeVetter import exceeds the {} MiB local safety limit",
            MAX_IMPORT_BYTES / 1024 / 1024
        ));
    }
    #[derive(Deserialize)]
    struct Import {
        format: String,
        schema_version: i64,
        snapshot: StructuralGraphSnapshot,
    }
    let imported: Import = serde_json::from_str(json_text)
        .map_err(|error| format!("CodeVetter graph JSON is invalid: {error}"))?;
    if imported.format != "codevetter-structural-graph"
        || imported.schema_version != STRUCTURAL_GRAPH_SCHEMA_VERSION
        || imported.snapshot.schema_version != STRUCTURAL_GRAPH_SCHEMA_VERSION
    {
        return Err("CodeVetter graph export uses an unsupported format or schema".to_string());
    }
    if imported.snapshot.nodes.len() > MAX_IMPORT_NODES
        || imported.snapshot.edges.len() > MAX_IMPORT_EDGES
    {
        return Err("CodeVetter graph export exceeds bounded graph limits".to_string());
    }
    let node_ids = imported
        .snapshot
        .nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    if let Some(edge) =
        imported.snapshot.edges.iter().find(|edge| {
            !node_ids.contains(edge.from.as_str()) || !node_ids.contains(edge.to.as_str())
        })
    {
        return Err(format!(
            "CodeVetter graph edge {} has a dangling endpoint",
            edge.id
        ));
    }
    Ok(imported.snapshot)
}

pub fn export_markdown(snapshot: &StructuralGraphSnapshot) -> String {
    let mut markdown = format!(
        "# CodeVetter structural graph\n\n- Snapshot: `{}`\n- Engine: `{}@{}`\n- Nodes: {}\n- Edges: {}\n- Indexed files: {}\n\n## Important communities\n",
        snapshot.id,
        snapshot.engine.id,
        snapshot.engine.version,
        snapshot.nodes.len(),
        snapshot.edges.len(),
        snapshot.coverage.indexed_files
    );
    let mut communities = snapshot.communities.iter().collect::<Vec<_>>();
    communities.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.label.cmp(&right.label))
    });
    for community in communities.into_iter().take(20) {
        markdown.push_str(&format!(
            "- **{}**: {} nodes, {} bridges\n",
            community.label,
            community.member_count,
            community.bridge_node_ids.len()
        ));
    }
    markdown.push_str("\n## Source-backed nodes\n");
    for node in snapshot
        .nodes
        .iter()
        .filter(|node| !node.sources.is_empty())
        .take(100)
    {
        let source = &node.sources[0];
        markdown.push_str(&format!(
            "- `{}` {} - `{}`{}\n",
            node.kind,
            node.label,
            source.path,
            source
                .start_line
                .map(|line| format!(":{line}"))
                .unwrap_or_default()
        ));
    }
    markdown
}

pub fn export_public_package(
    snapshot: &StructuralGraphSnapshot,
) -> Result<PublicGraphPackage, String> {
    const MAX_NODES: usize = 500;
    const MAX_EDGES: usize = 1_000;
    #[derive(Serialize)]
    struct PublicNode {
        id: String,
        kind: String,
        label: String,
        path: Option<String>,
        trust: GraphTrust,
    }
    #[derive(Serialize)]
    struct PublicEdge {
        id: String,
        from: String,
        to: String,
        kind: String,
        trust: GraphTrust,
    }
    #[derive(Serialize)]
    struct PublicPayload {
        format: &'static str,
        schema_version: i64,
        snapshot_id: String,
        repo_head: Option<String>,
        engine: String,
        created_at: String,
        nodes: Vec<PublicNode>,
        edges: Vec<PublicEdge>,
        omissions: Vec<String>,
        publication: &'static str,
    }

    let mut omissions = Vec::new();
    let mut source_nodes = snapshot.nodes.iter().collect::<Vec<_>>();
    source_nodes.sort_by(|left, right| left.id.cmp(&right.id));
    if source_nodes.len() > MAX_NODES {
        omissions.push(format!(
            "{} nodes omitted by the public package bound",
            source_nodes.len() - MAX_NODES
        ));
    }
    let nodes = source_nodes
        .into_iter()
        .take(MAX_NODES)
        .map(|node| PublicNode {
            id: node.id.clone(),
            kind: sanitize_public_text(&node.kind, &snapshot.repo_path, &mut omissions),
            label: sanitize_public_text(&node.label, &snapshot.repo_path, &mut omissions),
            path: node
                .path
                .as_deref()
                .map(|path| sanitize_public_text(path, &snapshot.repo_path, &mut omissions)),
            trust: node.trust,
        })
        .collect::<Vec<_>>();
    let node_ids = nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    let mut source_edges = snapshot
        .edges
        .iter()
        .filter(|edge| node_ids.contains(edge.from.as_str()) && node_ids.contains(edge.to.as_str()))
        .collect::<Vec<_>>();
    source_edges.sort_by(|left, right| left.id.cmp(&right.id));
    if source_edges.len() > MAX_EDGES {
        omissions.push(format!(
            "{} edges omitted by the public package bound",
            source_edges.len() - MAX_EDGES
        ));
    }
    let edges = source_edges
        .into_iter()
        .take(MAX_EDGES)
        .map(|edge| PublicEdge {
            id: edge.id.clone(),
            from: edge.from.clone(),
            to: edge.to.clone(),
            kind: sanitize_public_text(&edge.kind, &snapshot.repo_path, &mut omissions),
            trust: edge.trust,
        })
        .collect::<Vec<_>>();
    omissions.sort();
    omissions.dedup();
    let payload = PublicPayload {
        format: "codevetter-public-graph-package",
        schema_version: STRUCTURAL_GRAPH_SCHEMA_VERSION,
        snapshot_id: snapshot.id.clone(),
        repo_head: snapshot.repo_head.clone(),
        engine: format!("{}@{}", snapshot.engine.id, snapshot.engine.version),
        created_at: snapshot.created_at.clone(),
        nodes,
        edges,
        omissions: omissions.clone(),
        publication: "local export only; CodeVetter did not upload this package",
    };
    let canonical = serde_json::to_string(&payload)
        .map_err(|error| format!("Could not serialize public graph package: {error}"))?;
    let identity = format!("sha256:{:x}", Sha256::digest(canonical.as_bytes()));
    let json = serde_json::to_string_pretty(&serde_json::json!({
        "identity": identity,
        "payload": payload,
    }))
    .map_err(|error| format!("Could not render public graph JSON: {error}"))?;
    let decoded: Value = serde_json::from_str(&json)
        .map_err(|error| format!("Decode public graph JSON: {error}"))?;
    let public_nodes = decoded
        .pointer("/payload/nodes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let public_edges = decoded
        .pointer("/payload/edges")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let svg = public_graph_svg(&identity, &public_nodes, &public_edges);
    let markdown = format!(
        "# CodeVetter public graph snapshot\n\n- Package: `{identity}`\n- Snapshot: `{}`\n- Nodes: {}\n- Edges: {}\n- JSON: [graph.json](./graph.json)\n- Static image: [graph.svg](./graph.svg)\n- Publication: local export only; no upload was attempted.\n\n## Omissions\n{}\n",
        snapshot.id,
        public_nodes.len(),
        public_edges.len(),
        if omissions.is_empty() {
            "- None recorded.".to_string()
        } else {
            omissions
                .iter()
                .map(|omission| format!("- {omission}"))
                .collect::<Vec<_>>()
                .join("\n")
        }
    );
    Ok(PublicGraphPackage {
        schema_version: STRUCTURAL_GRAPH_SCHEMA_VERSION,
        identity,
        json,
        svg,
        markdown,
        omissions,
    })
}

fn sanitize_public_text(raw: &str, repo_path: &str, omissions: &mut Vec<String>) -> String {
    let mut value = raw.replace(repo_path, "[repo]");
    let lower = value.to_ascii_lowercase();
    if [
        "authorization:",
        "api_key",
        "apikey",
        "access_token",
        "refresh_token",
        "password=",
        "private key",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        omissions.push("Sensitive-looking graph text was redacted".to_string());
        return "[redacted]".to_string();
    }
    if value.chars().count() > 160 {
        value = value.chars().take(159).collect::<String>();
        value.push('…');
        omissions.push("Long graph labels were truncated".to_string());
    }
    value
}

fn public_graph_svg(identity: &str, nodes: &[Value], edges: &[Value]) -> String {
    let visible = nodes.iter().take(80).collect::<Vec<_>>();
    let visible_ids = visible
        .iter()
        .filter_map(|node| node.get("id").and_then(Value::as_str))
        .enumerate()
        .map(|(index, id)| (id, index))
        .collect::<HashMap<_, _>>();
    let width = 1_200;
    let rows = visible.len().div_ceil(8).max(1);
    let height = 100 + rows * 100;
    let mut svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {width} {height}\" role=\"img\" aria-label=\"CodeVetter public structural graph\"><rect width=\"100%\" height=\"100%\" fill=\"#0d0e11\"/><text x=\"24\" y=\"32\" fill=\"#d4a039\" font-family=\"system-ui\" font-size=\"14\">{}</text>",
        xml_escape(identity)
    );
    for edge in edges {
        let Some(from) = edge.get("from").and_then(Value::as_str) else {
            continue;
        };
        let Some(to) = edge.get("to").and_then(Value::as_str) else {
            continue;
        };
        let (Some(&from_index), Some(&to_index)) = (visible_ids.get(from), visible_ids.get(to))
        else {
            continue;
        };
        let (x1, y1) = graph_point(from_index);
        let (x2, y2) = graph_point(to_index);
        svg.push_str(&format!(
            "<line x1=\"{x1}\" y1=\"{y1}\" x2=\"{x2}\" y2=\"{y2}\" stroke=\"#4b5563\" stroke-width=\"1\"/>"
        ));
    }
    for (index, node) in visible.iter().enumerate() {
        let (x, y) = graph_point(index);
        let label = node.get("label").and_then(Value::as_str).unwrap_or("node");
        let compact = label.chars().take(22).collect::<String>();
        svg.push_str(&format!(
            "<circle cx=\"{x}\" cy=\"{y}\" r=\"7\" fill=\"#d4a039\"/><text x=\"{}\" y=\"{}\" fill=\"#e5e7eb\" font-family=\"system-ui\" font-size=\"10\">{}</text>",
            x + 11,
            y + 4,
            xml_escape(&compact)
        ));
    }
    svg.push_str("</svg>");
    svg
}

fn graph_point(index: usize) -> (usize, usize) {
    (40 + (index % 8) * 145, 72 + (index / 8) * 100)
}

fn xml_escape(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn required_string<'a>(
    fields: &'a Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<&'a str, String> {
    fields
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{label} requires a non-empty string {key}"))
}

fn endpoint_string<'a>(
    fields: &'a Map<String, Value>,
    primary: &str,
    fallback: &str,
) -> Result<&'a str, String> {
    fields
        .get(primary)
        .or_else(|| fields.get(fallback))
        .and_then(Value::as_str)
        .ok_or_else(|| format!("node-link link requires {primary}/{fallback} string endpoints"))
}

fn normalize_path(path: &str) -> String {
    path.replace('\\', "/").trim_start_matches("./").to_string()
}

fn source_anchor(fields: &Map<String, Value>) -> Option<GraphSourceAnchor> {
    let path = fields.get("source_file")?.as_str().map(normalize_path)?;
    let location = fields
        .get("source_location")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let start_line = location
        .trim_start_matches('L')
        .split(['-', ':'])
        .next()
        .and_then(|line| line.parse().ok());
    Some(GraphSourceAnchor {
        path,
        start_line,
        start_column: None,
        end_line: None,
        end_column: None,
        excerpt: None,
    })
}

fn infer_node_kind(label: &str, path: Option<&str>) -> String {
    if path.is_some_and(|path| path.rsplit('/').next() == Some(label)) {
        "file".to_string()
    } else if label.ends_with("()") {
        "function".to_string()
    } else {
        "symbol".to_string()
    }
}

fn node_link_trust(confidence: Option<&str>) -> GraphTrust {
    match confidence.unwrap_or_default().to_ascii_uppercase().as_str() {
        "EXTRACTED" => GraphTrust::Extracted,
        "AMBIGUOUS" => GraphTrust::Ambiguous,
        _ => GraphTrust::Inferred,
    }
}

fn extension_detail(fields: &Map<String, Value>, known: &[&str]) -> Option<String> {
    let known = known.iter().copied().collect::<HashSet<_>>();
    let extensions = fields
        .iter()
        .filter(|(key, _)| !known.contains(key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<Map<_, _>>();
    (!extensions.is_empty()).then(|| format!("{EXTENSION_PREFIX}{}", Value::Object(extensions)))
}

fn imported_communities(nodes: &[StructuralGraphNode]) -> Vec<StructuralGraphCommunity> {
    let mut members = BTreeMap::<String, Vec<String>>::new();
    for node in nodes {
        if let Some(community_id) = &node.community_id {
            members
                .entry(community_id.clone())
                .or_default()
                .push(node.id.clone());
        }
    }
    members
        .into_iter()
        .map(|(id, mut node_ids)| {
            node_ids.sort();
            StructuralGraphCommunity {
                label: format!(
                    "node-link community {}",
                    id.rsplit(':').next().unwrap_or(&id)
                ),
                id,
                member_count: node_ids.len(),
                hub_node_ids: Vec::new(),
                bridge_node_ids: Vec::new(),
                score: node_ids.len() as f64,
            }
        })
        .collect()
}

fn imported_files(nodes: &[StructuralGraphNode]) -> Vec<StructuralGraphFileRecord> {
    let mut paths = nodes
        .iter()
        .filter_map(|node| node.path.clone())
        .collect::<Vec<_>>();
    paths.sort();
    paths.dedup();
    paths
        .into_iter()
        .map(|path| StructuralGraphFileRecord {
            path,
            language: None,
            content_hash: None,
            disposition: "imported".to_string(),
            byte_size: 0,
            node_count: 0,
            edge_count: 0,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"{
      "directed": true,
      "vendor_extension": {"kept": true},
      "nodes": [
        {"id":"api","label":"api.py","source_file":"src/api.py","source_location":"L1","community":1,"custom":"node-value"},
        {"id":"run","label":"run()","source_file":"src/api.py","source_location":"L4","community":1}
      ],
      "links": [
        {"source":"api","target":"run","relation":"contains","confidence":"EXTRACTED","source_file":"src/api.py","source_location":"L4","weight":1.0}
      ]
    }"#;

    #[test]
    fn node_link_import_preserves_trust_locations_communities_and_extensions() {
        let preview = import_node_link_json("/repo", FIXTURE).expect("import");
        assert_eq!(preview.snapshot.nodes.len(), 2);
        assert_eq!(preview.snapshot.edges[0].trust, GraphTrust::Extracted);
        assert_eq!(preview.snapshot.edges[0].sources[0].start_line, Some(4));
        assert_eq!(preview.snapshot.communities.len(), 1);
        assert!(preview.snapshot.nodes[0]
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("custom")));
        assert!(preview.snapshot.diagnostics[0]
            .message
            .contains("vendor_extension"));
    }

    #[test]
    fn node_link_import_rejects_dangling_edges_without_partial_output() {
        let invalid = r#"{"nodes":[{"id":"a"}],"links":[{"source":"a","target":"missing"}]}"#;
        assert!(import_node_link_json("/repo", invalid)
            .unwrap_err()
            .contains("missing target"));
    }

    #[test]
    fn node_link_import_enforces_the_document_byte_cap() {
        let oversized = " ".repeat(MAX_IMPORT_BYTES + 1);
        assert!(import_node_link_json("/repo", &oversized)
            .unwrap_err()
            .contains("safety limit"));
    }

    #[test]
    fn codevetter_json_and_markdown_exports_are_versioned_and_source_backed() {
        let preview = import_node_link_json("/repo", FIXTURE).expect("import");
        let json = export_json(&preview.snapshot).expect("json export");
        assert!(json.contains("codevetter-structural-graph"));
        assert!(json.contains("interchange_extensions"));
        let markdown = export_markdown(&preview.snapshot);
        assert!(markdown.contains("# CodeVetter structural graph"));
        assert!(markdown.contains("`src/api.py`:1"));
        let round_trip = import_codevetter_json(&json).expect("round trip");
        assert_eq!(round_trip, preview.snapshot);
    }

    #[test]
    fn codevetter_json_export_spends_no_import_budget_on_indentation() {
        let preview = import_node_link_json("/repo", FIXTURE).expect("import");
        let json = export_json(&preview.snapshot).expect("json export");
        // Whitespace inside string values is legitimate; newline-plus-indent is
        // the pretty printer's padding, and it is what used to consume roughly a
        // third of MAX_IMPORT_BYTES on real repositories.
        assert!(!json.contains("\n  "), "export must not be indented");
        let pretty = serde_json::to_string_pretty(
            &serde_json::from_str::<serde_json::Value>(&json).expect("valid json"),
        )
        .expect("pretty");
        assert!(
            json.len() < pretty.len(),
            "compact export ({} bytes) must be smaller than the indented form ({} bytes)",
            json.len(),
            pretty.len()
        );
        assert_eq!(
            import_codevetter_json(&json).expect("compact round trip"),
            preview.snapshot
        );
    }

    #[test]
    fn public_package_is_deterministic_sanitized_static_and_side_effect_free() {
        let mut preview = import_node_link_json("/repo/private", FIXTURE).expect("import");
        preview.snapshot.nodes[0].label = "/repo/private Authorization: bearer secret".to_string();
        let first = export_public_package(&preview.snapshot).expect("package");
        let second = export_public_package(&preview.snapshot).expect("repeat");
        assert_eq!(first.identity, second.identity);
        assert_eq!(first.json, second.json);
        assert_eq!(first.svg, second.svg);
        assert!(!first.json.contains("bearer secret"));
        assert!(!first.json.contains("/repo/private"));
        assert!(first.svg.starts_with("<svg xmlns="));
        assert!(!first.svg.contains(" href="));
        assert!(!first.svg.contains("xlink:href"));
        assert!(first.markdown.contains("no upload was attempted"));
        assert!(!first.omissions.is_empty());
    }
}
