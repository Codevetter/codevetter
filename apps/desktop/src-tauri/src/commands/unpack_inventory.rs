//! Fast inventory metadata helpers for Repo Unpacked.

use crate::commands::unpack_types::{
    EntrypointHint, LanguageCount, ManifestSummary, WorkspaceUnitSummary,
};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

pub(crate) fn language_for_path(path: &str) -> Option<&'static str> {
    let ext = Path::new(path)
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    Some(match ext.as_str() {
        "ts" | "tsx" => "TypeScript",
        "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
        "rs" => "Rust",
        "py" => "Python",
        "go" => "Go",
        "rb" => "Ruby",
        "java" => "Java",
        "kt" | "kts" => "Kotlin",
        "swift" => "Swift",
        "c" | "h" => "C",
        "cpp" | "cc" | "hpp" | "cxx" => "C++",
        "cs" => "C#",
        "php" => "PHP",
        "ex" | "exs" => "Elixir",
        "erl" => "Erlang",
        "scala" => "Scala",
        "lua" => "Lua",
        "vue" => "Vue",
        "svelte" => "Svelte",
        "html" | "htm" => "HTML",
        "css" => "CSS",
        "scss" | "sass" => "Sass",
        "sql" => "SQL",
        "sh" | "bash" | "zsh" => "Shell",
        "md" | "mdx" => "Markdown",
        "json" => "JSON",
        "yaml" | "yml" => "YAML",
        "toml" => "TOML",
        _ => return None,
    })
}

pub(crate) fn read_first_bytes(path: &Path, limit: usize) -> String {
    use std::io::Read;
    let mut file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return String::new(),
    };
    let mut buf = vec![0u8; limit];
    let n = file.read(&mut buf).unwrap_or(0);
    buf.truncate(n);
    String::from_utf8_lossy(&buf).to_string()
}

pub(crate) fn is_manifest_candidate_path(rel: &str) -> bool {
    if rel.matches('/').count() > 3 {
        return false;
    }
    let basename = Path::new(rel)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
        .to_lowercase();
    matches!(
        basename.as_str(),
        "package.json"
            | "cargo.toml"
            | "pyproject.toml"
            | "go.mod"
            | "gemfile"
            | "composer.json"
            | "tauri.conf.json"
    )
}

pub(crate) fn manifest_candidate_paths(
    sampled_files: &[(String, u64)],
    tracked_files: Option<&[String]>,
) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for path in sampled_files.iter().map(|(path, _)| path.as_str()) {
        if is_manifest_candidate_path(path) && seen.insert(path.to_string()) {
            candidates.push(path.to_string());
        }
    }
    if let Some(tracked) = tracked_files {
        for path in tracked {
            if is_manifest_candidate_path(path) && seen.insert(path.clone()) {
                candidates.push(path.clone());
            }
        }
    }

    candidates.sort_by(|a, b| {
        let depth_a = a.matches('/').count();
        let depth_b = b.matches('/').count();
        depth_a.cmp(&depth_b).then_with(|| a.cmp(b))
    });
    candidates.truncate(160);
    candidates
}

pub(crate) fn parse_manifest(root: &Path, rel: &str) -> Option<ManifestSummary> {
    if !is_manifest_candidate_path(rel) {
        return None;
    }
    let basename = Path::new(rel)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
        .to_lowercase();

    let abs = root.join(rel);
    match basename.as_str() {
        "package.json" => parse_package_json(&abs, rel),
        "cargo.toml" => parse_cargo_toml(&abs, rel),
        "pyproject.toml" => parse_pyproject(&abs, rel),
        "go.mod" => parse_go_mod(&abs, rel),
        "gemfile" => Some(ManifestSummary {
            path: rel.to_string(),
            kind: "gemfile".to_string(),
            name: None,
            version: None,
            dependencies: Vec::new(),
            scripts: Vec::new(),
        }),
        "composer.json" => Some(ManifestSummary {
            path: rel.to_string(),
            kind: "composer.json".to_string(),
            name: None,
            version: None,
            dependencies: Vec::new(),
            scripts: Vec::new(),
        }),
        "tauri.conf.json" => Some(ManifestSummary {
            path: rel.to_string(),
            kind: "tauri.conf.json".to_string(),
            name: None,
            version: None,
            dependencies: Vec::new(),
            scripts: Vec::new(),
        }),
        _ => None,
    }
}

