//! Fast graph builder for Repo Unpacked snapshots.
//!
//! This graph uses metadata already collected by the walk: manifests, scripts,
//! entrypoints, docs, config files, tests, and top-level directories. It avoids
//! source-content reads so the local Unpack button can return quickly.

use crate::commands::unpack::{
    DirSummary, DocFile, EntrypointHint, ManifestSummary, QaSuggestedFlow, RepoGraph,
    RepoGraphEdge, RepoGraphNode, WorkspaceUnitSummary,
};

const MAX_FAST_GRAPH_NODES: usize = 1024;
const MAX_FAST_GRAPH_EDGES: usize = 2048;

fn graph_id(kind: &str, value: &str) -> String {
    let slug = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    format!("{kind}:{slug}")
}

fn push_node(nodes: &mut Vec<RepoGraphNode>, node: RepoGraphNode) -> bool {
    if nodes.iter().any(|existing| existing.id == node.id) {
        return true;
    }
    if nodes.len() >= MAX_FAST_GRAPH_NODES {
        return false;
    }
    nodes.push(node);
    true
}

fn push_edge(edges: &mut Vec<RepoGraphEdge>, edge: RepoGraphEdge) -> bool {
    if edges.iter().any(|existing| {
        existing.from == edge.from && existing.to == edge.to && existing.kind == edge.kind
    }) {
        return true;
    }
    if edges.len() >= MAX_FAST_GRAPH_EDGES {
        return false;
    }
    edges.push(edge);
    true
}

fn file_node(path: &str, kind: &str, detail: &str) -> RepoGraphNode {
    RepoGraphNode {
        id: graph_id("file", path),
        kind: kind.to_string(),
        label: path.to_string(),
        path: Some(path.to_string()),
        detail: Some(detail.to_string()),
        sources: vec![path.to_string()],
    }
}

fn parent_dir_id(path: &str) -> String {
    let top = path.split('/').next().unwrap_or("").trim();
    if top.is_empty() || top == path {
        graph_id("repo", "root")
    } else {
        graph_id("directory", top)
    }
}

fn is_test_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".test.ts")
        || lower.ends_with(".test.tsx")
        || lower.ends_with(".test.js")
        || lower.ends_with(".spec.ts")
        || lower.ends_with(".spec.tsx")
        || lower.ends_with(".spec.js")
        || lower.contains("/tests/")
        || lower.contains("/test/")
        || lower.starts_with("tests/")
}

fn route_from_page_path(path: &str) -> Option<QaSuggestedFlow> {
    let lower = path.to_ascii_lowercase();
    if !(lower.ends_with(".tsx")
        || lower.ends_with(".ts")
        || lower.ends_with(".jsx")
        || lower.ends_with(".js"))
    {
        return None;
    }

    let route = if lower.starts_with("app/") && lower.ends_with("/page.tsx") {
        path.trim_start_matches("app/")
            .trim_end_matches("/page.tsx")
            .trim_matches('/')
            .to_string()
    } else if lower.starts_with("pages/") {
        path.trim_start_matches("pages/")
            .trim_end_matches(".tsx")
            .trim_end_matches(".ts")
            .trim_end_matches(".jsx")
            .trim_end_matches(".js")
            .trim_matches('/')
            .to_string()
    } else if lower.contains("/pages/") || lower.contains("/routes/") {
        path.rsplit_once("/pages/")
            .or_else(|| path.rsplit_once("/routes/"))
            .map(|(_, rest)| rest)
            .unwrap_or(path)
            .trim_end_matches(".tsx")
            .trim_end_matches(".ts")
            .trim_end_matches(".jsx")
            .trim_end_matches(".js")
            .trim_matches('/')
            .to_string()
    } else {
        return None;
    };

    let route = if route.is_empty() || route == "index" {
        "/".to_string()
    } else {
        format!("/{}", route.trim_end_matches("/index"))
    };
    Some(QaSuggestedFlow {
        id: graph_id("route", &route),
        route,
        goal: "route inferred from file structure".to_string(),
        sources: vec![path.to_string()],
    })
}

