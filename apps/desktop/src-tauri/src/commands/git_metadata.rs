use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitTagRecord {
    pub name: String,
    pub object_sha: String,
    pub commit_sha: String,
    pub created_ts: i64,
}

/// Read tag identity once for DORA and temporal history without changing either
/// consumer's semantics: DORA keeps the tag object SHA, while history uses the
/// peeled commit SHA for ancestry and checkpoint assignment.
pub fn read_git_tags(repo_path: &Path) -> Result<Vec<GitTagRecord>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args([
            "for-each-ref",
            "--format=%(refname:short)%09%(objectname)%09%(*objectname)%09%(creatordate:unix)",
            "refs/tags",
        ])
        .output()
        .map_err(|error| format!("git for-each-ref: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "git for-each-ref failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let mut tags = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let fields = line.splitn(4, '\t').collect::<Vec<_>>();
        if fields.len() != 4 || fields[0].is_empty() {
            continue;
        }
        let created_ts = fields[3].parse::<i64>().unwrap_or_default();
        if created_ts <= 0 {
            continue;
        }
        tags.push(GitTagRecord {
            name: fields[0].to_string(),
            object_sha: fields[1].to_string(),
            commit_sha: if fields[2].is_empty() {
                fields[1].to_string()
            } else {
                fields[2].to_string()
            },
            created_ts,
        });
    }
    tags.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.object_sha.cmp(&right.object_sha))
    });
    Ok(tags)
}

/// Matches v1.2.3, 1.2.3, v1.2.3-rc.1, v2024.04.05, and 1.2.
pub fn is_release_tag(tag: &str) -> bool {
    let normalized = tag.trim_start_matches('v').trim_start_matches('V');
    if normalized.is_empty() {
        return false;
    }
    let head = normalized.split(['-', '+']).next().unwrap_or(normalized);
    let mut digits = 0;
    let mut dots = 0;
    for byte in head.bytes() {
        if byte.is_ascii_digit() {
            digits += 1;
        } else if byte == b'.' {
            dots += 1;
        } else {
            return false;
        }
    }
    digits > 0 && dots >= 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_tag_classifier_keeps_dora_semantics() {
        for tag in ["v1.2.3", "1.2.3", "v1.2", "v1.2.3-rc.1", "v2024.04.05"] {
            assert!(is_release_tag(tag), "{tag}");
        }
        for tag in ["latest", "nightly", "release-candidate", "", "v", "vfoo"] {
            assert!(!is_release_tag(tag), "{tag}");
        }
    }
}