fn parse_package_json(abs: &Path, rel: &str) -> Option<ManifestSummary> {
    let raw = fs::read_to_string(abs).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    let name = v.get("name").and_then(|x| x.as_str()).map(String::from);
    let version = v.get("version").and_then(|x| x.as_str()).map(String::from);

    let mut deps: Vec<String> = Vec::new();
    for key in &["dependencies", "devDependencies", "peerDependencies"] {
        if let Some(map) = v.get(*key).and_then(|x| x.as_object()) {
            for k in map.keys() {
                deps.push(k.to_string());
            }
        }
    }
    deps.sort();
    deps.dedup();
    deps.truncate(80);

    let scripts: Vec<String> = v
        .get("scripts")
        .and_then(|x| x.as_object())
        .map(|m| m.keys().take(40).cloned().collect())
        .unwrap_or_default();

    Some(ManifestSummary {
        path: rel.to_string(),
        kind: "package.json".to_string(),
        name,
        version,
        dependencies: deps,
        scripts,
    })
}

fn parse_cargo_toml(abs: &Path, rel: &str) -> Option<ManifestSummary> {
    let raw = fs::read_to_string(abs).ok()?;
    let mut name: Option<String> = None;
    let mut version: Option<String> = None;
    let mut deps: Vec<String> = Vec::new();
    let mut in_deps = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_deps = trimmed == "[dependencies]"
                || trimmed == "[dev-dependencies]"
                || trimmed == "[build-dependencies]"
                || trimmed.starts_with("[target.");
            if !in_deps {
                continue;
            }
            continue;
        }
        if !in_deps {
            if let Some(rest) = trimmed.strip_prefix("name") {
                if let Some(v) = parse_toml_string_value(rest) {
                    name = Some(v);
                }
            }
            if let Some(rest) = trimmed.strip_prefix("version") {
                if let Some(v) = parse_toml_string_value(rest) {
                    version = Some(v);
                }
            }
        } else {
            if let Some(eq_idx) = trimmed.find('=') {
                let dep = trimmed[..eq_idx].trim().trim_matches('"').to_string();
                if !dep.is_empty() && !dep.starts_with('#') {
                    deps.push(dep);
                }
            }
        }
    }
    deps.sort();
    deps.dedup();
    deps.truncate(80);
    Some(ManifestSummary {
        path: rel.to_string(),
        kind: "cargo.toml".to_string(),
        name,
        version,
        dependencies: deps,
        scripts: Vec::new(),
    })
}

fn parse_toml_string_value(rest: &str) -> Option<String> {
    let after_eq = rest.split_once('=')?.1.trim();
    let unquoted = after_eq.trim_matches('"').trim_matches('\'');
    if unquoted.is_empty() {
        None
    } else {
        Some(unquoted.to_string())
    }
}

fn parse_pyproject(abs: &Path, rel: &str) -> Option<ManifestSummary> {
    let raw = fs::read_to_string(abs).ok()?;
    let mut name = None;
    let mut version = None;
    let mut deps: Vec<String> = Vec::new();
    let mut in_deps = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_deps = trimmed.contains("dependencies");
            continue;
        }
        if !in_deps {
            if let Some(rest) = trimmed.strip_prefix("name") {
                if let Some(v) = parse_toml_string_value(rest) {
                    name = Some(v);
                }
            }
            if let Some(rest) = trimmed.strip_prefix("version") {
                if let Some(v) = parse_toml_string_value(rest) {
                    version = Some(v);
                }
            }
        } else if let Some(dep) = trimmed.split_whitespace().next() {
            let cleaned = dep.trim_matches('"').trim_matches(',').to_string();
            if !cleaned.is_empty() {
                deps.push(cleaned);
            }
        }
    }
    deps.truncate(80);
    Some(ManifestSummary {
        path: rel.to_string(),
        kind: "pyproject.toml".to_string(),
        name,
        version,
        dependencies: deps,
        scripts: Vec::new(),
    })
}

