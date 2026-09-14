use super::*;
use std::{
    fs,
    process::Command,
    time::{Duration, Instant},
};

fn fixture() -> (tempfile::TempDir, String, String) {
    let dir = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        let output = Command::new("git")
            .args(args)
            .current_dir(dir.path())
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    };
    run(&["init", "-b", "main"]);
    fs::create_dir(dir.path().join("src")).unwrap();
    fs::write(
        dir.path().join("README.md"),
        "# Fixture\nSource-backed test repository\n",
    )
    .unwrap();
    fs::write(
        dir.path().join("src/session.ts"),
        "export function validateSession(token: string) {\n  return token.length > 0;\n}\n",
    )
    .unwrap();
    run(&["add", "."]);
    run(&[
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "base",
    ]);
    let base = run(&["rev-parse", "HEAD"]);
    fs::write(dir.path().join("src/session.ts"), "export function validateSession(token: string) {\n  return token.length > 4;\n}\nexport const active = validateSession('hello');\n").unwrap();
    run(&["add", "."]);
    run(&[
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "head",
    ]);
    let head = run(&["rev-parse", "HEAD"]);
    (dir, base, head)
}

#[test]
fn github_url_types_and_rejection() {
    for (url, kind) in [
        ("https://github.com/owner/repo", "repository"),
        ("https://github.com/owner/repo.git", "repository"),
        ("https://github.com/owner/repo/pull/42/files", "pull"),
        ("https://github.com/owner/repo/commit/abcdef123", "commit"),
        ("https://github.com/owner/repo/tree/feature/auth", "branch"),
        (
            "https://github.com/owner/repo/blob/feature/auth/src/session.ts#L42-L50",
            "file",
        ),
    ] {
        assert_eq!(github::parse(url).unwrap().kind, kind);
    }
    assert_eq!(
        github::parse("https://github.com/o/r/blob/main/a%20b.ts#L42")
            .unwrap()
            .selector,
        "main/a b.ts"
    );
    assert_eq!(
        github::parse("https://github.com/o/r/blob/main/a.ts#L42")
            .unwrap()
            .line,
        42
    );
    for url in [
        "http://github.com/o/r",
        "https://github.com.evil/o/r",
        "https://user:pass@github.com/o/r",
        "https://github.com/o/r/pull/nope",
        "https://github.com/o/r/issues/2",
        "https://github.com/o/r/blob/--upload-pack/x",
    ] {
        assert!(github::parse(url).is_err(), "{url}");
    }
}

#[test]
fn pinned_revision_and_blob_survive_worktree_changes() {
    let (dir, base, head) = fixture();
    let session = Session::open(
        1,
        dir.path().to_str().unwrap(),
        dir.path(),
        Some(&head),
        Some(&base),
    )
    .unwrap();
    fs::write(
        dir.path().join("src/session.ts"),
        "mutated after snapshot\n",
    )
    .unwrap();
    let before = session.document("src/session.ts", "base").unwrap();
    let after = session.document("src/session.ts", "head").unwrap();
    assert!(before.text.contains("> 0"));
    assert!(after.text.contains("> 4"));
    assert_ne!(before.blob, after.blob);
    assert!(Arc::ptr_eq(
        &after,
        &session.document("src/session.ts", "head").unwrap()
    ));
    let diff = diff::diff(&session, "src/session.ts", 3).unwrap();
    assert!(diff["rows"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["kind"] == "add" && r["new"] == 2));
    assert_eq!(
        session
            .snapshot
            .files
            .iter()
            .find(|f| f.path == "src/session.ts")
            .unwrap()
            .status,
        "M"
    );
}

#[test]
fn source_protection_and_large_window_bounds() {
    for path in [
        "../outside",
        "/absolute",
        ".git/config",
        "src/../../escape",
        ".env",
        "nested/.env.local",
        "keys/id_rsa",
        ".kube/config",
    ] {
        assert!(!git::source_allowed(path), "{path}");
    }
    let (dir, _, head) = fixture();
    let session = Session::open(
        1,
        dir.path().to_str().unwrap(),
        dir.path(),
        Some(&head),
        None,
    )
    .unwrap();
    assert!(session.document("../README.md", "head").is_err());
    assert!(session.document("missing.ts", "head").is_err());
    let doc = session::Document::new(
        "blob".into(),
        (0..100000)
            .map(|i| format!("line {i}\n"))
            .collect::<String>()
            .into_bytes(),
    );
    assert_eq!(doc.offsets.len(), 100000);
    assert_eq!(doc.lines(99001, 10)[0], "line 99000");
    assert_eq!(doc.lines(999999, 10).len(), 0);
    assert_eq!(doc.lines(1, usize::MAX).len(), 1000);
    assert!(session::Document::new("binary".into(), vec![0, 255]).binary);
}

