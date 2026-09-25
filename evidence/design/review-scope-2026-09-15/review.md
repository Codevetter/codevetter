# Review comparison repair — 2026-09-15

Tracking: [#285](https://github.com/Codevetter/codevetter/issues/285), tasks 9–11.
Owner request: branch/base dropdowns after selecting a repository and an obvious
way to ask for a review. Implemented locally; no commit, push, installation or release.

## Design decision

Preserve lane: reuse the current native shell, source layout, compact pickers,
typography and colors. The owner supplied the specific interaction to repair;
this is not a new visual system. Historical verification-setup styling reference:
../native-acceptance-2026-09-01/review-intent.png (not a pixel baseline of the navigator).

The comparison bar now sits above the diff. Local and remote-tracking branches
are discovered read-only, bounded to 2,000 refs. Show diff pins merge-base/head
without checkout or fetch. Review change opens the existing verification setup
with that exact range locked; instructions and reviewer remain editable.
Changing a comparison disables eligibility for an old plan. Refresh retains
the applied branch/base. Repository changes clear scope and prior proof.

Local changes are explicitly worktree-vs-HEAD inspection. The existing verifier
requires committed source and a clean checkout at the selected head, and does not
silently verify another branch. Remote PR/commit context stays pinned; imported
source without a base is not falsely presented as a change comparison.
The Cancel action is shown only for an active review, not background metadata reads.

## Verification

- Final `pnpm test:native:background`: 109 Swift tests, 15 navigator Rust tests,
  all five isolated performance gates, native Debug build passed. Two explicit
  live-network navigator tests were skipped.
- Focused regression covers branch catalog, exact base/head handoff, pending
  selection, refresh, missing refs, repository switch and old-plan eligibility.
- Rust fixture verifies divergent-branch merge-base, detached HEAD, unrelated
  history rejection, invalid refs, and unchanged original HEAD/index.
- Final branch test and navigator Clippy with warnings denied passed after the
  multiple-merge-base rejection refinement; navigator library rebuilt.
- Documentation and diff whitespace checks passed. Complexity gate reported
  no applicable files (it does not establish Swift/Rust complexity coverage).

The first broader run failed the existing Usage hosted-render gate at
51.655 ms p95 versus the unchanged 50 ms budget. Final isolated Usage p95 was
30.054 ms; all final gates passed. Preserve this variance under #288 rather than
discarding the failed observation. No Usage performance code or threshold changed
as part of the Review repair.

## Native visual review

Screenshots are synthetic repository fixtures, not a real agent review or
verification verdict. Full-window captures cover 980, 1280 and 1440 points in
dark and light appearance. The 390/768 captures isolate the responsive comparison
bar; they are not claims of whole-app phone-sized support. The native minimum
window remains 980×640. Setup controls remain in the existing scrollable form.

The full-suite offscreen pass showed missing cached text in some screenshots;
the isolated render test was rerun and its complete renders were inspected and
retained here. This is a render-harness observation, not proven installed-app behavior.
Plan may appear disabled during fixture background initialization; eligibility
is separately tested, and no agent or executable review was started by this test.

Manual native fallback critique: **34/40** (continuity 9, hierarchy 9, scope clarity 9,
compact layout 7). Audit: **17/20** (read-only scope 4, identity/handoff 4, state
honesty 4, native label/layout inspection 3, interaction qualification 2).
No observed P0/P1 in the scoped checks. These are manual judgments, not
Impeccable output or full accessibility certification. Impeccable is unavailable.
The preserve-lane design receipt validator passed.

Foreground dropdown clicks, keyboard-to-pixel timing, and end-to-end provider
execution remain unqualified on this invocation; no fresh idle-screen approval
was inferred. No additional VoiceOver work. Existing Usage changes were preserved.
