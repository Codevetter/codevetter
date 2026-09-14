use crate::git::Result;
use crate::session::{Document, Location, Session};
use serde_json::{json, Value};

pub fn important(path: &str) -> Option<&'static str> {
    let lower = path.to_lowercase();
    let name = lower.rsplit('/').next().unwrap_or("");
    if matches!(
        name,
        "agents.md" | "claude.md" | "contributing.md" | ".cursorrules"
    ) {
        Some("Repository instructions")
    } else if lower.contains("adr/")
        || lower.contains("decisions/")
        || name.contains("architecture")
    {
        Some("Architecture and decisions")
    } else if matches!(
        name,
        "package.json" | "cargo.toml" | "package.swift" | "go.mod" | "pyproject.toml"
    ) {
        Some("Dependencies and modules")
    } else if name.starts_with("readme") {
        Some("Repository overview")
    } else if ["main.", "index.", "app.", "server."]
        .iter()
        .any(|p| name.starts_with(p))
    {
        Some("Entry points")
    } else {
        None
    }
}

pub fn symbols(path: &str, doc: &Document) -> Vec<Location> {
    let ext = path.rsplit('.').next().unwrap_or("");
    let language = match ext {
        "ts" => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        "tsx" => tree_sitter_typescript::LANGUAGE_TSX.into(),
        "js" | "jsx" | "mjs" | "cjs" => tree_sitter_javascript::LANGUAGE.into(),
        _ => return Vec::new(),
    };
    let mut parser = tree_sitter::Parser::new();
    if parser.set_language(&language).is_err() {
        return Vec::new();
    }
    let Some(tree) = parser.parse(&doc.text, None) else {
        return Vec::new();
    };
    let mut nodes = vec![tree.root_node()];
    let mut symbols = Vec::new();
    while let Some(node) = nodes.pop() {
        if matches!(
            node.kind(),
            "function_declaration"
                | "class_declaration"
                | "method_definition"
                | "interface_declaration"
                | "type_alias_declaration"
                | "enum_declaration"
                | "variable_declarator"
        ) {
            if let Some(name) = node.child_by_field_name("name") {
                if let Ok(text) = name.utf8_text(doc.text.as_bytes()) {
                    symbols.push(Location {
                        path: path.into(),
                        line: name.start_position().row + 1,
                        text: text.into(),
                        kind: node.kind().replace('_', " "),
                    });
                }
            }
        }
        let mut cursor = node.walk();
        nodes.extend(node.named_children(&mut cursor));
    }
    symbols.sort_by_key(|s| s.line);
    symbols
}

pub fn search(session: &Session, query: &str, reference: bool) -> Result<Value> {
    if query.trim().is_empty() {
        return Ok(json!({"locations": [], "complete": false, "truncated": false}));
    }
    if query.len() > 512 {
        return Err("Search query exceeds 512 bytes.".into());
    }
    let index = session
        .index
        .read()
        .map_err(|_| "Source index unavailable")?;
    let mut locations = Vec::new();
    let mut truncated = false;
    'files: for (path, doc) in &index.documents {
        for (line, text) in doc.text.lines().enumerate() {
            let found = if reference {
                text.match_indices(query).any(|(start, _)| {
                    let ident = |c: char| c.is_alphanumeric() || c == '_' || c == '$';
                    !text[..start].chars().next_back().is_some_and(ident)
                        && !text[start + query.len()..]
                            .chars()
                            .next()
                            .is_some_and(ident)
                })
            } else {
                text.contains(query)
            };
            if found {
                if locations.len() == 300 {
                    truncated = true;
                    break 'files;
                }
                locations.push(Location {
                    path: path.clone(),
                    line: line + 1,
                    text: text.chars().take(300).collect(),
                    kind: if reference {
                        "text reference candidate"
                    } else {
                        "text match"
                    }
                    .into(),
                });
            }
        }
    }
    Ok(
        json!({"locations": locations, "complete": index.done && index.skipped == 0, "truncated": truncated,
        "qualification": if reference { "Identifier matches; candidates are not language-server resolved references." } else { "Case-sensitive literal source search." }}),
    )
}

pub fn overview(session: &Session) -> Result<Value> {
    let index = session
        .index
        .read()
        .map_err(|_| "Source index unavailable")?;
    let mut locations: Vec<_> = session
        .snapshot
        .files
        .iter()
        .filter_map(|f| {
            important(&f.path).map(|kind| Location {
                path: f.path.clone(),
                line: 1,
                text: f.path.clone(),
                kind: kind.into(),
            })
        })
        .collect();
    // Source-backed dependency neighborhoods are read from explicit import statements.
    let mut dependencies = Vec::new();
    for (path, doc) in &index.documents {
        for (line, text) in doc.text.lines().enumerate() {
            let trimmed = text.trim();
            if trimmed.starts_with("import ") || trimmed.contains("require(") {
                dependencies.push(Location {
                    path: path.clone(),
                    line: line + 1,
                    text: trimmed.chars().take(250).collect(),
                    kind: "Dependency declaration".into(),
                });
                if dependencies.len() >= 200 {
                    break;
                }
            }
        }
        if dependencies.len() >= 200 {
            break;
        }
    }
    locations.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.path.cmp(&b.path)));
    Ok(
        json!({"locations": locations, "dependencies": dependencies, "indexed_files": index.files,
        "qualification": "Deterministic source map. Instructions, architecture documents, modules, and imports are navigation context, not executable proof."}),
    )
}

pub fn fuzzy(paths: impl Iterator<Item = String>, query: &str) -> Vec<String> {
    let query = query.to_lowercase();
    let mut ranked = Vec::new();
    for path in paths {
        let lower = path.to_lowercase();
        let mut chars = query.chars();
        let mut next = chars.next();
        let mut score = 0_i64;
        let mut last = None;
        for (i, c) in lower.char_indices() {
            if next == Some(c) {
                score += if last == Some(i.saturating_sub(1)) {
                    12
                } else {
                    1
                };
                last = Some(i);
                next = chars.next();
            }
        }
        if next.is_none() {
            if lower.rsplit('/').next().unwrap_or("").starts_with(&query) {
                score += 100;
            }
            score -= path.len() as i64 / 8;
            ranked.push((score, path));
        }
    }
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    ranked.into_iter().take(100).map(|(_, p)| p).collect()
}
