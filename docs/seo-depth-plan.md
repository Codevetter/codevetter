---
title: "SEO depth plan — flagship"
description: "Evidence-backed organic plan for codevetter.com: publish verifiable benchmark receipts, deepen competitor comparisons, expand the xray demo library."
sidebar:
  order: 90
---

# CodeVetter SEO depth plan — flagship

Source of truth: `~/.fleet` ledgers via `seo-scoreboard.mjs` (28-day window ending
2026-09-18): **403 imp · 2 clicks · avg pos 37** — Google associates us with
the right queries but ranks us page 5–9.

## What the queries say

| Query | Imp | Pos | Intent |
|---|---:|---:|---|
| ai code review benchmark | 1 | 75 | eval comparison — wants real numbers |
| ai code validation / verification | 44 | 76–89 | category-defining searches — we own this framing |
| codexglue benchmark | 3 | 50 | named-benchmark lookup — we should BE this |
| code evaluator / check if code is ai | 2 | 62–77 | adjacent, weaker fit |

The queries at pos 50–90 are exactly the category CodeVetter defines
("verification, not another LLM opinion"). Nobody ranks a page without
authority there — the moat is **verifiable evidence nobody else can publish**.

## The play: become the evidence source, not another comparison page

`/codevetter-vs-*`, `/verify-ai-generated-code`, `/xray/*` already exist.
The gap is that they assert instead of prove. Depth = real artifacts:

### Phase 1 — publish real benchmark evidence (highest leverage)

- Repo already has `benchmarks/` + `evidence/` + `/benchmark/optimization/*`
  pages running fleet products through the verifier. Publish the corpus as a
  first-class, citable artifact: `codevetter.com/benchmarks/<suite>` with the
  raw evidence bundle linked (the `.json` receipt is the differentiator —
  "here is the proof, verify it yourself").
- One "AI code review benchmark" page: run the same task set through the
  verifier, publish pass/fail evidence per finding class. This is the page
  "ai code review benchmark" and "codexglue benchmark" are looking for.
  It only wins if the numbers are real — do not publish synthetic results.

### Phase 2 — deepen the vs-pages with receipts

- `codevetter-vs-coderabbit`, `codevetter-vs-greptile`: add a concrete
  verdict section — "what each tool can prove vs. claim" with one worked
  example per competitor (an AI-written bug each tool missed or caught, with
  the evidence bundle attached). Opinionated is fine; fabricated is fatal.
- `/ai-code-review-vs-verification` → expand into the category pillar
  ("verification vs review" glossary + decision guide).

### Phase 3 — xray demo library as the long tail

- `/xray/*` pages are the proof-of-product. Expand to one demo per bug class
  CodeVetter catches (race conditions, injection, auth bypass, flaky tests) —
  each with the failing trace and the verification receipt. These pages are
  what engineers link to.

### Phase 4 — indexing follow-through

- 67 queued URLs churn via the daily agent; homepage is indexed. Watch
  `pnpm --dir site-health indexing status --project codevetter` weekly and
  investigate coverage states that read `Discovered — currently not indexed`
  on the new evidence pages (they signal "Google saw it, didn't think it was
  worth it" = deepen the page).

## Rules

- Every claim needs a runnable receipt or a link to the evidence bundle.
  Marketing copy without proof is exactly what CodeVetter exists to distrust.
- Don't chase "ai code review" head terms yet — own "verification/evidence/
  benchmark for coding agents" first; the review crowd follows.
- Register every shipped page: `seo-scoreboard.mjs register --project
  codevetter --lane editorial|programmatic --summary "…" --target <url>`.
