---
title: Native memory inspection qualification
description: Evidence for the bounded read-only Memories contract shared by Rust, CLI, and the native macOS client.
---

# Native memory inspection qualification

## Verdict

Qualified for bounded, read-only list, read, and Git-diff inspection through
the Rust core, `codevetter memories`, and native Settings. This does not grant
memory editing, arbitrary-path access, or agent/MCP content authority.

## Shared contract

- Schema: `codevetter.memories/v1`.
- Rust discovers known memory locations and returns only sources that exist.
- Sources are selected by deterministic opaque SHA-256 identity. Receipts do
  not expose absolute filesystem paths.
- At most 128 sources, 512 KiB per read, and 120,000 output characters enter a
  receipt. Truncation remains explicit.
- Content and Git-diff lines that look secret-bearing are redacted
  heuristically. Displayed memory must still be treated as private.
- Swift validates schema, operation, source identity, bounds, display paths,
  and mutually exclusive read/diff payloads before rendering.

## Reproducible verification

The command smoke used a repository-owned synthetic fixture with isolated
`HOME` and `CODEX_HOME`. It checked 79 supported candidate locations, returned
one existing fixture source, emitted no absolute path, and replaced the fixture
secret line with `[redacted secret-like line]`. No operator memory file was
read by the smoke.

Focused Rust tests pass for opaque identity, path projection, and content/diff
redaction. The CLI parser test passes for separate list, read, and diff
operations. The current quiet native lane passes 80 Swift package tests with
zero failures plus the Debug macOS build; the suite covers exact CLI arguments,
receipt validation, bounded private rendering, filtering, copying, and the
read/diff boundary.

## Visual evidence

- Dark: `evidence/design/native-acceptance-2026-09-01/settings-memories.png`,
  SHA-256 `8a39a2affa1e5471277717883752e88761363580bf97c215b5199b05dd8cafb8`.
- Light: `evidence/design/native-acceptance-2026-09-01/settings-memories-light.png`,
  SHA-256 `73b4ef2b59a23acb98b1d75d5144cb16999df0763bdee613da06e4eb5afe5e88`.
- Both renders are 2560x1600 and are included in the deterministic 33-state
  owner-review manifest.

## Limits

Redaction is defensive and heuristic, not a confidentiality proof. The native
surface does not create, edit, or delete memories. The agent and MCP surfaces
cannot read memory contents. Git diff is available only for an admitted source
already tracked by its containing repository. Final owner visual acceptance
and production release gates remain separate.
