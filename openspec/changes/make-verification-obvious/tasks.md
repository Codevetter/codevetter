## 1. Language and hierarchy

- [x] 1.1 Define one concise copy set for `Check a change`, Review findings,
  executable evidence, limitations, and `ship` / `hold` / `no confidence`
  without changing factual product claims
- [x] 1.2 Update `docs/product/surfaces.md` and any directly conflicting
  onboarding or navigation documentation to describe the broad workbench and
  its verification-centered path

## 2. Persistent entry and Home arrival

- [x] 2.1 Add one keyboard-accessible, high-attention `Check a change` action
  to the existing desktop navigation without removing destinations, changing
  routes, or breaking `g` shortcuts and persistent route mounting
- [x] 2.2 Keep change verification immediately reachable through the persistent
  shell action; the former duplicated Home spotlight is superseded by the
  focused five-surface shell
- [x] 2.3 Update the command palette so verification terminology and actions
  match the shell; Board is superseded by the focused five-surface direction

## 3. Workflow clarity

- [x] 3.1 Rewrite onboarding welcome and tour copy around repository context,
  change review, executable evidence, and a shipping decision while preserving
  prerequisite and preference behavior
- [x] 3.2 Clarify Review page title, setup action, and empty/result guidance so
  model findings are leads and missing runtime evidence is explicit
- [x] 3.3 Clarify Testing page and navigation language as the runtime-evidence
  stage while retaining its route, expert workflows, and receipt behavior
- [x] 3.4 Place verdict, evidence strength, failed or unverified checks,
  limitations, and next action before secondary Review diagnostics without
  deleting or changing stored evidence

## 4. UI verification

- [x] 4.1 Add focused frontend tests for the persistent CTA, onboarding mental
  model, retained command-palette destinations, and honest missing-evidence
  state; historical Home-spotlight assertions are superseded
- [x] 4.2 Run the smallest relevant desktop unit, lint, typecheck, and route
  checks, then fix only failures caused by this change
- [x] 4.3 Qualify representative empty, partial, completed, keyboard-focused,
  compact-window, and reduced-motion states in the Tauri app as required by
  `desktop-visual-system`
- [x] 4.4 Review the source diff for accidental churn, detector false
  positives, route/state regressions, and unsupported claims

## 5. Real shipping-decision pilot

- [x] 5.1 Create a private case template under
  `.codevetter/verify-artifacts/pilot/` that records task and decision owner,
  exact base/head, environment and CodeVetter identities, predeclared checks,
  receipt/X-Ray references, limitations, outcome, decision, and follow-up
- [ ] 5.2 Case A: verify the Stage 0 context-provider contract/planning change
  after an exact reviewable Git range exists; use the verdict to allow or hold
  review/merge of Stage 0
- [ ] 5.3 Case B: verify this verification-discoverability UI change after an
  exact reviewable Git range exists; use the verdict to include or hold it from
  the next desktop release
- [ ] 5.4 Case C: verify the first provider isolation and contamination adapter
  after implementation and an exact reviewable Git range exist; use the verdict
  to allow or block any Stage 1 provider trial
- [ ] 5.5 Compare the three cases for setup failure, would-have-shipped defects,
  evidence gaps, time to decision, and trust failures; label all results as
  private dogfood and update GitHub issues #55, #58, and #60 only with owner
  approval

## 6. Change validation and handoff

- [x] 6.1 Run strict OpenSpec validation, documentation validation, focused
  product checks, and `git diff --check`
- [ ] 6.2 Record only implemented and verified outcomes in
  `PROJECT_STATUS.md`; do not treat the plan or three dogfood cases as shipped
  product-value evidence
> **Scope reconciliation (2026-08-16):** Work, Board, seven-destination
> navigation, and the duplicated Home spotlight are superseded by
> `focus-desktop-product-surfaces`. Retain the completed Review, Testing,
> evidence-language, and shipping-decision work; do not restore removed shell
> surfaces to satisfy historical assertions.
