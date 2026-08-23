use super::*;

pub(super) fn extract_metadata_signals(
    path: &str,
    source: &str,
    file_id: &str,
    language: Option<&str>,
    nodes: &mut Vec<StructuralGraphNode>,
    edges: &mut Vec<StructuralGraphEdge>,
) {
    let lower_path = path.to_ascii_lowercase();
    let file_name = lower_path.rsplit('/').next().unwrap_or(&lower_path);
    if is_config_name(file_name) {
        push_metadata_signal(
            path,
            source,
            file_id,
            language,
            1,
            "configuration",
            file_name,
            "configures",
            "repository configuration file",
            nodes,
            edges,
        );
    }

    let lines = source.lines().collect::<Vec<_>>();
    let mut config_entries = 0usize;
    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        let lower = trimmed.to_ascii_lowercase();
        let line_number = index + 1;

        if lower.contains("create table") {
            if let Some(label) = sql_object_name(trimmed, "table") {
                push_metadata_signal(
                    path,
                    source,
                    file_id,
                    language,
                    line_number,
                    "db_table",
                    &label,
                    "declares",
                    "SQL table declaration",
                    nodes,
                    edges,
                );
            }
        }
        if lower.contains("create index") {
            if let Some(label) = sql_object_name(trimmed, "index") {
                push_metadata_signal(
                    path,
                    source,
                    file_id,
                    language,
                    line_number,
                    "db_index",
                    &label,
                    "declares",
                    "SQL index declaration",
                    nodes,
                    edges,
                );
            }
        }

        if lower.contains("#[tauri::command]") {
            if let Some(label) = lines
                .iter()
                .skip(index + 1)
                .take(4)
                .find_map(|next| rust_function_name(next))
            {
                push_metadata_signal(
                    path,
                    source,
                    file_id,
                    language,
                    line_number,
                    "tauri_command",
                    &label,
                    "exposes",
                    "Tauri command boundary",
                    nodes,
                    edges,
                );
            }
        }

        for marker in ["<route", "route(", ".route(", "router."] {
            if lower.contains(marker) {
                if let Some(label) = first_quoted(trimmed) {
                    if label.starts_with('/') {
                        push_metadata_signal(
                            path,
                            source,
                            file_id,
                            language,
                            line_number,
                            "route",
                            &label,
                            "routes_to",
                            "application route",
                            nodes,
                            edges,
                        );
                    }
                }
                break;
            }
        }

        if is_analytics_line(&lower) {
            if let Some(label) = first_quoted(trimmed) {
                push_metadata_signal(
                    path,
                    source,
                    file_id,
                    language,
                    line_number,
                    "analytics_event",
                    &label,
                    "emits",
                    "analytics event emission",
                    nodes,
                    edges,
                );
            }
        }

        if is_test_line(&lower, &lower_path) {
            let label = (lower == "#[test]")
                .then(|| {
                    lines
                        .iter()
                        .skip(index + 1)
                        .take(4)
                        .find_map(|next| rust_function_name(next))
                })
                .flatten()
                .or_else(|| first_quoted(trimmed))
                .or_else(|| rust_function_name(trimmed))
                .unwrap_or_else(|| format!("test at line {line_number}"));
            push_metadata_signal(
                path,
                source,
                file_id,
                language,
                line_number,
                "test",
                &label,
                "contains_test",
                "test declaration",
                nodes,
                edges,
            );
        }

        if is_structured_config_path(&lower_path) && !is_lockfile_path(&lower_path) {
            for label in config_entry_labels(trimmed) {
                if config_entries >= MAX_CONFIG_ENTRIES_PER_FILE {
                    break;
                }
                config_entries += 1;
                push_metadata_signal(
                    path,
                    source,
                    file_id,
                    language,
                    line_number,
                    "config_entry",
                    &label,
                    "declares",
                    "configuration entry",
                    nodes,
                    edges,
                );
            }
        }

        if lower_path.ends_with(".md") || lower_path.ends_with(".mdx") {
            for target in markdown_link_targets(trimmed) {
                push_metadata_signal(
                    path,
                    source,
                    file_id,
                    language,
                    line_number,
                    "documentation_link",
                    &target,
                    "documents",
                    "documentation link",
                    nodes,
                    edges,
                );
            }
            if let Some(label) = rationale_marker(trimmed) {
                push_metadata_signal(
                    path,
                    source,
                    file_id,
                    language,
                    line_number,
                    "decision",
                    &label,
                    "records_decision",
                    "repo rationale marker",
                    nodes,
                    edges,
                );
            }
        }
    }
    append_contract_extraction(path, source, file_id, language, nodes, edges);
}

