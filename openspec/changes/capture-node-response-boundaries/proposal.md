## Why

After preflight, High Signal still spends 0.84–1.18 seconds in a warm local
`GET /`, while repository CPU, supported child operations, async delay, and the
three available Next phases explain almost none of it. The installed Next
runtime exposes no additional performance-measure spans, so CodeVetter needs a
framework-independent way to partition Node response production.

## What Changes

- Observe the first Node response commitment, first body write, `end` call, and
  `finish` event for the exact correlated server request without retaining
  payloads, headers, or arguments.
- Project bounded request-relative offsets and derived preparation, streaming,
  and finalization intervals without claiming network TTFB or exclusive work.
- Classify one dominant response interval with deterministic thresholds and no
  source/edit authority.
- Preserve behavior for empty, streamed, implicit-header, error, static, and
  incomplete responses.
- Prove the evidence against an unchanged real Node/Next Playwright flow.

## Capabilities

### New Capabilities

- `node-response-boundary-evidence`: Closed Node server response-call timing
  and agent-facing request-phase classification.

### Modified Capabilities

None.

## Impact

The change affects the owned Node preload, normalized server-flow schema,
tool-led diagnosis, tests, and performance documentation. It adds no dependency
and does not inspect response content, production traffic, or repository
framework configuration.
