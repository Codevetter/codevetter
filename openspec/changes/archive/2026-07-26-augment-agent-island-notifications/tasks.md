## 1. Presentation state

- [x] 1.1 Add explicit collapsed, user-expanded, and automatic presentation state with a pure trusted-event transition selector.
- [x] 1.2 Reconcile automatic presentation against later snapshots without overriding user-owned expansion.
- [x] 1.3 Add cancellable informational auto-collapse with pointer entry and exit handling.

## 2. Native interface

- [x] 2.1 Keep automatic presentation non-activating while preserving keyboard focus behavior for explicit user expansion.
- [x] 2.2 Add the collapsed team-status rail with bounded markers, overflow count, and complete accessibility context.
- [x] 2.3 Add short reduced-motion-safe structural transitions without animating AppKit panel geometry.

## 3. Qualification and documentation

- [x] 3.1 Extend Swift self-tests for event novelty, priority, manual ownership, preview suppression, resolution, pointer-safe collapse, and team rail ordering.
- [x] 3.2 Run the Swift helper self-test and existing Agent Island qualification command.
- [x] 3.3 Update canonical Agent Island architecture and project status with the unreleased behavior and public-reference boundary.
- [x] 3.4 Run strict OpenSpec, documentation, formatting, and diff validation, then sync and archive the completed change.
