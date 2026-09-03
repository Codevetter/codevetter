# Native onboarding receipt

Date: 2026-09-01
Scope: first-run state, tool readiness, default agent, and product orientation

## Result

Native macOS and `codevetter onboarding` now consume one Rust-owned
`codevetter.onboarding/v1` receipt. It reuses the incumbent
`onboarding_complete` preference, so an existing user does not receive a false
first-run experience after migration. Completion transactionally persists only
that shared flag and the already allowlisted `default_adapter` value.

The receipt reports Codex, Claude Code, and GitHub CLI executable presence. It
does not execute those tools, inspect authentication, read credential values,
or expose resolved filesystem paths. Missing tools remain visible limitations
and never become inferred readiness.

The native flow has four states:

1. the execution-backed product standard;
2. bounded local-tool readiness;
3. Codex or Claude Code default-agent selection; and
4. the synchronized app, CLI, and scoped-agent operating model.

The About desk can reopen the tour without clearing or rewriting the completion
flag.

## Verification

- Two Rust service tests prove legacy completion compatibility, credential
  omission, declared-adapter validation, and transactional persistence.
- The CLI parser separates read-only inspection from explicit completion and
  rejects incomplete or unknown-adapter requests.
- An isolated real CLI smoke observed incomplete, completed, and persisted
  inspect receipts without using the live application database.
- Two focused Swift tests prove exact CLI arguments/schema/authority and render
  all four states within the 760 by 600 point native window.
- Strict recursive Swift formatting and the background native package/build
  gate pass.

## Rendered evidence

- Purpose: `evidence/design/native-acceptance-2026-09-01/onboarding-purpose.png`
  (`1520x1200`, SHA-256
  `82daad81c0e6f67279aa41e16e181e6bf9e1a2697e196220f6ca5b0ee37ed688`).
- Agent boundary:
  `evidence/design/native-acceptance-2026-09-01/onboarding-agent.png`
  (`1520x1200`, SHA-256
  `4ae058543eda58a06e2001592647e0bba613eff7d97bf80cabcb9e4d2c3393ea`).

## Remaining boundary

This receipt does not inspect provider authentication, migrate credentials,
authorize an agent run, qualify production signing or updates, establish owner
visual acceptance, or permit Tauri retirement.
