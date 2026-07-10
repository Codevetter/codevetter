//! Stream external CLI agent stdout/stderr to the Tauri webview while processes run.

use serde_json::json;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter};

use super::review::{agent_cli_label, resolve_agent_cli_path, unwrap_agent_envelope};
use super::unpack_agent_activity::{
    agent_uses_stream_json, emit_unpack_agent_activity, finalize_assembled_output,
    ingest_agent_stream_line,
};

const STREAM_CHUNK_BYTES: usize = 2048;

#[derive(Clone)]
pub struct CliStreamContext {
    pub app: AppHandle,
    pub stream_id: String,
    pub repo_path: String,
    pub agent: String,
}

struct CliSession {
    cancel: Arc<AtomicBool>,
    pid: u32,
}

fn sessions() -> &'static Mutex<HashMap<String, CliSession>> {
    static STORE: OnceLock<Mutex<HashMap<String, CliSession>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn register_cli_stream_session(stream_id: &str, cancel: Arc<AtomicBool>, pid: u32) {
    if let Ok(mut map) = sessions().lock() {
        map.insert(stream_id.to_string(), CliSession { cancel, pid });
    }
}

pub fn unregister_cli_stream_session(stream_id: &str) {
    if let Ok(mut map) = sessions().lock() {
        map.remove(stream_id);
    }
}

/// Cancel a running unpack CLI synthesis by report id.
pub fn cancel_cli_stream(stream_id: &str) -> bool {
    let session = sessions()
        .lock()
        .ok()
        .and_then(|mut map| map.remove(stream_id));
    let Some(session) = session else {
        return false;
    };
    session.cancel.store(true, Ordering::SeqCst);
    kill_pid(session.pid);
    true
}

#[cfg(unix)]
fn kill_pid(pid: u32) {
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
    }
}

#[cfg(not(unix))]
fn kill_pid(_pid: u32) {}

pub fn emit_stream_chunk(
    app: &AppHandle,
    stream_id: &str,
    repo_path: &str,
    stream: &str,
    chunk: &str,
    done: bool,
) {
    let _ = app.emit(
        "unpack-agent-stream",
        json!({
            "stream_id": stream_id,
            "repo_path": repo_path,
            "stream": stream,
            "chunk": chunk,
            "done": done,
        }),
    );
}

fn spawn_agent_child(
    agent: &str,
    cli_path: &str,
    repo_path: &str,
    prompt: &str,
    model: Option<&str>,
) -> Result<Child, String> {
    let cli_label = agent_cli_label(agent);
    let model_arg = model.map(str::trim).filter(|m| !m.is_empty());

    let mut child = match agent {
        "codex" => {
            let mut cmd = StdCommand::new(cli_path);
            cmd.args(["exec", "--json"]);
            if let Some(m) = model_arg {
                cmd.args(["-m", m]);
            }
            cmd.current_dir(repo_path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to spawn {cli_label} (resolved to {cli_path}): {e}"))?
        }
        "grok" => {
            let mut cmd = StdCommand::new(cli_path);
            cmd.args([
                "-p",
                prompt,
                "--output-format",
                "streaming-json",
                "--always-approve",
            ]);
            if let Some(m) = model_arg {
                cmd.args(["--model", m]);
            }
            cmd.current_dir(repo_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to spawn {cli_label} (resolved to {cli_path}): {e}"))?
        }
        "cursor" => {
            let mut cmd = StdCommand::new(cli_path);
            cmd.args(["-p", "--output-format", "json"]);
            if let Some(m) = model_arg {
                cmd.args(["--model", m]);
            }
            cmd.arg(prompt)
                .current_dir(repo_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to spawn {cli_label} (resolved to {cli_path}): {e}"))?
        }
        "command-code" => {
            let mut cmd = StdCommand::new(cli_path);
            cmd.args([
                "-p",
                prompt,
                "--trust",
                "--skip-onboarding",
                "--output-format",
                "stream-json",
                "--verbose",
            ]);
            if let Some(m) = model_arg {
                cmd.args(["-m", m]);
            }
            cmd.current_dir(repo_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to spawn {cli_label} (resolved to {cli_path}): {e}"))?
        }
        _ => {
            let mut cmd = StdCommand::new(cli_path);
            if let Some(m) = model_arg {
                cmd.args(["--model", m]);
            }
            cmd.args(["-p", "--output-format", "stream-json", "--verbose", prompt])
                .current_dir(repo_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to spawn {cli_label} (resolved to {cli_path}): {e}"))?
        }
    };

    if agent == "codex" {
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(prompt.as_bytes())
                .map_err(|e| format!("Failed to write prompt to {cli_label}: {e}"))?;
        }
    }

    Ok(child)
}

fn pump_reader<R: Read + Send + 'static>(
    mut reader: R,
    ctx: CliStreamContext,
    label: &'static str,
    cancel: Arc<AtomicBool>,
) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut acc = String::new();
        let mut buf = [0u8; STREAM_CHUNK_BYTES];
        loop {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    acc.push_str(&chunk);
                    emit_stream_chunk(
                        &ctx.app,
                        &ctx.stream_id,
                        &ctx.repo_path,
                        label,
                        &chunk,
                        false,
                    );
                }
                Err(_) => break,
            }
        }
        acc
    })
}