fn append_contract_extraction(
    path: &str,
    source: &str,
    file_id: &str,
    language: Option<&str>,
    nodes: &mut Vec<StructuralGraphNode>,
    edges: &mut Vec<StructuralGraphEdge>,
) {
    let extraction = extract_contracts(path, source);
    let mut node_id_by_key = HashMap::new();
    for fact in extraction.facts {
        let id = stable_graph_id(&fact.kind, &format!("{path}\0{}", fact.label));
        let anchor = GraphSourceAnchor {
            path: path.to_string(),
            start_line: Some(fact.line as u32),
            start_column: Some(1),
            end_line: Some(fact.line as u32),
            end_column: None,
            excerpt: source
                .lines()
                .nth(fact.line.saturating_sub(1))
                .map(|line| line.trim().chars().take(240).collect()),
        };
        if let Some(existing) = nodes.iter_mut().find(|node| node.id == id) {
            if !existing.sources.contains(&anchor) {
                existing.sources.push(anchor.clone());
            }
        } else {
            nodes.push(StructuralGraphNode {
                id: id.clone(),
                kind: fact.kind.clone(),
                label: fact.label.clone(),
                qualified_name: Some(format!("{path}::{}", fact.label)),
                path: Some(path.to_string()),
                detail: Some(fact.detail.clone()),
                language: language.map(str::to_string),
                community_id: None,
                trust: fact.trust,
                origin: GraphOrigin::Metadata,
                sources: vec![anchor.clone()],
            });
        }
        edges.push(make_edge(
            file_id,
            &id,
            &fact.edge_kind,
            fact.trust,
            GraphOrigin::Metadata,
            fact.detail,
            vec![anchor],
            Vec::new(),
        ));
        node_id_by_key.insert(fact.key, id);
    }
    for link in extraction.links {
        let (Some(from), Some(to)) = (
            node_id_by_key.get(&link.from_key),
            node_id_by_key.get(&link.to_key),
        ) else {
            continue;
        };
        let sources = nodes
            .iter()
            .find(|node| node.id == *to)
            .map(|node| node.sources.clone())
            .unwrap_or_default();
        edges.push(make_edge(
            from,
            to,
            &link.edge_kind,
            link.trust,
            GraphOrigin::Metadata,
            link.detail,
            sources,
            Vec::new(),
        ));
    }
}

