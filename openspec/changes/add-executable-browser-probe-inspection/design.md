## Context

See [proposal.md](./proposal.md). Playwright capture receipts already bind a
normalized result path, byte count, SHA-256 digest, compact diagnosis, source
snapshot, and exact scope. The compact next probe currently retains a name but
not the selected server-request ordinal, while the full result contains all
request-local CPU, Worker, async, and native evidence.

## Goals / Non-Goals

**Goals:**

- Make a next-probe label executable through CodeVetter after the original lab
  response is gone.
- Resolve request and source evidence without parsing display strings.
- Reuse the receipt/result integrity boundary and expose one byte-stable
  projection through CLI and MCP.

**Non-Goals:**

- Recapture or profile the application during inspection.
- Infer a source not present in captured evidence.
- Authorize an edit, generate a patch, or claim activity caused CPU.
- Read arbitrary capture paths or support production/App Health traces.

## Decisions

### Bind the next probe to a request ordinal

The pre-commit route finding records `server_request_ordinal`, and compact
diagnosis v20 carries it in `next_probe`. Inspection uses that ordinal and
rejects a missing or duplicate request.

Alternative: parse method and route from `operation_shape`. Rejected because a
display field is not a durable identity contract and duplicate routes are
possible.

### Load by validated capture identity

A new durable loader resolves only
`.codevetter/playwright-runs/<capture-id>/receipt.json`, validates the existing
receipt contract, reuses result digest and compact-diagnosis verification, and
checks the current source snapshot. CLI and MCP call the same inspector.

Alternative: accept receipt or result paths. Rejected because it expands the
filesystem authority surface and lets agents bypass the capture identity.

### Use a closed probe-to-source mapping

The projection admits sources as follows:

- main-thread repository: request CPU candidates;
- Worker repository/dependency/generated/runtime: matching Worker profile candidates;
- libuv crypto: `worker_pool` async resources;
- libuv filesystem: `filesystem` async resources;
- libuv DNS: `dns` async resources;
- libuv network: `connect` async resources;
- response-linked async: exact matching async-resource kind;
- incomplete async/framework inventory: exact request context and an explicit
  same-flow recapture action, with no source candidate;
- all other probes: exact route source only as context, not mechanism attribution.

Candidates are deduplicated, bounded to eight, and labeled with the captured
evidence kind and a fixed non-causal relationship. Empty source evidence yields
a closed missing-evidence action rather than a guessed file.

### Return evidence needed to evaluate the probe

The result retains compact request identity, response timing, process/thread
CPU, Worker summary, native activity, matched candidates, authority, and
limitations. It does not return the whole diagnosis, raw events, raw profiles,
or unrelated requests.

## Risks / Trade-offs

- **[Older captures lack request ordinal]** → Reject them as unsupported for
  executable inspection; do not infer identity from strings.
- **[A correlated async callsite is not the native operation source]** → Label
  it temporal/context evidence, never causal attribution or edit authority.
- **[Source changes after capture]** → Return an explicit stale result with no
  current source candidates.
- **[Probe families grow]** → Keep a closed family parser and require tests plus
  a schema change before admitting another family.
- **[Large durable results]** → Reuse existing byte/digest validation and return
  only a bounded projection.

## Migration Plan

Increment the Playwright diagnosis schema to v20, add the read-only operation,
and replay one unchanged capture. Existing captures remain readable by their
current loaders but are not executable-probe compatible without the new request
ordinal. Rollback removes the new operation and ordinal field; no application
data migration is required.
