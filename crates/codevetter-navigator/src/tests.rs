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
fn branch_picker_resolves_merge_base_without_changing_checkout() {
    let (dir, base, head) = fixture();
    let root = dir.path();
    let index = fs::read(root.join(".git/index")).unwrap();
    git::git(root, &["update-ref", "refs/heads/feature/auth", &head]).unwrap();
    let other = git::text(
        root,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit-tree",
            &format!("{base}^{{tree}}"),
            "-p",
            &base,
            "-m",
            "parallel base",
        ],
    )
    .unwrap();
    git::git(root, &["update-ref", "refs/remotes/origin/main", &other]).unwrap();
    git::git(
        root,
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        ],
    )
    .unwrap();
    let catalog = branches::list(root).unwrap();
    assert_eq!(catalog["current"], "refs/heads/main");
    assert_eq!(catalog["default_base"], "refs/remotes/origin/main");
    assert_eq!(catalog["branches"].as_array().unwrap().len(), 3);
    let cache = tempfile::tempdir().unwrap();
    let opened = request(
        json!({"version":1,"operation":"open","input":root,"cache":cache.path(),
        "revision":"refs/heads/feature/auth","base":"refs/remotes/origin/main","mergeBase":true}),
    )
    .unwrap();
    assert_eq!(opened["head"], head);
    assert_eq!(opened["base"], base);
    assert_eq!(opened["kind"], "commit");
    assert_eq!(git::text(root, &["rev-parse", "HEAD"]).unwrap(), head);
    assert_eq!(fs::read(root.join(".git/index")).unwrap(), index);
    assert!(branches::comparison(root, "missing", "HEAD").is_err());
    assert!(branches::comparison(root, "main", "--help").is_err());
    let orphan = git::text(
        root,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit-tree",
            &format!("{base}^{{tree}}"),
            "-m",
            "unrelated",
        ],
    )
    .unwrap();
    assert!(branches::comparison(root, &orphan, &head).is_err());
    request(json!({"version":1,"operation":"close","session":opened["id"]})).unwrap();
    git::git(root, &["update-ref", "--no-deref", "HEAD", &head]).unwrap();
    assert!(branches::list(root).unwrap()["current"].is_null());
}

