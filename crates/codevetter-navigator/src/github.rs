use crate::git::{self, Result};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GitHubTarget {
    pub owner: String,
    pub repo: String,
    pub kind: String,
    pub selector: String,
    pub line: usize,
}

pub fn parse(input: &str) -> Result<GitHubTarget> {
    let url = reqwest::Url::parse(input.trim())
        .map_err(|_| "Paste a complete https://github.com URL.")?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Use a public https://github.com URL without credentials.".into());
    }
    let path = decode(url.path())?;
    let parts: Vec<_> = path.trim_matches('/').split('/').collect();
    if parts.len() < 2 {
        return Err("The URL needs an owner and repository.".into());
    }
    let owner = parts[0];
    let repo = parts[1].strip_suffix(".git").unwrap_or(parts[1]);
    if [owner, repo].iter().any(|s| {
        s.is_empty()
            || s.starts_with('.')
            || !s
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
    }) {
        return Err("Invalid GitHub repository identity.".into());
    }
    let (kind, selector) = if parts.len() == 2 {
        ("repository", String::new())
    } else {
        let kind = match parts[2] {
            "pull" => "pull",
            "commit" => "commit",
            "tree" => "branch",
            "blob" => "file",
            _ => return Err("Use a repository, PR, commit, branch, or file URL.".into()),
        };
        if parts.len() < 4 {
            return Err("The URL is missing its revision.".into());
        }
        let selector = if matches!(kind, "pull" | "commit") {
            parts[3].to_owned()
        } else {
            parts[3..].join("/")
        };
        if !git::safe_path(&selector) || selector.starts_with('-') {
            return Err("Invalid URL revision or path.".into());
        }
        if kind == "pull"
            && (!selector.bytes().all(|b| b.is_ascii_digit())
                || selector.parse::<u64>().unwrap_or(0) == 0)
        {
            return Err("Invalid pull request number.".into());
        }
        if kind == "commit"
            && (selector.len() < 7 || !selector.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err("Invalid commit SHA.".into());
        }
        (kind, selector)
    };
    let line = url
        .fragment()
        .and_then(|s| s.strip_prefix('L'))
        .and_then(|s| s.split('-').next())
        .and_then(|s| s.parse().ok())
        .unwrap_or(1);
    Ok(GitHubTarget {
        owner: owner.into(),
        repo: repo.into(),
        kind: kind.into(),
        selector,
        line,
    })
}

fn decode(value: &str) -> Result<String> {
    let mut bytes = Vec::new();
    let raw = value.as_bytes();
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'%' {
            let hex = value.get(i + 1..i + 3).ok_or("Invalid URL encoding")?;
            bytes.push(u8::from_str_radix(hex, 16).map_err(|_| "Invalid URL encoding")?);
            i += 3;
        } else {
            bytes.push(raw[i]);
            i += 1;
        }
    }
    String::from_utf8(bytes).map_err(|_| "Invalid UTF-8 URL path".into())
}

pub struct Resolved {
    pub root: PathBuf,
    pub head: String,
    pub base: Option<String>,
    pub path: Option<String>,
    pub label: String,
    pub kind: String,
    pub line: usize,
}

fn api(path: &str) -> Result<serde_json::Value> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(format!("https://api.github.com/{path}"))
        .header("User-Agent", "CodeVetter-Navigator")
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "GitHub returned {}. Public access may be unavailable or rate limited.",
            response.status()
        ));
    }
    response.json().map_err(|e| e.to_string())
}

