# Native surface parity receipt

Date: 2026-09-01
Scope: evidence-scope discovery plus canonical local-check receipt semantics
Fixtures: `apps/desktop/src-tauri/tests/fixtures/surface-parity/evidence-scope-v1.json`
and `apps/desktop/src-tauri/tests/fixtures/surface-parity/local-check-v1.json`

## Result

The Rust core, `codevetter scope`, native Swift runner, and packaged MCP
`resolve_evidence_scope` tool consume one repository-owned fixture and preserve
the same schema-v1 request, candidate identity, target, confidence, readiness,
and limitation semantics.

A second shared fixture preserves one `codevetter.local-check/v1`
`no_confidence` receipt, request/run identity, stage status, limitation, and
exit-code semantics through the authoritative Rust service, `codevetter check`,
and native supervised runner. The repository-scoped MCP server reads that same
persisted canonical receipt through `verification_get_receipt` after redaction;
it cannot start or cancel the run.

This passes issue #201 task 9 for local-check and evidence-scope receipt parity.
It is not a claim that every native migration row is complete.

## Authority boundary

| Surface | Authority | Qualified behavior |
| --- | --- | --- |
| Rust | Authoritative resolver and service | Discovers scope and owns verification command, verdict, persistence, and receipt semantics |
| CLI | Supervised execution | Sends the exact request, returns the canonical Rust receipt, and maps `no_confidence` to exit 2 |
| Native | Supervised execution | Sends the same request and rejects request, schema, verdict, or exit-status disagreement before rendering |
| MCP | Read-only projection | Returns the same discovery semantics and one already-persisted canonical local-check receipt without execution or cancellation authority |

Both fixtures record `mcp_may_execute: false`, and the MCP contract test also
requires every exposed tool to be read-only, non-destructive, bounded, and
closed-world.

## Executable proof

The following focused checks passed against the same fixture:

- authoritative Rust resolver: 1/1;
- authoritative Rust local-check receipt contract: 1/1;
- CLI parser, serialization, and human projection: 1/1;
- CLI local-check request, receipt, limitation, and exit semantics: 1/1;
- MCP read-only schema gate: 1/1;
- real MCP protocol lifecycle, scoped discovery, canonical receipt read, and
  absolute-path redaction: 1/1;
- Swift supervised-runner discovery plus local-check request, schema, identity,
  limitation, exit validation, and mismatch rejection: 2/2;
- packaged release MCP smoke: 28 unique strict read-only tools and no TCP
  listeners.

Commands:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml authoritative_resolver_matches_the_shared_surface_parity_fixture -- --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml authoritative_service_owns_the_shared_local_check_receipt_contract -- --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --features browser-agent --bin codevetter scope_cli_projects_the_shared_surface_parity_fixture_without_schema_drift -- --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --features browser-agent --bin codevetter check_cli_preserves_the_shared_local_check_receipt_and_exit_semantics -- --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml every_tool_is_explicitly_read_only_and_schema_bounded -- --nocapture
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml protocol_lifecycle_is_scoped_structured_and_live_revocable -- --nocapture
npx -y xcodebuildmcp@2.7.0 swift-package test --package-path apps/macos/CodeVetterPackage --filter supervisedEvidenceScopeRunnerPreservesTheSharedDiscoveryContract
npx -y xcodebuildmcp@2.7.0 swift-package test --package-path apps/macos/CodeVetterPackage --filter supervisedRunnerPreservesTheSharedLocalCheckReceiptAndExitSemantics
node apps/desktop/scripts/mcp-benchmark.mjs --smoke --skip-build
```

The only known Rust warning remains the pre-existing unused `RawPeriod.totals`
and `RawPeriod.model_breakdowns` fields in `local_usage.rs`.

## Remaining boundary

This receipt does not authorize an MCP execution tool, run a live watcher poll,
qualify signing/notarization/updating, establish matched Tauri/native performance,
or approve Tauri retirement.
