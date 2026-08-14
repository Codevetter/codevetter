## Purpose

Defines request-scoped, privacy-bounded runtime activity evidence for V8,
libuv threadpool, and native I/O mechanisms that can guide an agent without
presenting overlapping activity duration as CPU causality.

## ADDED Requirements

### Requirement: Trace only the selected request interval

The owned local Node runtime SHALL enable a fixed trace category set immediately
before the selected dynamic request is dispatched and SHALL disable it at first
response commitment, with bounded private monotonic interval markers.

#### Scenario: Selected isolated request

- **WHEN** one qualified dynamic request is admitted without overlap
- **THEN** trace activity is retained only when its interval overlaps that request's pre-commit marker

#### Scenario: Concurrent selected request

- **WHEN** another selected dynamic request overlaps the active trace interval
- **THEN** the evidence is marked contaminated and cannot support a mechanism route

### Requirement: Normalize closed activity mechanisms

The normalizer SHALL publish bounded counts and interval-union overlap only for
closed V8 GC, V8 compilation, libuv threadpool crypto, zlib, filesystem, DNS,
network, Node-API, blob, and other mechanisms.

#### Scenario: Libuv worker activity

- **WHEN** paired threadpool execution events overlap the selected interval
- **THEN** the public summary reports the allowlisted operation class, count, and unioned activity milliseconds without a thread identity

#### Scenario: V8 activity

- **WHEN** complete V8 GC or compilation events overlap the selected interval
- **THEN** the public summary reports their class, count, and unioned activity milliseconds separately from threadpool activity

### Requirement: Fail closed on unsafe trace evidence

The collector SHALL reject or mark incomplete any malformed, oversized,
truncated, inconsistent, unpaired, escaping, or unsupported trace evidence.

#### Scenario: Live partial trace container

- **WHEN** tracing has been disabled and flushed but the process-owned JSON container remains unclosed while the server is alive
- **THEN** the bounded collector accepts only individually complete JSON event objects and marks completeness from the private interval marker and parser bounds

### Requirement: Exclude private trace data

Public evidence SHALL NOT retain trace arguments, raw event names outside the
allowlist, event IDs, thread IDs, process IDs, paths, runtime versions, absolute
timestamps, application values, headers, bodies, or environment data.

#### Scenario: Public browser-server projection

- **WHEN** native activity is joined to the exact browser-server request
- **THEN** only state, interval length, bounded mechanism aggregates, completeness, observer effect, and fixed provenance remain

