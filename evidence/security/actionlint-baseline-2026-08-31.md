# Actionlint and ShellCheck qualification — 2026-08-31

This receipt qualifies repository workflow validation; it is not product
runtime evidence.

## Tool identity

| Tool | Version | License | Qualified artifact |
|---|---|---|---|
| actionlint | 1.7.12 | MIT | Darwin arm64 archive SHA-256 `aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f` |
| ShellCheck | 0.11.0 | GPL-3.0 | Linux x86-64 archive SHA-256 `b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6` |

The CI lane uses actionlint's publisher-provided Linux x86-64 checksum
`8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`.
ShellCheck's release does not publish a checksum file; its hardcoded digest was
qualified from the GitHub release asset fetched through the authenticated
GitHub API.

## First audit

The initial full-workflow audit found three findings:

- `ci.yml`: SC2046 identified an unquoted computed ccusage binary path. The
  target is now captured separately and the complete executable path is quoted.
- `weekly.yml`: two SC2129 style findings identified repeated redirects to
  `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY`. Each set now uses one bounded group
  redirect.

The complete rerun exits zero with no ignored rules. The permanent
`repository-security.yml` job downloads both exact binaries, verifies their
hashes, and runs actionlint with ShellCheck discovery enabled. No application
dependency or product-runtime invocation was added.

## Companion pedantic zizmor audit

Running zizmor 1.29.0 with `--offline --pedantic` after actionlint exposed one
remaining shell-template expansion, workflow-level write permissions, missing
concurrency controls, undocumented permission purposes, and unnamed jobs. The
workflows now pass the structural findings. The remaining output is the four
low-confidence cache-poisoning heuristics on trusted deploy/release workflows
plus two informational suggestions to replace the pinned Rust toolchain action
with runner shell commands. The publish jobs now disable or omit dependency and
toolchain caches, eliminating all four cache findings. The informational
suggestions were not applied: retaining one maintained, commit-pinned setup
action is clearer than duplicating toolchain setup shell logic.
