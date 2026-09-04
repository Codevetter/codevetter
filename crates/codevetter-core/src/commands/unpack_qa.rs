//! Synthetic QA readiness signals for Repo Unpacked inventories.

use crate::commands::unpack_types::{
    EntrypointHint, ManifestSummary, QaReadiness, QaReadinessSignal, QaSuggestedFlow,
};
use std::path::Path;

pub(crate) fn build_qa_readiness(
    files: &[(String, u64)],
    manifests: &[ManifestSummary],
    entrypoints: &[EntrypointHint],
) -> QaReadiness {
    let file_paths: Vec<&str> = files.iter().map(|(path, _)| path.as_str()).collect();

    let browser_config_sources: Vec<String> = file_paths
        .iter()
        .filter(|path| {
            let lower = path.to_ascii_lowercase();
            lower.ends_with("playwright.config.ts")
                || lower.ends_with("playwright.config.js")
                || lower.ends_with("playwright.config.mjs")
                || lower.ends_with("cypress.config.ts")
                || lower.ends_with("cypress.config.js")
                || lower.ends_with("cypress.config.mjs")
        })
        .take(8)
        .map(|path| (*path).to_string())
        .collect();

    let browser_spec_sources: Vec<String> = file_paths
        .iter()
        .filter(|path| {
            let lower = path.to_ascii_lowercase();
            let browserish_dir = lower.contains("/e2e/")
                || lower.contains("/playwright/")
                || lower.contains("/cypress/")
                || lower.starts_with("e2e/")
                || lower.starts_with("tests/e2e/")
                || lower.starts_with("cypress/");
            let browserish_name = lower.ends_with(".spec.ts")
                || lower.ends_with(".spec.tsx")
                || lower.ends_with(".spec.js")
                || lower.ends_with(".spec.jsx");
            browserish_dir && browserish_name
        })
        .take(12)
        .map(|path| (*path).to_string())
        .collect();

    let runnable_script_names = [
        "dev",
        "start",
        "preview",
        "serve",
        "tauri:dev",
        "desktop:dev",
    ];
    let qa_script_names = [
        "e2e",
        "test:e2e",
        "playwright",
        "test:playwright",
        "cypress",
        "test:cypress",
        "qa",
        "synthetic-qa",
        "test:synthetic-qa",
    ];

    let runnable_script_sources: Vec<String> = manifests
        .iter()
        .filter(|manifest| {
            manifest.kind == "package.json"
                && manifest
                    .scripts
                    .iter()
                    .any(|script| runnable_script_names.contains(&script.as_str()))
        })
        .map(|manifest| manifest.path.clone())
        .take(8)
        .collect();

    let qa_script_sources: Vec<String> = manifests
        .iter()
        .filter(|manifest| {
            manifest.kind == "package.json"
                && manifest.scripts.iter().any(|script| {
                    let lower = script.to_ascii_lowercase();
                    qa_script_names.contains(&lower.as_str())
                        || lower.contains("e2e")
                        || lower.contains("playwright")
                        || lower.contains("cypress")
                        || lower.contains("qa")
                })
        })
        .map(|manifest| manifest.path.clone())
        .take(8)
        .collect();

    let browser_dep_sources: Vec<String> = manifests
        .iter()
        .filter(|manifest| {
            manifest.dependencies.iter().any(|dep| {
                dep == "@playwright/test"
                    || dep == "playwright"
                    || dep == "cypress"
                    || dep == "puppeteer"
            })
        })
        .map(|manifest| manifest.path.clone())
        .take(8)
        .collect();

    let artifact_sources: Vec<String> = file_paths
        .iter()
        .filter(|path| {
            let lower = path.to_ascii_lowercase();
            lower.contains("playwright-report/")
                || lower.contains("test-results/")
                || lower.contains("cypress/screenshots/")
                || lower.contains("cypress/videos/")
                || lower.ends_with("trace.zip")
                || lower.ends_with("report.html")
        })
        .take(8)
        .map(|path| (*path).to_string())
        .collect();

    let route_sources: Vec<String> = entrypoints
        .iter()
        .filter(|entry| {
            entry.kind == "web"
                || entry.reason.to_ascii_lowercase().contains("react")
                || entry.reason.to_ascii_lowercase().contains("router")
        })
        .map(|entry| entry.path.clone())
        .take(10)
        .collect();

    let docs_sources: Vec<String> = file_paths
        .iter()
        .filter(|path| {
            let lower = path.to_ascii_lowercase();
            lower.contains("qa")
                || lower.contains("playwright")
                || lower.contains("cypress")
                || lower.contains("e2e")
        })
        .filter(|path| path.ends_with(".md") || path.ends_with(".mdx"))
        .take(8)
        .map(|path| (*path).to_string())
        .collect();

    let mut score = 0;
    if !browser_config_sources.is_empty() {
        score += 20;
    } else if !browser_dep_sources.is_empty() {
        score += 12;
    }
    if !browser_spec_sources.is_empty() {
        score += 25;
    }
    if !qa_script_sources.is_empty() {
        score += 20;
    }
    if !runnable_script_sources.is_empty() {
        score += 15;
    }
    if !artifact_sources.is_empty() {
        score += 10;
    } else if !browser_config_sources.is_empty() || !browser_dep_sources.is_empty() {
        score += 5;
    }
    if !route_sources.is_empty() {
        score += 5;
    }
    if !docs_sources.is_empty() {
        score += 5;
    }
    score = score.min(100);

    let status = if score >= 75 {
        "ready"
    } else if score >= 45 {
        "partial"
    } else {
        "missing"
    }
    .to_string();

    let signal = |id: &str,
                  label: &str,
                  ready: bool,
                  partial: bool,
                  detail: String,
                  sources: Vec<String>|
     -> QaReadinessSignal {
        QaReadinessSignal {
            id: id.to_string(),
            label: label.to_string(),
            status: if ready {
                "ready"
            } else if partial {
                "partial"
            } else {
                "missing"
            }
            .to_string(),
            detail,
            sources,
        }
    };

    let mut runner_sources = browser_config_sources.clone();
    for source in &browser_dep_sources {
        push_unique_limited(&mut runner_sources, source.clone(), 8);
    }

    let signals = vec![
        signal(
            "browser_runner",
            "Browser runner",
            !browser_config_sources.is_empty(),
            !browser_dep_sources.is_empty(),
            if !browser_config_sources.is_empty() {
                format!(
                    "{} browser runner config file{} found.",
                    browser_config_sources.len(),
                    if browser_config_sources.len() == 1 {
                        ""
                    } else {
                        "s"
                    }
                )
            } else if !browser_dep_sources.is_empty() {
                "Browser automation dependency is installed, but no runner config was found."
                    .to_string()
            } else {
                "No Playwright, Cypress, or browser runner config was found.".to_string()
            },
            runner_sources,
        ),
        signal(
            "user_flow_specs",
            "User-flow specs",
            !browser_spec_sources.is_empty(),
            false,
            if !browser_spec_sources.is_empty() {
                format!(
                    "{} browser-oriented spec file{} found.",
                    browser_spec_sources.len(),
                    if browser_spec_sources.len() == 1 {
                        ""
                    } else {
                        "s"
                    }
                )
            } else {
                "No e2e/playwright/cypress spec files were found.".to_string()
            },
            browser_spec_sources.clone(),
        ),
        signal(
            "local_app_command",
            "Local app command",
            !runnable_script_sources.is_empty(),
            false,
            if !runnable_script_sources.is_empty() {
                "Package scripts expose a local dev/start/preview command.".to_string()
            } else {
                "No obvious package script for starting the app locally was found.".to_string()
            },
            runnable_script_sources.clone(),
        ),
        signal(
            "qa_script",
            "QA script",
            !qa_script_sources.is_empty(),
            false,
            if !qa_script_sources.is_empty() {
                "Package scripts expose a QA/e2e/browser test command.".to_string()
            } else {
                "No explicit QA/e2e/browser test script was found.".to_string()
            },
            qa_script_sources.clone(),
        ),
        signal(
            "artifact_trail",
            "Artifact trail",
            !artifact_sources.is_empty(),
            !browser_config_sources.is_empty() || !browser_dep_sources.is_empty(),
            if !artifact_sources.is_empty() {
                "Existing browser test artifacts or reports were found.".to_string()
            } else if !browser_config_sources.is_empty() || !browser_dep_sources.is_empty() {
                "Runner is artifact-capable, but no existing screenshot/trace/report artifacts were found in the scanned files.".to_string()
            } else {
                "No browser QA artifacts or artifact-capable runner were found.".to_string()
            },
            artifact_sources.clone(),
        ),
        signal(
            "targetable_routes",
            "Targetable surfaces",
            !route_sources.is_empty(),
            false,
            if !route_sources.is_empty() {
                "Web entrypoints or pages give Synthetic QA candidate surfaces.".to_string()
            } else {
                "No obvious web entrypoint or route file was found.".to_string()
            },
            route_sources.clone(),
        ),
    ];

    let suggested_flows = suggested_qa_flows(&file_paths);
    let summary = match status.as_str() {
        "ready" => "Repo has enough browser-runner, script, and flow evidence to seed Synthetic QA workflows from Repo Unpacked.",
        "partial" => "Repo has some Synthetic QA building blocks, but CodeVetter should ask for the missing runner/script/spec pieces before claiming runtime coverage.",
        _ => "Repo does not expose enough local browser QA structure for a reliable Synthetic QA workflow yet.",
    }
    .to_string();

    QaReadiness {
        score,
        status,
        summary,
        signals,
        suggested_flows,
    }
}

