//! A read-only TypeScript LSP worker. Neither the user's checkout nor its configuration
//! is used as a process working directory. Only admitted immutable source is exposed.
#[cfg(test)]
#[path = "semantic_tests.rs"]
mod tests;
use crate::{git::Result, session::Session};
use reqwest::Url;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc::{self, Receiver, SyncSender},
    time::{Duration, Instant},
};

const TIMEOUT: Duration = Duration::from_secs(30);
const MAX_FRAME: usize = 16 * 1024 * 1024;

pub struct SemanticServer {
    child: Child,
    outgoing: SyncSender<Value>,
    incoming: Receiver<Result<Value>>,
    next: u64,
    _root: tempfile::TempDir,
    paths: HashMap<PathBuf, String>,
    cache: HashMap<String, Value>,
    opened: HashSet<String>,
}

impl Drop for SemanticServer {
    fn drop(&mut self) {
        // Stop before the owned scratch snapshot is reclaimed.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub fn navigate(session: &Session, request: &Value) -> Result<Value> {
    let side = request["side"].as_str().unwrap_or("head");
    if !["head", "base"].contains(&side) {
        return Err("Invalid semantic source side".into());
    }
    let method = match request["query"].as_str() {
        Some("definition") => "textDocument/definition",
        Some("references") => "textDocument/references",
        _ => return Err("Only read-only semantic navigation is allowed".into()),
    };
    let path = request["path"].as_str().ok_or("Missing semantic source")?;
    let line = request["line"].as_u64().ok_or("Missing semantic line")? as usize;
    let column = request["column"].as_u64().ok_or("Missing UTF-16 column")? as usize;
    let doc = session.document(path, side)?;
    if line == 0
        || line > doc.offsets.len()
        || column > doc.lines(line, 1)[0].encode_utf16().count()
    {
        return Err("Semantic position is outside the pinned source".into());
    }
    let mut servers = session
        .semantics
        .lock()
        .map_err(|_| "Semantic worker unavailable")?;
    if !servers.contains_key(side) {
        let executable = request["server"]
            .as_str()
            .ok_or("Bundled TypeScript server is unavailable")?;
        let worker = SemanticServer::start(session, side, Path::new(executable))?;
        servers.insert(side.to_string(), worker);
    }
    let result = servers
        .get_mut(side)
        .unwrap()
        .navigate(path, line, column, method);
    if result.is_err() {
        servers.remove(side);
    }
    result
}

impl SemanticServer {
    fn start(session: &Session, side: &str, executable: &Path) -> Result<Self> {
        let executable = executable
            .canonicalize()
            .map_err(|e| format!("TypeScript server: {e}"))?;
        let root = tempfile::Builder::new()
            .prefix("codevetter-semantic-")
            .tempdir()
            .map_err(|e| e.to_string())?;
        let root_path = root.path().canonicalize().map_err(|e| e.to_string())?;
        let mut paths = HashMap::new();
        let mut bytes = 0;
        // Copy admitted source/configuration data only, never plugins or dependency trees.
        // The sandbox blocks external config references and all writes/network/child execution.
        for entry in &session.snapshot.files {
            if session.cancelled.load(std::sync::atomic::Ordering::Relaxed) {
                return Err("Session closed".into());
            }
            let source_path = if side == "base" {
                entry.old_path.as_deref().unwrap_or(&entry.path)
            } else {
                &entry.path
            };
            if !source_file(source_path) && !configuration_file(source_path) {
                continue;
            }
            let Ok(doc) = session.document(&entry.path, side) else {
                continue;
            };
            if doc.binary || doc.text.len() > 2 * 1024 * 1024 {
                continue;
            }
            bytes += doc.text.len();
            if bytes > 32 * 1024 * 1024 {
                return Err("Semantic source exceeds the 32 MiB snapshot bound".into());
            }
            let destination = root_path.join(source_path);
            std::fs::create_dir_all(destination.parent().unwrap()).map_err(|e| e.to_string())?;
            std::fs::write(&destination, &doc.text).map_err(|e| e.to_string())?;
            if source_file(source_path) {
                paths.insert(destination, entry.path.clone());
            }
        }
        let config = json!({"compilerOptions":{"allowJs":true,"checkJs":true,"noEmit":true,"target":"ESNext","module":"Preserve","moduleResolution":"Bundler","jsx":"preserve","skipLibCheck":true},"files":paths.keys().map(|p|p.strip_prefix(&root_path).unwrap().to_string_lossy().to_string()).collect::<Vec<_>>()});
        if !root_path.join("tsconfig.json").exists() && !root_path.join("jsconfig.json").exists() {
            std::fs::write(root_path.join("tsconfig.json"), config.to_string())
                .map_err(|e| e.to_string())?;
        }
        let mut command = sandboxed_command(&executable, &root_path)?;
        command
            .arg("--lsp")
            .arg("--stdio")
            .current_dir(&root_path)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(test)]
        command.stderr(Stdio::inherit());
        let mut child = command
            .spawn()
            .map_err(|e| format!("Start TypeScript worker: {e}"))?;
        let mut stdin = child.stdin.take().ok_or("Missing semantic input")?;
        let stdout = child.stdout.take().ok_or("Missing semantic output")?;
        let (outgoing, writes) = mpsc::sync_channel::<Value>(8);
        let (responses, incoming) = mpsc::sync_channel(16);
        std::thread::spawn(move || {
            for value in writes {
                let bytes = value.to_string();
                if write!(stdin, "Content-Length: {}\r\n\r\n{}", bytes.len(), bytes)
                    .and_then(|_| stdin.flush())
                    .is_err()
                {
                    break;
                }
            }
        });
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let value = read_frame(&mut reader);
                let failed = value.is_err();
                if responses.send(value).is_err() || failed {
                    break;
                }
            }
        });
        let mut server = Self {
            child,
            outgoing,
            incoming,
            next: 0,
            _root: root,
            paths,
            cache: HashMap::new(),
            opened: HashSet::new(),
        };
        let uri = Url::from_directory_path(&root_path)
            .map_err(|_| "Invalid snapshot URI")?
            .to_string();
        let initialized = server.call("initialize", json!({"processId":null,"rootUri":uri,"capabilities":{"general":{"positionEncodings":["utf-16"]}},"workspaceFolders":[{"uri":uri,"name":"Pinned source"}]}))?;
        if initialized["capabilities"]["positionEncoding"]
            .as_str()
            .is_some_and(|v| v != "utf-16")
        {
            return Err("Unsupported language server position encoding".into());
        }
        server.send(json!({"jsonrpc":"2.0","method":"initialized","params":{}}))?;
        Ok(server)
    }

    fn send(&self, value: Value) -> Result<()> {
        self.outgoing
            .try_send(value)
            .map_err(|_| "Semantic worker input unavailable".into())
    }

    fn call(&mut self, method: &str, params: Value) -> Result<Value> {
        self.next += 1;
        let id = self.next;
        self.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))?;
        let deadline = Instant::now() + TIMEOUT;
        loop {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or("Semantic request timed out")?;
            let value = self
                .incoming
                .recv_timeout(remaining)
                .map_err(|_| "Semantic worker timed out or exited")??;
            if value["id"] == id && value.get("method").is_none() {
                if value.get("error").is_some() {
                    return Err("Language server could not resolve this request".into());
                }
                return Ok(value["result"].clone());
            }
            // Explicitly refuse all server-initiated requests (including edits/commands).
            if value.get("method").is_some() && value.get("id").is_some() {
                self.send(json!({"jsonrpc":"2.0","id":value["id"],"error":{"code":-32601,"message":"Read-only client: request unsupported"}}))?;
            }
        }
    }

    fn navigate(&mut self, path: &str, line: usize, column: usize, method: &str) -> Result<Value> {
        let key = format!("{path}:{line}:{column}:{method}");
        if let Some(value) = self.cache.get(&key) {
            return Ok(value.clone());
        }
        let absolute = self
            .paths
            .iter()
            .find(|(_, p)| p.as_str() == path)
            .map(|(p, _)| p.clone())
            .ok_or("File is outside the admitted JS/TS snapshot")?;
        let uri = Url::from_file_path(&absolute)
            .map_err(|_| "Invalid source URI")?
            .to_string();
        let text = std::fs::read_to_string(&absolute).map_err(|e| e.to_string())?;
        if self.opened.insert(uri.clone()) {
            self.send(json!({"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{"uri":uri,"languageId":if path.ends_with(".js") || path.ends_with(".jsx") {"javascript"} else {"typescript"},"version":1,"text":text}}}))?;
        }
        let result = self.call(method, json!({"textDocument":{"uri":uri},"position":{"line":line-1,"character":column},"context":{"includeDeclaration":true}}))?;
        let entries = match result {
            Value::Array(v) => v,
            Value::Null => vec![],
            other => vec![other],
        };
        let truncated = entries.len() > 500;
        let mut locations = vec![];
        for entry in entries.iter().take(500) {
            let Some(uri) = entry["uri"].as_str().or(entry["targetUri"].as_str()) else {
                continue;
            };
            let Ok(absolute) = Url::parse(uri)
                .ok()
                .and_then(|u| u.to_file_path().ok())
                .ok_or(())
            else {
                continue;
            };
            let Some(path) = self.paths.get(&absolute) else {
                continue;
            };
            let range = entry
                .get("targetSelectionRange")
                .or(entry.get("range"))
                .unwrap_or(&Value::Null);
            let line = range["start"]["line"].as_u64().unwrap_or(0) as usize + 1;
            let text = std::fs::read_to_string(&absolute)
                .unwrap_or_default()
                .lines()
                .nth(line - 1)
                .unwrap_or("")
                .chars()
                .take(400)
                .collect::<String>();
            locations.push(json!({"path":path,"line":line,"text":text,"kind":"semantic","column":range["start"]["character"]}));
        }
        let value = json!({"locations":locations,"truncated":truncated,"qualification":"TypeScript 7.0.2 semantic resolution within the pinned JS/TS snapshot and its compiler configuration. External dependencies and paths outside the snapshot are unavailable."});
        if self.cache.len() >= 2048 {
            self.cache.clear();
        }
        self.cache.insert(key, value.clone());
        Ok(value)
    }
}

fn source_file(path: &str) -> bool {
    crate::git::source_allowed(path)
        && !path.split('/').any(|p| p == "node_modules" || p == ".git")
        && [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]
            .iter()
            .any(|ext| path.ends_with(ext))
}

fn configuration_file(path: &str) -> bool {
    crate::git::source_allowed(path)
        && !path.split('/').any(|p| p == "node_modules" || p == ".git")
        && Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| {
                n == "package.json"
                    || (n.starts_with("tsconfig") || n.starts_with("jsconfig"))
                        && n.ends_with(".json")
            })
}

fn sandboxed_command(executable: &Path, root: &Path) -> Result<Command> {
    #[cfg(target_os = "macos")]
    {
        let quote = |p: &Path| serde_json::to_string(&p.to_string_lossy()).unwrap();
        let profile = format!("(version 1)(deny default)(allow process-exec (literal {}))(allow process-info*)(allow sysctl-read)(allow mach-lookup)(allow file-read* (subpath {}) (subpath {}) (subpath \"/System/Library\") (subpath \"/usr/lib\") (literal \"/\") (literal \"/dev/urandom\") (literal \"/dev/null\"))", quote(executable), quote(root), quote(executable.parent().ok_or("Invalid server path")?));
        let mut command = Command::new("/usr/bin/sandbox-exec");
        command.args(["-p", &profile]).arg(executable);
        Ok(command)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (executable, root);
        Err("Semantic worker requires the macOS read-only sandbox".into())
    }
}

fn read_frame(reader: &mut impl BufRead) -> Result<Value> {
    let mut size = None;
    let mut header_bytes = 0;
    loop {
        let mut line = String::new();
        let count = (&mut *reader)
            .take(8193)
            .read_line(&mut line)
            .map_err(|e| e.to_string())?;
        header_bytes += count;
        if count == 0 || header_bytes > 8192 {
            return Err("Invalid LSP header or worker exit".into());
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some(value) = line.strip_prefix("Content-Length:") {
            size = value.trim().parse::<usize>().ok();
        }
    }
    let size = size
        .filter(|n| *n <= MAX_FRAME)
        .ok_or("Invalid LSP frame size")?;
    let mut body = vec![0; size];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    serde_json::from_slice(&body).map_err(|e| e.to_string())
}
