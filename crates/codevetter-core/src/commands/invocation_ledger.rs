//! Explicit, bounded recorder ingestion. Never discovers a personal ledger or
//! follows metadata receipt paths. Unix directory descriptors anchor all reads.
use super::invocation_events::{
    project_invocation_events, repository_identity, valid_pointer, InvocationEventsReceipt,
    InvocationFilter, InvocationSession, ReceiptIntegrity,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::File,
    io::Read,
    path::{Component, Path, PathBuf},
};

const MAX_SESSIONS: usize = 1_000;
const MAX_ASSESSMENTS: usize = 100;
const MAX_METADATA: usize = 16 * 1024;
const MAX_RECEIPT: usize = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct InvocationLedgerSource {
    pub path: PathBuf,
    pub synthetic_fixture: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InvocationLedgerReceipt {
    #[serde(flatten)]
    pub projection: InvocationEventsReceipt,
    pub evidence_origin: String,
    /// Fixed error codes only: no stderr, argument values, or file contents.
    pub ingestion_issues: Vec<IngestionIssue>,
    /// Failures whose repository cannot be identified, separate from scoped issues.
    pub unattributed_ingestion_issues: Vec<IngestionIssue>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IngestionIssue {
    pub invocation_id: Option<String>,
    pub code: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InvocationReceiptView {
    pub schema_version: String,
    pub invocation_id: String,
    pub repo_path: String,
    pub receipt_sha256: String,
    pub json_pointer: Option<String>,
    pub value: Value,
    pub evidence_origin: String,
    pub limitations: Vec<String>,
}

/// Explicit single-session content access, separate from the content-free index.
/// Reads only anchored fixed filenames, never the metadata's receipt path.
pub fn read_invocation_receipt(
    source: &InvocationLedgerSource,
    repo_path: &str,
    invocation_id: &str,
    pointer: Option<&str>,
) -> Result<InvocationReceiptView, String> {
    let identity = canonical_id(invocation_id).ok_or("invalid_invocation_identity")?;
    if pointer
        .is_some_and(|text| !text.starts_with('/') || text.len() > 512 || !valid_pointer(text))
    {
        return Err("invalid_receipt_pointer".into());
    }
    let filter = InvocationFilter {
        repo_path: Some(repo_path.into()),
        ..Default::default()
    };
    project_invocation_events(&[], &filter, 0, 1)?;
    let root = directory(&source.path)?;
    let session = child(&root, &identity, true).map_err(|_| "unsafe_session_directory")?;
    let mut budget = MAX_METADATA + MAX_RECEIPT + 1;
    let metadata = json_file(&session, "invocation.json", &mut budget)?;
    if metadata.get("invocation_id").and_then(Value::as_str) != Some(&identity)
        || repository_identity(&metadata) != Some(repo_path)
    {
        return Err("invocation_scope_or_identity_mismatch".into());
    }
    let raw = bytes(&session, "receipt.json", MAX_RECEIPT, &mut budget)?;
    let supplied = InvocationSession {
        invocation: metadata,
        assessments: vec![],
        receipt_bytes: Some(raw.clone()),
    };
    let projection = project_invocation_events(&[supplied], &filter, 0, 1)?;
    let event = projection
        .invocations
        .first()
        .filter(|event| event.receipt_integrity == ReceiptIntegrity::HashMatched)
        .ok_or("receipt_unavailable_changed_or_invalid")?;
    let receipt: Value = serde_json::from_slice(&raw).map_err(|_| "invalid_receipt_json")?;
    let value = match pointer {
        Some(pointer) => receipt
            .pointer(pointer)
            .cloned()
            .ok_or("receipt_pointer_not_found")?,
        None => receipt,
    };
    Ok(InvocationReceiptView {
        schema_version: "codevetter.invocation-receipt/v1".into(),
        invocation_id: identity,
        repo_path: repo_path.into(),
        receipt_sha256: event
            .receipt_sha256
            .clone()
            .ok_or("receipt_hash_not_recorded")?,
        json_pointer: pointer.map(str::to_owned),
        value,
        evidence_origin: if source.synthetic_fixture {
            "synthetic_fixture"
        } else {
            "unqualified_local_ledger"
        }
        .into(),
        limitations: vec![
            "Receipt integrity identifies captured bytes, not correctness or causal agent benefit. Only the selected session's fixed receipt.json was read; recorded paths were not followed.".into(),
        ],
    })
}

pub fn read_invocation_ledger(
    source: &InvocationLedgerSource,
    filter: &InvocationFilter,
    offset: usize,
    limit: usize,
) -> Result<InvocationLedgerReceipt, String> {
    // Reject invalid requests before any filesystem access.
    project_invocation_events(&[], filter, offset, limit)?;
    let root = directory(&source.path)?;
    let mut budget = MAX_TOTAL_BYTES;
    let mut sessions = Vec::new();
    let mut issues = Vec::new();
    let mut unattributed_issues = Vec::new();
    for name in names(&root, MAX_SESSIONS)? {
        let mut session_issues = Vec::new();
        let id = canonical_id(&name);
        let mut session = InvocationSession {
            invocation: Value::Null,
            assessments: vec![],
            receipt_bytes: None,
        };
        let loaded = id
            .as_ref()
            .ok_or("invalid_session_identity")
            .and_then(|id| {
                let dir = child(&root, id, true).map_err(|_| "unsafe_session_directory")?;
                session.invocation = json_file(&dir, "invocation.json", &mut budget)?;
                if filter
                    .repo_path
                    .as_deref()
                    .is_some_and(|repo| repository_identity(&session.invocation) != Some(repo))
                {
                    return Ok(());
                }
                if session
                    .invocation
                    .get("invocation_id")
                    .and_then(Value::as_str)
                    != Some(id)
                {
                    if let Some(metadata) = session.invocation.as_object_mut() {
                        metadata.insert("invocation_id".into(), Value::Null);
                    } else {
                        session.invocation = Value::Null;
                    }
                    return Err("session_identity_mismatch");
                }
                // Fixed filename, never the recorded receipt_path. Missing captures
                // are normal for failed launches; declared captures are unavailable.
                if !session
                    .invocation
                    .get("receipt_path")
                    .unwrap_or(&Value::Null)
                    .is_null()
                {
                    match bytes(&dir, "receipt.json", MAX_RECEIPT, &mut budget) {
                        Ok(raw) => session.receipt_bytes = Some(raw),
                        Err(code) => session_issues.push(issue(Some(id.clone()), code)),
                    }
                }
                match child(&dir, "assessments", true) {
                    Ok(assessments) => {
                        for name in names(&assessments, MAX_ASSESSMENTS)
                            .map_err(|_| "assessment_scan_limit_or_error")?
                        {
                            let value = canonical_id(name.strip_suffix(".json").unwrap_or(""))
                                .ok_or("invalid_assessment_identity")
                                .and_then(|assessment_id| {
                                    let value = json_file(&assessments, &name, &mut budget)?;
                                    if value.get("assessment_id").and_then(Value::as_str)
                                        != Some(&assessment_id)
                                    {
                                        return Err("assessment_identity_mismatch");
                                    }
                                    Ok(value)
                                });
                            match value {
                                Ok(value) => session.assessments.push(value),
                                Err(code) => {
                                    session.assessments.push(Value::Null);
                                    session_issues.push(issue(Some(id.clone()), code));
                                }
                            }
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(_) => {
                        session.assessments.push(Value::Null);
                        session_issues.push(issue(Some(id.clone()), "unsafe_assessment_directory"));
                    }
                }
                Ok(())
            });
        if let Err(code) = loaded {
            // Do not silently present a complete history after a bounded scan
            // failed. A malformed record alone remains a counted exclusion.
            if code == "assessment_scan_limit_or_error" {
                return Err(code.into());
            }
            session_issues.push(issue(id, code));
        }
        if budget == 0 {
            return Err("invocation_ledger_byte_budget_exceeded".into());
        }
        if let Some(repo) = filter.repo_path.as_deref() {
            match repository_identity(&session.invocation) {
                Some(identity) if identity != repo => continue,
                None => {
                    if session_issues.is_empty() {
                        session_issues.push(issue(None, "unknown_repository_identity"));
                    }
                    for issue in &mut session_issues {
                        issue.invocation_id = None;
                    }
                    unattributed_issues.append(&mut session_issues);
                }
                _ => {}
            }
        }
        issues.extend(session_issues);
        sessions.push(session);
    }
    let mut projection = project_invocation_events(&sessions, filter, offset, limit)?;
    projection.limitations.push("Explicit local ledger only; recorded receipt paths are informational. Concurrent recordings are a read snapshot, not a transaction. Hash-bound receipts and agent observations do not establish independent benefit.".into());
    Ok(InvocationLedgerReceipt {
        projection,
        evidence_origin: if source.synthetic_fixture {
            "synthetic_fixture"
        } else {
            "unqualified_local_ledger"
        }
        .into(),
        ingestion_issues: issues,
        unattributed_ingestion_issues: unattributed_issues,
    })
}

fn issue(invocation_id: Option<String>, code: &str) -> IngestionIssue {
    IngestionIssue {
        invocation_id,
        code: code.into(),
    }
}
fn canonical_id(text: &str) -> Option<String> {
    uuid::Uuid::parse_str(text)
        .ok()
        .filter(|id| id.to_string() == text)
        .map(|_| text.into())
}

fn json_file(dir: &File, name: &str, budget: &mut usize) -> Result<Value, &'static str> {
    serde_json::from_slice(&bytes(dir, name, MAX_METADATA, budget)?).map_err(|_| "malformed_json")
}

fn bytes(
    dir: &File,
    name: &str,
    maximum: usize,
    budget: &mut usize,
) -> Result<Vec<u8>, &'static str> {
    let file = child(dir, name, false).map_err(|_| "unavailable_or_unsafe_file")?;
    let metadata = file.metadata().map_err(|_| "unavailable_file_metadata")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err("hard_linked_file");
        }
    }
    if !metadata.is_file() {
        return Err("non_regular_file");
    }
    if metadata.len() > maximum as u64 {
        return Err("file_size_limit");
    }
    if metadata.len() >= *budget as u64 {
        *budget = 0;
        return Err("byte_budget_exceeded");
    }
    let mut raw = Vec::new();
    file.take((maximum + 1).min(*budget) as u64)
        .read_to_end(&mut raw)
        .map_err(|_| "file_read_failed")?;
    *budget = budget.saturating_sub(raw.len());
    if raw.len() > maximum {
        return Err("file_size_limit");
    }
    Ok(raw)
}

#[cfg(unix)]
fn directory(path: &Path) -> Result<File, String> {
    use std::os::unix::fs::OpenOptionsExt;
    if path
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("unsafe_ledger_path".into());
    }
    // Only the fixed filesystem root or current directory is opened by path.
    // Every caller-supplied component is opened relative to its live parent.
    let mut dir = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(if path.is_absolute() { "/" } else { "." })
        .map_err(|_| "unavailable_or_unsafe_ledger_directory".to_string())?;
    for part in path.components() {
        if let Component::Normal(name) = part {
            let name = name.to_str().ok_or("unsafe_ledger_path")?;
            dir = child(&dir, name, true)
                .map_err(|_| "unavailable_or_unsafe_ledger_directory".to_string())?;
        }
    }
    Ok(dir)
}