fn parse_go_mod(abs: &Path, rel: &str) -> Option<ManifestSummary> {
    let raw = fs::read_to_string(abs).ok()?;
    let mut name = None;
    let mut deps: Vec<String> = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("module ") {
            name = Some(rest.trim().to_string());
        }
        if trimmed.starts_with("require ") || trimmed.starts_with('\t') {
            if let Some(dep) = trimmed.split_whitespace().nth(0) {
                if dep != "require" && !dep.starts_with("//") {
                    deps.push(dep.to_string());
                }
            }
        }
    }
    deps.sort();
    deps.dedup();
    deps.truncate(80);
    Some(ManifestSummary {
        path: rel.to_string(),
        kind: "go.mod".to_string(),
        name,
        version: None,
        dependencies: deps,
        scripts: Vec::new(),
    })
}

pub(crate) fn infer_stack(files: &[(String, u64)], manifests: &[ManifestSummary]) -> Vec<String> {
    let mut tags: Vec<&'static str> = Vec::new();
    let names: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();

    let has = |needle: &str| names.iter().any(|p| p == &needle);
    let has_in = |needle: &str| names.iter().any(|p| p.contains(needle));

    if has("tauri.conf.json") || has_in("src-tauri/") {
        tags.push("Tauri");
    }
    if manifests
        .iter()
        .any(|m| m.dependencies.contains(&"react".to_string()))
    {
        tags.push("React");
    }
    if manifests
        .iter()
        .any(|m| m.dependencies.contains(&"vue".to_string()))
    {
        tags.push("Vue");
    }
    if manifests
        .iter()
        .any(|m| m.dependencies.contains(&"svelte".to_string()))
    {
        tags.push("Svelte");
    }
    if manifests
        .iter()
        .any(|m| m.dependencies.contains(&"next".to_string()))
    {
        tags.push("Next.js");
    }
    if manifests
        .iter()
        .any(|m| m.dependencies.contains(&"vite".to_string()))
        || has("vite.config.ts")
        || has("vite.config.js")
    {
        tags.push("Vite");
    }
    if manifests
        .iter()
        .any(|m| m.dependencies.contains(&"tailwindcss".to_string()))
        || has("tailwind.config.ts")
        || has("tailwind.config.js")
    {
        tags.push("Tailwind");
    }
    if manifests
        .iter()
        .any(|m| m.dependencies.iter().any(|d| d == "drizzle-orm"))
    {
        tags.push("Drizzle");
    }
    if manifests.iter().any(|m| {
        m.dependencies
            .iter()
            .any(|d| d == "@cloudflare/workers-types")
    }) || has("wrangler.toml")
        || has("wrangler.jsonc")
    {
        tags.push("Cloudflare Workers");
    }
    if manifests.iter().any(|m| m.kind == "cargo.toml") {
        tags.push("Rust");
    }
    if manifests.iter().any(|m| m.kind == "go.mod") {
        tags.push("Go");
    }
    if manifests.iter().any(|m| m.kind == "pyproject.toml") {
        tags.push("Python");
    }
    if manifests
        .iter()
        .any(|m| m.dependencies.iter().any(|d| d == "@playwright/test"))
    {
        tags.push("Playwright");
    }
    if manifests
        .iter()
        .any(|m| m.dependencies.iter().any(|d| d == "vitest"))
    {
        tags.push("Vitest");
    }
    if has(".github/workflows") || has_in(".github/workflows/") {
        tags.push("GitHub Actions");
    }
    if has("Dockerfile") || has("docker-compose.yml") || has("docker-compose.yaml") {
        tags.push("Docker");
    }
    if has("vercel.json") {
        tags.push("Vercel");
    }
    if has("netlify.toml") {
        tags.push("Netlify");
    }
    if has("fly.toml") {
        tags.push("Fly.io");
    }

    tags.sort();
    tags.dedup();
    tags.into_iter().map(String::from).collect()
}

