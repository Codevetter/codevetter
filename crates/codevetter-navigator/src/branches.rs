//! Read-only branch discovery and merge-base resolution for the review picker.
use crate::git::{self, Result};
use serde_json::{json, Value};
use std::path::Path;

pub fn list(root: &Path) -> Result<Value> {
    let raw = git::text(
        root,
        &[
            "for-each-ref",
            "--count=2001",
            "--sort=refname",
            "--format=%(refname)%09%(objectname)%09%(symref)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    let mut branches = Vec::new();
    for line in raw.lines().take(2000) {
        let fields: Vec<_> = line.split('\t').collect();
        if fields.len() < 2 || fields.get(2).is_some_and(|s| !s.is_empty()) {
            continue;
        }
        let reference = fields[0];
        let name = reference
            .strip_prefix("refs/heads/")
            .or_else(|| reference.strip_prefix("refs/remotes/"))
            .unwrap_or(reference);
        branches.push(json!({"reference": reference, "name": name, "sha": fields[1]}));
    }
    let current = git::text(root, &["symbolic-ref", "--quiet", "HEAD"]).ok();
    let remote_default = git::text(
        root,
        &["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    )
    .ok();
    let default_base = remote_default
        .into_iter()
        .chain([
            "refs/heads/main".to_string(),
            "refs/heads/master".to_string(),
        ])
        .find(|name| {
            branches
                .iter()
                .any(|branch| branch["reference"].as_str() == Some(name))
        });
    Ok(
        json!({"branches": branches, "current": current, "default_base": default_base,
        "truncated": raw.lines().count() > 2000}),
    )
}

pub fn comparison(root: &Path, base: &str, head: &str) -> Result<(String, String)> {
    let head = git::sha(root, head)?;
    let base = git::sha(root, base)?;
    let ancestor = git::text(root, &["merge-base", "--all", &base, &head])
        .map_err(|_| "These revisions have no available common ancestor. Fetch missing history outside CodeVetter or choose another base.".to_string())?;
    if !git::is_sha(&ancestor) {
        return Err("Could not resolve a unique comparison base.".into());
    }
    Ok((ancestor, head))
}
