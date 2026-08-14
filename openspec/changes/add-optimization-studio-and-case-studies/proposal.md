## Why

CodeVetter can run bounded local performance laboratories and emit durable
receipts, but that capability is effectively hidden behind CLI/MCP operations.
People need a first-class desktop path to select a repository, start the lab,
and understand its process, while prospective users need honest public case
studies showing both accepted and rejected results.

## What Changes

- Add an **Optimize** destination to the desktop workbench and command palette.
- Let users select or add a local repository, start a bounded local performance
  laboratory, and inspect its live state, executed steps, findings, stop reason,
  limitations, and retained/rejected evidence.
- Expose the already-packaged performance runtime through a typed Tauri IPC
  command and a bounded receipt-history reader; do not add cloud execution,
  source mutation, or arbitrary command input.
- Add a public optimization case-study section to the landing page and benchmark
  route, backed by the committed Anime List receipt and an inspectable JSON
  endpoint.
- Explicitly separate local-development movement from production-build impact,
  and show rejected experiments alongside the retained result.
- Treat implementation size as part of the optimization verdict: record changed
  files and lines, reject out-of-scope or oversized candidates, and surface
  production dependency additions instead of rewarding performance alone.

## Capabilities

### New Capabilities

- `optimization-studio`: Repository selection, bounded local lab execution, and
  human-readable projection of machine performance receipts in the desktop app.
- `public-optimization-case-studies`: Evidence-backed public case studies with
  methodology, limitations, rejected hypotheses, and machine-readable proof.

### Modified Capabilities

None.

## Impact

- Desktop React routing, navigation, command palette, project workspace, typed
  IPC, and a new evidence viewer.
- Tauri command registration plus a small local-only adapter over the packaged
  `runtime-failure-capsule` resource.
- Astro landing-page components, benchmark content, and one prerendered JSON
  proof endpoint.
- No new production dependency, hosted service, cloud cost, deployment, source
  mutation authority, or production profiling claim.
- Performance-lab receipts and public proofs gain a bounded change-cost record
  so agents can prefer the smallest verified patch.