pub(crate) fn suggested_qa_flows(paths: &[&str]) -> Vec<QaSuggestedFlow> {
    let mut flows = Vec::new();
    let mut push_flow = |id: String, route: String, goal: String, source: String| {
        if flows.len() >= 8 {
            return;
        }
        if flows
            .iter()
            .any(|flow: &QaSuggestedFlow| flow.route == route)
        {
            return;
        }
        flows.push(QaSuggestedFlow {
            id,
            route,
            goal,
            sources: vec![source],
        });
    };

    for path in paths {
        let lower = path.to_ascii_lowercase();
        if lower.ends_with("/app/page.tsx") || lower == "app/page.tsx" {
            push_flow(
                "app-root".to_string(),
                "/".to_string(),
                "Open the app home page and confirm the primary content renders.".to_string(),
                (*path).to_string(),
            );
            continue;
        }
        if lower.contains("/app/") && lower.ends_with("/page.tsx") {
            let route = path
                .split("/app/")
                .nth(1)
                .unwrap_or(path)
                .trim_end_matches("/page.tsx")
                .split('/')
                .filter(|part| !part.starts_with('(') && !part.starts_with('['))
                .collect::<Vec<_>>()
                .join("/");
            if !route.is_empty() {
                push_flow(
                    format!("next-{route}").replace('/', "-"),
                    format!("/{route}"),
                    format!("Open /{route} and verify the main user-visible flow."),
                    (*path).to_string(),
                );
            }
            continue;
        }
        if (lower.contains("/src/pages/") || lower.starts_with("src/pages/"))
            && (lower.ends_with(".tsx") || lower.ends_with(".jsx"))
        {
            let stem = Path::new(path)
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
                .unwrap_or_default();
            if stem.is_empty() {
                continue;
            }
            let route = if stem.eq_ignore_ascii_case("home") || stem.eq_ignore_ascii_case("index") {
                "/".to_string()
            } else {
                format!("/{}", camel_to_kebab(&stem))
            };
            push_flow(
                format!("page-{}", route.trim_start_matches('/')).replace('/', "-"),
                route.clone(),
                format!(
                    "Open {route} and verify the primary screen renders without console errors."
                ),
                (*path).to_string(),
            );
        }
    }

    flows
}

fn camel_to_kebab(value: &str) -> String {
    let mut out = String::new();
    for (idx, ch) in value.chars().enumerate() {
        if ch.is_ascii_uppercase() {
            if idx > 0 {
                out.push('-');
            }
            out.push(ch.to_ascii_lowercase());
        } else if ch == '_' || ch == ' ' {
            out.push('-');
        } else {
            out.push(ch.to_ascii_lowercase());
        }
    }
    out.trim_matches('-').to_string()
}

pub(crate) fn push_unique_limited(
    values: &mut Vec<String>,
    value: impl Into<String>,
    limit: usize,
) {
    if values.len() >= limit {
        return;
    }
    let value = value.into();
    if !value.trim().is_empty() && !values.contains(&value) {
        values.push(value);
    }
}