pub(crate) fn infer_entrypoints(
    files: &[(String, u64)],
    manifests: &[ManifestSummary],
    stack_tags: &[String],
) -> Vec<EntrypointHint> {
    let mut hits: Vec<EntrypointHint> = Vec::new();
    let names: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();
    let push_if = |hits: &mut Vec<EntrypointHint>, path: &str, kind: &str, reason: &str| {
        if names.contains(&path) {
            hits.push(EntrypointHint {
                path: path.to_string(),
                kind: kind.to_string(),
                reason: reason.to_string(),
            });
        }
    };

    push_if(&mut hits, "README.md", "docs", "Repository readme");
    push_if(&mut hits, "AGENTS.md", "docs", "Agent instructions");
    push_if(&mut hits, "agents.md", "docs", "Agent instructions");
    push_if(&mut hits, "CLAUDE.md", "docs", "Claude instructions");
    push_if(&mut hits, ".env.example", "config", "Required env vars");

    // Common code entrypoints (existence checked across full file list)
    let candidates = [
        ("src/main.rs", "bin", "Rust binary entrypoint"),
        ("src/lib.rs", "bin", "Rust library entrypoint"),
        ("src/index.ts", "web", "TS entrypoint"),
        ("src/index.tsx", "web", "TSX entrypoint"),
        ("src/main.ts", "web", "Vite/TS entrypoint"),
        ("src/main.tsx", "web", "Vite/React entrypoint"),
        ("src/App.tsx", "web", "React root component"),
        ("src/App.vue", "web", "Vue root component"),
        ("pages/_app.tsx", "web", "Next.js Pages Router"),
        ("app/page.tsx", "web", "Next.js App Router"),
        ("app/layout.tsx", "web", "Next.js root layout"),
        ("server.ts", "server", "Server entrypoint"),
        ("server.js", "server", "Server entrypoint"),
        ("worker.ts", "server", "Cloudflare worker"),
        ("workerd.ts", "server", "Cloudflare worker"),
        ("index.html", "web", "Static html shell"),
        ("manage.py", "script", "Django manage.py"),
        ("main.py", "script", "Python entrypoint"),
        ("app.py", "script", "Flask app"),
    ];
    for (path, kind, reason) in candidates {
        push_if(&mut hits, path, kind, reason);
    }

    // Walk every file looking for nested entrypoints (apps/*/src/main.tsx etc.)
    for (p, _) in files {
        if p.ends_with("src/main.rs") && p != "src/main.rs" {
            hits.push(EntrypointHint {
                path: p.clone(),
                kind: "bin".to_string(),
                reason: "Rust binary entrypoint".to_string(),
            });
        }
        if p.ends_with("src-tauri/tauri.conf.json") {
            hits.push(EntrypointHint {
                path: p.clone(),
                kind: "desktop".to_string(),
                reason: "Tauri config".to_string(),
            });
        }
        if p.ends_with("src/main.tsx") && p != "src/main.tsx" {
            hits.push(EntrypointHint {
                path: p.clone(),
                kind: "web".to_string(),
                reason: "Vite React entrypoint".to_string(),
            });
        }
        if p.ends_with("src/App.tsx") && p != "src/App.tsx" {
            hits.push(EntrypointHint {
                path: p.clone(),
                kind: "web".to_string(),
                reason: "React root".to_string(),
            });
        }
        if p.ends_with("vite.config.ts") || p.ends_with("vite.config.js") {
            hits.push(EntrypointHint {
                path: p.clone(),
                kind: "config".to_string(),
                reason: "Vite config".to_string(),
            });
        }
        if p.ends_with("playwright.config.ts") {
            hits.push(EntrypointHint {
                path: p.clone(),
                kind: "config".to_string(),
                reason: "Playwright e2e config".to_string(),
            });
        }
        if p.ends_with(".github/workflows/ci.yml")
            || p.ends_with(".github/workflows/release.yml")
            || (p.starts_with(".github/workflows/") && p.ends_with(".yml"))
        {
            hits.push(EntrypointHint {
                path: p.clone(),
                kind: "config".to_string(),
                reason: "GitHub Actions workflow".to_string(),
            });
        }
    }

    // Manifest-based: package.json scripts → "scripts" entrypoint
    for m in manifests {
        if m.kind == "package.json" && !m.scripts.is_empty() {
            let preview: Vec<String> = m.scripts.iter().take(8).cloned().collect();
            hits.push(EntrypointHint {
                path: m.path.clone(),
                kind: "config".to_string(),
                reason: format!("npm scripts: {}", preview.join(", ")),
            });
        }
    }

    // Stack hint nudges
    if stack_tags.contains(&"Tauri".to_string()) {
        for (p, _) in files {
            if p.ends_with("src-tauri/src/main.rs") {
                hits.push(EntrypointHint {
                    path: p.clone(),
                    kind: "desktop".to_string(),
                    reason: "Tauri Rust backend".to_string(),
                });
            }
        }
    }

    // De-dup by path
    let mut seen = std::collections::HashSet::new();
    hits.retain(|h| seen.insert(h.path.clone()));
    hits.truncate(60);
    hits
}

