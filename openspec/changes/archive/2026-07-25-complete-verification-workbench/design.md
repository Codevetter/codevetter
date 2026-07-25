## Context

CodeVetter already has local review, warm verification, synthetic QA, repository
graphs, Work conversations, Board items, Agent PR X-Ray export, and the native
Agent Island. The remaining work is not another top-level product surface. It
is the evidence and lifecycle layer that connects those capabilities:

- Repo metrics describe change but do not yet have a durable, sample-aware
  relationship to downstream review and QA outcomes.
- Transcript archives and FTS can grow indefinitely.
- Work can launch providers and Board can track work, but neither owns a
  crash-safe isolated execution lifecycle.
- Benchmark and public-export mechanisms exist, but the real-PR corpus,
  comparator provenance, impact measures, and safe rich previews are incomplete.
- Scale and native promotion claims have explicit gates but incomplete current
  evidence.

The implementation must remain desktop-only, local-first, `rusqlite`-backed,
dependency-light, and honest about missing evidence. Existing Review, Testing,
Repo, Work, and Board surfaces remain authoritative.

## Goals / Non-Goals

**Goals:**

- Make downstream outcome calibration reproducible, sample-aware, local, and
  explainable.
- Bound transcript storage without silently deleting pinned or referenced
  evidence.
- Give Work and Board a managed, resumable execution boundary built from
  existing provider, worktree, and verification primitives.
- Make intent satisfaction an explicit evidence decision rather than an
  inferred completion badge.
- Complete the benchmark curation and comparator contracts needed for public
  claims, while failing closed when external evidence is unavailable.
- Provide safe local previews and explicit export packages without automatic
  upload.
- Measure dashboard IPC and cache growth before consolidating anything.
- Produce reproducible Agent Island and archaeology qualification receipts.
- Ship the completed work through the existing signed updater path.

**Non-Goals:**

- A general IDE, terminal multiplexer, hosted agent runner, CI enforcement
  service, marketplace, or multi-tenant collaboration system.
- Automatic repository upload, gallery deployment, public graph hosting, or
  external marketing claims.
- Treating correlations as causation, inferred intent as verified intent, or a
  synthetic scale fixture as proof of an unavailable real corpus.
- Adding a Go service or production dependency without measured need and
  separate approval.
- Silently running arbitrary repository commands or deleting user history in
  the background.

## Decisions

### 1. Additive evidence tables, not overloaded status columns

Add versioned local records for calibration observations/models, retention
plans/runs, managed runs/checkpoints, intent-closure decisions, and performance
receipts. Existing `agent_tasks`, `cc_sessions`, review, QA, and graph records
remain authoritative and are referenced by stable IDs.

This avoids turning workflow stages into evidence and permits append-only audit
history. The alternative—adding more nullable columns to existing rows—would
make provenance, reruns, and stale-state handling ambiguous.

### 2. Calibration is local descriptive guidance with hard sample gates

Calibration derives versioned feature deltas from comparable Repo Unpacked or
Activity snapshots and joins them to later exact-repository review, QA, and
procedure outcomes. The first implementation uses deterministic grouped rates,
effect direction, confidence bounds, time windows, and minimum sample/support
thresholds. It does not introduce a remote model or opaque classifier.

The UI labels results `insufficient`, `descriptive`, or `qualified`; it always
shows sample size, outcome definitions, time window, exclusions, and source
records. Correlation can recommend where to inspect but cannot create findings,
change severity, or upgrade verification.

### 3. Retention is plan-first and reference-aware

Retention computes a dry-run plan from configurable age and byte limits.
Sessions remain protected when pinned, attached to active Work/Board items, or
referenced by persisted review, QA, intent, X-Ray, or history evidence. Apply is
an explicit user action and records counts/bytes/reasons. Base archive rows and
FTS entries are removed in one transaction, followed by an explicit checkpoint
and optional `VACUUM` only when requested and safe.

Defaults remain conservative. There is no startup purge and no source JSONL
deletion. Re-indexable source history and CodeVetter's local projection are
reported separately.

### 4. Managed runs reuse existing provider and sandbox boundaries

Managed runs compose, rather than replace:

- provider profile discovery and PTY/app-server launch;
- Board work item identity and acceptance criteria;
- existing isolated worktree creation and local exclusion;
- repository-owned setup/check commands;
- warm verification, Review, diff, and history evidence;
- explicit Git/PR/archive actions.

Each run persists an owner token, provider/profile, repository and base revision,
worktree/environment identity, reserved ports, process identity, hooks, state,
and checkpoints. On restart, CodeVetter verifies OS process and Git worktree
identity before reattaching; ambiguity fails closed. Hooks are bounded,
displayed before launch, use no shell interpolation by default, and never
commit, push, open a PR, or remove a worktree without an explicit action.

Work stays conversation-first. Board displays concise lifecycle/checkpoint
evidence and links to the authoritative specialist surface instead of embedding
a cockpit.

### 5. Intent closure is an explicit human decision supported by evidence

Each work item may record a versioned original goal, acceptance criteria,
producing provider/session/run, exact change identity, linked review and
verification, and a human disposition: `satisfied`, `partially_satisfied`,
`not_satisfied`, or `waived`, with a reason.

