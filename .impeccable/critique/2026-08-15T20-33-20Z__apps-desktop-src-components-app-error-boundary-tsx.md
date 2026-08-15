---
target: apps/desktop/src/components/app-error-boundary.tsx
total_score: 35
maximum: 40
p0: 0
p1: 0
p2: 1
method: dual-agent
timestamp: 2026-08-15T20-33-20Z
slug: apps-desktop-src-components-app-error-boundary-tsx
---
# CodeVetter crash recovery critique

## Method

Dual-agent review: a detector-blind visual/heuristic assessment plus an independent detector and responsive-browser evidence pass. The final state was then rechecked at 390, 768, and 1440 px after resolving the review findings.

## Nielsen assessment — 35/40

| Heuristic | Score | Final assessment |
| --- | ---: | --- |
| Visibility of system status | 3 | The interruption, local receipt, and copy status are explicit; repeated retry has no attempt counter. |
| Match to the real world | 4 | Scope-aware language and plain recovery actions describe what happened and what each action does. |
| User control and freedom | 3 | Retry, reload, and Usage escape cover the common exits; Usage remains a best-effort app route. |
| Consistency and standards | 4 | Uses the established ink surface, amber action, semantic rose state, type, buttons, and focus treatment. |
| Error prevention | 3 | The boundary contains the failure and avoids unsupported safety claims; it does not add a repeated-failure safe mode. |
| Recognition over recall | 4 | Actions are visible and retry/reload behavior is stated directly. |
| Flexibility and efficiency | 3 | Keyboard recovery and copyable diagnostics are available without exposing raw details by default. |
| Aesthetic and minimalist design | 4 | The hierarchy stays focused: interruption, recovery, then local evidence. |
| Error recognition and recovery | 4 | Scope, three recovery routes, incident identity, and technical evidence are all visible. |
| Help and documentation | 3 | Technical details support reporting, but no dedicated troubleshooting route is present. |

## Cognitive load — 8/8

The surface has one focus, three clearly grouped recovery choices, a short behavioral explanation, and progressive disclosure for diagnostics. No decision point exceeds four choices.

## Accessibility and responsive evidence

- Focus moves to the recovery heading on mount; the next Tab reaches the primary recovery action.
- The full-page alert was narrowed to the interruption announcement, leaving controls outside the live alert.
- Muted metadata uses the higher-contrast zinc-400 token.
- Axe reported no critical or serious violations in the focused Playwright check.
- Document scroll width matched client width at 390, 768, and 1440 px.

## Findings resolved

- **P1 resolved:** removed the categorical claim that the repository was unmodified. The UI now states that repository state was not checked.
- **P1 resolved:** application-shell failures now always expose a Return to Usage action in addition to retry and reload.
- **P2 resolved:** recovery takes focus, metadata contrast was raised, and retry versus reload behavior is explained.

## Remaining advisory item

- **P2:** if the same render failure repeats, the surface does not yet count attempts or escalate to a dedicated safe mode. This is a future reliability enhancement, not a blocker for the bounded recovery layer.

## Detector and integrity

The advisory detector returned an empty result (`[]`) across the recovery component and entry point. No production dependency was added, raw error messages and stacks are not persisted, and repository/query data is excluded from the local incident receipt.
