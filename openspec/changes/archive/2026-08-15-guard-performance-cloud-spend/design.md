## Context

The runtime profiler launches exact repository-owned Node, Vitest, Playwright,
and Go targets with bounded output and wall time. Qualification detects some
network and database signals, but direct CLI and campaign execution do not
share an immutable admission contract and the child process is not currently a
zero-egress sandbox. See `proposal.md` for the product risk.

## Goals / Non-Goals

**Goals:**

- Make the default autonomous policy explicit, deterministic, and inspectable.
- Block unsafe work before the first child process and enforce the admitted
  policy at runtime where CodeVetter has a dependable boundary.
- Reuse one policy across direct profiles, supervision, and campaigns.
- Keep blocked outcomes useful to agents through a compact receipt.

**Non-Goals:**

- Add hosted profiling, production load generation, billing integrations, or
  approval management.
- Claim an OS-level sandbox for runtimes that CodeVetter cannot isolate.
- Infer that a workload is safe merely because credentials are absent.

## Decisions

### Use a closed preflight plan as the authority

A new dependency-free governance module derives a plan from exact repository,
adapter, target, name, and duration inputs plus a bounded source scan. The plan
uses stable JSON hashing and closed validation. Every executable performance
entry point calls it; a separate CLI dry-run exposes the same result.

Alternative: keep safety flags only in qualification. Rejected because callers
can bypass qualification and flags do not bind the later execution identity.

### Support only local zero-egress autonomous mode

The first schema has one executable mode: `local_zero_egress`. Remote, paid,
unknown-cost, load, soak, stress, and production evidence is terminally blocked
even if an approval string is supplied. This makes maximum external requests,
retries, and cost exactly zero rather than estimates.

Alternative: implement hosted approval and pricing now. Rejected because it
would expand the product into cloud execution and billing before local safety is
proven.

### Enforce Node-family egress with a preload and block unsupported runtimes

Node, node-script, and Vitest processes receive a repository-owned preload that
rejects non-loopback DNS, sockets, HTTP(S), fetch, and WebSocket calls. Playwright
is admitted only with an explicit loopback URL and uses the same remote guard.
On macOS, every admitted workload also runs under `sandbox-exec`; this permits
Go test and benchmark targets with networking denied. On other platforms, Go
performance execution remains manually callable outside the autonomous
campaign but is not admitted until a portable, testable sandbox exists.
`GOPROXY=off` alone is not considered a network sandbox.

Alternative: static source scanning alone. Rejected because dependencies and
computed endpoints can escape a lexical scan.

### Count enforcement events, not inferred traffic

The preload emits a bounded machine marker when it blocks a request. The parent
captures markers separately from redacted stdout/stderr and records attempted
external requests without retrying. An ordinary completed local run has zero
attempted external requests; a policy violation remains zero successful
external requests but records the blocked attempt and a failed admission
receipt.

## Risks / Trade-offs

- **Node APIs may add new network entry points** → Keep the preload small,
  deny-by-default around built-in network modules, and cover supported APIs with
  hermetic tests.
- **Playwright often starts a local dev server outside the test process** → The
  autonomous path admits only already-declared loopback targets; server startup
  orchestration stays outside this change.
- **Go becomes less automatic** → Return an explicit unsupported-enforcement
  receipt rather than claiming zero egress. Manual profiling remains available.
- **Source scanning can over-block words used in fixtures** → Runtime
  enforcement controls Node admission; lexical signals explain and block only
  clearly remote/paid/production targets.

## Migration Plan

1. Add plan/receipt contracts and hermetic validation tests.
2. Add the Node preload and prove loopback/remote behavior without internet.
3. Route dry-run, direct profile, supervision, and campaign paths through the
   shared admission check.
4. Document the stricter local boundary and run focused runtime tests.
5. Roll back by removing the new admission calls; no persisted database or
   production configuration requires migration.
