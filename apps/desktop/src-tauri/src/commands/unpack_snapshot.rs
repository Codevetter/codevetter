use crate::commands::unpack_types::{
    SnapshotChangedFile, SnapshotCommitEvidence, SnapshotCommitRange,
};
use std::process::Command as StdCommand;

const SNAPSHOT_UNIT_SEP: char = '\u{1f}';
const SNAPSHOT_REC_SEP: char = '\u{1e}';

pub(crate) fn build_snapshot_commit_range(
    repo_path: &str,
    base_commit: &str,
    head_commit: &str,
    limit: usize,
) -> Result<SnapshotCommitRange, String> {
    let base = base_commit.trim();
    let head = head_commit.trim();
    if !is_safe_commit_id(base) || !is_safe_commit_id(head) {
        return Err("Snapshot comparison needs concrete git commit SHAs.".to_string());
    }

    if base == head {
        return Ok(SnapshotCommitRange {
            base_commit: base.to_string(),
            head_commit: head.to_string(),
            commit_count: 0,
            commits: Vec::new(),
            truncated: false,
        });
    }

    let range = format!("{base}..{head}");
    let count_output = StdCommand::new("git")
        .args(["rev-list", "--count", &range, "--"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run git rev-list: {e}"))?;
    if !count_output.status.success() {
        let stderr = String::from_utf8_lossy(&count_output.stderr);
        return Err(format!("git rev-list failed for snapshot range: {stderr}"));
    }
    let commit_count = String::from_utf8_lossy(&count_output.stdout)
        .trim()
        .parse::<u64>()
        .unwrap_or(0);

    let pretty = "%x1e%H%x1f%ad%x1f%an%x1f%s";
    let max_count = limit.max(1).to_string();
    let log_output = StdCommand::new("git")
        .args([
            "log",
            "--no-merges",
            "--date=short",
            &format!("--pretty=format:{pretty}"),
            "--numstat",
            "-n",
            &max_count,
            &range,
            "--",
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run git log for snapshot range: {e}"))?;
    if !log_output.status.success() {
        let stderr = String::from_utf8_lossy(&log_output.stderr);
        return Err(format!("git log failed for snapshot range: {stderr}"));
    }

    let commits = parse_snapshot_commit_log(&String::from_utf8_lossy(&log_output.stdout));
    Ok(SnapshotCommitRange {
        base_commit: base.to_string(),
        head_commit: head.to_string(),
        commit_count,
        truncated: commit_count as usize > commits.len(),
        commits,
    })
}

pub(crate) fn is_safe_commit_id(value: &str) -> bool {
    (7..=64).contains(&value.len()) && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

pub(crate) fn parse_snapshot_commit_log(raw: &str) -> Vec<SnapshotCommitEvidence> {
    let mut out = Vec::new();
    for raw_record in raw.split(SNAPSHOT_REC_SEP) {
        let record = raw_record.trim_matches(|c| c == '\n' || c == '\r');
        if record.is_empty() {
            continue;
        }
        let mut parts = record.splitn(4, SNAPSHOT_UNIT_SEP);
        let sha = parts.next().unwrap_or("").trim();
        let date = parts.next().unwrap_or("").trim();
        let author = parts.next().unwrap_or("").trim();
        let subject_and_numstat = parts.next().unwrap_or("");
        if sha.is_empty() {
            continue;
        }
        let mut lines = subject_and_numstat.lines();
        let subject = lines.next().unwrap_or("").trim().to_string();
        let mut files = Vec::new();
        let mut additions = 0u64;
        let mut deletions = 0u64;
        for line in lines {
            if !line_is_snapshot_numstat(line) {
                continue;
            }
            let mut cols = line.splitn(3, '\t');
            let add_raw = cols.next().unwrap_or("-");
            let del_raw = cols.next().unwrap_or("-");
            let path = cols.next().unwrap_or("").trim();
            if path.is_empty() {
                continue;
            }
            let add = add_raw.parse::<u64>().unwrap_or(0);
            let del = del_raw.parse::<u64>().unwrap_or(0);
            additions += add;
            deletions += del;
            files.push(SnapshotChangedFile {
                path: path.to_string(),
                additions: add,
                deletions: del,
            });
        }
        files.truncate(12);
        out.push(SnapshotCommitEvidence {
            sha: sha.to_string(),
            date: date.to_string(),
            author: author.to_string(),
            subject,
            additions,
            deletions,
            files,
        });
    }
    out
}

fn line_is_snapshot_numstat(line: &str) -> bool {
    let mut parts = line.splitn(3, '\t');
    let add = parts.next().unwrap_or("");
    let del = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");
    if path.is_empty() {
        return false;
    }
    let valid_count = |s: &str| s == "-" || s.chars().all(|ch| ch.is_ascii_digit());
    valid_count(add) && valid_count(del)
}
