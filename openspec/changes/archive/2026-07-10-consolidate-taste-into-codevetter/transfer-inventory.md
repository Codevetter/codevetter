# ShipRank Transfer Inventory

Source revision: `5b06c239f89284871c8e669e01d74023d7b572f1` (`taste/main`)

Target revision: `4b4bfa3c92405e2b8b4612fbf552b589d9164b6f` (`codevetter/main`)

The original worktrees were dirty when consolidation began and were preserved unchanged. ShipRank had modified `src/db/schema.ts` and `src/lib/tasteDataset.ts` plus untracked `drizzle/migrations/0003_label_pairs.sql` and `src/lib/publicLabels.ts`. CodeVetter had unrelated Rust/backend and generated-schema changes plus an untracked `.codex/` directory. Implementation uses isolated worktrees under `/Users/sarthak/Desktop/worktrees/`.

## Transfer Or Adapt Into CodeVetter

| ShipRank asset | Disposition | CodeVetter use |
|---|---|---|
| `src/lib/scoring.ts` signal diagnostics | Port with provenance | Rust evaluation-signal kernel and parity tests |
| `src/lib/types.ts` pairwise/signal contracts | Adapt | Typed Rust and Tauri IPC contracts |
| `src/lib/scoring.test.ts` | Adapt | Comparable-judgment, order, majority, and cycle fixtures |
| `src/lib/report.ts` confidence caveats | Adapt | Staged verification summary and proof export |
| `src/lib/tasteDataset.ts` pair manifest concepts | Adapt | Audience candidate/response contracts; no direct schema copy |
| Current uncommitted label-pair/vote work | Preserve as design input | Local audience runs and provenance-preserving responses; do not apply its D1 migration |
| Pair-review and JSONL tooling concepts | Selectively adapt | Optional import fixtures and future benchmark calibration |
| Research rationale in `docs/` and archived PRD | Preserve reference | Retirement inventory and source-history pointer |

## Archive In ShipRank History

| Asset | Reason |
|---|---|
| `datasets/`, `models/`, capture manifests, and training/report scripts | Useful research evidence, but the current linear ranker is not promoted for production |
| Capture/data-loop runbooks | Historical context for screenshot-aware training and resource inventory |
| Existing report and simulation UI | Reference for signal presentation; CodeVetter receives a smaller native Review surface |
| Arena/study/evaluator fixtures | Product-history evidence; not part of CodeVetter's local verification contract |

## Retire Without Migration

| ShipRank surface | Reason |
|---|---|
| Vite SPA routes, dashboard, study wizard, report pages, Product Arena, evaluator application, admin UI | Standalone product shell is superseded; copying it would create a second product inside CodeVetter |
| Hono Pages Functions and D1 study/arena/evaluator schema | Conflicts with CodeVetter's local-first Tauri/SQLite boundary |
| Cloudflare Pages deployment and standalone capture Worker/R2 path | CodeVetter already owns local browser/screenshot evidence; cloud resources require separate decommission approval |
| SaaS Maker auth/device flow, planned Stripe/email/marketplace work | Standalone SaaS concerns are no longer in scope |
| Unpromoted `TASTE_RANKER_MODEL_JSON` production routing | Promotion gate is not met; retain only as research history |

## External Resource Inventory (Read-only, 2026-07-10)

- Cloudflare Pages project `shiprank` exists at `shiprank.pages.dev`; current production deployment `8d479e8f-07ba-4e9d-a8f4-ef0a79aed9e9` uses source `e3854bf` and returns HTTP 200.
- D1 `shiprank-db` exists as `b535a229-2995-45ce-9ca9-2ca76f3b2a30` with 16 tables, approximately 180 kB, and zero reads/writes in the preceding 24 hours.
- Worker `taste-capture` does not exist.
- R2 bucket `taste-captures` does not exist.
- No taste/ShipRank queue exists.
- GitHub `sarthak-fleet/taste` is public, on `main`, and not archived.
- `shiprank.dev` is an unrelated Vercel-hosted leaderboard and is not attached to the Cloudflare Pages project; it must not be touched.

No external resource was changed by this inventory. Exact proposed closure actions remain gated: export then delete D1, delete the Pages project, and archive rather than delete the GitHub repository.