pub(crate) fn build_workspace_units(
    files: &[(String, u64)],
    tracked_files: Option<&[String]>,
    manifests: &[ManifestSummary],
    entrypoints: &[EntrypointHint],
) -> Vec<WorkspaceUnitSummary> {
    let file_paths: Vec<String> = tracked_files
        .map(|tracked| tracked.to_vec())
        .unwrap_or_else(|| files.iter().map(|(path, _)| path.clone()).collect());
    let size_by_path: HashMap<&str, u64> = files
        .iter()
        .map(|(path, size)| (path.as_str(), *size))
        .collect();

    let mut units: Vec<WorkspaceUnitSummary> = Vec::new();
    let mut seen_roots: HashSet<String> = HashSet::new();

    for manifest in manifests {
        let root = manifest_root(&manifest.path);
        if !seen_roots.insert(root.clone()) {
            continue;
        }
        let unit = summarize_workspace_unit(
            &root,
            Some(manifest),
            &file_paths,
            &size_by_path,
            entrypoints,
        );
        units.push(unit);
    }

    if units.is_empty() || (file_paths.len() >= 2_000 && units.len() < 3) {
        units.extend(build_subsystem_units(
            &file_paths,
            &size_by_path,
            entrypoints,
            &mut seen_roots,
        ));
    }

    if units.is_empty() {
        units.push(summarize_workspace_unit(
            ".",
            None,
            &file_paths,
            &size_by_path,
            entrypoints,
        ));
    }

    units.sort_by(|a, b| {
        score_workspace_unit(b)
            .cmp(&score_workspace_unit(a))
            .then_with(|| a.path.cmp(&b.path))
    });
    units.truncate(48);
    units
}

fn build_subsystem_units(
    file_paths: &[String],
    size_by_path: &HashMap<&str, u64>,
    entrypoints: &[EntrypointHint],
    seen_roots: &mut HashSet<String>,
) -> Vec<WorkspaceUnitSummary> {
    let mut top_files: HashMap<String, Vec<&String>> = HashMap::new();
    for path in file_paths {
        let Some((top, _rest)) = path.split_once('/') else {
            continue;
        };
        if is_low_signal_top_level_dir(top) {
            continue;
        }
        top_files.entry(top.to_string()).or_default().push(path);
    }

    let mut candidates: Vec<(String, usize)> = top_files
        .iter()
        .filter_map(|(top, paths)| {
            if paths.len() >= 8 {
                Some((top.clone(), paths.len()))
            } else {
                None
            }
        })
        .collect();
    candidates.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    candidates.truncate(16);

    candidates
        .into_iter()
        .filter_map(|(root, _count)| {
            if !seen_roots.insert(root.clone()) {
                return None;
            }
            let unit_files = top_files.get(&root)?;
            Some(summarize_workspace_unit_from_files(
                &root,
                None,
                unit_files,
                size_by_path,
                entrypoints,
            ))
        })
        .collect()
}

