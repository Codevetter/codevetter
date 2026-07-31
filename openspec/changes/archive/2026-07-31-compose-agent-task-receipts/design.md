## Context

The v2 runner receipt already binds the task manifest, fixture, acceptance
contract, adapter, environment, lifecycle, checks, output hashes, regressions,
cleanup, limitations, and optional diagnostics. The structural-context scorer
has the pairing and qualification rules needed for issue #53, but its input is
currently a hand-authored monolithic manifest. See `proposal.md` for the
motivation and the delta specs for observable behavior.

The implementation must remain local, shell-free, bounded, dependency-free,
and compatible with existing direct evaluator manifests.

## Goals / Non-Goals

**Goals:**

- Make raw v2 receipts the authoritative source for run outcomes.
- Keep experiment metadata and graph-context declarations explicit and
  immutable without duplicating receipt-owned fields.
- Reject invalid evidence before any score artifact is written.
- Make score provenance sufficient for deterministic rescoring and audit.

**Non-Goals:**

- Launching real providers or generating new runner receipts.
- Changing qualification thresholds or adding a second scorer.
- Publishing a result, enforcing the workflow in CI, or adding UI.
- Claiming the synthetic composition fixture is product evidence.

## Decisions

### Use a small composition bundle instead of extending raw receipts

The bundle references the corpus root, adapter files, and raw receipts while
declaring pair/arm/order and structural-context metadata. These are experiment
facts that the provider-neutral runner cannot know at launch time. Keeping them
outside the receipt preserves one runner format across experiments.

Alternative: add comparison and graph fields to the runner receipt. Rejected
because it couples task execution to one evaluator and would require agents to
be launched with scorer-specific metadata.

### Derive task and adapter fields from immutable artifacts

Task titles, packets, acceptance checks, manifest identities, and agent/model
labels are loaded from the validated corpus and adapter. The bundle declares
only the repository revision and experiment-specific fields. This avoids
hand-copying values that could drift.

Alternative: duplicate a full evaluator task/run record in the bundle.
Rejected because the duplicate could contradict the raw evidence while still
looking structurally valid.

### Compose first, then invoke the existing scorer

The composer validates artifact hashes, projects one standard evaluator
manifest, calls the existing manifest validator and scorer, and refuses export
if the scorer reports invalid pairs. Missing required checks are rejected
before scoring because issue #53 requires export to fail closed rather than
merely classify the run as incomplete.

Alternative: implement score calculations in the composer. Rejected because it
would create competing outcome and qualification authority.

### Hash canonical evidence and the actual scorer source

The derived artifact records hashes of the bundle bytes, corpus index, sorted
acceptance identities, projected manifest, raw receipt files, and scorer module
bytes. A stable scorer version remains human-readable while the source hash
captures exact implementation changes.

Alternative: version strings alone. Rejected because a source change could
silently alter results without a version bump.

### Write only after all validation and scoring succeeds

The CLI renders deterministic canonical JSON in memory, then uses an atomic
temporary-file rename for `--out`. Raw receipts and bundle artifacts are never
rewritten.

Alternative: emit partial projection diagnostics on failure. Rejected for the
primary output because partial files can be mistaken for valid scores; errors
remain on stderr.

## Risks / Trade-offs

- [Scorer source hashing covers one module rather than its runtime] → Keep the
  scorer dependency-free and stamp the explicit scorer version; changes to
  composition or runtime still change bundle/projection outputs or repository
  revision.
- [Bundle metadata can lie about a graph snapshot] → Require exact repository
  revision matching and fail closed on control contamination; cryptographic
  attestation of external graph engines remains outside this slice.
- [Pre-check failures do not contain hidden check results] → Project the
  immutable acceptance inventory as `skipped` only when the lifecycle proves
  checks never started; once checks start, any missing check rejects export.
- [Direct evaluator manifests remain less strongly provenance-stamped] → Keep
  backward compatibility, while recommending the receipt-composition CLI for
  new runner evidence.

## Migration Plan

Additive only. Existing `bench:graph-context` inputs and reports continue to
work. The new composer receives its own package script and schemas. Rollback is
removal of the additive composer files and scripts; raw receipts remain valid
and untouched.
