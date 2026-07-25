## Why

CodeVetter's core verification workflow is shipped, but the remaining product
work is fragmented across status notes: evidence still needs real-world
calibration, long-lived local data needs explicit retention, Work needs a
managed execution boundary, and public or scale claims remain gated on missing
qualification. Completing these gaps together turns the current collection of
strong local tools into one durable, measurable verification workbench without
expanding into a general IDE or hosted service.

## What Changes

- Add outcome-backed Repo Unpacked calibration that explains which structural
  and activity movements correlate with later review or QA risk, while keeping
  deterministic evidence distinct from learned guidance.
- Complete the public benchmark workflow for 20-30 adjudicated agent-generated
  pull requests, named comparator artifacts, unverified-fix counts, and
  time/cost impact; keep external claims fail-closed until the checked corpus is
  complete.
- Add bounded, sanitized screenshot/report previews and versioned opt-in public
  graph snapshots without uploading repositories or making network publication
  automatic.
- Add measured age/size retention, dry-run cleanup, pinned/evidence-reference
  preservation, and explicit compaction for archived local session messages and
  their FTS index.
- Add a managed local work harness with provider profile selection, crash-safe
  process registration, isolated worktrees/environments, checkpoints,
  setup/run/archive hooks, port isolation, and integrated diff/check/PR/archive
  handoffs without restoring a terminal cockpit.
- Add explicit intent-closure evidence so a completed work item can record
  whether the original user goal was satisfied and which provider/session
  produced the qualifying change.
- Define and qualify the supported transition from fixture-backed synthetic QA
  to real local product automation; unsupported app classes remain explicit.
- Add reproducible dashboard IPC profiling and worktree cache accounting, then
  consolidate only measured duplicate caches.
- Run the Agent Island repeated-use qualification while keeping it off by
  default, and run the largest available business-rule archaeology scale gate
  without overstating unsupported corpus size.
- Reconcile the canonical docs and retired SaaS Maker task references, archive
  the completed change, and cut the next desktop release only after all required
  checks pass.

No breaking API, schema-destruction, hosted service, repository upload, or new
production dependency is introduced.

## Capabilities

### New Capabilities

- `outcome-risk-calibration`: Evidence contracts for learning and presenting
  repository risk calibration from local review and QA outcomes.
- `local-session-retention`: Measured retention, protected references, dry-run
  cleanup, and explicit compaction for local transcript archives.
- `managed-work-harness`: Crash-safe isolated local execution and lifecycle
  handoffs for Work and Board.
- `intent-closure-evidence`: Explicit evidence connecting a completed change
  back to the user's original goal and producing session.
- `local-performance-governance`: Reproducible dashboard IPC and local cache
  measurement with evidence-based consolidation.

### Modified Capabilities

- `agent-pr-xray`: Require adjudicated real-PR corpus metadata, named comparator
  artifacts, impact fields, and secure bounded artifact previews before public
  claims or gallery promotion.
- `structural-repo-graph`: Add outcome-calibrated guidance and versioned,
  privacy-reviewed opt-in public snapshot export.
- `automatic-verification-observation`: Define the supported real-product
  automation matrix and secure preview behavior beyond fixture-only runs.
- `agent-conversation-workspace`: Add provider-profile and managed-run entry
  points while preserving the conversation-first interface.
- `local-work-board`: Add managed-run checkpoints and integrated
  diff/check/PR/archive handoffs without fabricating evidence.
- `native-agent-island`: Add a recorded repeated-use promotion gate while
  preserving the off-by-default rollout.
- `business-rule-archaeology`: Require the largest available checked scale run
  and explicit unsupported-corpus reporting before larger claims.

## Impact

- Rust/Tauri: local SQLite migrations and commands for retention, calibration,
  managed processes/worktrees, intent closure, profiling, and qualification.
- React: bounded additions to Repo Unpack, Work, Board, Testing, Review/X-Ray,
  and Settings; no new top-level route.
- Tooling and fixtures: benchmark curation, comparator import, performance/cache
  measurement, Agent Island soak qualification, and archaeology scale reports.
- Documentation/OpenSpec: canonical specs, status, benchmark/operations docs,
  and removal or correction of retired SaaS Maker authority references.
- Release: next desktop version and updater artifacts after TypeScript, Biome,
  unit, Rust, Playwright, build, docs, OpenSpec, native-helper, and release
  checks pass.
