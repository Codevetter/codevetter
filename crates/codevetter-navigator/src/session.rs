use crate::{
    git::{self, Result},
    github,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, RwLock,
    },
};

#[derive(Clone, Serialize)]
pub struct Entry {
    pub path: String,
    pub blob: String,
    pub size: usize,
    pub mode: String,
    pub status: String,
    pub old_path: Option<String>,
}
#[derive(Clone, Serialize)]
pub struct Location {
    pub path: String,
    pub line: usize,
    pub text: String,
    pub kind: String,
}
#[derive(Clone, Serialize)]
pub struct Snapshot {
    pub id: u64,
    pub root: String,
    pub label: String,
    pub head: String,
    pub base: Option<String>,
    pub kind: String,
    pub initial_path: Option<String>,
    pub initial_line: usize,
    pub files: Vec<Entry>,
}

pub struct Document {
    pub blob: String,
    pub text: String,
    pub offsets: Vec<usize>,
    pub binary: bool,
}
impl Document {
    pub fn new(blob: String, bytes: Vec<u8>) -> Self {
        let binary = bytes.contains(&0) || std::str::from_utf8(&bytes).is_err();
        let text = if binary {
            String::new()
        } else {
            String::from_utf8(bytes).unwrap_or_default()
        };
        let mut offsets = vec![0];
        for (i, b) in text.bytes().enumerate() {
            if b == b'\n' && i + 1 < text.len() {
                offsets.push(i + 1);
            }
        }
        Self {
            blob,
            text,
            offsets,
            binary,
        }
    }
    pub fn lines(&self, start: usize, count: usize) -> Vec<String> {
        let first = start.saturating_sub(1).min(self.offsets.len());
        (first..(first + count.min(1000)).min(self.offsets.len()))
            .map(|i| {
                let end = self.offsets.get(i + 1).copied().unwrap_or(self.text.len());
                // A pathological single line must not flood the native boundary.
                self.text[self.offsets[i]..end]
                    .trim_end_matches(['\r', '\n'])
                    .chars()
                    .take(8000)
                    .collect()
            })
            .collect()
    }
}

#[derive(Default)]
pub struct Index {
    pub files: usize,
    pub bytes: usize,
    pub skipped: usize,
    pub done: bool,
    pub documents: Vec<(String, Arc<Document>)>,
    pub symbols: Vec<Location>,
    pub issue: Option<String>,
}
pub struct Session {
    pub snapshot: Snapshot,
    root: PathBuf,
    cache_root: PathBuf,
    remote: bool,
    pub cancelled: AtomicBool,
    index_started: AtomicBool,
    documents: Mutex<HashMap<String, Arc<Document>>>,
    pub index: RwLock<Index>,
    pub diffs: Mutex<HashMap<String, serde_json::Value>>,
}