#[cfg(unix)]
fn child(dir: &File, name: &str, is_dir: bool) -> std::io::Result<File> {
    use std::os::fd::{AsRawFd, FromRawFd};
    let name = std::ffi::CString::new(name).map_err(|_| std::io::ErrorKind::InvalidInput)?;
    let flags = libc::O_RDONLY
        | libc::O_NOFOLLOW
        | libc::O_CLOEXEC
        | libc::O_NONBLOCK
        | if is_dir { libc::O_DIRECTORY } else { 0 };
    // Names are fixed filenames or validated UUIDs, and the parent descriptor
    // stays alive. No intermediate path components or symlinks are followed.
    let fd = unsafe { libc::openat(dir.as_raw_fd(), name.as_ptr(), flags) };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

#[cfg(unix)]
fn names(dir: &File, maximum: usize) -> Result<Vec<String>, String> {
    use std::os::fd::AsRawFd;
    // dup ownership transfers to fdopendir; closed on every exit by guard.
    let fd = unsafe { libc::dup(dir.as_raw_fd()) };
    if fd < 0 {
        return Err("ledger_directory_read_failed".into());
    }
    let stream = unsafe { libc::fdopendir(fd) };
    if stream.is_null() {
        unsafe {
            libc::close(fd);
        }
        return Err("ledger_directory_read_failed".into());
    }
    struct Guard(*mut libc::DIR);
    impl Drop for Guard {
        fn drop(&mut self) {
            unsafe {
                libc::closedir(self.0);
            }
        }
    }
    let guard = Guard(stream);
    let mut result = Vec::new();
    loop {
        // errno distinguishes EOF from readdir failure on supported Unix hosts.
        #[cfg(target_os = "macos")]
        unsafe {
            *libc::__error() = 0;
        }
        #[cfg(target_os = "linux")]
        unsafe {
            *libc::__errno_location() = 0;
        }
        let entry = unsafe { libc::readdir(guard.0) };
        if entry.is_null() {
            if std::io::Error::last_os_error().raw_os_error().unwrap_or(0) != 0 {
                return Err("ledger_directory_read_failed".into());
            }
            break;
        }
        let name = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) }
            .to_str()
            .map_err(|_| "invalid_ledger_entry_name")?;
        if name == "." || name == ".." {
            continue;
        }
        if result.len() == maximum {
            return Err("ledger_entry_limit_exceeded".into());
        }
        result.push(name.into());
    }
    result.sort();
    Ok(result)
}

#[cfg(not(unix))]
fn directory(_: &Path) -> Result<File, String> {
    Err("safe_ledger_ingestion_requires_unix".into())
}
#[cfg(not(unix))]
fn child(_: &File, _: &str, _: bool) -> std::io::Result<File> {
    Err(std::io::ErrorKind::Unsupported.into())
}
#[cfg(not(unix))]
fn names(_: &File, _: usize) -> Result<Vec<String>, String> {
    Err("safe_ledger_ingestion_requires_unix".into())
}

#[cfg(test)]
#[path = "invocation_ledger_tests.rs"]
mod tests;
