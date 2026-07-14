use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use std::fmt;

pub const SCHEME: &str = "codevetter-history";

const RESOURCE_KINDS: &[&str] = &[
    "repository",
    "graph",
    "snapshot",
    "community",
    "release",
    "commit",
    "episode",
    "entity-lineage",
    "causal-thread",
    "annotation",
    "evidence",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryResourceUri {
    pub repo_id: String,
    pub kind: String,
    pub id: String,
}

impl HistoryResourceUri {
    pub fn new(repo_id: &str, kind: &str, id: &str) -> Result<Self, String> {
        validate_repo_id(repo_id)?;
        if !RESOURCE_KINDS.contains(&kind) {
            return Err("Unknown CodeVetter history resource kind".to_string());
        }
        if id.is_empty() || id.len() > 4_096 || id.chars().any(char::is_control) {
            return Err("Invalid CodeVetter history resource identifier".to_string());
        }
        Ok(Self {
            repo_id: repo_id.to_string(),
            kind: kind.to_string(),
            id: id.to_string(),
        })
    }

    pub fn parse(raw: &str, expected_repo_id: &str) -> Result<Self, String> {
        let prefix = format!("{SCHEME}://");
        let remainder = raw
            .strip_prefix(&prefix)
            .ok_or_else(|| "Invalid CodeVetter history resource scheme".to_string())?;
        if remainder.contains(['?', '#', '\\']) || remainder.contains("..") {
            return Err("Invalid CodeVetter history resource URI".to_string());
        }
        let mut segments = remainder.split('/');
        let repo_id = segments.next().unwrap_or_default();
        let kind = segments.next().unwrap_or_default();
        let encoded_id = segments.next().unwrap_or_default();
        if segments.next().is_some() || repo_id != expected_repo_id {
            return Err("CodeVetter history resource is outside this repository scope".to_string());
        }
        validate_repo_id(repo_id)?;
        if !RESOURCE_KINDS.contains(&kind) {
            return Err("Unknown CodeVetter history resource kind".to_string());
        }
        let decoded = URL_SAFE_NO_PAD
            .decode(encoded_id)
            .map_err(|_| "Malformed CodeVetter history resource identifier".to_string())?;
        let id = String::from_utf8(decoded)
            .map_err(|_| "Malformed CodeVetter history resource identifier".to_string())?;
        Self::new(repo_id, kind, &id)
    }
}

impl fmt::Display for HistoryResourceUri {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let encoded_id = URL_SAFE_NO_PAD.encode(self.id.as_bytes());
        write!(
            formatter,
            "{SCHEME}://{}/{}/{}",
            self.repo_id, self.kind, encoded_id
        )
    }
}

fn validate_repo_id(repo_id: &str) -> Result<(), String> {
    if repo_id.len() < 16
        || repo_id.len() > 128
        || !repo_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Invalid opaque CodeVetter repository identity".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const REPO: &str = "repo_0123456789abcdef";

    #[test]
    fn resource_uri_round_trips_opaque_identifiers() {
        let uri = HistoryResourceUri::new(REPO, "commit", "feature/a b#c")
            .expect("uri")
            .to_string();
        assert!(!uri.contains("feature"));
        assert_eq!(
            HistoryResourceUri::parse(&uri, REPO).expect("parse").id,
            "feature/a b#c"
        );
    }

    #[test]
    fn resource_uri_rejects_scope_changes_and_traversal() {
        let uri = HistoryResourceUri::new(REPO, "release", "v1").expect("uri");
        assert!(HistoryResourceUri::parse(&uri.to_string(), "repo_different123456").is_err());
        assert!(
            HistoryResourceUri::parse(&format!("{SCHEME}://{REPO}/release/../evidence"), REPO)
                .is_err()
        );
    }

    #[test]
    fn resource_uri_rejects_malformed_and_oversized_inputs() {
        let oversized_id = URL_SAFE_NO_PAD.encode("x".repeat(4_097));
        let invalid = [
            "https://repo_0123456789abcdef/release/djE=".to_string(),
            format!("{SCHEME}://{REPO}/release/"),
            format!("{SCHEME}://{REPO}/unknown/djE"),
            format!("{SCHEME}://{REPO}/release/%%%"),
            format!("{SCHEME}://{REPO}/release/djE?cursor=1"),
            format!("{SCHEME}://{REPO}/release/djE#fragment"),
            format!(r"{SCHEME}://{REPO}\release\djE"),
            format!("{SCHEME}://{REPO}/release/djE/extra"),
            format!("{SCHEME}://{REPO}/release/{oversized_id}"),
        ];

        for raw in invalid {
            assert!(
                HistoryResourceUri::parse(&raw, REPO).is_err(),
                "accepted malformed URI: {raw}"
            );
        }
    }
}