pub fn import(input: &str, cache: &Path) -> Result<Resolved> {
    let target = parse(input)?;
    let root = cache
        .join(&target.owner)
        .join(format!("{}.git", target.repo));
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    if !root.join("HEAD").exists() {
        git::git(&root, &["init", "--bare"])?;
    }
    let remote = format!("https://github.com/{}/{}.git", target.owner, target.repo);
    if git::text(&root, &["remote", "get-url", "origin"]).is_err() {
        git::git(&root, &["remote", "add", "origin", &remote])?;
    }
    if git::text(&root, &["remote", "get-url", "origin"])? != remote {
        return Err("Import cache has a different remote identity.".into());
    }
    let mut requested_path = None;
    let mut base = None;
    let revision = match target.kind.as_str() {
        "pull" => {
            let pr = api(&format!(
                "repos/{}/{}/pulls/{}",
                target.owner, target.repo, target.selector
            ))?;
            let head = pr["head"]["sha"]
                .as_str()
                .filter(|s| git::is_sha(s))
                .ok_or("GitHub omitted PR head identity")?
                .to_owned();
            let base_sha = pr["base"]["sha"]
                .as_str()
                .filter(|s| git::is_sha(s))
                .ok_or("GitHub omitted PR base identity")?
                .to_owned();
            fetch(&root, &remote, &head, 1)?;
            fetch(&root, &remote, &base_sha, 1)?;
            // GitHub's compare endpoint supplies the exact common ancestor without downloading history.
            let compare = api(&format!(
                "repos/{}/{}/compare/{}...{}",
                target.owner, target.repo, base_sha, head
            ))?;
            let ancestor = compare["merge_base_commit"]["sha"]
                .as_str()
                .filter(|s| git::is_sha(s))
                .ok_or("GitHub omitted PR merge base")?
                .to_owned();
            fetch(&root, &remote, &ancestor, 1)?;
            base = Some(ancestor);
            head
        }
        "repository" => {
            let refs = git::text(&root, &["ls-remote", "--symref", &remote, "HEAD"])?;
            refs.lines()
                .find_map(|l| {
                    l.split_once('\t')
                        .filter(|(s, r)| *r == "HEAD" && git::is_sha(s))
                        .map(|(s, _)| s.to_owned())
                })
                .ok_or("Repository has no default commit")?
        }
        "commit" => {
            let commit = api(&format!(
                "repos/{}/{}/commits/{}",
                target.owner, target.repo, target.selector
            ))?;
            if let Some(parent) = commit["parents"]
                .as_array()
                .and_then(|p| p.first())
                .and_then(|p| p["sha"].as_str())
                .filter(|s| git::is_sha(s))
            {
                base = Some(parent.to_owned());
            } else {
                base = Some("4b825dc642cb6eb9a060e54bf8d69288fbee4904".into());
            }
            commit["sha"]
                .as_str()
                .filter(|s| git::is_sha(s))
                .ok_or("GitHub omitted commit identity")?
                .to_owned()
        }
        _ => {
            // Longest ref prefix resolves branches containing slashes before treating the suffix as a file.
            let refs = git::text(&root, &["ls-remote", "--heads", "--tags", &remote])?;
            let mut matches: Vec<(usize, String, String)> = refs
                .lines()
                .filter_map(|line| {
                    let (sha, reference) = line.split_once('\t')?;
                    let name = reference
                        .strip_prefix("refs/heads/")
                        .or_else(|| reference.strip_prefix("refs/tags/"))?;
                    if name.ends_with("^{}") || !git::is_sha(sha) {
                        return None;
                    }
                    let peeled_ref = format!("refs/tags/{name}^{{}}");
                    let peeled = refs.lines().find_map(|l| {
                        l.split_once('\t')
                            .filter(|(_, r)| *r == peeled_ref)
                            .map(|(s, _)| s)
                    });
                    (target.selector == name || target.selector.starts_with(&format!("{name}/")))
                        .then(|| {
                            (
                                name.len(),
                                peeled.unwrap_or(sha).to_owned(),
                                name.to_owned(),
                            )
                        })
                })
                .collect();
            matches.sort_by_key(|m| std::cmp::Reverse(m.0));
            let (sha, name) = if let Some((_, sha, name)) = matches.first() {
                (sha.clone(), name.clone())
            } else {
                let first = target.selector.split('/').next().unwrap_or("");
                if first.len() < 7 || !first.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err("The branch or revision no longer exists.".into());
                }
                let commit = api(&format!(
                    "repos/{}/{}/commits/{first}",
                    target.owner, target.repo
                ))?;
                (
                    commit["sha"]
                        .as_str()
                        .filter(|s| git::is_sha(s))
                        .ok_or("GitHub omitted file revision identity")?
                        .to_owned(),
                    first.to_owned(),
                )
            };
            requested_path = target
                .selector
                .strip_prefix(&format!("{name}/"))
                .map(str::to_owned);
            if target.kind == "file" && requested_path.is_none() {
                return Err("The file URL has no file path.".into());
            }
            sha
        }
    };
    fetch(
        &root,
        &remote,
        &revision,
        if target.kind == "commit" { 2 } else { 1 },
    )?;
    if target.kind == "commit" {
        if let Some(parent) = base
            .as_ref()
            .filter(|s| s.as_str() != "4b825dc642cb6eb9a060e54bf8d69288fbee4904")
        {
            fetch(&root, &remote, parent, 1)?;
        }
    }
    let head = git::sha(&root, &revision)?;
    if git::is_sha(&revision) && head != revision.to_lowercase() {
        return Err("Fetched source does not match requested revision.".into());
    }
    Ok(Resolved {
        root,
        head,
        base,
        path: requested_path,
        label: format!("{}/{}", target.owner, target.repo),
        kind: target.kind,
        line: target.line.max(1),
    })
}

fn fetch(root: &Path, _remote: &str, revision: &str, depth: usize) -> Result<()> {
    // Resolve explicit immutable objects directly; FETCH_HEAD is shared mutable cache metadata.
    if git::is_sha(revision) && git::sha(root, revision).is_ok() {
        return Ok(());
    }
    git::git(
        root,
        &[
            "fetch",
            "--no-tags",
            "--filter=blob:none",
            &format!("--depth={depth}"),
            "origin",
            revision,
        ],
    )?;
    Ok(())
}
