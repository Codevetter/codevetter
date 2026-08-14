## Why

CodeVetter can execute one browser probe and compare repeated probe evidence,
but an agent still has to decide how many local reruns to launch and when to
stop. That manual gap can waste CPU and wall time or, worse, encourage an agent
to follow one noisy diagnosis.

## What Changes

- Add a bounded scheduler that reuses compatible durable recaptures before
  launching any new local work.
- Allow at most three total compatible observations and at most three newly
  executed recaptures per scheduling operation.
- Stop immediately on disagreement, failed correctness, incomplete evidence,
  source drift, operational failure, or sufficient unanimous stability.
- Persist an integrity-bound scheduler receipt with the exact execution budget,
  reused and newly created evidence, terminal reason, and final assessment.
- Expose equivalent CLI and MCP operations with no caller-supplied commands,
  paths, environment, base URLs, or network policy.

## Capabilities

### New Capabilities

- `browser-probe-stability-scheduling`: Bounded reuse, execution, stopping, and
  durable reporting for repeated local browser-probe evidence.

### Modified Capabilities

None.

## Impact

- Adds one local runtime scheduler module and focused tests.
- Adds one CLI operation, one MCP tool, a package script, documentation, and a
  product proof artifact.
- Reuses the existing browser-probe recapture and stability contracts; it adds
  no production dependency and performs no cloud or production operation.
