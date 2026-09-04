//! Policy boundary for the external Apple `container` sandbox candidate.
//!
//! This module deliberately does not launch the CLI. It produces the only
//! bind-mount argument a future runner may pass and revalidates the source
//! identity immediately before process creation. Runtime supervision and
//! isolated-network attestation remain separate gates.

use std::fs::Metadata;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppleContainerMountPlan {
    allowed_root: PathBuf,
    canonical_source: PathBuf,
    container_target: String,
    source_identity: SourceIdentity,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SourceIdentity {
    is_directory: bool,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

impl AppleContainerMountPlan {
    /// Creates a read-only bind plan contained by `allowed_root`.
    pub fn new(
        allowed_root: &Path,
        requested_source: &Path,
        container_target: &str,
    ) -> Result<Self, String> {
        let allowed_root = canonical_directory(allowed_root, "allowed workspace root")?;
        let canonical_source = requested_source.canonicalize().map_err(|error| {
            format!(
                "Apple Container mount source {} is unavailable: {error}",
                requested_source.display()
            )
        })?;
        if !canonical_source.starts_with(&allowed_root) {
            return Err("Apple Container mount source escapes the allowed workspace root".into());
        }

        let source_text = safe_mount_path(&canonical_source, "source")?;
        validate_container_target(container_target)?;
        let metadata = canonical_source.metadata().map_err(|error| {
            format!(
                "Could not inspect Apple Container mount source {}: {error}",
                canonical_source.display()
            )
        })?;

        // Materialize now so unsupported mount-string characters fail before
        // a plan can be retained or handed to a runner.
        let _ = format!("type=bind,source={source_text},target={container_target},readonly");

        Ok(Self {
            allowed_root,
            canonical_source,
            container_target: container_target.to_string(),
            source_identity: SourceIdentity::from_metadata(&metadata),
        })
    }

    pub fn canonical_source(&self) -> &Path {
        &self.canonical_source
    }

    /// Re-checks both containment and filesystem identity. A future runner
    /// must call this immediately before spawning `container`.
    pub fn revalidate(&self) -> Result<(), String> {
        let current_root = canonical_directory(&self.allowed_root, "allowed workspace root")?;
        if current_root != self.allowed_root {
            return Err("Apple Container allowed workspace root identity changed".into());
        }
        let current_source = self.canonical_source.canonicalize().map_err(|error| {
            format!(
                "Apple Container mount source {} is unavailable: {error}",
                self.canonical_source.display()
            )
        })?;
        if current_source != self.canonical_source || !current_source.starts_with(&current_root) {
            return Err("Apple Container mount source identity or containment changed".into());
        }
        let current_identity = SourceIdentity::from_metadata(
            &current_source
                .metadata()
                .map_err(|error| format!("Could not revalidate mount source: {error}"))?,
        );
        if current_identity != self.source_identity {
            return Err("Apple Container mount source identity changed".into());
        }
        Ok(())
    }

    pub fn read_only_mount_argument(&self) -> Result<String, String> {
        self.revalidate()?;
        Ok(format!(
            "type=bind,source={},target={},readonly",
            safe_mount_path(&self.canonical_source, "source")?,
            self.container_target
        ))
    }
}

impl SourceIdentity {
    fn from_metadata(metadata: &Metadata) -> Self {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;

        Self {
            is_directory: metadata.is_dir(),
            #[cfg(unix)]
            device: metadata.dev(),
            #[cfg(unix)]
            inode: metadata.ino(),
        }
    }
}

fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    let canonical = path.canonicalize().map_err(|error| {
        format!(
            "Apple Container {label} {} is unavailable: {error}",
            path.display()
        )
    })?;
    if !canonical.is_dir() {
        return Err(format!("Apple Container {label} must be a directory"));
    }
    Ok(canonical)
}

fn safe_mount_path<'a>(path: &'a Path, label: &str) -> Result<&'a str, String> {
    let value = path
        .to_str()
        .ok_or_else(|| format!("Apple Container mount {label} must be valid UTF-8"))?;
    if value.contains(',') || value.chars().any(char::is_control) {
        return Err(format!(
            "Apple Container mount {label} contains unsupported mount syntax"
        ));
    }
    Ok(value)
}

