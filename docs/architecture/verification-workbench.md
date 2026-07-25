---
title: Verification workbench evidence
description: Additive identity, lifecycle, retention, and performance records that connect CodeVetter's existing specialist surfaces.
---

# Verification workbench evidence

The verification workbench connects Repo Unpacked, Work, Board, Review,
Testing, session history, and release qualification without replacing any of
their authoritative records. Its tables are additive evidence and lifecycle
records. Moving a card, launching an agent, or computing a correlation does not
create review or verification proof.

## Identity map

| Record | Existing authority | Stored link | Stale condition |
|---|---|---|---|
| Outcome calibration observation | Repo snapshot plus review, QA, procedure, or bug outcome | Repository identity, snapshot IDs, outcome kind and ID | Repository/schema identity is incompatible, time order is invalid, or the source record is unavailable |
| Outcome calibration summary | Versioned observation set | Stable summary identity and contributing source IDs | Its observation set, policy, or repository identity changes |
| Session retention pin | Indexed local session | `cc_sessions.id` | The session is removed through its existing owner lifecycle |
| Session retention plan/run | Current archive and protected-reference set | Archive fingerprint plus full bounded plan | Archive rows, policy, or protected references change after preview |
| Managed work run | Local Board work item | `agent_tasks.id`, provider/session identity, repository revision, worktree, process owner token | Process start identity, Git worktree metadata, repository revision, or owner token no longer matches |
| Managed checkpoint | Managed work run | Run ID, monotonic sequence, exact change identity, bounded command/evidence | The worktree change identity advances |
| Intent closure | Board work item plus Review/Testing evidence | Work item, producing session/run, change identity, review and verification IDs | Repository or diff identity advances after the decision |
| Performance receipt | Repository-owned qualification | Git revision, fixture identity, machine and measurement payload | Code, fixture, machine class, or measurement policy changes |

The joins deliberately use existing string identities instead of copying
provider messages, repository source, findings, screenshots, or command output
into the workbench tables.

## Additive tables

- `outcome_calibration_observations` stores one versioned feature/outcome join,
  including explicit exclusions.
- `outcome_calibration_summaries` stores sample-aware local guidance and links
  back to its observation IDs.
- `session_retention_pins` records explicit local preservation.
- `session_retention_runs` stores dry-run plans and append-only apply/rejection
  receipts. Provider-owned JSONL transcripts are outside this cleanup boundary.
- `managed_work_runs`, `managed_work_port_reservations`, and
  `managed_work_checkpoints` describe isolated local execution. They do not
  authorize commit, push, PR creation, or worktree removal.
- `intent_closure_receipts` records an explicit human disposition. Automated
  evidence can make the decision easier to review but cannot mark intent
  satisfied.
- `local_performance_receipts` stores redacted, versioned benchmark and cache
  measurements.

## Stale-state rules

All mutable work is read against its current repository or archive identity:

1. Compute the current identity from the authoritative source.
2. Compare it with the persisted evidence identity.
3. If it differs, preserve the old receipt and label it stale.
4. Require a new plan, checkpoint, qualification, or closure decision.

Stale evidence is never rewritten to appear current. A failed or cancelled
refresh leaves the last complete evidence readable.

## Privacy and lifecycle boundaries

- Calibration reads aggregate local evidence and never upgrades a finding.
- Retention removes only CodeVetter's normalized archive projection after an
  explicit, current dry-run plan.
- Managed runs use owned processes and isolated worktrees; recovery fails
  closed if ownership cannot be proven.
- Intent closure stores the goal, criteria, identities, disposition, and
  bounded reason—not hidden reasoning or raw terminal output.
- Performance receipts use redacted fixtures and aggregate timings/bytes.
- Public artifacts are generated separately through sanitized export
  contracts; no workbench table uploads data.

## Measured qualification

The 2026-07-25 release-candidate qualification produced local evidence with
these explicit boundaries:

- The dashboard IPC benchmark completed 25 cold and warm release-profile reads
  with no errors and a 26,836-byte response. Cold latency measured 24.327 ms
  p50, 27.234 ms p95, and 27.325 ms maximum; warm latency measured 23.334 ms
  p50, 24.073 ms p95, and 24.713 ms maximum on an 18-logical-CPU arm64 Mac.
  Because the live database was locked by the running app, the benchmark used
  a SQLite-consistent local snapshot and did not alter the live database.
- Disk accounting measured 36,571,503,947 bytes across the checked roots:
  17,301,822,907 bytes of Rust targets, 16,402,499,355 bytes in the user pnpm
  store, 518,141,523 bytes in the workspace pnpm store, and 2,349,040,162
  bytes of Playwright cache. No exact duplicate cache root was found, so
  consolidation performed no move and recorded an empty rollback.
- The Native Agent Island repeated-use gate passed 120 snapshots across all six
  statuses and all six action identities. It measured 82 ms p95, 0.12% idle
  CPU, 53.75 MiB RSS, zero false actions, and passing duplicate/stale,
  crash/fallback, continuity, and parent-exit checks. The helper remains off by
  default because qualification does not substitute for a separate promotion
  decision.
- Full-repository business-rule archaeology preserved the source identity and
  persisted its exact report, but failed closed at the existing
  `Archaeology linker persisted input bound exceeded` limit. This result does
  not support an 18M-line or 100,000-rule claim.
- The public agent-PR corpus contains 20 schema-ready, provenance-pinned cases.
  Each records the exact missing authenticated capture for CodeVetter,
  CodeRabbit free tier, and Claude Code `/review`. The production-pipeline
  comparison remains unrun for this corpus, so no external catch-rate,
  quality, time, token, or cost claim is authorized.
