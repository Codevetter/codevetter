## Why

CodeVetter can produce evidence-backed local review findings, but outsiders cannot inspect a compact artifact that proves what it caught, what it verified, and what remains uncertain on a real agent-authored pull request. A sanitized Agent PR X-Ray makes the desktop product's strongest output shareable while preserving the local-first, no-server architecture.

## What Changes

- Add a local export workflow that turns a completed public-PR review into a deterministic, sanitized verification packet.
- Report changed behavior, trusted impact paths, relevant checks run, verified claims, missing proof, and unresolved review risks with links back to public source context.
- Emit portable Markdown and self-contained static HTML suitable for attaching to a pull request, benchmark case, or marketing example.
- Add explicit redaction and provenance rules so local paths, credentials, prompts, private repository content, and model secrets cannot enter a public artifact by default.
- Dogfood the packet on fleet pull requests, compare its claims against actual review and CI outcomes, and curate 20–30 public cases including misses before making catch-rate claims.
- Keep hosted arbitrary-URL analysis, private-code upload, accounts, and a new server out of scope; the initial public gallery is made from reviewed static artifacts.

## Capabilities

### New Capabilities

- `agent-pr-xray`: Local generation, sanitization, validation, and export of a shareable PR verification packet plus the proof-corpus rules for publishing reviewed examples.

### Modified Capabilities

- `staged-change-verification`: Preserve structured verification evidence needed by the exported X-Ray, including check outcomes and explicit missing-proof states.

## Impact

- Desktop: review-result normalization and an export action in the existing Review workflow.
- Rust/TypeScript boundary: typed export payload, sanitizer, deterministic renderer, and file-save path using existing Tauri IPC patterns.
- Landing/benchmark surfaces: static example artifacts and corpus metadata; no runtime analysis service.
- Quality: golden export fixtures, secret/redaction tests, provenance checks, and reviewed dogfood cases.
- No production dependency, hosted backend, repository upload, or release is part of this proposal.