fn validate_container_target(target: &str) -> Result<(), String> {
    if target.is_empty()
        || target.contains(',')
        || target.chars().any(char::is_control)
        || !Path::new(target).is_absolute()
        || Path::new(target).components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::CurDir | Component::Prefix(_)
            )
        })
    {
        return Err("Apple Container mount target must be a normalized absolute path".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "codevetter-apple-container-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(root.join("workspace/nested")).expect("fixture");
        std::fs::create_dir_all(root.join("sibling")).expect("sibling");
        root
    }

    #[test]
    fn produces_only_a_canonical_read_only_bind() {
        let fixture = fixture();
        let workspace = fixture.join("workspace");
        let plan = AppleContainerMountPlan::new(
            &workspace,
            &workspace.join("nested/../nested"),
            "/workspace",
        )
        .expect("contained plan");

        let argument = plan.read_only_mount_argument().expect("argument");
        assert!(argument.starts_with("type=bind,source="));
        assert!(argument.ends_with(",target=/workspace,readonly"));
        assert!(!argument.contains("/../"));
        assert_eq!(
            plan.canonical_source(),
            workspace.join("nested").canonicalize().unwrap()
        );

        std::fs::remove_dir_all(fixture).expect("cleanup");
    }

    #[test]
    fn rejects_parent_traversal_outside_the_allowed_root() {
        let fixture = fixture();
        let error = AppleContainerMountPlan::new(
            &fixture.join("workspace"),
            &fixture.join("workspace/../sibling"),
            "/workspace",
        )
        .expect_err("escape must fail");
        assert!(error.contains("escapes"));
        std::fs::remove_dir_all(fixture).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_that_resolves_outside_the_allowed_root() {
        use std::os::unix::fs::symlink;

        let fixture = fixture();
        symlink(fixture.join("sibling"), fixture.join("workspace/link")).expect("symlink");
        let error = AppleContainerMountPlan::new(
            &fixture.join("workspace"),
            &fixture.join("workspace/link"),
            "/workspace",
        )
        .expect_err("symlink escape must fail");
        assert!(error.contains("escapes"));
        std::fs::remove_dir_all(fixture).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn revalidation_rejects_source_replacement_before_launch() {
        use std::os::unix::fs::symlink;

        let fixture = fixture();
        let workspace = fixture.join("workspace");
        let source = workspace.join("nested");
        let plan = AppleContainerMountPlan::new(&workspace, &source, "/workspace").expect("plan");
        std::fs::rename(&source, workspace.join("original")).expect("rename");
        symlink(fixture.join("sibling"), &source).expect("replacement symlink");

        let error = plan
            .read_only_mount_argument()
            .expect_err("replacement must fail");
        assert!(error.contains("identity or containment changed"));
        std::fs::remove_dir_all(fixture).expect("cleanup");
    }

    #[test]
    fn rejects_mount_string_injection_and_relative_targets() {
        let fixture = fixture();
        let workspace = fixture.join("workspace");
        let comma_source = workspace.join("comma,source");
        std::fs::create_dir(&comma_source).expect("comma fixture");

        assert!(AppleContainerMountPlan::new(&workspace, &comma_source, "/workspace").is_err());
        assert!(AppleContainerMountPlan::new(&workspace, &workspace, "workspace").is_err());
        assert!(AppleContainerMountPlan::new(&workspace, &workspace, "/work/../escape").is_err());
        assert!(
            AppleContainerMountPlan::new(&workspace, &workspace, "/work,target=/escape").is_err()
        );

        std::fs::remove_dir_all(fixture).expect("cleanup");
    }
}
