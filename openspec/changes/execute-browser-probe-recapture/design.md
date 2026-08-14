## Context

See [proposal.md](./proposal.md). A v20 Playwright diagnosis now carries the
exact next-probe name and server-request ordinal, and the inspector verifies the
durable receipt/result/snapshot before projection. The autonomous lab already
owns local Vite/Next startup, attestation, exact Playwright capture, remote HTTP
denial, and cleanup. Ordinary browser-server presentation retains eight async
resources and eight framework phases per request; High Signal produced twelve
async observations, so the common completeness probe currently cannot resolve
that presentation gap.

## Goals / Non-Goals

**Goals:**

- Make one high-frequency next probe executable end to end.
- Reuse existing qualification and owned-runtime safety instead of accepting
  caller-supplied commands.
- Persist an integrity-bound recapture receipt with an explicit evidence result.
- Demonstrate that ordinary captures retain their current size bounds.

**Non-Goals:**

- Execute every emitted probe in this change.
- Modify application source, generate patches, or authorize optimization.
- Replace Playwright assertions or make a failed flow correct.
- Connect to production, cloud infrastructure, databases, or App Health.

## Decisions

### Start with inventory completion

The operation initially admits only
`complete_async_and_framework_inventories`. This is the real probe emitted by
the current High Signal flow and can be satisfied by a bounded presentation
change; main-thread/Worker/native source-profile probes require different
instrumentation and remain unsupported rather than being treated as aliases.

Alternative: accept every known probe and recapture identically. Rejected
because a renamed repeat that gathers no new evidence is not executable
debugging.

### Resolve the exact flow from durable identity

The operation validates the prior durable capture, then qualification must find
one candidate whose target, name, and browser project equal the captured scope.
The caller supplies no test path, command, base URL, or runtime family.

### Add an expanded closed presentation profile

`createBrowserServerFlowSummary` receives a closed presentation profile. The
ordinary profile remains 8/8; the inventory-completion profile retains at most
32 async resources and 32 representative framework phases. Full captured
inventories still drive interval union, so presentation expansion cannot alter
accounting.

Alternative: globally raise the ordinary cap. Rejected because it increases
every capture and hides that extra evidence was intentionally requested.

Alternative: claim completeness from aggregated counts alone. Rejected because
agents need source-bearing and response-lineage observations for later probes.

### Use a separate durable probe receipt

The operation writes
`.codevetter/browser-probe-runs/<recapture-id>/receipt.json` atomically after
the runtime is stopped. It binds prior/new capture identity, source snapshot,
probe, ordinal, outcome, cleanup, and capture receipt/result hashes. The new
Playwright capture remains authoritative for detailed evidence.

### Return evidence outcome, not success theatre

The result distinguishes `evidence_completed`, `evidence_incomplete`,
`flow_failed`, `stale`, and `operational_failure`. Evidence completion never
overrides the new Playwright state. Authority remains low, non-causal,
edit-ineligible, and correctness-required.

## Risks / Trade-offs

- **[The expanded cap still truncates a large flow]** → Preserve exact totals
  and return `evidence_incomplete`; do not loop or increase the cap dynamically.
- **[Development runtime variance]** → Bind runtime configuration and keep the
  existing local-development limitation in the receipt.
- **[A prior failed test fails again]** → Preserve the new diagnosis and
  evidence outcome, but do not authorize editing.
- **[Runtime leaks after errors]** → Use `finally` cleanup and make cleanup
  failure terminal even if capture evidence exists.
- **[Old captures lack v20 ordinal identity]** → Reject them; do not infer from
  route display strings.

## Migration Plan

Add the profile and operation without changing the ordinary capture default.
Rollback removes the recapture operation and expanded profile; existing
Playwright receipts remain readable and probe-run receipts are inert local
artifacts. No application or database migration is required.
