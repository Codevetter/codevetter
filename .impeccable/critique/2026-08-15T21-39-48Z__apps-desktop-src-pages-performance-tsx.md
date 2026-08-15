---
timestamp: 2026-08-15T21-39-48Z
slug: apps-desktop-src-pages-performance-tsx
---
# Performance workbench critique

Target: `apps/desktop/src/pages/Performance.tsx`

## Outcome

- Design heuristic score: 35/40 (good, near excellent).
- Automated detector: 0 findings.
- Responsive qualification: no horizontal overflow at 390, 768, or 1440 px.
- Accessibility structure: one main landmark, labelled workload controls, labelled evidence region, and accessible form names.
- Final severity: 0 P0, 0 P1.

## Resolved during critique

- Added a real same-scope paired-verification action and verdict-driven campaign states.
- Invalidated stale evidence when scope fields or the selected repository change.
- Cancelled and discarded late receipts from a prior repository generation.
- Added truthful blocked, failed, and no-confidence recovery states.
- Separated observed, inferred, and unverified evidence without truncating captured rows.
- Raised low-contrast operational copy and removed empty machine-detail rows.

## Evidence

- `artifacts/design/product-surfaces-after-390.jpg`
- `artifacts/design/product-surfaces-after-768.jpg`
- `artifacts/design/product-surfaces-after-1440.jpg`
