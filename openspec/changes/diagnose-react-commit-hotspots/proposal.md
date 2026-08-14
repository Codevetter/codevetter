## Why

CodeVetter already captures bounded React commit counts, inclusive
framework-reported component durations, and bounded repository source matches
for an exact Playwright flow. Real Anime List evidence shows that inclusive
duration ranks provider and layout ancestors because it contains their child
work, while one shared truncation flag cannot prove that a unique-source scan
was complete. The deterministic layer therefore lacks a trustworthy component
self-work signal from which to propose an experiment.

## What Changes

- Extend the existing separate React diagnostic rerun with bounded derived
  component self-render duration and explicit source-attribution completeness.
- Preserve readable legacy React evidence while requiring the new duration and
  completeness authority for an experiment candidate.
- Add one deterministic browser detector for material repeated component
  self-work observed during the exact flow.
- Require positive profiling duration, repeated presence across commits, fixed
  absolute and relative self-duration floors, and one unique repository source
  from a complete bounded scan before a candidate can become edit-eligible.
- Keep the finding explicitly observational: repeated commits are not proof of
  redundant rendering, causality, or production impact.
- Report closed detector coverage when React is absent, unavailable,
  unprofiled, truncated, immaterial, or source-ambiguous.
- Surface the finding through existing Playwright diagnosis, compact capture,
  performance-lab, CLI, and MCP paths without adding another public operation.
- Preserve the authoritative browser timing pass and paired correctness,
  latency, memory, loading, and React regression gates.

## Capabilities

### New Capabilities

- `react-commit-hotspot-diagnosis`: Deterministic, bounded diagnosis of material
  repeated React component activity from an exact local Playwright flow.

### Modified Capabilities

None.

## Impact

The change affects the React hook document and aggregate evidence contracts,
bounded source attribution, tool-led browser diagnosis policy and finding
contract, Playwright compact diagnosis projection, detector coverage matrix,
focused runtime tests, and performance proof documentation. It adds no
dependency, does not modify application source, and does not contact production
or cloud systems.
