## Why

The autonomous performance lab can prove that a candidate is correct for its
declared scopes and materially faster, but it can still preserve unnecessary
implementation complexity or describe an external pull request as healthy
without reading inline maintainer feedback. The Marked optimization exposed
both failures and also showed that performance, T-Rex flow verification, patch
quality, and upstream contribution state need independent, revision-bound
verdicts.

## What Changes

- Add a mandatory post-promotion candidate challenge that records observable
  complexity, requires either a simpler-candidate comparison or a bounded
  not-applicable reason, and refuses publication while patch quality is
  unqualified.
- Add a closed, SHA-bound optimization contribution receipt that keeps
  performance, correctness, patch quality, T-Rex, checks, reviews, approvals,
  merge authority, and artifact freshness separate.
- Add read-only GitHub contribution inspection for checks and thread-aware
  review evidence, including actionable current threads, outdated threads,
  approval-required workflows, external-preview authorization, and terminal PR
  state.
- Compose an existing T-Rex receipt as optional browser-flow correctness
  evidence. When supplied, its source head must match the optimization
  candidate and its failure or no-confidence verdict cannot be overridden by a
  speedup.
- Invalidate derived contribution evidence when the PR head changes and retain
  the prior receipt as history.
- Expose the new behavior through dependency-free JSON CLI and repository-
  scoped MCP operations, with documentation and a Marked-shaped hermetic
  qualification fixture.
- Keep the workflow entirely author-side by default: maintainers do not install
  CodeVetter, add repository configuration, receive bot comments or reminders,
  resolve CodeVetter-owned checks, or review raw local receipts.
- Keep the first implementation local and operator-triggered: it does not post
  comments, resolve reviews, merge PRs, deploy previews, poll in the background,
  or execute hosted load tests.

## Capabilities

### New Capabilities

- `optimization-contribution-closeout`: Defines candidate simplification,
  SHA-bound contribution receipts, thread-aware upstream inspection, optional
  T-Rex evidence composition, invalidation, and honest terminal states.

### Modified Capabilities

None. T-Rex continues to produce its canonical receipt unchanged; this change
consumes that receipt without weakening the existing automatic-change-
verification contract.

## Impact

- Extends `scripts/runtime-failure-capsule/` campaign contracts, service, CLI,
  MCP, tests, and operator documentation.
- Reads public or already-authorized GitHub pull-request metadata through the
  existing local `gh` CLI; it adds no production dependency or credential
  store.
- Reads an explicitly supplied repository-contained T-Rex receipt but does not
  launch T-Rex or a preview itself.
- Adds no GitHub App, required check, webhook, maintainer configuration, bot
  identity, or automated PR message.
- Adds no desktop route, database migration, hosted service, deployment,
  production configuration, paid-model call, or automatic network workload.
- Implements the active scope of GitHub issue #111. Adjacent issues #52, #97,
  and #105 remain independently evidence-gated and will be reconciled after
  qualification rather than closed by association.
