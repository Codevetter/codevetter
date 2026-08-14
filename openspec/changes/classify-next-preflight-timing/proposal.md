## Why

An owned Next browser capture currently records only whether one route warmup
succeeded. When a later Playwright request is slow, an agent cannot tell
whether the first-route preflight was materially slower, whether repeated
preflight requests stayed slow, or whether the browser-triggered request is the
outlier. The real High Signal capture left 2.35 seconds unexplained after its
closed framework phases accounted for less than one millisecond.

## What Changes

- Replace the boolean-only Next warmup with two bounded, body-free GET
  observations against the exact statically qualified route.
- Retain only request ordinal, status class, duration, and complete/incomplete
  inventory in the owned runtime summary.
- Project compatible preflight evidence into the exact browser capture and
  compare it with the matching browser-correlated server request.
- Classify first-request-only, repeatedly slow, browser-request-only, stable,
  and insufficient evidence without calling any class framework compilation,
  production behavior, or source causation.
- Keep existing listeners, Vite flows, dynamic routes, redirects, failed
  preflights, and incomplete inventories fail-closed.

## Capabilities

### New Capabilities

- `node-browser-preflight-evidence`: Closed same-runtime Next preflight timing
  and deterministic comparison with one exact browser request.

### Modified Capabilities

None.

## Impact

The change affects the owned Next runtime contract, bounded Playwright capture
result, tool-led performance diagnosis, tests, and durable local performance
documentation. It adds no dependency, does not evaluate repository
configuration, and does not enable production or remote traffic.