#[test]
#[cfg(target_os = "macos")]
fn semantic_native_alias_shadowing_unicode_and_revision() {
    let (dir, base, head) = fixture();
    fs::write(
        dir.path().join("tsconfig.json"),
        r#"{"compilerOptions":{"paths":{"@app/*":["./src/*"]},"strict":true},"include":["src"]}"#,
    )
    .unwrap();
    fs::write(dir.path().join("src/types.ts"), "export interface Session { token: string }\nexport function authenticate(): Session { return {token: 'ok'}; }\n").unwrap();
    fs::write(dir.path().join("src/use.ts"), "import { authenticate as login } from '@app/types';\nconst emoji = '😀'; const session = login();\nsession.token;\nfunction isolated(login: () => number) { return login(); }\n").unwrap();
    let cache = tempfile::tempdir().unwrap();
    let opened =
        request(json!({"version":1,"operation":"open","input":dir.path(),"cache":cache.path()}))
            .unwrap();
    let server = std::env::var_os("CODEVETTER_NAVIGATOR_TEST_SERVER")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../artifacts/navigator-typescript/lib/tsc")
        });
    assert!(
        server.is_file(),
        "Run pnpm navigator:build to stage the pinned TypeScript worker"
    );
    let navigate = |path: &str, line: usize, column: usize, operation: &str| {
        request(json!({"version":1,"operation":"semantic","session":opened["id"],"path":path,"line":line,"column":column,"query":operation,"server":server})).unwrap()
    };
    let source = "const emoji = '😀'; const session = login();";
    let column = source[..source.find("login()").unwrap()]
        .encode_utf16()
        .count();
    let start = Instant::now();
    let definition = navigate("src/use.ts", 2, column, "definition");
    assert_eq!(
        definition["locations"][0]["path"], "src/types.ts",
        "{definition}"
    );
    assert_eq!(definition["locations"][0]["line"], 2);
    eprintln!("Native semantic cold definition: {:?}", start.elapsed());
    let property = navigate("src/use.ts", 3, 9, "definition");
    assert_eq!(
        property["locations"][0]["path"], "src/types.ts",
        "{property}"
    );
    assert_eq!(property["locations"][0]["line"], 1);
    let shadow = navigate("src/use.ts", 4, 49, "definition");
    assert_eq!(shadow["locations"][0]["path"], "src/use.ts", "{shadow}");
    assert_eq!(shadow["locations"][0]["line"], 4);
    let references = navigate("src/use.ts", 2, column, "references");
    assert!(
        !references["locations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["path"] == "src/use.ts" && v["line"] == 4),
        "{references}"
    );
    assert!(references["locations"].as_array().unwrap().len() >= 2);
    fs::write(
        dir.path().join("src/types.ts"),
        "changed outside the immutable semantic snapshot",
    )
    .unwrap();
    let start = Instant::now();
    for _ in 0..100 {
        assert_eq!(navigate("src/use.ts", 2, column, "definition"), definition);
    }
    eprintln!("Native semantic warm mean: {:?}", start.elapsed() / 100);
    request(json!({"version":1,"operation":"close","session":opened["id"]})).unwrap();
    let pinned = request(json!({"version":1,"operation":"open","input":dir.path(),"cache":cache.path(),"revision":head,"base":base})).unwrap();
    for side in ["base", "head"] {
        let response = request(json!({"version":1,"operation":"semantic","session":pinned["id"],"path":"src/session.ts","side":side,"line":2,"column":9,"query":"definition","server":server})).unwrap();
        assert_eq!(response["locations"][0]["line"], 1, "{response}");
    }
    request(json!({"version":1,"operation":"close","session":pinned["id"]})).unwrap();
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

#[test]
#[ignore = "Explicit live public GitHub qualification; requires network"]
fn live_public_github_import() {
    let cache = tempfile::tempdir().unwrap();
    for url in [
        "https://github.com/octocat/Hello-World",
        "https://github.com/octocat/Hello-World/blob/master/README#L1",
        "https://github.com/octocat/Hello-World/tree/master",
        "https://github.com/octocat/Hello-World/pull/1",
        "https://github.com/octocat/Hello-World/commit/7fd1a60",
    ] {
        let start = Instant::now();
        let session = Session::open(1, url, cache.path(), None, None).unwrap();
        let path = session.snapshot.initial_path.as_ref().unwrap();
        let doc = session.document(path, "head").unwrap();
        eprintln!(
            "LIVE {url}: {:?}, {} files, head {}, blob {}, {} bytes",
            start.elapsed(),
            session.snapshot.files.len(),
            session.snapshot.head,
            doc.blob,
            doc.text.len()
        );
        assert!(!doc.text.is_empty());
        if url.contains("/pull/") {
            assert!(session.snapshot.base.is_some());
            assert!(session.snapshot.files.iter().any(|f| !f.status.is_empty()));
        }
    }
}

#[test]
fn indexed_search_p95_measurement() {
    let (dir, _, head) = fixture();
    let session = Session::open(
        1,
        dir.path().to_str().unwrap(),
        dir.path(),
        Some(&head),
        None,
    )
    .unwrap();
    {
        let mut index = session.index.write().unwrap();
        for i in 0..1000 {
            let text =
                "export function sample(value: string) { return value.length > 0; }\n".repeat(100);
            index.documents.push((
                format!("src/module{i}.ts"),
                Arc::new(session::Document::new(format!("{i}"), text.into_bytes())),
            ));
        }
        index.done = true;
    }
    let mut samples = Vec::new();
    for _ in 0..50 {
        let start = Instant::now();
        understanding::search(&session, "no_match_entire_corpus", false).unwrap();
        samples.push(start.elapsed());
    }
    samples.sort();
    eprintln!(
        "6.4 MB / 1000 indexed files / 100000 lines / 50 misses: p95 {:?}",
        samples[47]
    );
}

#[test]
#[ignore = "Explicit live regular-repository import and indexing qualification"]
fn live_regular_repository_index() {
    let cache = tempfile::tempdir().unwrap();
    let start = Instant::now();
    let session = Session::open(
        44,
        "https://github.com/expressjs/express",
        cache.path(),
        None,
        None,
    )
    .unwrap();
    let doc = session
        .document(session.snapshot.initial_path.as_ref().unwrap(), "head")
        .unwrap();
    eprintln!(
        "EXPRESS first source {:?}, {} files, {} bytes, {}",
        start.elapsed(),
        session.snapshot.files.len(),
        doc.text.len(),
        session.snapshot.head
    );
    session.start_index();
    let deadline = Instant::now() + Duration::from_secs(120);
    while !session.index.read().unwrap().done {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(50));
    }
    let index = session.index.read().unwrap();
    eprintln!(
        "EXPRESS indexed {} files / {} bytes / {} excluded in {:?}",
        index.files,
        index.bytes,
        index.skipped,
        start.elapsed()
    );
    assert!(index.files > 20);
    assert!(!index.symbols.is_empty());
    drop(index);
    let result = understanding::search(&session, "createApplication", true).unwrap();
    assert!(!result["locations"].as_array().unwrap().is_empty());
    let source = session.materialize().unwrap();
    assert_eq!(
        git::sha(Path::new(&source), "HEAD").unwrap(),
        session.snapshot.head
    );
    eprintln!("EXPRESS Unpack snapshot ready, same HEAD");
    if let Ok(cli) = std::env::var("CODEVETTER_NAVIGATOR_QUALIFY_CLI") {
        let output = Command::new(cli)
            .args(["unpack", "--operation", "scan", "--repo", &source, "--json"])
            .env(
                "CODEVETTER_APP_DATA_DIR",
                cache.path().join("isolated-unpack-state"),
            )
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(receipt["schema_version"], "codevetter.unpack-scan/v1");
        assert_eq!(receipt["inventory"]["commit_sha"], session.snapshot.head);
        assert!(receipt["inventory"]["files_scanned"].as_u64().unwrap() > 20);
        eprintln!(
            "EXPRESS existing Unpack CLI: {} files scanned, exact source SHA preserved",
            receipt["inventory"]["files_scanned"]
        );
    }
}
