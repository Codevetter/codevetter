use crate::{
    git::{self, Result},
    session::Session,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Serialize, Deserialize)]
pub struct DiffLine {
    pub old: Option<usize>,
    pub new: Option<usize>,
    pub kind: String,
    pub text: String,
}

pub fn diff(session: &Session, path: &str, context: usize) -> Result<Value> {
    if !git::source_allowed(path) {
        return Err("Protected or invalid source path".into());
    }
    let entry = session
        .snapshot
        .files
        .iter()
        .find(|f| f.path == path)
        .ok_or("Unknown snapshot file")?;
    if entry
        .old_path
        .as_deref()
        .is_some_and(|p| !git::source_allowed(p))
    {
        return Err("The historical source path is protected.".into());
    }
    if session.snapshot.kind == "local" && entry.status != "D" {
        let pinned = session.document(path, "head")?;
        let current = std::fs::read(session.root().join(path)).map_err(|e| e.to_string())?;
        use sha2::{Digest, Sha256};
        if format!("worktree-sha256:{:x}", Sha256::digest(&current)) != pinned.blob {
            return Err("This file changed after it was opened. Refresh the source snapshot before reviewing its diff.".into());
        }
    }
    let key = format!("{path}:{context}");
    if let Some(value) = session
        .diffs
        .lock()
        .map_err(|_| "Diff cache unavailable")?
        .get(&key)
    {
        return Ok(value.clone());
    }
    let raw = if session.snapshot.kind == "local" && entry.status == "A" {
        let doc = session.document(path, "head")?;
        let rows: Vec<_> = doc
            .lines(1, 1000)
            .into_iter()
            .enumerate()
            .map(|(i, text)| DiffLine {
                old: None,
                new: Some(i + 1),
                kind: "add".into(),
                text,
            })
            .collect();
        return Ok(
            json!({"rows": rows, "truncated": doc.offsets.len() > 1000, "binary": doc.binary}),
        );
    } else {
        let base = session
            .snapshot
            .base
            .as_ref()
            .unwrap_or(&session.snapshot.head);
        let context_arg = format!("--unified={}", context.min(10000));
        let mut args = vec![
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--find-renames",
            &context_arg,
            base.as_str(),
        ];
        if session.snapshot.kind != "local" {
            args.push(&session.snapshot.head);
        }
        args.extend(["--", path]);
        if let Some(old) = &entry.old_path {
            args.push(old);
        }
        git::text(session.root(), &args)?
    };
    if session.snapshot.kind == "local" && entry.status != "D" {
        let pinned = session.document(path, "head")?;
        let current = std::fs::read(session.root().join(path)).map_err(|e| e.to_string())?;
        use sha2::{Digest, Sha256};
        if format!("worktree-sha256:{:x}", Sha256::digest(&current)) != pinned.blob {
            return Err(
                "Source changed while its diff was being read. Refresh this snapshot.".into(),
            );
        }
    }
    let binary = raw.contains("Binary files ");
    let (rows, truncated) = parse(&raw);
    let result = json!({"rows": rows, "truncated": truncated, "binary": binary});
    session
        .diffs
        .lock()
        .map_err(|_| "Diff cache unavailable")?
        .insert(key, result.clone());
    Ok(result)
}

pub fn parse(raw: &str) -> (Vec<DiffLine>, bool) {
    let mut rows = Vec::new();
    let mut old = 0;
    let mut new = 0;
    let mut hunk = false;
    for text in raw.lines() {
        if rows.len() >= 50000 {
            return (rows, true);
        }
        if text.starts_with("@@ ") {
            let parts: Vec<_> = text.split_whitespace().collect();
            old = parts
                .get(1)
                .and_then(|s| s.trim_start_matches('-').split(',').next())
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            new = parts
                .get(2)
                .and_then(|s| s.trim_start_matches('+').split(',').next())
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            rows.push(DiffLine {
                old: None,
                new: None,
                kind: "hunk".into(),
                text: text.into(),
            });
            hunk = true;
        } else if hunk {
            let (a, b, kind) = match text.as_bytes().first() {
                Some(b'+') => {
                    let b = new;
                    new += 1;
                    (None, Some(b), "add")
                }
                Some(b'-') => {
                    let a = old;
                    old += 1;
                    (Some(a), None, "delete")
                }
                Some(b' ') => {
                    let a = old;
                    let b = new;
                    old += 1;
                    new += 1;
                    (Some(a), Some(b), "context")
                }
                _ => continue,
            };
            rows.push(DiffLine {
                old: a,
                new: b,
                kind: kind.into(),
                text: text[1..].chars().take(8000).collect(),
            });
        }
    }
    (rows, false)
}
