//! Versioned, read-only, in-process navigation. Every session pins its Git identity.
mod diff;
mod git;
mod github;
mod semantic;
mod session;
mod understanding;

use git::Result;
use serde_json::{json, Value};
use session::Session;
use std::{
    collections::HashMap,
    ffi::{c_char, CStr, CString},
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
};

static SESSIONS: OnceLock<Mutex<HashMap<u64, Arc<Session>>>> = OnceLock::new();
static IMPORT: Mutex<()> = Mutex::new(());
static NEXT: AtomicU64 = AtomicU64::new(1);
fn sessions() -> &'static Mutex<HashMap<u64, Arc<Session>>> {
    SESSIONS.get_or_init(Default::default)
}

pub fn request(request: Value) -> Result<Value> {
    if request["version"] != 1 {
        return Err("Unsupported navigator protocol version".into());
    }
    let operation = request["operation"]
        .as_str()
        .ok_or("Missing navigator operation")?;
    if operation == "open" {
        let _guard = IMPORT.lock().map_err(|_| "Import is unavailable")?;
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        let input = request["input"]
            .as_str()
            .ok_or("Missing repository URL or path")?;
        let cache = request["cache"]
            .as_str()
            .ok_or("Missing import cache location")?;
        let session = Session::open(
            id,
            input,
            Path::new(cache),
            request["revision"].as_str(),
            request["base"].as_str(),
        )?;
        let result = serde_json::to_value(&session.snapshot).map_err(|e| e.to_string())?;
        sessions()
            .lock()
            .map_err(|_| "Navigator unavailable")?
            .insert(id, session);
        return Ok(result);
    }
    let id = request["session"]
        .as_u64()
        .ok_or("Missing navigator session")?;
    if operation == "close" {
        if let Some(session) = sessions()
            .lock()
            .map_err(|_| "Navigator unavailable")?
            .remove(&id)
        {
            session.cancelled.store(true, Ordering::Relaxed);
        }
        return Ok(json!({"closed": true}));
    }
    let session = sessions()
        .lock()
        .map_err(|_| "Navigator unavailable")?
        .get(&id)
        .cloned()
        .ok_or("Repository session has closed")?;
    let path = request["path"].as_str().unwrap_or("");
    let query = request["query"].as_str().unwrap_or("");
    match operation {
        "index" => {
            session.start_index();
            Ok(json!({"started": true}))
        }
        "file" => {
            let side = request["side"].as_str().unwrap_or("head");
            if !["head", "base"].contains(&side) {
                return Err("Invalid source side".into());
            }
            let doc = session.document(path, side)?;
            let start = request["start"].as_u64().unwrap_or(1).max(1) as usize;
            let count = request["count"].as_u64().unwrap_or(300) as usize;
            Ok(
                json!({"path": path, "side": side, "revision": if side == "base" { session.snapshot.base.as_ref().unwrap_or(&session.snapshot.head) } else { &session.snapshot.head },
                "blob": doc.blob, "total_lines": doc.offsets.len(), "start": start, "lines": doc.lines(start, count), "binary": doc.binary, "bytes": doc.text.len()}),
            )
        }
        "diff" => diff::diff(
            &session,
            path,
            request["context"].as_u64().unwrap_or(3) as usize,
        ),
        "fuzzy" => Ok(
            json!({"paths": understanding::fuzzy(session.snapshot.files.iter().map(|f| f.path.clone()), query)}),
        ),
        "search" => understanding::search(&session, query, false),
        "semantic" => semantic::navigate(&session, &request),
        "references" => understanding::search(&session, query, true),
        "symbols" | "definition" => {
            let index = session.index.read().map_err(|_| "Index unavailable")?;
            let locations: Vec<_> = index
                .symbols
                .iter()
                .filter(|s| {
                    (path.is_empty() || s.path == path) && (query.is_empty() || s.text == query)
                })
                .take(500)
                .collect();
            Ok(
                json!({"locations": locations, "qualification": "Syntax-backed JavaScript/TypeScript declarations; matching names may belong to different scopes."}),
            )
        }
        "status" => {
            let index = session.index.read().map_err(|_| "Index unavailable")?;
            Ok(
                json!({"indexed": index.files, "total": session.snapshot.files.len(), "skipped": index.skipped, "done": index.done, "bytes": index.bytes, "issue": index.issue}),
            )
        }
        "understand" => understanding::overview(&session),
        "materialize" => Ok(json!({"path": session.materialize()?})),
        "history" | "blame" => {
            if !git::source_allowed(path) || !session.snapshot.files.iter().any(|f| f.path == path)
            {
                return Err("Invalid history source".into());
            }
            let text = if operation == "history" {
                git::text(
                    session.root(),
                    &[
                        "log",
                        "-12",
                        "--format=%h %ad %s",
                        "--date=short",
                        &session.snapshot.head,
                        "--",
                        path,
                    ],
                )?
            } else {
                let line = request["line"].as_u64().unwrap_or(1).max(1);
                git::text(
                    session.root(),
                    &[
                        "blame",
                        "-L",
                        &format!("{line},+20"),
                        &session.snapshot.head,
                        "--",
                        path,
                    ],
                )?
            };
            Ok(
                json!({"text": text, "qualification": "Available local Git history; shallow imports may omit older history."}),
            )
        }
        _ => Err("Unknown navigator operation".into()),
    }
}

/// # Safety
/// `input` must be a valid NUL-terminated UTF-8 C string for this call's lifetime.
/// Free the returned owned C string exactly once using `codevetter_navigator_free`.
#[no_mangle]
pub unsafe extern "C" fn codevetter_navigator_request(input: *const c_char) -> *mut c_char {
    let result = std::panic::catch_unwind(|| {
        if input.is_null() {
            return Err("Missing navigator request".into());
        }
        let bytes = unsafe { CStr::from_ptr(input) }.to_bytes();
        if bytes.len() > 1024 * 1024 {
            return Err("Navigator request exceeds 1 MiB".into());
        }
        let value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        request(value)
    })
    .unwrap_or_else(|_| Err("Navigator operation failed safely".into()));
    let envelope = match result {
        Ok(value) => json!({"version":1,"ok":true,"value":value}),
        Err(error) => json!({"version":1,"ok":false,"error":error}),
    };
    CString::new(envelope.to_string())
        .map(CString::into_raw)
        .unwrap_or(std::ptr::null_mut())
}

/// # Safety
/// `output` must be null or an unfreed pointer returned by `codevetter_navigator_request`.
#[no_mangle]
pub unsafe extern "C" fn codevetter_navigator_free(output: *mut c_char) {
    if !output.is_null() {
        drop(unsafe { CString::from_raw(output) });
    }
}

#[cfg(test)]
mod tests;