pub(super) fn attach_metadata_to_syntax_owners(
    nodes: &[StructuralGraphNode],
    edges: &mut Vec<StructuralGraphEdge>,
) {
    let syntax_nodes = nodes
        .iter()
        .filter(|node| node.origin == GraphOrigin::Syntax && node.kind != "file")
        .collect::<Vec<_>>();
    let metadata_nodes = nodes
        .iter()
        .filter(|node| node.origin == GraphOrigin::Metadata && node.kind != "configuration")
        .collect::<Vec<_>>();
    for metadata in metadata_nodes {
        if metadata.kind == "tauri_command" {
            if let Some(implementation) = syntax_nodes.iter().find(|candidate| {
                candidate.label == metadata.label && candidate.path == metadata.path
            }) {
                edges.push(make_edge(
                    &metadata.id,
                    &implementation.id,
                    "implemented_by",
                    GraphTrust::Extracted,
                    GraphOrigin::Metadata,
                    "command annotation and declaration share an exact source-backed name"
                        .to_string(),
                    metadata.sources.clone(),
                    Vec::new(),
                ));
            }
        }
        let Some(source) = metadata.sources.first() else {
            continue;
        };
        let Some(line) = source.start_line else {
            continue;
        };
        let owner = syntax_nodes
            .iter()
            .filter(|candidate| candidate.path == metadata.path)
            .filter_map(|candidate| {
                let anchor = candidate.sources.first()?;
                let start = anchor.start_line?;
                let end = anchor.end_line.unwrap_or(start);
                (start <= line && line <= end).then_some((*candidate, end - start))
            })
            .min_by_key(|(_, span)| *span)
            .map(|(candidate, _)| candidate);
        if let Some(owner) = owner {
            let file_id = metadata
                .path
                .as_deref()
                .map(|path| stable_graph_id("file", path));
            let source_relation = file_id.as_deref().and_then(|file_id| {
                edges
                    .iter()
                    .find(|edge| edge.from == file_id && edge.to == metadata.id)
                    .map(|edge| edge.kind.clone())
            });
            let kind = match metadata.kind.as_str() {
                "analytics_event" => "emits",
                "db_table" | "db_view" | "db_index" => "persists_to",
                "db_object_reference" => source_relation.as_deref().unwrap_or("references_data"),
                "dbt_model_reference" => "depends_on",
                "job_reference" => "schedules",
                "event_reference" => "emits",
                "event_subscription" => "subscribes",
                "configuration_reference" => "reads_config",
                "route" => "routes_to",
                "test" => "tests",
                _ => "contains",
            };
            edges.push(make_edge(
                &owner.id,
                &metadata.id,
                kind,
                metadata.trust,
                GraphOrigin::Metadata,
                "metadata signal is lexically contained by this declaration".to_string(),
                metadata.sources.clone(),
                Vec::new(),
            ));
        }
    }
}

/// A structured-configuration file contributed nothing searchable before this:
/// its only node was the file itself, labelled with its own path. A query about
/// what a config file *says* — a project id, a deploy target, a feature flag —
/// therefore could not retrieve the file at any budget, which read as a ranking
/// failure and was really a coverage gap. Each key/value entry now becomes one
/// node anchored at its line.
const MAX_CONFIG_ENTRIES_PER_FILE: usize = 400;

fn is_structured_config_path(lower_path: &str) -> bool {
    let name = lower_path.rsplit('/').next().unwrap_or(lower_path);
    [".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini"]
        .iter()
        .any(|extension| lower_path.ends_with(extension))
        || matches!(name, ".gitmodules" | ".editorconfig" | ".npmrc")
}

/// A lockfile is a resolver's output, not authored configuration: thousands of
/// dependency entries nobody asks a structural question about. One `pnpm-lock`
/// alone contributed 213 entries on a measured repository.
fn is_lockfile_path(lower_path: &str) -> bool {
    let name = lower_path.rsplit('/').next().unwrap_or(lower_path);
    matches!(
        name,
        "package-lock.json"
            | "pnpm-lock.yaml"
            | "yarn.lock"
            | "npm-shrinkwrap.json"
            | "cargo.lock"
            | "poetry.lock"
            | "composer.lock"
            | "gemfile.lock"
            | "bun.lock"
            | "bun.lockb"
    )
}

/// Every key/value entry on one line, as `key: value` (or a bare `key` when the
/// value is structural or uninteresting).
///
/// A line can carry several entries — `{ "id": "x", "deployKind": "worker" }` —
/// so the line is split on commas first. Fragments that are not a single
/// key/value entry yield nothing, which is how prose, punctuation-only lines and
/// continuation values are left alone.
fn config_entry_labels(trimmed: &str) -> Vec<String> {
    trimmed
        .split(',')
        .filter_map(config_entry_label)
        .collect()
}

/// `"deployKind": "worker"` -> `deployKind: worker`; `tier: parked` -> the same
/// shape; `name = "x"` -> `name: x`; an object or array opener yields the bare
/// key.
fn config_entry_label(fragment: &str) -> Option<String> {
    // Tested before the brackets are stripped, since `[section]` is the bracket.
    if let Some(section) = ini_section_label(fragment.trim()) {
        return Some(section);
    }
    let line = fragment.trim().trim_start_matches(['{', '[', '-']).trim();
    let (key, rest) = split_config_key(line)?;
    let value = rest
        .trim()
        .trim_start_matches(':')
        .trim()
        .trim_end_matches([',', '}', ']'])
        .trim()
        .trim_matches(['"', '\'', '`'])
        .trim();
    // Structural punctuation only announces that the value continues elsewhere.
    let structural = value.is_empty()
        || value.len() > 120
        || value.contains(['{', '}', '[', ']'])
        || matches!(value, "|" | ">");
    let value = if structural || !value_is_distinctive(value) {
        ""
    } else {
        value
    };
    Some(if value.is_empty() {
        key.to_string()
    } else {
        format!("{key}: {value}")
    })
}