CodeVetter may deterministically highlight unmet acceptance criteria or stale
evidence, but it never auto-marks intent satisfied and never exposes hidden
reasoning. A newer change identity makes the closure stale.

### 6. Real-product QA graduates through an explicit support matrix

Real local automation is permitted only when a project declares a supported
app class, start/health contract, owned loopback target, authentication/state
fixture boundary, first-party network policy, deterministic scenario manifest,
and cleanup contract. The current React/Vite/Chromium lane is the first
qualified class. Unsupported frameworks remain fixture-backed or manual and
are labeled accordingly.

This resolves the open product question: synthetic QA moves beyond fixtures per
app class after the class passes repeatability, isolation, observation,
cancellation, resource, and cleanup gates—not on a calendar date.

### 7. Public artifacts are generated locally from one sanitized payload

Screenshot/report previews use a backend projection that validates canonical
paths, allowlisted content types, size/dimension bounds, and ownership by the
selected evidence record. Text is escaped; HTML is never executed; images are
decoded through the platform webview with no external references.

Public graph export produces a versioned, sanitized JSON manifest plus static
SVG/PNG and Markdown link metadata from an explicit graph snapshot. Export is
local and opt-in. Publishing or deploying remains a separate owner action.

### 8. Benchmark cases and comparator results are immutable evidence packages

Each real-PR case pins repository, PR URL, base/head SHAs, license/public status,
diff fixture, hand labels, adjudicator, exclusions, and timestamps. Comparator
imports name the tool/version/tier, exact captured output, run time, available
token/cost data, and capture method. Missing CodeRabbit or Claude access is
reported as an unfilled comparator slot, never synthesized.

Scoring adds unverified-fix count and time/cost impact only when the artifact
contains those values consistently. The public claim gate requires the minimum
adjudicated corpus and every mandatory comparator/provenance field.

### 9. Performance work is receipt-driven

A repository-owned profiler records bounded p50/p95/max latency and serialized
bytes for dashboard IPCs against a redacted fixture, plus disk use for Cargo,
Playwright, package-manager, worktree, and CodeVetter artifact caches.
Consolidation is limited to exact duplicate caches with reversible configuration
and before/after receipts. A Go service is not considered in this change.

### 10. Promotion and scale gates record non-claims

Agent Island qualification replays deterministic lifecycle/action fixtures,
then records bounded repeated local-use sessions, false-action count, crashes,
latency, CPU, RSS, and fallback behavior. The feature remains off by default
unless the promotion threshold passes and a separate product decision enables
it.

Archaeology runs the largest available checked corpus with exact identity and
records what it proves. If no 18M-line/100,000-rule corpus is available, the
receipt explicitly says that claim remains unsupported.

## Risks / Trade-offs

- **The program is broad and could create an oversized diff** → Implement in
  independently testable slices behind additive contracts; stop release if any
  required slice is incomplete.
- **Calibration can look more certain than the data permits** → Hard sample
  gates, confidence labels, visible exclusions, and a prohibition on verdict
  upgrades.
- **Retention can remove useful context** → Dry-run first, protected reference
  traversal, conservative defaults, transactional FTS cleanup, and no source
  transcript deletion.
- **Managed hooks can execute unsafe commands** → Exact argument vectors,
  displayed repository-owned commands, bounded time/output, no implicit
  publish/destructive actions, and explicit per-run confirmation.
- **Worktree/process recovery can attach to the wrong resource** → Persist and
  verify repository, base revision, owner token, process start identity, and
  worktree metadata before recovery.
- **Real public comparator access may be unavailable** → Preserve empty named
  slots with actionable capture instructions; do not weaken the claim gate.
- **Rich artifact previews can leak local data** → Evidence ownership checks,
  path canonicalization, strict bounds, redaction, and no executable HTML.
- **Full release qualification is expensive** → Run narrow checks per slice,
  then the existing release matrix once at the end.

## Migration Plan

1. Add additive schema objects and migrations; old application versions ignore
   them and existing records remain readable.
2. Implement backend contracts and focused unit tests before exposing controls.
3. Add bounded UI controls and Playwright coverage without changing default
   routes or enabling Agent Island.
4. Add benchmark/qualification fixtures and generate checked receipts.
5. Run TypeScript, Biome, frontend unit, Rust, targeted Playwright, production
   build, docs, OpenSpec, helper, and release qualification.
6. Archive the OpenSpec change, reconcile `PROJECT_STATUS.md`/`STATUS.md`, bump
   the Tauri version, and push the release commit.
7. If release verification fails, leave the prior `v1.5.4` updater manifest
   authoritative and fix forward; the additive local schema requires no
   destructive rollback.

## Open Questions

- Availability of real CodeRabbit free-tier and Claude Code `/review` captures
  is an external qualification input. Missing access blocks that comparator
  slot and external claims, not local product operation.
- Availability of an exact 18M-line/100,000-rule corpus is an external scale
  input. The implementation will record the largest available checked gate and
  the unsupported larger claim explicitly.
