---
title: SEO sprint
description: Phased organic-search roadmap for codevetter.com — demand-mapped page coverage, competitor comparisons, and evidence-corpus scale.
---

# SEO sprint — CodeVetter

Initialized 2026-09-22 from the Fleet scoreboard (`seo-scoreboard.mjs
--project codevetter`): **403 impressions, 2 clicks, mean position ~37**
over 28 days. Google is already serving us on the right terms — the gap is
coverage depth and position, not topic selection.

## Demand evidence (Search Console, 28d ending 2026-09-18)

| Cluster | Queries seen | Impressions | Position |
| --- | --- | --- | --- |
| Validation | `ai code validation`, `validating agent generated code`, `coding agent validation` | ~57 | 66–95 |
| Verification | `ai code verification`, `verify code in agent loop`, `coding verification`, `deterministic code verification` | ~29 | 47–98 |
| Benchmarks | `ai code review benchmark`, `code review benchmark`, `codexglue benchmark`, `coding agent refactoring benchmark` | ~6 | 50–79 |
| Detection | `check if code is ai`, `is this ai generated code` | ~2 | 72–77 |

Rules that keep this honest:

- One canonical page per intent — no near-duplicate keyword variants that
  would cannibalize `/verify-ai-generated-code` or `/coding-agent-verification`.
- Competitor pages quote the vendor's own docs with a checked-on date and
  publish no invented head-to-head numbers (same standard as
  `/codevetter-vs-coderabbit`).
- Evidence pages (`/xray/*`, `/benchmark`) are generated from the
  `benchmarks/public-catch-rate/` corpus, never hand-invented.

## Phases

- [x] **Phase 1 — demand-mapped coverage + corpus scale**
  - `xray-examples.json` regenerated from the full 27-case catch-rate
    corpus (was 3 hand-written) via `scripts/sync-xray-examples.mjs` →
    27 evidence pages + Markdown mirrors.
  - New `/ai-code-validation` page targeting the largest open cluster
    (validation phrasing; disambiguates review vs validation vs
    verification rather than duplicating existing pages).
- [ ] **Phase 2 — competitor comparison matrix.** `codevetter-vs-*`
  pages for the tools developers actually evaluate against: Qodo Merge,
  Sourcery, Cursor Bugbot, Copilot code review, Korbit, Bito, Ellipsis,
  cubic. Each entry needs its own docs-checked claims — batch draft, then
  verify quotes before publishing.
- [ ] **Phase 3 — benchmark cluster depth.** Per-language case pages
  (the corpus spans ts/py/go/rust), a `code review benchmark` explainer
  comparing recognition fixtures vs repository-task benchmarks
  (SWE-bench lineage), and the codexglue-style "coding agent benchmark"
  explainer.
- [ ] **Phase 4 — internal-link lattice.** Once phase 2 pages exist,
  cross-link every comparison page to the nearest evidence page
  (`/xray/<case>`) and the benchmark methodology.

## Measurement

- Site Health `search` family: per-term position for the four clusters
  above; expect validation cluster pos 83→<40 within ~6 weeks of indexing.
- Site Health `github` family: referrer entries from codevetter.com.
- Indexing: submit new routes via `pnpm --dir site-health indexing submit
  --project codevetter --sitemap` after deploy.
