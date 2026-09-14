use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

pub type Result<T> = std::result::Result<T, String>;
const MAX_OUTPUT: u64 = 64 * 1024 * 1024;

/// No shell, hooks, credential helper, external diff, pager, or project execution.
pub fn git(root: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let mut child = Command::new("git")
        .args([
            "--no-pager",
            "-c",
            "credential.helper=",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "diff.external=",
            "-c",
            "protocol.file.allow=never",
        ])
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_LFS_SKIP_SMUDGE", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Git could not start: {e}"))?;
    let stdout = child.stdout.take().ok_or("Missing Git stdout")?;
    let stderr = child.stderr.take().ok_or("Missing Git stderr")?;
    let out = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(MAX_OUTPUT + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let err = thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr
            .take(128 * 1024)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(90);
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Git timed out; retry the import when the connection is available.".into());
        }
        thread::sleep(Duration::from_millis(2));
    };
    let output = out
        .join()
        .map_err(|_| "Git output reader failed")?
        .map_err(|e| e.to_string())?;
    let errors = err
        .join()
        .map_err(|_| "Git error reader failed")?
        .map_err(|e| e.to_string())?;
    if output.len() as u64 > MAX_OUTPUT {
        return Err("Git output exceeds the 64 MiB navigation bound.".into());
    }
    if !status.success() {
        return Err(String::from_utf8_lossy(&errors).trim().to_string());
    }
    Ok(output)
}

pub fn text(root: &Path, args: &[&str]) -> Result<String> {
    String::from_utf8(git(root, args)?)
        .map(|s| s.trim_end().to_owned())
        .map_err(|_| "Git returned a non-UTF-8 path or response.".into())
}

pub fn sha(root: &Path, revision: &str) -> Result<String> {
    if revision.starts_with('-') || revision.contains(['\0', '\n', '\r']) {
        return Err("Invalid revision".into());
    }
    let value = text(
        root,
        &["rev-parse", "--verify", &format!("{revision}^{{commit}}")],
    )?;
    if !is_sha(&value) {
        return Err("Git did not resolve an immutable commit.".into());
    }
    Ok(value)
}

pub fn is_sha(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains(['\0', '\\'])
        && path
            .split('/')
            .all(|part| !matches!(part, "" | "." | ".." | ".git"))
}

pub fn source_allowed(path: &str) -> bool {
    safe_path(path)
        && !path.split('/').any(|part| {
            let p = part.to_ascii_lowercase();
            p == ".env"
                || p.starts_with(".env.")
                || matches!(
                    p.as_str(),
                    ".ssh" | ".aws" | ".kube" | "credentials" | "id_rsa" | "id_ed25519"
                )
                || p.ends_with(".pem")
                || p.ends_with(".key")
        })
}