/// `[submodule "engines/reel-maker"]` -> `submodule: engines/reel-maker`;
/// `[tool.ruff]` -> `tool.ruff`.
///
/// A section header names what the entries under it configure, and it is often
/// the only place the noun a question uses appears at all — a `.gitmodules` file
/// says "submodule" nowhere else.
fn ini_section_label(line: &str) -> Option<String> {
    let inner = line.strip_prefix('[')?.strip_suffix(']')?.trim();
    if inner.is_empty() || inner.len() > 160 {
        return None;
    }
    let (name, rest) = match inner.split_once(char::is_whitespace) {
        Some((name, rest)) => (name.trim(), rest.trim().trim_matches(['"', '\'', '`']).trim()),
        None => (inner, ""),
    };
    if name.is_empty() {
        return None;
    }
    Some(if rest.is_empty() {
        name.to_string()
    } else {
        format!("{name}: {rest}")
    })
}

/// Whether a config value is the kind of thing a question is ever asked about.
///
/// Names are: `"cfProject": "tinygpt"`, `"deployKind": "worker"`. Flags,
/// counts, versions, dates and hashes are not — and folding them into a
/// key-only node collapses the hundreds of `"deployed": true` lines in a large
/// registry onto one deduplicated node instead of one node per line. Without
/// this, config entries cost roughly a fifth of a snapshot on a
/// configuration-heavy repository and pushed it back over the import ceiling.
fn value_is_distinctive(value: &str) -> bool {
    if matches!(
        value.to_ascii_lowercase().as_str(),
        "true" | "false" | "null" | "nil" | "none" | "yes" | "no" | "on" | "off"
    ) {
        return false;
    }
    let mut letters = 0usize;
    let mut digits = 0usize;
    for character in value.chars() {
        if character.is_ascii_digit() {
            digits += 1;
        } else if character.is_alphabetic() {
            letters += 1;
        }
    }
    // Versions (`1.2.3`), dates (`2026-08-22`), counts and hex digests are all
    // digit-dominated; a name is not.
    letters > digits && letters >= 2
}

/// Splits a leading quoted or bare key from its separator and remainder.
fn split_config_key(line: &str) -> Option<(&str, &str)> {
    let (key, rest) = match line.strip_prefix('"') {
        Some(quoted) => {
            let end = quoted.find('"')?;
            (&quoted[..end], &quoted[end + 1..])
        }
        None => {
            let end = line.find([':', '='])?;
            (line[..end].trim(), &line[end..])
        }
    };
    let rest = rest.trim_start();
    if !rest.starts_with(':') && !rest.starts_with('=') {
        return None;
    }
    let key = key.trim();
    let plausible = !key.is_empty()
        && key.len() <= 80
        && key
            .chars()
            .all(|character| character.is_alphanumeric() || matches!(character, '_' | '-' | '.' | '$' | '/'))
        && key.chars().any(char::is_alphanumeric);
    plausible.then_some((key, rest.get(1..).unwrap_or_default()))
}