impl Session {
    pub fn open(
        id: u64,
        input: &str,
        cache: &Path,
        revision: Option<&str>,
        base: Option<&str>,
    ) -> Result<Arc<Self>> {
        let remote = input.trim().starts_with("https:");
        let resolved = if remote {
            github::import(input, cache)?
        } else {
            let root = PathBuf::from(input)
                .canonicalize()
                .map_err(|e| format!("Open repository: {e}"))?;
            git::git(&root, &["rev-parse", "--git-dir"])?;
            let head = git::sha(&root, revision.unwrap_or("HEAD"))?;
            let base = base.map(|b| git::sha(&root, b)).transpose()?;
            github::Resolved {
                label: root
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                root,
                head,
                base,
                path: None,
                kind: if revision.is_none() {
                    "local".into()
                } else {
                    "commit".into()
                },
                line: 1,
            }
        };
        let mut files = tree(&resolved.root, &resolved.head)?;
        if let Some(base) = &resolved.base {
            apply_changes(&resolved.root, base, &resolved.head, &mut files)?;
        }
        if resolved.kind == "local" {
            local_changes(&resolved.root, &mut files)?;
        }
        let initial_path = resolved
            .path
            .clone()
            .or_else(|| {
                files
                    .iter()
                    .find(|f| !f.status.is_empty() && f.status != "D")
                    .map(|f| f.path.clone())
            })
            .or_else(|| {
                files
                    .iter()
                    .find(|f| f.path.eq_ignore_ascii_case("README.md"))
                    .map(|f| f.path.clone())
            })
            .or_else(|| {
                files
                    .iter()
                    .find(|f| git::source_allowed(&f.path) && f.mode != "120000")
                    .map(|f| f.path.clone())
            });
        if resolved.kind == "file" && !files.iter().any(|f| Some(&f.path) == initial_path.as_ref())
        {
            return Err("The requested file does not exist at that revision.".into());
        }
        let snapshot = Snapshot {
            id,
            root: resolved.root.to_string_lossy().into_owned(),
            label: resolved.label,
            head: resolved.head,
            base: resolved.base,
            kind: resolved.kind,
            initial_path,
            initial_line: resolved.line,
            files,
        };
        Ok(Arc::new(Self {
            snapshot,
            root: resolved.root,
            cache_root: cache.to_path_buf(),
            remote,
            cancelled: AtomicBool::new(false),
            index_started: AtomicBool::new(false),
            documents: Mutex::new(HashMap::new()),
            index: RwLock::new(Index::default()),
            diffs: Mutex::new(HashMap::new()),
        }))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn document(&self, path: &str, side: &str) -> Result<Arc<Document>> {
        if !git::source_allowed(path) {
            return Err("Protected credentials, environment files, and escaping paths are excluded from navigation.".into());
        }
        let entry = self
            .snapshot
            .files
            .iter()
            .find(|f| f.path == path)
            .ok_or("File is not in this snapshot")?;
        if entry.mode == "160000" {
            return Err("Submodule: open its repository explicitly to browse its source.".into());
        }
        if entry.mode == "120000" {
            return Err("Symbolic links are not followed by the read-only browser.".into());
        }
        let revision = if side == "base" {
            self.snapshot.base.as_ref().unwrap_or(&self.snapshot.head)
        } else {
            &self.snapshot.head
        };
        let source_path = if side == "base" {
            entry.old_path.as_deref().unwrap_or(path)
        } else {
            path
        };
        if !git::source_allowed(source_path) {
            return Err("The historical source path is protected.".into());
        }
        let local = self.snapshot.kind == "local" && side == "head";
        let key = format!("{side}:{path}");
        if let Some(doc) = self
            .documents
            .lock()
            .map_err(|_| "Source cache unavailable")?
            .get(&key)
            .cloned()
        {
            return Ok(doc);
        }
        let (blob, bytes) = if local {
            let candidate = self.root.join(path);
            let resolved = candidate.canonicalize().map_err(|e| e.to_string())?;
            if !resolved.starts_with(&self.root)
                || std::fs::symlink_metadata(&candidate)
                    .map_err(|e| e.to_string())?
                    .file_type()
                    .is_symlink()
            {
                return Err("Source escapes the repository or is a symlink.".into());
            }
            let size = std::fs::metadata(&resolved)
                .map_err(|e| e.to_string())?
                .len();
            if size > 64 * 1024 * 1024 {
                return Err("File exceeds the 64 MiB source bound.".into());
            }
            let bytes = std::fs::read(resolved).map_err(|e| e.to_string())?;
            // Local bytes are pinned on first read; hash the exact bytes read, never a second file read.
            let blob = format!("worktree-sha256:{:x}", Sha256::digest(&bytes));
            (blob, Some(bytes))
        } else {
            let blob = if side != "base" {
                entry.blob.clone()
            } else {
                git::text(
                    &self.root,
                    &[
                        "rev-parse",
                        "--verify",
                        &format!("{revision}:{source_path}"),
                    ],
                )?
            };
            if !git::is_sha(&blob) {
                return Err("Invalid source blob identity".into());
            }
            (blob, None)
        };
        let bytes = match bytes {
            Some(bytes) => bytes,
            None => {
                let size = git::text(&self.root, &["cat-file", "-s", &blob])?
                    .parse::<u64>()
                    .map_err(|_| "Invalid blob size")?;
                if size > 64 * 1024 * 1024 {
                    return Err("File exceeds the 64 MiB source bound.".into());
                }
                git::git(&self.root, &["cat-file", "blob", &blob])?
            }
        };
        let doc = Arc::new(Document::new(blob.clone(), bytes));
        let mut cache = self
            .documents
            .lock()
            .map_err(|_| "Source cache unavailable")?;
        if cache.values().map(|d| d.text.len()).sum::<usize>() + doc.text.len() > 96 * 1024 * 1024 {
            cache.clear();
        }
        cache.insert(key, doc.clone());
        Ok(doc)
    }

    pub fn start_index(self: &Arc<Self>) {
        if self.index_started.swap(true, Ordering::Relaxed) {
            return;
        }
        let session = self.clone();
        std::thread::spawn(move || {
            if session.remote && !session.cancelled.load(Ordering::Relaxed) {
                // Hydrate small blobs in one background pack instead of one network round trip per file.
                // The requested document is already visible. Failure falls back to Git's lazy blob reads.
                let _ = git::git(
                    &session.root,
                    &[
                        "fetch",
                        "--refetch",
                        "--filter=blob:limit=2097152",
                        "--no-tags",
                        "--no-write-fetch-head",
                        "origin",
                        &session.snapshot.head,
                    ],
                );
            }
            let mut entries: Vec<_> = session.snapshot.files.iter().collect();
            entries.sort_by_key(|f| priority(f, session.snapshot.initial_path.as_deref()));
            for entry in entries {
                if session.cancelled.load(Ordering::Relaxed) {
                    break;
                }
                if !git::source_allowed(&entry.path)
                    || entry.status == "D"
                    || entry.size > 2 * 1024 * 1024
                    || entry.mode != "100644" && entry.mode != "100755"
                {
                    if let Ok(mut index) = session.index.write() {
                        index.skipped += 1;
                    }
                    continue;
                }
                // Never hold index/cache locks over disk, network or parsing.
                match session.document(&entry.path, "head") {
                    Ok(doc) if !doc.binary && doc.text.len() <= 2 * 1024 * 1024 => {
                        let symbols = crate::understanding::symbols(&entry.path, &doc);
                        if let Ok(mut index) = session.index.write() {
                            if index.bytes + doc.text.len() > 32 * 1024 * 1024 {
                                index.skipped += 1;
                                continue;
                            }
                            index.files += 1;
                            index.bytes += doc.text.len();
                            index.symbols.extend(symbols);
                            index.documents.push((entry.path.clone(), doc));
                        }
                    }
                    Ok(_) => {
                        if let Ok(mut index) = session.index.write() {
                            index.skipped += 1;
                        }
                    }
                    Err(error) => {
                        if let Ok(mut index) = session.index.write() {
                            index.skipped += 1;
                            index.issue = Some(error);
                        }
                    }
                }
            }
            if let Ok(mut index) = session.index.write() {
                index.done = true;
            }
        });
    }

    pub fn materialize(&self) -> Result<String> {
        if self.snapshot.kind == "local" {
            return Ok(self.snapshot.root.clone());
        }
        let index = self.index.read().map_err(|_| "Source index unavailable")?;
        if !index.done {
            return Err("The source index is still preparing this snapshot.".into());
        }
        let parent = self.cache_root.join("snapshots");
        std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let destination = parent.join(format!(
            "{}-{}-{nonce}",
            &self.snapshot.head[..12],
            self.snapshot.id
        ));
        if !destination.exists() {
            git::git(
                &self.root,
                &[
                    "worktree",
                    "add",
                    "--detach",
                    "--no-checkout",
                    destination.to_str().ok_or("Invalid snapshot path")?,
                    &self.snapshot.head,
                ],
            )?;
        }
        for (path, doc) in &index.documents {
            if self.cancelled.load(Ordering::Relaxed) {
                return Err("Snapshot closed".into());
            }
            let output = destination.join(path);
            if let Some(parent) = output.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&output, &doc.text).map_err(|e| e.to_string())?;
        }
        // Populate only the new cache worktree's Git index; no user checkout is changed.
        git::git(&destination, &["read-tree", &self.snapshot.head])?;
        Ok(destination.to_string_lossy().into_owned())
    }
}

