# Invocation ledger source qualification — 2026-10-08

The owner selected direction A, invocation history with a receipt inspector.
The native Runs viewer consumes the Rust-owned invocation projection, keeps
saved verification results separate, and requires an explicit recorder directory.
Single-session inspection validates repository, UUID, schema and captured hash
before reading fixed anchored receipt bytes or a selected JSON field.

Source checks: 29 Rust library tests, 2 CLI parser tests, 6 synthetic CLI checks,
19 scoped Swift tests, Clippy, current CLI build, native Debug preview build,
docs, new-file Swift formatting and diff checks pass. Synthetic/offscreen checks
are source qualification, not installed-app, runtime or causal-benefit evidence.

Native foreground interaction and running-window captures remain pending fresh
idle-screen authorization. The design completion gate remains failing. Controlled
with/without-agent evidence remains unqualified; independent benefit stays unknown.
This change does not close issue #348 or establish a release.
