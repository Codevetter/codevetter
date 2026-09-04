//! Safe registration of the bundled `codevetter` CLI.
//!
//! DMG drag-install has no post-install hook. On the first installed-app
//! launch we create one user-owned symlink without touching shell profiles,
//! privileged directories, or an existing command.

use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub enum CliInstallStatus {
    Installed(PathBuf),
    Current(PathBuf),
    SkippedDevelopment,
    BundledCliMissing(PathBuf),
    Collision(PathBuf),
    Unavailable(String),
}

pub fn ensure_bundled_cli_link() -> CliInstallStatus {
    #[cfg(not(target_os = "macos"))]
    {
        CliInstallStatus::Unavailable(
            "Automatic CLI registration is currently supported for the macOS app bundle.".into(),
        )
    }
    #[cfg(target_os = "macos")]
    {
        let executable = match std::env::current_exe() {
            Ok(path) => path,
            Err(error) => {
                return CliInstallStatus::Unavailable(format!(
                    "resolve installed app executable: {error}"
                ))
            }
        };
        let Some(bundled_cli) = installed_bundled_cli(&executable) else {
            return CliInstallStatus::SkippedDevelopment;
        };
        if !bundled_cli.is_file() {
            return CliInstallStatus::BundledCliMissing(bundled_cli);
        }
        let Some(home) = std::env::var_os("HOME") else {
            return CliInstallStatus::Unavailable("HOME is unavailable".into());
        };
        let launcher = PathBuf::from(home)
            .join(".local")
            .join("bin")
            .join("codevetter");
        match install_cli_link(&bundled_cli, &launcher) {
            Ok(true) => CliInstallStatus::Installed(launcher),
            Ok(false) => CliInstallStatus::Current(launcher),
            Err(InstallLinkError::Collision) => CliInstallStatus::Collision(launcher),
            Err(InstallLinkError::Io(error)) => CliInstallStatus::Unavailable(error),
        }
    }
}

fn installed_bundled_cli(executable: &Path) -> Option<PathBuf> {
    let parent = executable.parent()?;
    let components = parent
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>();
    let macos_index = components
        .iter()
        .rposition(|component| component == "MacOS")?;
    if macos_index < 2
        || components
            .get(macos_index - 1)
            .map(|component| component.as_ref())
            != Some("Contents")
        || !components
            .get(macos_index - 2)
            .is_some_and(|component| component.ends_with(".app"))
    {
        return None;
    }
    Some(parent.join("codevetter"))
}

#[derive(Debug)]
enum InstallLinkError {
    Collision,
    Io(String),
}

/// Returns `true` when a new link was created and `false` when the exact link
/// already existed. Any other filesystem entry is a collision and is preserved.
fn install_cli_link(bundled_cli: &Path, launcher: &Path) -> Result<bool, InstallLinkError> {
    match std::fs::symlink_metadata(launcher) {
        Ok(metadata) => {
            if !metadata.file_type().is_symlink() {
                return Err(InstallLinkError::Collision);
            }
            let target = std::fs::read_link(launcher)
                .map_err(|error| InstallLinkError::Io(format!("read CLI launcher: {error}")))?;
            if target == bundled_cli {
                return Ok(false);
            }
            return Err(InstallLinkError::Collision);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(InstallLinkError::Io(format!(
                "inspect CLI launcher: {error}"
            )))
        }
    }
    let parent = launcher
        .parent()
        .ok_or_else(|| InstallLinkError::Io("CLI launcher has no parent directory".into()))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| InstallLinkError::Io(format!("create CLI directory: {error}")))?;
    #[cfg(unix)]
    std::os::unix::fs::symlink(bundled_cli, launcher)
        .map_err(|error| InstallLinkError::Io(format!("create CLI launcher: {error}")))?;
    #[cfg(not(unix))]
    return Err(InstallLinkError::Io(
        "CLI symlink registration requires a Unix platform".into(),
    ));
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_bundle_path_resolves_sibling_cli() {
        assert_eq!(
            installed_bundled_cli(Path::new(
                "/Applications/CodeVetter.app/Contents/MacOS/CodeVetter"
            )),
            Some(PathBuf::from(
                "/Applications/CodeVetter.app/Contents/MacOS/codevetter"
            ))
        );
        assert_eq!(
            installed_bundled_cli(Path::new("/tmp/target/debug/codevetter-desktop")),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn launcher_creation_is_idempotent_and_preserves_collisions() {
        let fixture = tempfile::tempdir().expect("fixture");
        let bundled = fixture
            .path()
            .join("CodeVetter.app/Contents/MacOS/codevetter");
        std::fs::create_dir_all(bundled.parent().expect("bundle parent")).expect("bundle dir");
        std::fs::write(&bundled, b"binary").expect("bundled CLI");
        let launcher = fixture.path().join("home/.local/bin/codevetter");

        assert!(install_cli_link(&bundled, &launcher).expect("install"));
        assert!(!install_cli_link(&bundled, &launcher).expect("current"));
        assert_eq!(std::fs::read_link(&launcher).expect("link"), bundled);

        let other_launcher = fixture.path().join("other/.local/bin/codevetter");
        std::fs::create_dir_all(other_launcher.parent().expect("other parent")).expect("other dir");
        std::fs::write(&other_launcher, b"unrelated").expect("collision");
        assert!(matches!(
            install_cli_link(&bundled, &other_launcher),
            Err(InstallLinkError::Collision)
        ));
        assert_eq!(
            std::fs::read(&other_launcher).expect("preserved"),
            b"unrelated"
        );
    }
}
