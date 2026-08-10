---
target: Usage telemetry evidence tiers
total_score: 36
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
timestamp: 2026-08-10T18-31-57Z
slug: apps-desktop-src-pages-home-tsx
---
## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 4 | Verified, partial, stale, pending, and loading states are written explicitly. |
| 2 | Match system / real world | 3 | API-equivalent remains specialist language, now explained as not subscription spend. |
| 3 | User control and freedom | 4 | Reconcile and recovery settings are available at the diagnosis. |
| 4 | Consistency and standards | 4 | One reconciliation verb now owns the refresh path. |
| 5 | Error prevention | 4 | Legacy, ambiguous, stale, and unpriced data cannot masquerade as verified. |
| 6 | Recognition rather than recall | 4 | Recovery settings are linked in context. |
| 7 | Flexibility and efficiency | 3 | Aggregate categories are not yet drillable to individual sources. |
| 8 | Aesthetic and minimalist design | 4 | Evidence hierarchy is compact and uses the incumbent workbench language. |
| 9 | Error recovery | 3 | Recovery is complete, but source-level diagnostics remain aggregate. |
| 10 | Help and documentation | 3 | Inline pricing and recovery explanations cover the main uncertainty model. |
| **Total** | | **36/40** | **Excellent** |

## Design Specificity Verdict

The result is authored for CodeVetter's Evidence Bench. Accepted transcript observations,
scanner revision, observation watermark, exact/ranged/unpriced pricing, and explicit legacy
exclusion make the surface an evidence instrument rather than a generic analytics card.

The deterministic detector returned five `gray-on-color` warnings in Home.tsx and none in
Settings.tsx. All five are contextual false positives: the background is translucent over ink or
the slate text classes are mutually exclusive with the cyan active state. Verified detector issue
count: zero.

## Overall Impression

The trusted number leads, uncertainty is written rather than hidden, and recovery is attached to
the diagnosis. The remaining opportunity is source/session drill-down, not another visual layer.

## What's Working

- Verified totals and legacy estimates are structurally separated.
- Cost bounds explain unknown service tier and disclaim subscription spend.
- Recovery is one bounded flow: import roots, then re-index and reconcile.

## Priority Issues

- **P2 — Aggregate diagnostics are not drillable.** Users can see affected counts but not the
  source identities. Add a source-detail disclosure after the read cutover is qualified.
- **P3 — Narrow screenshots compress below the product contract.** The Tauri app enforces a 900px
  minimum; 390px is retained as evidence but is not a supported window state.

## Persona Red Flags

- **Alex:** source-level evidence is not yet inspectable from the aggregate.
- **Sam:** the cost range is now explicitly API-equivalent and not subscription spend; written
  partial coverage does not rely on color.
- **Riley:** import persistence failures are announced and the recovery action returns to a single
  reconciliation path.

## Minor Observations

- Legacy period estimates remain expanded for continuity; a later release may collapse them once
  users have migrated to verified reads.
- The app's documented and configured minimum width is 900px, so mobile-shell adaptation is out of
  scope for this macOS desktop viewer.

## Questions to Consider

- Should the next qualified iteration expose the exact sessions behind each unresolved tier?
- Once verified coverage stabilizes, should the legacy blended summary become collapsed by default?
