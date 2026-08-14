## Context

See [proposal.md](./proposal.md). Probe recapture receipts bind the prior and new
capture, exact request, source snapshot, presentation profile, evidence outcome,
correctness, runtime cleanup, and linked capture digests. The linked Playwright
receipt already binds its normalized result byte count, digest, and compact
diagnosis. Two real High Signal recaptures are compatible at that level but
select different post-recapture routes around the 0.20 CPU-ratio threshold.

## Goals / Non-Goals

**Goals:**

- Convert repeated recaptures into one deterministic stability decision.
- Detect disagreement without another execution or LLM interpretation.
- Preserve exact metric observations needed to understand threshold proximity.

**Non-Goals:**

- Automatically run missing repetitions.
- Smooth, average, majority-vote, or retune diagnosis thresholds.
- Follow the selected probe or authorize source changes.
- Compare different flows, snapshots, probes, profiles, or runtime policies.

## Decisions

### Load by recapture ID only

The operation resolves only
`.codevetter/browser-probe-runs/<id>/receipt.json`, validates the closed receipt,
then validates the fixed linked Playwright receipt hash and result through the
existing loader. Arbitrary paths are not accepted.

### Use strict compatibility

Compatibility requires identical subject revision/snapshot, source capture ID
and receipt hash, source probe, exact request ordinal/method/route, target/name/
project, timeout-independent presentation policy, and completed requested
evidence. Recapture IDs and timing values are expected to differ.

### Use unanimity, minimum three

Three unanimous routes are the smallest stable result. Two matching routes are
insufficient; any disagreement among two to five is unstable immediately. This
is deliberately stricter than majority voting because the operation is a probe
selection gate, not a noisy performance estimator.

### Retain threshold evidence without inference

Each compact run retains request preparation wall time, preparation process CPU,
CPU-to-wall ratio, classification, next probe, evidence outcome, correctness,
and cleanup. The assessment reports min/max ratio and distance to the existing
0.20 boundary only when values exist; it does not claim that proximity caused
the disagreement.

### Keep follow-up eligibility narrower than stability

`follow_up_eligible` requires stable routing, every included requested evidence
outcome complete, and every Playwright correctness outcome passed. It still does
not grant edit authority.

## Risks / Trade-offs

- **[Strict unanimity withholds some useful routes]** → Prefer one extra local
  measurement over sending an agent down a noisy branch.
- **[Three runs can still be unrepresentative]** → Keep confidence low and all
  production/scale claims out of scope.
- **[Older or hand-written receipts fail]** → Reject rather than infer missing
  identity or trust unverified paths.
- **[Read-only assessment becomes an execution loop]** → Do not auto-run missing
  repetitions in this capability; return a bounded next action.

## Migration Plan

Add the read-only operations without changing recapture or diagnosis behavior.
Rollback removes the assessment surface; all existing receipts remain valid
local artifacts. No data or application migration is required.
