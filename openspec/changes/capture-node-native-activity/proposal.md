## Why

Exact current-thread CPU now separates main-thread from other-thread work, but
CodeVetter cannot yet observe whether the residual overlaps libuv threadpool,
V8 GC or compilation, or other native runtime activity. Node trace events expose
bounded activity intervals for these mechanisms, allowing the next probe to
become evidence-backed without pretending wall-time activity is CPU attribution.

## What Changes

- Enable a fixed request-scoped Node trace-event category set only around the
  selected dynamic request and flush it before the server is stopped.
- Record a private monotonic request interval marker and normalize only bounded,
  closed activity categories, counts, and interval-union overlap.
- Join native activity to the exact browser-server request while discarding
  event names outside the allowlist, arguments, IDs, thread IDs, paths, versions,
  values, and absolute timestamps.
- Refine exact other-thread residual routing when libuv threadpool activity is
  observed; explicitly separate activity overlap from CPU causality.
- Preserve unsupported, malformed, oversized, truncated, overlapping, and
  failed-correctness boundaries.

## Capabilities

### New Capabilities

- `node-native-activity-evidence`: Request-scoped bounded V8, libuv threadpool,
  and native I/O activity intervals derived from Node trace events.
- `node-native-activity-routing`: Deterministic residual routing informed by
  native activity without converting wall-time overlap into CPU attribution.

### Modified Capabilities

None.

## Impact

The change affects the owned Node preload and launcher, temporary trace files,
native-activity normalization, browser-server evidence, deterministic diagnosis,
Playwright diagnosis schema, focused tests, and proof documentation. It adds no
dependency, production tracing, network access, application edit, or UI.