fn is_low_signal_top_level_dir(dir: &str) -> bool {
    matches!(
        dir,
        ".git"
            | ".github"
            | ".husky"
            | ".vscode"
            | ".idea"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | "out"
            | "coverage"
            | ".next"
            | ".turbo"
            | ".cache"
            | "vendor"
    )
}

fn manifest_root(manifest_path: &str) -> String {
    Path::new(manifest_path)
        .parent()
        .map(|parent| parent.to_string_lossy().to_string())
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| ".".to_string())
}

fn summarize_workspace_unit(
    root: &str,
    manifest: Option<&ManifestSummary>,
    file_paths: &[String],
    size_by_path: &HashMap<&str, u64>,
    entrypoints: &[EntrypointHint],
) -> WorkspaceUnitSummary {
    let unit_files: Vec<&String> = file_paths
        .iter()
        .filter(|path| path_in_unit(path, root))
        .collect();
    summarize_workspace_unit_from_files(root, manifest, &unit_files, size_by_path, entrypoints)
}

fn summarize_workspace_unit_from_files(
    root: &str,
    manifest: Option<&ManifestSummary>,
    unit_files: &[&String],
    size_by_path: &HashMap<&str, u64>,
    entrypoints: &[EntrypointHint],
) -> WorkspaceUnitSummary {
    let mut lang_map: HashMap<&'static str, (usize, u64)> = HashMap::new();
    let mut test_files: Vec<String> = Vec::new();

    for path in unit_files {
        if let Some(lang) = language_for_path(path) {
            let entry = lang_map.entry(lang).or_insert((0, 0));
            entry.0 += 1;
            entry.1 += size_by_path.get(path.as_str()).copied().unwrap_or(0);
        }
        if is_test_path(path) {
            test_files.push((*path).clone());
        }
    }

    let mut languages: Vec<LanguageCount> = lang_map
        .into_iter()
        .map(|(language, (files, bytes))| LanguageCount {
            language: language.to_string(),
            files,
            bytes,
        })
        .collect();
    languages.sort_by(|a, b| b.files.cmp(&a.files).then_with(|| b.bytes.cmp(&a.bytes)));
    languages.truncate(5);
    test_files.sort();
    test_files.truncate(8);

    let mut unit_entrypoints: Vec<String> = entrypoints
        .iter()
        .filter(|entrypoint| path_in_unit(&entrypoint.path, root))
        .map(|entrypoint| entrypoint.path.clone())
        .collect();
    unit_entrypoints.sort();
    unit_entrypoints.dedup();
    unit_entrypoints.truncate(8);

    let mut scripts: Vec<String> = manifest
        .map(|manifest| manifest.scripts.iter().take(12).cloned().collect())
        .unwrap_or_default();
    scripts.sort();

    let kind = infer_workspace_unit_kind(root, manifest, &unit_files, &unit_entrypoints);
    let tags = infer_workspace_unit_tags(manifest, &unit_files, &languages, !test_files.is_empty());

    WorkspaceUnitSummary {
        path: root.to_string(),
        name: workspace_unit_name(root, manifest),
        kind,
        manifest_path: manifest.map(|manifest| manifest.path.clone()),
        build_system: manifest.map(|manifest| manifest.kind.clone()),
        file_count: unit_files.len(),
        languages,
        scripts,
        entrypoints: unit_entrypoints,
        test_files,
        tags,
    }
}

fn path_in_unit(path: &str, root: &str) -> bool {
    root == "."
        || path == root
        || path
            .strip_prefix(root)
            .is_some_and(|rest| rest.starts_with('/'))
}