pub fn priority(entry: &Entry, requested: Option<&str>) -> u8 {
    if requested == Some(entry.path.as_str()) {
        0
    } else if !entry.status.is_empty() {
        1
    } else if ["main.", "index.", "app.", "package.json", "Cargo.toml"]
        .iter()
        .any(|n| entry.path.rsplit('/').next().unwrap_or("").starts_with(n))
    {
        3
    } else if crate::understanding::important(&entry.path).is_some() {
        5
    } else {
        6
    }
}

fn tree(root: &Path, revision: &str) -> Result<Vec<Entry>> {
    // Do not request blob sizes here: `ls-tree -l` hydrates every missing blob in a partial clone.
    let bytes = git::git(root, &["ls-tree", "-r", "-z", revision])?;
    let mut files = Vec::new();
    for record in bytes.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        let text = std::str::from_utf8(record).map_err(|_| "Repository has non-UTF-8 paths")?;
        let (meta, path) = text.split_once('\t').ok_or("Invalid Git tree entry")?;
        let fields: Vec<_> = meta.split_whitespace().collect();
        if fields.len() != 3 || !git::safe_path(path) {
            continue;
        }
        files.push(Entry {
            path: path.into(),
            mode: fields[0].into(),
            blob: fields[2].into(),
            size: 0,
            status: String::new(),
            old_path: None,
        });
    }
    Ok(files)
}