fn pump_reader_json_lines<R: Read + Send + 'static>(
    reader: R,
    ctx: CliStreamContext,
    agent: String,
    cancel: Arc<AtomicBool>,
) -> thread::JoinHandle<(String, String)> {
    thread::spawn(move || {
        let mut raw = String::new();
        let mut assembled = String::new();
        let reader = BufReader::new(reader);

        for line in reader.lines() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let Ok(line) = line else {
                break;
            };
            if line.trim().is_empty() {
                continue;
            }
            raw.push_str(&line);
            raw.push('\n');
            emit_stream_chunk(
                &ctx.app,
                &ctx.stream_id,
                &ctx.repo_path,
                "stdout",
                &format!("{line}\n"),
                false,
            );
            for activity in ingest_agent_stream_line(&agent, &line, &mut assembled) {
                emit_unpack_agent_activity(&ctx.app, &ctx.stream_id, &ctx.repo_path, &activity);
            }
        }

        (raw, assembled)
    })
}

/// Run a CLI agent, streaming stdout/stderr to the webview, returning final decoded text.
pub fn run_cli_prompt_streaming(
    ctx: &CliStreamContext,
    repo_path: &str,
    prompt: &str,
    model: Option<&str>,
) -> Result<String, String> {
    let cli_label = agent_cli_label(&ctx.agent);
    let cli_path = resolve_agent_cli_path(&ctx.agent);
    let cancel = Arc::new(AtomicBool::new(false));

    let mut child = spawn_agent_child(&ctx.agent, &cli_path, repo_path, prompt, model)?;
    let pid = child.id();
    register_cli_stream_session(&ctx.stream_id, cancel.clone(), pid);

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("{cli_label} stdout pipe missing"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("{cli_label} stderr pipe missing"))?;

    let ctx_err = ctx.clone();
    let cancel_err = cancel.clone();

    let use_json_lines = agent_uses_stream_json(&ctx.agent);
    let stdout_handle = if use_json_lines {
        let ctx_out = ctx.clone();
        let agent = ctx.agent.clone();
        let cancel_out = cancel.clone();
        pump_reader_json_lines(stdout, ctx_out, agent, cancel_out)
    } else {
        let ctx_out = ctx.clone();
        let cancel_out = cancel.clone();
        thread::spawn(move || {
            let acc = pump_reader(stdout, ctx_out, "stdout", cancel_out)
                .join()
                .unwrap_or_default();
            (acc, String::new())
        })
    };

    let stderr_handle = pump_reader(stderr, ctx_err, "stderr", cancel_err);

    let stderr_acc = stderr_handle.join().unwrap_or_default();
    let (stdout_raw, stdout_assembled) = stdout_handle.join().unwrap_or_default();

    let status = child
        .wait()
        .map_err(|e| format!("Failed waiting for {cli_label}: {e}"))?;

    unregister_cli_stream_session(&ctx.stream_id);

    emit_stream_chunk(&ctx.app, &ctx.stream_id, &ctx.repo_path, "stdout", "", true);

    if cancel.load(Ordering::Relaxed) {
        return Err(format!("{cli_label} synthesis cancelled"));
    }

    if !status.success() {
        let code = status
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let body = if !stderr_acc.trim().is_empty() {
            stderr_acc
        } else if !stdout_raw.trim().is_empty() {
            format!("(stdout) {stdout_raw}")
        } else {
            format!("exit code {code}")
        };
        return Err(format!(
            "{cli_label} failed (resolved to {cli_path}):\n{body}"
        ));
    }

    let decoded = if use_json_lines {
        finalize_assembled_output(&ctx.agent, &stdout_raw, &stdout_assembled)
    } else {
        stdout_raw
    };

    if !stderr_acc.trim().is_empty() {
        emit_stream_chunk(
            &ctx.app,
            &ctx.stream_id,
            &ctx.repo_path,
            "stderr",
            &stderr_acc,
            false,
        );
    }

    Ok(unwrap_agent_envelope(&ctx.agent, &decoded))
}

/// Stream stdout/stderr from an already-spawned child process until it exits.
pub fn run_streaming_child(
    ctx: &CliStreamContext,
    mut child: Child,
    cancel: Arc<AtomicBool>,
) -> Result<std::process::ExitStatus, String> {
    let pid = child.id();
    register_cli_stream_session(&ctx.stream_id, cancel.clone(), pid);

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Child stdout pipe missing".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Child stderr pipe missing".to_string())?;

    let ctx_out = ctx.clone();
    let ctx_err = ctx.clone();
    let cancel_out = cancel.clone();
    let cancel_err = cancel.clone();

    let stdout_handle = pump_reader(stdout, ctx_out, "stdout", cancel_out);
    let stderr_handle = pump_reader(stderr, ctx_err, "stderr", cancel_err);

    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    let status = child
        .wait()
        .map_err(|e| format!("Failed waiting for child process: {e}"))?;

    unregister_cli_stream_session(&ctx.stream_id);

    emit_stream_chunk(&ctx.app, &ctx.stream_id, &ctx.repo_path, "stdout", "", true);

    Ok(status)
}