#[allow(clippy::too_many_arguments)]
pub fn build_fast_repo_graph(
    repo_name: &str,
    files: &[(String, u64)],
    manifests: &[ManifestSummary],
    entrypoints: &[EntrypointHint],
    workspace_units: &[WorkspaceUnitSummary],
    top_level_dirs: &[DirSummary],
    docs: &[DocFile],
    config_files: &[String],
) -> RepoGraph {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut truncated = false;
    let root_id = graph_id("repo", "root");

    let _ = push_node(
        &mut nodes,
        RepoGraphNode {
            id: root_id.clone(),
            kind: "repo".to_string(),
            label: repo_name.to_string(),
            path: None,
            detail: Some("Fast local structure graph from walk metadata".to_string()),
            sources: Vec::new(),
        },
    );

    for dir in top_level_dirs.iter().take(32) {
        let dir_id = graph_id("directory", &dir.path);
        truncated |= !push_node(
            &mut nodes,
            RepoGraphNode {
                id: dir_id.clone(),
                kind: "directory".to_string(),
                label: dir.path.clone(),
                path: Some(dir.path.clone()),
                detail: Some(format!("{} files | {} bytes", dir.file_count, dir.bytes)),
                sources: vec![dir.path.clone()],
            },
        );
        truncated |= !push_edge(
            &mut edges,
            RepoGraphEdge {
                from: root_id.clone(),
                to: dir_id,
                kind: "contains".to_string(),
                evidence: "top-level directory from fast file walk".to_string(),
                sources: vec![dir.path.clone()],
            },
        );
    }

    for unit in workspace_units.iter().take(48) {
        let unit_id = graph_id("workspace", &unit.path);
        let language_summary = unit
            .languages
            .iter()
            .take(3)
            .map(|language| format!("{} {}", language.files, language.language))
            .collect::<Vec<_>>()
            .join(", ");
        let mut sources = Vec::new();
        if let Some(manifest_path) = &unit.manifest_path {
            sources.push(manifest_path.clone());
        }
        sources.extend(unit.entrypoints.iter().take(2).cloned());
        sources.extend(unit.test_files.iter().take(2).cloned());
        if sources.is_empty() && unit.path != "." {
            sources.push(unit.path.clone());
        }
        sources.sort();
        sources.dedup();

        truncated |= !push_node(
            &mut nodes,
            RepoGraphNode {
                id: unit_id.clone(),
                kind: if unit.kind == "subsystem" {
                    "subsystem".to_string()
                } else {
                    "workspace_unit".to_string()
                },
                label: unit.name.clone(),
                path: if unit.path == "." {
                    None
                } else {
                    Some(unit.path.clone())
                },
                detail: Some(format!(
                    "{} | {} files{}",
                    unit.kind.replace('_', " "),
                    unit.file_count,
                    if language_summary.is_empty() {
                        String::new()
                    } else {
                        format!(" | {language_summary}")
                    }
                )),
                sources,
            },
        );

        if let Some(manifest_path) = &unit.manifest_path {
            truncated |= !push_edge(
                &mut edges,
                RepoGraphEdge {
                    from: unit_id.clone(),
                    to: graph_id("package", manifest_path),
                    kind: "defines".to_string(),
                    evidence: "workspace unit owns this manifest".to_string(),
                    sources: vec![manifest_path.clone()],
                },
            );
        }
        for entrypoint in unit.entrypoints.iter().take(6) {
            let file_id = graph_id("file", entrypoint);
            truncated |= !push_node(
                &mut nodes,
                file_node(entrypoint, "file", "workspace entrypoint"),
            );
            truncated |= !push_edge(
                &mut edges,
                RepoGraphEdge {
                    from: unit_id.clone(),
                    to: file_id,
                    kind: "entrypoint".to_string(),
                    evidence: "entrypoint belongs to this workspace unit".to_string(),
                    sources: vec![entrypoint.clone()],
                },
            );
        }
        for test_file in unit.test_files.iter().take(6) {
            let test_id = graph_id("test", test_file);
            truncated |= !push_node(
                &mut nodes,
                RepoGraphNode {
                    id: test_id.clone(),
                    kind: "test".to_string(),
                    label: test_file.clone(),
                    path: Some(test_file.clone()),
                    detail: Some("workspace test/spec file".to_string()),
                    sources: vec![test_file.clone()],
                },
            );
            truncated |= !push_edge(
                &mut edges,
                RepoGraphEdge {
                    from: unit_id.clone(),
                    to: test_id,
                    kind: "tests".to_string(),
                    evidence: "test file belongs to this workspace unit".to_string(),
                    sources: vec![test_file.clone()],
                },
            );
        }
    }

    for manifest in manifests.iter().take(40) {
        let package_id = graph_id("package", &manifest.path);
        truncated |= !push_node(
            &mut nodes,
            RepoGraphNode {
                id: package_id.clone(),
                kind: "package".to_string(),
                label: manifest
                    .name
                    .clone()
                    .unwrap_or_else(|| manifest.path.clone()),
                path: Some(manifest.path.clone()),
                detail: Some(format!("{} manifest", manifest.kind)),
                sources: vec![manifest.path.clone()],
            },
        );
        truncated |= !push_edge(
            &mut edges,
            RepoGraphEdge {
                from: parent_dir_id(&manifest.path),
                to: package_id.clone(),
                kind: "defines".to_string(),
                evidence: "manifest discovered during fast scan".to_string(),
                sources: vec![manifest.path.clone()],
            },
        );

        for script in manifest.scripts.iter().take(18) {
            let script_id = graph_id("script", &format!("{}:{script}", manifest.path));
            truncated |= !push_node(
                &mut nodes,
                RepoGraphNode {
                    id: script_id.clone(),
                    kind: "script".to_string(),
                    label: script.clone(),
                    path: Some(manifest.path.clone()),
                    detail: Some("package script".to_string()),
                    sources: vec![manifest.path.clone()],
                },
            );
            truncated |= !push_edge(
                &mut edges,
                RepoGraphEdge {
                    from: package_id.clone(),
                    to: script_id,
                    kind: "defines".to_string(),
                    evidence: format!("{} defines script `{script}`", manifest.path),
                    sources: vec![manifest.path.clone()],
                },
            );
        }
    }

    for entry in entrypoints.iter().take(80) {
        let file_id = graph_id("file", &entry.path);
        truncated |= !push_node(&mut nodes, file_node(&entry.path, "file", &entry.reason));
        truncated |= !push_edge(
            &mut edges,
            RepoGraphEdge {
                from: parent_dir_id(&entry.path),
                to: file_id,
                kind: "entrypoint".to_string(),
                evidence: entry.reason.clone(),
                sources: vec![entry.path.clone()],
            },
        );
    }

    for flow in files
        .iter()
        .filter_map(|(path, _)| route_from_page_path(path))
        .take(60)
    {
        let Some(source) = flow.sources.first() else {
            continue;
        };
        let route_id = graph_id("route", &flow.route);
        let file_id = graph_id("file", source);
        let _ = push_node(&mut nodes, file_node(source, "file", "route file"));
        truncated |= !push_node(
            &mut nodes,
            RepoGraphNode {
                id: route_id.clone(),
                kind: "route".to_string(),
                label: flow.route.clone(),
                path: Some(source.clone()),
                detail: Some(flow.goal.clone()),
                sources: flow.sources.clone(),
            },
        );
        truncated |= !push_edge(
            &mut edges,
            RepoGraphEdge {
                from: file_id,
                to: route_id,
                kind: "routes_to".to_string(),
                evidence: "route inferred from page file path".to_string(),
                sources: flow.sources,
            },
        );
    }

    for path in files
        .iter()
        .map(|(path, _)| path.as_str())
        .filter(|path| is_test_path(path))
        .take(80)
    {
        let test_id = graph_id("test", path);
        truncated |= !push_node(
            &mut nodes,
            RepoGraphNode {
                id: test_id.clone(),
                kind: "test".to_string(),
                label: path.to_string(),
                path: Some(path.to_string()),
                detail: Some("test/spec file".to_string()),
                sources: vec![path.to_string()],
            },
        );
        truncated |= !push_edge(
            &mut edges,
            RepoGraphEdge {
                from: parent_dir_id(path),
                to: test_id,
                kind: "tests".to_string(),
                evidence: "test/spec file discovered during fast scan".to_string(),
                sources: vec![path.to_string()],
            },
        );
    }

    for doc in docs.iter().take(32) {
        let doc_id = graph_id("doc", &doc.path);
        truncated |= !push_node(
            &mut nodes,
            RepoGraphNode {
                id: doc_id.clone(),
                kind: "doc".to_string(),
                label: doc.path.clone(),
                path: Some(doc.path.clone()),
                detail: Some("documentation file".to_string()),
                sources: vec![doc.path.clone()],
            },
        );
        truncated |= !push_edge(
            &mut edges,
            RepoGraphEdge {
                from: parent_dir_id(&doc.path),
                to: doc_id,
                kind: "documents".to_string(),
                evidence: "documentation path discovered during fast scan".to_string(),
                sources: vec![doc.path.clone()],
            },
        );
    }

    for path in config_files.iter().take(48) {
        let config_id = graph_id("config", path);
        truncated |= !push_node(
            &mut nodes,
            RepoGraphNode {
                id: config_id.clone(),
                kind: "config".to_string(),
                label: path.clone(),
                path: Some(path.clone()),
                detail: Some("configuration file".to_string()),
                sources: vec![path.clone()],
            },
        );
        truncated |= !push_edge(
            &mut edges,
            RepoGraphEdge {
                from: parent_dir_id(path),
                to: config_id,
                kind: "configures".to_string(),
                evidence: "known config file discovered during fast scan".to_string(),
                sources: vec![path.clone()],
            },
        );
    }

    nodes.sort_by(|a, b| a.kind.cmp(&b.kind).then_with(|| a.label.cmp(&b.label)));
    edges.sort_by(|a, b| {
        a.kind
            .cmp(&b.kind)
            .then_with(|| a.from.cmp(&b.from))
            .then_with(|| a.to.cmp(&b.to))
    });

    RepoGraph {
        schema_version: 1,
        nodes,
        edges,
        truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::unpack::LanguageCount;

    #[test]
    fn fast_graph_uses_existing_inventory_metadata() {
        let files = vec![
            ("package.json".to_string(), 200),
            ("src/main.tsx".to_string(), 1200),
            ("src/pages/Home.tsx".to_string(), 900),
            ("tests/home.spec.ts".to_string(), 600),
        ];
        let manifests = vec![ManifestSummary {
            path: "package.json".to_string(),
            kind: "package.json".to_string(),
            name: Some("demo".to_string()),
            version: None,
            dependencies: Vec::new(),
            scripts: vec!["dev".to_string(), "test".to_string()],
        }];
        let entrypoints = vec![EntrypointHint {
            path: "src/main.tsx".to_string(),
            kind: "web".to_string(),
            reason: "React entrypoint".to_string(),
        }];
        let workspace_units = vec![WorkspaceUnitSummary {
            path: ".".to_string(),
            name: "demo".to_string(),
            kind: "web_app".to_string(),
            manifest_path: Some("package.json".to_string()),
            build_system: Some("package.json".to_string()),
            file_count: 4,
            languages: vec![LanguageCount {
                language: "TypeScript".to_string(),
                files: 2,
                bytes: 2_100,
            }],
            scripts: vec!["dev".to_string(), "test".to_string()],
            entrypoints: vec!["src/main.tsx".to_string()],
            test_files: vec!["tests/home.spec.ts".to_string()],
            tags: vec!["React".to_string()],
        }];
        let dirs = vec![DirSummary {
            path: "src".to_string(),
            file_count: 2,
            bytes: 2100,
        }];

        let graph = build_fast_repo_graph(
            "demo",
            &files,
            &manifests,
            &entrypoints,
            &workspace_units,
            &dirs,
            &[],
            &[],
        );

        assert!(graph.nodes.iter().any(|n| n.kind == "repo"));
        assert!(graph.nodes.iter().any(|n| n.kind == "workspace_unit"));
        assert!(graph.nodes.iter().any(|n| n.kind == "package"));
        assert_eq!(graph.nodes.iter().filter(|n| n.kind == "script").count(), 2);
        assert!(graph.nodes.iter().any(|n| n.kind == "route"));
        assert!(graph.nodes.iter().any(|n| n.kind == "test"));
        assert!(graph.edges.iter().any(|e| e.kind == "entrypoint"));
        assert!(graph.edges.iter().any(|e| e.kind == "routes_to"));
    }
}