fn is_test_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.contains("/test/")
        || lower.contains("/tests/")
        || lower.contains("/__tests__/")
        || lower.ends_with(".test.ts")
        || lower.ends_with(".test.tsx")
        || lower.ends_with(".spec.ts")
        || lower.ends_with(".spec.tsx")
        || lower.ends_with("_test.go")
        || lower.ends_with("_test.rs")
        || lower.ends_with("_test.py")
        || lower.ends_with("_spec.rb")
}

fn workspace_unit_name(root: &str, manifest: Option<&ManifestSummary>) -> String {
    if let Some(name) = manifest.and_then(|manifest| manifest.name.clone()) {
        return name;
    }
    if root == "." {
        return "root".to_string();
    }
    Path::new(root)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| root.to_string())
}

fn infer_workspace_unit_kind(
    root: &str,
    manifest: Option<&ManifestSummary>,
    files: &[&String],
    entrypoints: &[String],
) -> String {
    let root_lower = root.to_lowercase();
    let has_file = |needle: &str| files.iter().any(|path| path.ends_with(needle));
    let has_path = |needle: &str| files.iter().any(|path| path.contains(needle));

    if root_lower.contains("docs") {
        return "docs".to_string();
    }
    if root == "." {
        return "workspace".to_string();
    }
    if manifest.is_none() {
        return "subsystem".to_string();
    }
    if has_path("src-tauri/") || has_file("tauri.conf.json") {
        return "desktop_app".to_string();
    }
    if manifest.is_some_and(|manifest| {
        manifest
            .dependencies
            .iter()
            .any(|dep| dep == "react" || dep == "next" || dep == "vue" || dep == "svelte")
    }) || entrypoints
        .iter()
        .any(|path| path.ends_with("src/main.tsx") || path.ends_with("src/App.tsx"))
    {
        return "web_app".to_string();
    }
    if has_file("worker.ts") || has_file("wrangler.toml") || has_file("wrangler.jsonc") {
        return "service".to_string();
    }
    if root_lower.contains("api") || root_lower.contains("worker") || root_lower.contains("server")
    {
        return "service".to_string();
    }
    if root_lower.contains("tool") || root_lower.contains("cli") || root_lower.contains("script") {
        return "tool".to_string();
    }
    if root_lower.contains("package") || root_lower.contains("lib") || root_lower.contains("crate")
    {
        return "library".to_string();
    }
    "workspace".to_string()
}

fn infer_workspace_unit_tags(
    manifest: Option<&ManifestSummary>,
    files: &[&String],
    languages: &[LanguageCount],
    has_tests: bool,
) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    let has_dependency = |dep: &str| {
        manifest.is_some_and(|manifest| manifest.dependencies.iter().any(|item| item == dep))
    };
    let has_file = |needle: &str| files.iter().any(|path| path.ends_with(needle));

    if has_dependency("react") {
        tags.push("React".to_string());
    }
    if has_dependency("next") {
        tags.push("Next.js".to_string());
    }
    if has_dependency("@cloudflare/workers-types") || has_file("wrangler.toml") {
        tags.push("Cloudflare".to_string());
    }
    if has_file("vite.config.ts") || has_file("vite.config.js") {
        tags.push("Vite".to_string());
    }
    if has_file("tauri.conf.json") || files.iter().any(|path| path.contains("src-tauri/")) {
        tags.push("Tauri".to_string());
    }
    for language in languages.iter().take(3) {
        tags.push(language.language.clone());
    }
    if has_tests {
        tags.push("tests".to_string());
    }
    tags.sort();
    tags.dedup();
    tags.truncate(8);
    tags
}

fn score_workspace_unit(unit: &WorkspaceUnitSummary) -> usize {
    let kind_bonus = match unit.kind.as_str() {
        "desktop_app" | "web_app" | "service" => 20_000,
        "tool" | "library" => 10_000,
        "subsystem" => 5_000,
        _ => 0,
    };
    kind_bonus
        + unit.file_count
        + unit.entrypoints.len() * 500
        + unit.scripts.len() * 100
        + unit.test_files.len() * 50
}
