use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::secret_policy::{is_sensitive_path, looks_like_secret};

const MAX_SPEC_FILES: usize = 8;
const MAX_SPEC_FILE_BYTES: u64 = 64 * 1024;
const MAX_SPEC_TOTAL_BYTES: u64 = 256 * 1024;
const MAX_REQUIREMENTS: usize = 128;
const MAX_REQUIREMENT_BYTES: usize = 8 * 1024;
const MAX_REVIEW_CONTEXT_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpecSource {
    pub path: String,
    pub sha256: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExtractedRequirement {
    pub id: String,
    pub title: String,
    pub text: String,
    pub source_path: String,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone)]
pub struct SpecPacket {
    pub sources: Vec<SpecSource>,
    pub requirements: Vec<ExtractedRequirement>,
    pub review_context: String,
    pub review_requirement_ids: BTreeSet<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpecExecutionOutcome {
    Passed,
    Failed,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpecEvidenceReference {
    pub stage: String,
    pub status: String,
    pub adapter: Option<String>,
    pub target: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RequirementStatus {
    Verified,
    Contradicted,
    ReviewOnly,
    Unverified,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RequirementCoverage {
    #[serde(flatten)]
    pub requirement: ExtractedRequirement,
    pub selected_for_execution: bool,
    pub supplied_to_review: bool,
    pub status: RequirementStatus,
    pub evidence: Option<SpecEvidenceReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpecCoverageSummary {
    pub total_requirements: usize,
    pub review_input_requirements: usize,
    pub selected_for_execution: usize,
    pub verified: usize,
    pub contradicted: usize,
    pub review_only: usize,
    pub unverified: usize,
    pub review_input_coverage_percent: Option<u8>,
    pub executable_evidence_coverage_percent: Option<u8>,
    pub verified_coverage_percent: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpecCoverageReceipt {
    pub schema_version: String,
    pub head_sha: String,
    pub sources: Vec<SpecSource>,
    pub requirements: Vec<RequirementCoverage>,
    pub summary: SpecCoverageSummary,
    pub limitations: Vec<String>,
}

pub fn load_spec_packet(repo_path: &Path, paths: &[PathBuf]) -> Result<Option<SpecPacket>, String> {
    if paths.is_empty() {
        return Ok(None);
    }
    if paths.len() > MAX_SPEC_FILES {
        return Err(format!(
            "At most {MAX_SPEC_FILES} spec files may be checked at once"
        ));
    }

    let repo = repo_path
        .canonicalize()
        .map_err(|error| format!("Could not resolve repository for spec input: {error}"))?;
    let mut seen_paths = BTreeSet::new();
    let mut seen_requirements = BTreeMap::<String, String>::new();
    let mut sources = Vec::new();
    let mut requirements = Vec::new();
    let mut total_bytes = 0_u64;

    for relative in paths {
        let logical_path = validate_relative_markdown_path(relative)?;
        if !seen_paths.insert(logical_path.clone()) {
            return Err(format!(
                "Spec path `{logical_path}` was supplied more than once"
            ));
        }
        let candidate = repo.join(relative);
        let canonical = candidate
            .canonicalize()
            .map_err(|error| format!("Spec `{logical_path}` is unavailable: {error}"))?;
        if !canonical.starts_with(&repo) || !canonical.is_file() {
            return Err(format!(
                "Spec `{logical_path}` must be a contained repository file"
            ));
        }
        let bytes = canonical
            .metadata()
            .map_err(|error| format!("Could not inspect spec `{logical_path}`: {error}"))?
            .len();
        if bytes > MAX_SPEC_FILE_BYTES {
            return Err(format!(
                "Spec `{logical_path}` exceeds the 64 KiB file limit"
            ));
        }
        total_bytes = total_bytes.saturating_add(bytes);
        if total_bytes > MAX_SPEC_TOTAL_BYTES {
            return Err("Combined spec input exceeds the 256 KiB limit".into());
        }
        let source_bytes = std::fs::read(&canonical)
            .map_err(|error| format!("Could not read spec `{logical_path}`: {error}"))?;
        let source = std::str::from_utf8(&source_bytes)
            .map_err(|_| format!("Spec `{logical_path}` must be UTF-8 Markdown"))?;
        if looks_like_secret(source) {
            return Err(format!(
                "Spec `{logical_path}` contains secret-like material"
            ));
        }
        let extracted = extract_requirements(&logical_path, source)?;
        for requirement in &extracted {
            if let Some(existing) = seen_requirements.insert(
                requirement.id.clone(),
                format!("{}:{}", requirement.source_path, requirement.start_line),
            ) {
                return Err(format!(
                    "Requirement id `{}` is duplicated at {} and {}:{}",
                    requirement.id, existing, requirement.source_path, requirement.start_line
                ));
            }
        }
        requirements.extend(extracted);
        if requirements.len() > MAX_REQUIREMENTS {
            return Err(format!(
                "Spec input exceeds the {MAX_REQUIREMENTS} requirement limit"
            ));
        }
        sources.push(SpecSource {
            path: logical_path,
            sha256: format!("sha256:{:x}", Sha256::digest(&source_bytes)),
            bytes: source_bytes.len(),
        });
    }

    let (review_context, review_requirement_ids, mut limitations) =
        build_review_context(&requirements);
    if requirements.is_empty() {
        limitations.push(
            "No explicit `Requirement:` sections were found; CodeVetter did not invent requirements"
                .into(),
        );
    }
    Ok(Some(SpecPacket {
        sources,
        requirements,
        review_context,
        review_requirement_ids,
        limitations,
    }))
}

pub fn validate_selected_requirements(
    packet: Option<&SpecPacket>,
    selected_ids: &[String],
) -> Result<(), String> {
    if selected_ids.is_empty() {
        return Ok(());
    }
    let packet = packet.ok_or_else(|| "--requirement requires at least one --spec".to_string())?;
    let known = packet
        .requirements
        .iter()
        .map(|requirement| requirement.id.as_str())
        .collect::<BTreeSet<_>>();
    let mut seen = BTreeSet::new();
    for id in selected_ids {
        if !seen.insert(id.as_str()) {
            return Err(format!("Requirement `{id}` was selected more than once"));
        }
        if !known.contains(id.as_str()) {
            return Err(format!(
                "Selected requirement `{id}` was not found in the supplied specs"
            ));
        }
    }
    Ok(())
}

pub fn compose_spec_coverage(
    packet: SpecPacket,
    selected_ids: &[String],
    head_sha: &str,
    review_completed: bool,
    execution: SpecExecutionOutcome,
    evidence: Option<SpecEvidenceReference>,
) -> SpecCoverageReceipt {
    let selected = selected_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let requirements = packet
        .requirements
        .into_iter()
        .map(|requirement| {
            let selected_for_execution = selected.contains(requirement.id.as_str());
            let supplied_to_review = packet.review_requirement_ids.contains(&requirement.id);
            let (status, requirement_evidence) = if selected_for_execution {
                match execution {
                    SpecExecutionOutcome::Passed => (RequirementStatus::Verified, evidence.clone()),
                    SpecExecutionOutcome::Failed => {
                        (RequirementStatus::Contradicted, evidence.clone())
                    }
                    SpecExecutionOutcome::Unavailable if review_completed && supplied_to_review => {
                        (RequirementStatus::ReviewOnly, None)
                    }
                    SpecExecutionOutcome::Unavailable => (RequirementStatus::Unverified, None),
                }
            } else if review_completed && supplied_to_review {
                (RequirementStatus::ReviewOnly, None)
            } else {
                (RequirementStatus::Unverified, None)
            };
            RequirementCoverage {
                requirement,
                selected_for_execution,
                supplied_to_review,
                status,
                evidence: requirement_evidence,
            }
        })
        .collect::<Vec<_>>();
    let total = requirements.len();
    let count = |status| {
        requirements
            .iter()
            .filter(|item| item.status == status)
            .count()
    };
    let verified = count(RequirementStatus::Verified);
    let contradicted = count(RequirementStatus::Contradicted);
    let review_only = count(RequirementStatus::ReviewOnly);
    let unverified = count(RequirementStatus::Unverified);
    let review_input = requirements
        .iter()
        .filter(|item| item.supplied_to_review)
        .count();
    let selected_count = requirements
        .iter()
        .filter(|item| item.selected_for_execution)
        .count();
    let mut limitations = packet.limitations;
    limitations.push(
        "Review-input coverage records criteria supplied to a model; it is not executable proof"
            .into(),
    );
    if selected_count == 0 && total > 0 {
        limitations.push(
            "No requirement was explicitly bound to the correctness target; executable coverage is zero"
                .into(),
        );
    }
    if unverified + review_only > 0 {
        limitations.push(format!(
            "{} requirement(s) remain without executable proof",
            unverified + review_only
        ));
    }

    SpecCoverageReceipt {
        schema_version: "codevetter.spec-coverage/v1".into(),
        head_sha: head_sha.into(),
        sources: packet.sources,
        summary: SpecCoverageSummary {
            total_requirements: total,
            review_input_requirements: review_input,
            selected_for_execution: selected_count,
            verified,
            contradicted,
            review_only,
            unverified,
            review_input_coverage_percent: percentage(review_input, total),
            executable_evidence_coverage_percent: percentage(verified + contradicted, total),
            verified_coverage_percent: percentage(verified, total),
        },
        requirements,
        limitations,
    }
}

fn validate_relative_markdown_path(path: &Path) -> Result<String, String> {
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Spec paths must be contained repository-relative paths".into());
    }
    let logical = path
        .to_str()
        .ok_or_else(|| "Spec paths must be valid UTF-8".to_string())?
        .replace('\\', "/");
    if is_sensitive_path(&logical) {
        return Err(format!("Spec `{logical}` uses a sensitive path"));
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    if !matches!(extension.as_deref(), Some("md" | "markdown")) {
        return Err(format!("Spec `{logical}` must be a Markdown file"));
    }
    Ok(logical)
}

fn extract_requirements(path: &str, source: &str) -> Result<Vec<ExtractedRequirement>, String> {
    let normalized = source.replace("\r\n", "\n").replace('\r', "\n");
    let lines = normalized.lines().collect::<Vec<_>>();
    let mut starts = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if let Some(title) = requirement_heading(line) {
            let id = slugify(title);
            if id.is_empty() {
                return Err(format!(
                    "Requirement at {path}:{} has no usable id",
                    index + 1
                ));
            }
            starts.push((index, id, title.to_string()));
        }
    }
    let mut requirements = Vec::new();
    for (position, (start, id, title)) in starts.iter().enumerate() {
        let end = starts
            .get(position + 1)
            .map(|(next, _, _)| *next)
            .unwrap_or(lines.len());
        let text = lines[*start + 1..end]
            .iter()
            .map(|line| line.trim_end())
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();
        if text.len() > MAX_REQUIREMENT_BYTES {
            return Err(format!(
                "Requirement `{id}` at {path}:{} exceeds 8 KiB",
                start + 1
            ));
        }
        requirements.push(ExtractedRequirement {
            id: id.clone(),
            title: title.clone(),
            text,
            source_path: path.into(),
            start_line: start + 1,
            end_line: end.max(start + 1),
        });
    }
    Ok(requirements)
}

fn requirement_heading(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let hashes = trimmed
        .chars()
        .take_while(|character| *character == '#')
        .count();
    if !(1..=6).contains(&hashes) || trimmed.as_bytes().get(hashes) != Some(&b' ') {
        return None;
    }
    trimmed[hashes + 1..]
        .strip_prefix("Requirement:")
        .map(str::trim)
        .filter(|title| !title.is_empty())
}

fn slugify(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .fold(
            (String::new(), false),
            |(mut output, separator), character| {
                if character.is_ascii_alphanumeric() || matches!(character, '.' | '_') {
                    if separator && !output.is_empty() {
                        output.push('-');
                    }
                    output.push(character);
                    (output, false)
                } else {
                    (output, true)
                }
            },
        )
        .0
        .trim_matches('-')
        .to_string()
}

fn build_review_context(
    requirements: &[ExtractedRequirement],
) -> (String, BTreeSet<String>, Vec<String>) {
    let mut context = String::from(
        "Documented requirements follow. Treat them as review criteria and cited hypotheses, not executable proof. Cite requirement ids in related findings.\n",
    );
    let mut included = BTreeSet::new();
    let mut limitations = Vec::new();
    for requirement in requirements {
        let block = format!(
            "\n[{}] {}:{}\n{}\n",
            requirement.id, requirement.source_path, requirement.start_line, requirement.text
        );
        if context.len().saturating_add(block.len()) > MAX_REVIEW_CONTEXT_BYTES {
            limitations.push(format!(
                "Review context stopped after {} of {} requirements at the 16 KiB bound",
                included.len(),
                requirements.len()
            ));
            break;
        }
        context.push_str(&block);
        included.insert(requirement.id.clone());
    }
    if included.is_empty() {
        context.clear();
    }
    (context, included, limitations)
}

fn percentage(part: usize, total: usize) -> Option<u8> {
    (total > 0).then(|| ((part * 100 + total / 2) / total) as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_spec(root: &Path, relative: &str, content: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        std::fs::write(path, content).expect("write spec");
    }

    #[test]
    fn extracts_explicit_requirements_with_stable_anchors() {
        let repo = tempfile::tempdir().expect("repo");
        write_spec(
            repo.path(),
            "docs/product.md",
            "# Product\n\n### Requirement: Account Lockout\nUsers SHALL lock after five attempts.\n\n#### Scenario: failure\n- **WHEN** five attempts fail\n- **THEN** access is denied\n\n### Requirement: audit-log\nEvery denial is recorded.\n",
        );
        let packet = load_spec_packet(repo.path(), &[PathBuf::from("docs/product.md")])
            .expect("packet")
            .expect("some packet");
        assert_eq!(packet.requirements.len(), 2);
        assert_eq!(packet.requirements[0].id, "account-lockout");
        assert_eq!(packet.requirements[0].start_line, 3);
        assert_eq!(packet.requirements[0].end_line, 9);
        assert_eq!(packet.requirements[1].id, "audit-log");
        assert!(packet.sources[0].sha256.starts_with("sha256:"));
        assert!(packet
            .review_context
            .contains("[account-lockout] docs/product.md:3"));
    }

    #[test]
    fn rejects_unsafe_duplicate_and_secret_bearing_specs() {
        let repo = tempfile::tempdir().expect("repo");
        write_spec(repo.path(), "docs/a.md", "### Requirement: same\nOne.\n");
        write_spec(repo.path(), "docs/b.md", "### Requirement: same\nTwo.\n");
        assert!(load_spec_packet(repo.path(), &[PathBuf::from("../outside.md")]).is_err());
        assert!(load_spec_packet(
            repo.path(),
            &[PathBuf::from("docs/a.md"), PathBuf::from("docs/b.md")]
        )
        .is_err());
        write_spec(
            repo.path(),
            "docs/secret.md",
            "### Requirement: secret\npassword=correct-horse-battery-staple\n",
        );
        assert!(load_spec_packet(repo.path(), &[PathBuf::from("docs/secret.md")]).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape_and_non_markdown_input() {
        use std::os::unix::fs::symlink;

        let repo = tempfile::tempdir().expect("repo");
        let outside = tempfile::NamedTempFile::new().expect("outside");
        let link = repo.path().join("escaped.md");
        symlink(outside.path(), &link).expect("symlink");
        assert!(load_spec_packet(repo.path(), &[PathBuf::from("escaped.md")]).is_err());
        std::fs::write(
            repo.path().join("spec.txt"),
            "### Requirement: one\nText.\n",
        )
        .expect("text file");
        assert!(load_spec_packet(repo.path(), &[PathBuf::from("spec.txt")]).is_err());
    }

    #[test]
    fn selected_requirements_must_exist_and_be_unique() {
        let repo = tempfile::tempdir().expect("repo");
        write_spec(
            repo.path(),
            "spec.md",
            "### Requirement: expected\nBehavior.\n",
        );
        let packet = load_spec_packet(repo.path(), &[PathBuf::from("spec.md")])
            .expect("packet")
            .expect("some packet");
        assert!(validate_selected_requirements(Some(&packet), &["missing".into()]).is_err());
        assert!(validate_selected_requirements(
            Some(&packet),
            &["expected".into(), "expected".into()]
        )
        .is_err());
    }

    #[test]
    fn coverage_only_verifies_explicitly_selected_requirements() {
        let repo = tempfile::tempdir().expect("repo");
        write_spec(
            repo.path(),
            "docs/product.md",
            "### Requirement: one\nFirst.\n### Requirement: two\nSecond.\n",
        );
        let packet = load_spec_packet(repo.path(), &[PathBuf::from("docs/product.md")])
            .expect("packet")
            .expect("some packet");
        let receipt = compose_spec_coverage(
            packet,
            &["one".into()],
            &"a".repeat(40),
            true,
            SpecExecutionOutcome::Passed,
            Some(SpecEvidenceReference {
                stage: "correctness".into(),
                status: "passed".into(),
                adapter: Some("node-test".into()),
                target: Some("tests/one.test.mjs".into()),
                source: Some("explicit".into()),
            }),
        );
        assert_eq!(receipt.requirements[0].status, RequirementStatus::Verified);
        assert_eq!(
            receipt.requirements[1].status,
            RequirementStatus::ReviewOnly
        );
        assert_eq!(
            receipt.summary.executable_evidence_coverage_percent,
            Some(50)
        );
        assert_eq!(receipt.summary.verified_coverage_percent, Some(50));
    }

    #[test]
    fn failed_bound_target_contradicts_without_claiming_success() {
        let repo = tempfile::tempdir().expect("repo");
        write_spec(
            repo.path(),
            "spec.md",
            "### Requirement: expected\nBehavior.\n",
        );
        let packet = load_spec_packet(repo.path(), &[PathBuf::from("spec.md")])
            .expect("packet")
            .expect("some packet");
        let receipt = compose_spec_coverage(
            packet,
            &["expected".into()],
            &"b".repeat(40),
            true,
            SpecExecutionOutcome::Failed,
            None,
        );
        assert_eq!(
            receipt.requirements[0].status,
            RequirementStatus::Contradicted
        );
        assert_eq!(
            receipt.summary.executable_evidence_coverage_percent,
            Some(100)
        );
        assert_eq!(receipt.summary.verified_coverage_percent, Some(0));
    }
}
