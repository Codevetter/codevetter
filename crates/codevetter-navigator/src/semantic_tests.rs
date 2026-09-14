use super::*;

#[test]
fn lsp_framing_is_bounded_and_rejects_truncation() {
    let value = json!({"id":1,"result":"😀"}).to_string();
    let frame = format!("Content-Length: {}\r\n\r\n{value}", value.len());
    assert_eq!(read_frame(&mut frame.as_bytes()).unwrap()["result"], "😀");
    for invalid in [
        "Content-Length: 99999999\r\n\r\n",
        "Content-Length: 10\r\n\r\n{}",
        "Content-Length: invalid\r\n\r\n",
    ] {
        assert!(read_frame(&mut invalid.as_bytes()).is_err());
    }
    assert!(read_frame(&mut "X".repeat(9000).as_bytes()).is_err());
    assert!(!source_file("node_modules/plugin/index.js"));
    assert!(!source_file(".ssh/private.ts"));
}

#[test]
#[cfg(target_os = "macos")]
fn sandbox_denies_outside_reads_writes_and_network() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let source = outside.path().join("public-test.txt");
    std::fs::write(&source, "public sandbox fixture").unwrap();
    let output = sandboxed_command(Path::new("/bin/cat"), root.path())
        .unwrap()
        .arg(&source)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    let forbidden = root.path().join("should-not-exist");
    let output = sandboxed_command(Path::new("/usr/bin/touch"), root.path())
        .unwrap()
        .arg(&forbidden)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(!forbidden.exists());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let output = sandboxed_command(Path::new("/usr/bin/curl"), root.path())
        .unwrap()
        .args([
            "--noproxy",
            "*",
            "--max-time",
            "1",
            &format!("http://{}", listener.local_addr().unwrap()),
        ])
        .output()
        .unwrap();
    assert!(!output.status.success());
    listener.set_nonblocking(true).unwrap();
    assert!(
        listener.accept().is_err(),
        "The sandbox must deny even a localhost connection"
    );
}