#[test]
fn local_diff_rejects_drift_after_source_is_cached() {
    let (dir, _, _) = fixture();
    let session = Session::open(1, dir.path().to_str().unwrap(), dir.path(), None, None).unwrap();
    session.document("src/session.ts", "head").unwrap();
    fs::write(dir.path().join("src/session.ts"), "changed again\n").unwrap();
    assert!(diff::diff(&session, "src/session.ts", 3)
        .unwrap_err()
        .contains("changed after"));
}

#[test]
fn materialized_unpack_preserves_commit_and_source_bytes() {
    let (dir, _, head) = fixture();
    let session = Session::open(
        9123,
        dir.path().to_str().unwrap(),
        dir.path(),
        Some(&head),
        None,
    )
    .unwrap();
    session.start_index();
    let deadline = Instant::now() + Duration::from_secs(10);
    while !session.index.read().unwrap().done {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    let path = session.materialize().unwrap();
    assert_eq!(git::sha(Path::new(&path), "HEAD").unwrap(), head);
    assert_eq!(
        fs::read_to_string(Path::new(&path).join("src/session.ts")).unwrap(),
        session.document("src/session.ts", "head").unwrap().text
    );
}

#[test]
fn progressive_index_declarations_references_and_search() {
    let (dir, _, head) = fixture();
    let session = Session::open(
        1,
        dir.path().to_str().unwrap(),
        dir.path(),
        Some(&head),
        None,
    )
    .unwrap();
    session.start_index();
    let deadline = Instant::now() + Duration::from_secs(10);
    while !session.index.read().unwrap().done {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    let index = session.index.read().unwrap();
    assert!(index
        .symbols
        .iter()
        .any(|s| s.text == "validateSession" && s.line == 1));
    drop(index);
    assert_eq!(
        understanding::search(&session, "validateSession", true).unwrap()["locations"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert!(understanding::overview(&session).unwrap()["locations"]
        .as_array()
        .unwrap()
        .iter()
        .any(|l| l["path"] == "README.md"));
}

#[test]
fn ffi_envelope_errors_and_ownership() {
    for input in ["{}", "{\"version\":99}", "invalid"] {
        let input = CString::new(input).unwrap();
        unsafe {
            let output = codevetter_navigator_request(input.as_ptr());
            assert!(!output.is_null());
            let result: Value = serde_json::from_slice(CStr::from_ptr(output).to_bytes()).unwrap();
            assert_eq!(result["ok"], false);
            codevetter_navigator_free(output);
        }
    }
}

#[test]
fn diff_preserves_old_and_new_line_numbers() {
    let (rows, truncated) =
        diff::parse("--- a/file\n+++ b/file\n@@ -9,2 +10,3 @@\n same\n-old\n+new\n+more\n");
    assert!(!truncated);
    assert_eq!(rows[1].old, Some(9));
    assert_eq!(rows[1].new, Some(10));
    assert_eq!(rows[2].old, Some(10));
    assert_eq!(rows[3].new, Some(11));
    assert_eq!(rows[4].new, Some(12));
}

#[test]
fn fuzzy_prefers_basename_and_accepts_subsequence() {
    let paths = vec![
        "src/session.ts".into(),
        "session/other.ts".into(),
        "README.md".into(),
    ];
    assert_eq!(
        understanding::fuzzy(paths.clone().into_iter(), "session")[0],
        "src/session.ts"
    );
    assert_eq!(
        understanding::fuzzy(paths.into_iter(), "ssts")[0],
        "src/session.ts"
    );
}

#[test]
fn navigation_warm_measurements() {
    let (dir, _, head) = fixture();
    let session = Session::open(
        1,
        dir.path().to_str().unwrap(),
        dir.path(),
        Some(&head),
        None,
    )
    .unwrap();
    session.document("src/session.ts", "head").unwrap();
    let start = Instant::now();
    for _ in 0..1000 {
        session.document("src/session.ts", "head").unwrap();
    }
    eprintln!("warm source cache mean: {:?}", start.elapsed() / 1000);
    let paths: Vec<_> = (0..10000)
        .map(|i| format!("src/module{i}/session{i}.ts"))
        .collect();
    let start = Instant::now();
    understanding::fuzzy(paths.into_iter(), "session42");
    eprintln!("10k-file fuzzy query: {:?}", start.elapsed());
}
