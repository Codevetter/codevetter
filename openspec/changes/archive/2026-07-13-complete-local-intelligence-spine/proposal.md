## Why

CodeVetter already persists live session messages, command anchors, file-level history explanations, and a verification timeline, but those slices stop at command-only replay and one-file summaries. Completing the three authoritative local PRD continuations turns the existing archive into a coherent evidence spine: fresh transcript evidence, bounded surrounding conversation, and queryable file/decision/commit/test/finding relationships.

## What Changes

- Formalize and verify the existing best-effort live transcript tail path so active Claude/Codex evidence reaches the local archive and UI promptly, with full-index recovery after missed events; do not add a duplicate watcher or dependency unless measured evidence shows the current 10-second incremental path is insufficient.
- Reconstruct bounded non-command conversation windows around raw-session command/replay anchors from the normalized local message archive, preserving source/session/message references and privacy-safe excerpts.
- Attach those conversation windows to Review history, verification-timeline replay packets, jump targets, segment fix packets, and reviewer proof without dumping full transcripts into the primary UI.
- Build a deterministic, bounded local history graph over files, commits, decisions, recurring findings, agent-session notes, commands, and tests.
- Add local file/query commands and Repo/Review surfaces that answer file-centric “why does this exist?” questions with ranked nodes, relationships, citations, confidence, and explicit truncation.
- Keep all work local-only and deterministic; exclude hosted sync, GitHub-app ingestion, team packaging, generic knowledge-graph expansion, and new production dependencies.

## Capabilities

### New Capabilities

- `live-session-evidence`: Best-effort incremental transcript ingestion, archive-update events, and full-index recovery for active local sessions.
- `conversation-reconstruction`: Bounded non-command conversation windows around verification replay anchors, exposed through Review timeline and proof contracts.
- `queryable-history-graph`: Deterministic local history graph construction and bounded file/text queries with cited explanations.

### Modified Capabilities

- None.

## Impact

- Rust session/history indexing, local SQLite queries, git/history context commands, Repo Unpacked history artifacts, and Tauri command registration.
- Typed frontend IPC, Review timeline/proof construction, Repo history UI, and focused unit/runtime tests.
- Existing local database/archive schemas remain backward-compatible; no network, hosted integration, migration requiring user action, deployment, or production dependency is introduced.