fn apply_changes(root: &Path, base: &str, head: &str, files: &mut Vec<Entry>) -> Result<()> {
    let bytes = git::git(
        root,
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--name-status",
            "-z",
            "--find-renames",
            base,
            head,
            "--",
        ],
    )?;
    let parts: Vec<_> = bytes.split(|b| *b == 0).filter(|p| !p.is_empty()).collect();
    let mut i = 0;
    while i + 1 < parts.len() {
        let status = String::from_utf8_lossy(parts[i]);
        let path = String::from_utf8_lossy(parts[i + 1]);
        i += 2;
        let (path, old) = if status.starts_with('R') || status.starts_with('C') {
            let new = parts.get(i).ok_or("Invalid rename diff")?;
            i += 1;
            (
                String::from_utf8_lossy(new).into_owned(),
                Some(path.into_owned()),
            )
        } else {
            (path.into_owned(), None)
        };
        if let Some(file) = files.iter_mut().find(|f| f.path == path) {
            file.status = status[..1].to_owned();
            file.old_path = old;
        } else if status == "D" {
            if let Some(mut entry) = tree(root, base)?.into_iter().find(|f| f.path == path) {
                entry.status = "D".into();
                files.push(entry);
            }
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(())
}

fn local_changes(root: &Path, files: &mut Vec<Entry>) -> Result<()> {
    let bytes = git::git(
        root,
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--name-only",
            "-z",
            "HEAD",
            "--",
        ],
    )?;
    for path in bytes
        .split(|b| *b == 0)
        .filter_map(|p| std::str::from_utf8(p).ok())
    {
        if let Some(file) = files.iter_mut().find(|f| f.path == path) {
            file.status = if root.join(path).exists() {
                "M".into()
            } else {
                "D".into()
            };
        }
    }
    let untracked = git::git(root, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    for path in untracked
        .split(|b| *b == 0)
        .filter_map(|p| std::str::from_utf8(p).ok())
        .filter(|p| git::source_allowed(p))
    {
        files.push(Entry {
            path: path.into(),
            blob: String::new(),
            size: 0,
            mode: "100644".into(),
            status: "A".into(),
            old_path: None,
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(())
}
