---
title: "Decision: MCP Rust SDK"
description: Pin the official MCP Rust SDK to 3.9.0 while preserving the initialize-bound local history contract.
---

Initially evaluated 2026-07-13. Security migration reviewed 2026-11-11.

## Decision

Use the official `modelcontextprotocol/rust-sdk` crate `rmcp` pinned to `3.9.0`.
The production dependency disables default features and enables only `server`,
`transport-io`, and `macros`. HTTP/SSE, OAuth, client, child-process, reqwest,
and network-server features are absent. The test-only dependency additionally
enables `client` for real lifecycle/framing tests.

The advertised protocol remains `2025-11-25`. Supported revisions are the SDK's
`known_up_to` list ending at `ProtocolVersion::V_2025_11_25`. Normal `initialize` negotiation
can select an older supported revision or fall back to `2025-11-25` for a newer
client. Do not reject a compatible client solely because it requested a newer
revision during initialization. Use the SDK
`negotiate_initialize` result before storing peer handshake info, so a repeated
handshake cannot leave future-version response encoding behind a `2025-11-25`
fallback.

The sidecar requires the SDK's initialize handshake before application requests.
SDK 3.9.0 can open an inline session even when request metadata selects an older
application protocol, so a version ceiling alone does not preserve this boundary.
A single SDK `Service` wrapper rejects requests and notifications without the
SDK's peer handshake info and rejects `server/discover` in every session.
Notifications or a later `initialize` inside an inline session cannot satisfy the
guard. SDK-owned pre-initialize `ping`, framing, negotiation and concurrency stay
intact; CodeVetter does not implement a separate JSON-RPC transport.

Real stdio regressions cover normal and fallback initialization, inline requests
claiming both `2025-11-25` and `2026-07-28`, discovery, and the existing live
scope-revocation checks in `crates/codevetter-core/tests/mcp_stdio.rs`.

## Why this dependency

The official SDK owns JSON-RPC framing, initialization/version negotiation,
capability routing, cancellation plumbing, MCP error types, schema models, stdio
concurrency, and backward-compatible resource-not-found behavior. Reimplementing
those protocol mechanics would add more security and interoperability risk than
the dependency saves. CodeVetter still owns authorization, canonical queries,
redaction, limits, cursor validation, and product semantics.

## License, security, and dependency surface

- License: Apache-2.0.
- Upstream: <https://github.com/modelcontextprotocol/rust-sdk>
- Production feature closure: server + async read/write codec + stdio + schema
  support and macros. Direct runtime families are Tokio/Tokio-util, Serde,
  Schemars, Futures, Tracing, Chrono, Thiserror, and the SDK macros. Most were
  already present in the desktop dependency graph.
- Explicitly absent from the selected production features: reqwest, HTTP server,
  SSE, OAuth, JWT, URL-based elicitation, child-process client, and network
  transports.
- The initial 2026-07-13 review found no published advisory for the then-pinned
  `rmcp 2.2.0`. That dated observation is superseded by the 2026-11-11 migration.
- Pin `3.9.0` to include the fixes for
  [OAuth client SSRF](https://rustsec.org/advisories/RUSTSEC-2026-0457.html) and
  [unbounded HTTP response buffering](https://rustsec.org/advisories/RUSTSEC-2026-0462.html).
  Those HTTP/OAuth features remain disabled in the shipped stdio dependency.
  Current lockfile scans and feature qualification provide the security evidence;
  the old absence-of-advisories observation does not.

## Historical distribution measurements (2026-07)

These measurements describe the original SDK evaluation, not the `3.9.0`
migration. No new size, RSS or latency measurements are claimed here.

The measured Apple Silicon release sidecar was 7.04 MiB and idled at 12.31 MiB
RSS. That binary size includes CodeVetter's shared graph/history/SQLite code and linked
desktop crate surface, so it is an upper bound—not an attribution of 6.80 MiB to
`rmcp`. At that time, Tauri packaged the target-suffixed executable beside the
app. Those packaging observations are historical; the current signed release artifact and
its own qualification remain the distribution proof.

The final release-binary benchmark on 2026-07-14 used a 10,000-event fixture and
measured cold initialize at 5.28 ms p50 / 7.90 ms p95. Steady compact queries were
2.16–2.34 ms p50 and 2.43–2.56 ms p95, with 1.4–2.0 KiB responses; resource listing
was 2.15 ms. The 25-launch sample contained one 442.81 ms cold outlier. An earlier
small fixture measured 5.30 ms / 6.18 ms cold p50/p95 and 1.37–1.40 ms warm p50.
Both runs verified zero TCP listeners and no target-repository mutation. The
SDK, linking, schema, audit or packaging changes need fresh measurements before
these historical results can qualify their distribution cost.

## Rust versus Go

Keep the sidecar in Rust. Its canonical graph/history services and SQLite types
already live in Rust, so a Go process would either duplicate product semantics or
add another IPC boundary back into Rust. The original evaluation measured warm
queries around 2.2 ms, 12 MiB RSS, a single 7.0 MiB packaged binary and no runtime
download. Those results supported the original decision; they are not fresh
evidence for the security migration. A future language comparison must measure
the then-current Rust sidecar and prototype on the same workload, including
startup, serialization, memory, signing, artifact size and maintenance.