#[allow(clippy::too_many_arguments)]
fn push_metadata_signal(
    path: &str,
    source: &str,
    file_id: &str,
    language: Option<&str>,
    line_number: usize,
    kind: &str,
    label: &str,
    edge_kind: &str,
    evidence: &str,
    nodes: &mut Vec<StructuralGraphNode>,
    edges: &mut Vec<StructuralGraphEdge>,
) {
    let label = label.trim().trim_matches(['`', '"', '\'', ';']);
    if label.is_empty() || label.len() > 240 {
        return;
    }
    let id = stable_graph_id(kind, &format!("{path}\0{label}"));
    if nodes.iter().any(|node| node.id == id) {
        return;
    }
    let excerpt = source
        .lines()
        .nth(line_number.saturating_sub(1))
        .map(|line| {
            let line = line.trim();
            line.chars().take(240).collect::<String>()
        });
    let anchor = GraphSourceAnchor {
        path: path.to_string(),
        start_line: Some(line_number as u32),
        start_column: Some(1),
        end_line: Some(line_number as u32),
        end_column: None,
        excerpt,
    };
    nodes.push(StructuralGraphNode {
        id: id.clone(),
        kind: kind.to_string(),
        label: label.to_string(),
        qualified_name: Some(format!("{path}::{label}")),
        path: Some(path.to_string()),
        detail: Some(evidence.to_string()),
        language: language.map(str::to_string),
        community_id: None,
        trust: GraphTrust::Extracted,
        origin: GraphOrigin::Metadata,
        sources: vec![anchor.clone()],
    });
    edges.push(make_edge(
        file_id,
        &id,
        edge_kind,
        GraphTrust::Extracted,
        GraphOrigin::Metadata,
        evidence.to_string(),
        vec![anchor],
        Vec::new(),
    ));
}

fn is_config_name(name: &str) -> bool {
    name.ends_with(".config.js")
        || name.ends_with(".config.ts")
        || matches!(
            name,
            "package.json"
                | "cargo.toml"
                | "pyproject.toml"
                | "go.mod"
                | "dockerfile"
                | "docker-compose.yml"
                | "docker-compose.yaml"
                | "wrangler.toml"
                | "wrangler.jsonc"
                | "tauri.conf.json"
        )
}

fn sql_object_name(line: &str, object_kind: &str) -> Option<String> {
    let tokens = line
        .split(|character: char| character.is_whitespace() || matches!(character, '(' | ';'))
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();
    let position = tokens
        .iter()
        .position(|token| token.eq_ignore_ascii_case(object_kind))?;
    tokens
        .iter()
        .skip(position + 1)
        .find(|token| {
            !matches!(
                token.to_ascii_lowercase().as_str(),
                "if" | "not" | "exists" | "unique" | "concurrently"
            )
        })
        .map(|token| token.trim_matches(['`', '"', '\'', '[', ']']).to_string())
}

fn rust_function_name(line: &str) -> Option<String> {
    let function = line.find("fn ")? + 3;
    let rest = &line[function..];
    let name = rest
        .split(|character: char| !character.is_alphanumeric() && character != '_')
        .next()?;
    (!name.is_empty()).then(|| name.to_string())
}

fn first_quoted(line: &str) -> Option<String> {
    for quote in ['"', '\'', '`'] {
        let Some(start) = line.find(quote) else {
            continue;
        };
        let rest = &line[start + quote.len_utf8()..];
        if let Some(end) = rest.find(quote) {
            let value = rest[..end].trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn is_analytics_line(lower: &str) -> bool {
    [
        "capture(",
        ".capture(",
        "track(",
        "trackevent(",
        "track_event(",
        "trackcoreaction(",
        "track_core_action(",
        "analytics.emit(",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn is_test_line(lower: &str, lower_path: &str) -> bool {
    lower == "#[test]"
        || lower.starts_with("it(")
        || lower.starts_with("test(")
        || lower.starts_with("describe(")
        || ((lower_path.contains("/tests/") || lower_path.contains(".test."))
            && lower.contains("fn test_"))
}

fn markdown_link_targets(line: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut remainder = line;
    while let Some(start) = remainder.find("](") {
        let after = &remainder[start + 2..];
        let Some(end) = after.find(')') else {
            break;
        };
        let target = after[..end].trim();
        if !target.is_empty() && !target.starts_with('#') {
            targets.push(target.to_string());
        }
        remainder = &after[end + 1..];
    }
    targets
}

fn rationale_marker(line: &str) -> Option<String> {
    let trimmed = line
        .trim()
        .trim_start_matches(['#', '-', '*', '>', ' '])
        .trim();
    let lower = trimmed.to_ascii_lowercase();
    ["decision:", "rationale:", "why:", "adr:"]
        .iter()
        .find_map(|marker| lower.starts_with(marker).then(|| trimmed.to_string()))
}
