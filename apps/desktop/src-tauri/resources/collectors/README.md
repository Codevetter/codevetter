Pinned collector executables are prepared here for macOS packaging and remain
untracked. Release preparation verifies publisher digests, exact versions, and
licenses before Tauri copies this directory into application resources.
Verified archives are reused from a content-addressed cache under the ignored
Rust `target/` tree; builds do not write to the user's Downloads folder.
