---
title: Review pipeline
description: The review → fix → re-review → proof flow and how findings are produced.
sidebar:
  order: 4
---

# Review pipeline

The review engine is **TypeScript running in the webview**. Rust shells out to
git and CLI agents but does not score findings.

## Flow

```
repo path / PR branch
        │
        ▼
get_local_diff  (Rust: commands/review.rs → git diff)
        │
        ▼
build prompt  (TS: review-service.ts + active standards pack)
        │
        ▼
CLI agent subprocess  (Rust: agent/ spawns claude-code / codex / gemini -p)
   ├─ risk-tiered passes:
   │     trivial single-pass → lite product/agent → full sensitive-path
   │     (security + product + agent specialists + coordinator + dedup)
   │
        ▼
parse findings  (TS: ReviewFinding[] with score + fingerprint)
        │
        ▼
coordinator dedup  (token-similarity clustering on same-file near-line)
        │
        ▼
save_review  (Rust → SQLite: local_reviews + local_review_findings)
        │
        ▼
UI: QuickReview editor-primary layout + verdict sidebar
```

## Risk tiers

- **Trivial** — single pass, no specialists.
- **Lite** — product + agent passes.
- **Full / sensitive path** — security, product, and agent specialist passes
  plus a coordinator pass and dedup metadata.

Tier selection is driven by the changed-file set (sensitive paths trigger the
full tier).

## Coordinator dedup

Replaced exact `file:line:title` dedup with **same-file near-line
token-similarity clustering**, calibrated on real duplicate pairs from the
first benchmark run. This is what flipped the head-to-head vs raw Claude on
precision and F1 (see [development/benchmark.md](../development/benchmark.md)).
Three regression tests guard the clustering.

## Fix loop

1. User selects findings (dismissed findings are excluded from bulk selection).
2. `agent-fix-packet` is built from selected findings: goal, acceptance
   criteria, non-goals, browser/QA evidence refs, usage-routing advice.
3. Fix attempts run in **isolated git worktrees** (Rust `sandbox.rs`).
4. Re-review runs the same pipeline against the fix diff.
5. Per-finding re-check status: `fixed` / `reproduced` / `unchecked`.

## Verification proof

The Review screen emits a copyable reviewer handoff (`review-proof` +
`agent-fix-packet`) containing:

- Per-finding evidence (file/line, artifact, level, notes) with status icons.
- Fixed / reproduced / unchecked tallies.
- A `### Next actions` checkbox list derived from unchecked + reproduced +
  unticked revalidation items.

Staged review → executable test → audience-validation produces one
evidence-linked aggregate outcome with explicit stage waivers. See
[product/synthetic-user-qa.md](../product/synthetic-user-qa.md) for the
runtime evidence layer.

## Standards packs

`StandardsPack` (`review-service.ts`) groups checks by focus
(`product-safety`, `security-boundary`, …). The active pack is persisted in
user settings (`codevetter_review_config` localStorage key, mirrored to Tauri
preferences) and linked to reviews via `local_reviews.standards_pack`. The
Rubrics page (`/rubrics`) handles pack authoring, exact prompt preview,
per-pack usage stats, and cloning.

## Key files

- `apps/desktop/src/lib/review-service.ts` — config, standards packs, orchestration entry.
- `apps/desktop/src/lib/agent-fix-packet.ts` — fix packet construction.
- `apps/desktop/src/lib/review-proof.ts` — verification handoff.
- `apps/desktop/src/lib/quick-review-*.ts{x}` — QuickReview state, code, format, procedure.
- `apps/desktop/src/components/quick-review/` — 13 panels (setup, editor, findings, fix diff, verification summary, audience, synthetic QA, history context, review memory graph, evidence insights, create preview, agent status timeline).
- `apps/desktop/src-tauri/src/commands/review.rs` — diff, save, fix worktrees.
- `apps/desktop/src-tauri/src/agent/` — CLI agent subprocess spawning.
