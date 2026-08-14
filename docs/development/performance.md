---
title: Performance harness and baselines
description: Measures the three surfaces CodeVetter can control so every optimization is proven against numbers.
---

CodeVetter is a local-first desktop tool. Its performance is won by **not doing
wasteful work**, not by changing languages — the native side is already Rust and
the dominant *wall-clock* cost (LLM calls) is network-bound and unfixable by us.

This harness measures the three surfaces we *can* control, so every optimization
is proven against numbers instead of vibes. Measure → change → measure.

## Running it

From `apps/desktop/`:

```bash
pnpm bench          # build + bundle budget + Rust benches (everything)
pnpm bench:bundle   # JS chunk sizes vs budget (needs a prior `pnpm build`)
pnpm bench:rust     # serialized index, graph, history, and FTS benches
pnpm qualify:graph     # enforced canonical-graph backend + UI data-path budgets
pnpm qualify:graph:browser # history-slider browser interaction qualification
```

The Rust benches are `#[ignore]`d (`src-tauri/src/commands/perf_bench.rs`) so they
never gate normal `cargo test`. Comparison benches print tables without timing
assertions. `qualify:graph` sets `CV_ENFORCE_GRAPH_BUDGETS=1`; on the calibrated
Apple M5 Pro profile, the real-repository structural benchmark enforces the
release envelope below. Shared release runners set
`CV_GRAPH_BUDGET_MODE=report-only`, retaining correctness and resource
measurement without treating variable hosted-runner timing as comparable.
`qualify:graph:browser` likewise enables its absolute frame-time ceilings only
outside report-only mode; normal browser CI still exercises every scrub input,
final revision, accessibility label, and concurrent indexing state. The script
forces one test thread so independent CPU, SQLite, and filesystem benches do not
contaminate each other's baselines. Bigger inputs:

```bash
cd src-tauri
CV_BENCH_MAX_MB=256 cargo test --release perf_bench::bench_index_parse -- --ignored --nocapture
```

## Agent-facing local performance laboratory

The repository CLI can exhaust the safe mechanical portion of another stable
Node, Vitest, Jest, or Go repository's local performance investigation:

```bash
pnpm runtime:run-performance-lab -- \
  --repo /absolute/path/to/product \
  --lab-id product-local-2026-08-12 \
  --max-steps 8 \
  --timeout-ms 30000 \
  --json
```

After the separate verifier rejects a candidate, a later run can advance the
same immutable diagnosis with a comma-separated, maximum-eight exclusion list:

```bash
pnpm runtime:run-performance-lab -- \
  --repo /absolute/path/to/product \
  --lab-id product-local-next-2026-08-12 \
  --exclude-finding-ids 0123456789abcdef01234567 \
  --json
```

To skip the same source and inference mechanism across several flows on one
immutable snapshot, use the opaque key returned with an eligible candidate:

```bash
pnpm runtime:run-performance-lab -- \
  --repo /absolute/path/to/product \
  --lab-id product-local-next-flow-2026-08-12 \
  --exclude-candidate-keys 89abcdef0123456789abcdef \
  --json
```

After an agent edits the returned source candidate, a new lab can continue from
the originating receipt instead of reconstructing the comparison by hand:

```bash
pnpm runtime:run-performance-lab -- \
  --repo /absolute/path/to/product \
  --lab-id product-local-screen-2026-08-13 \
  --continue-from product-local-2026-08-12 \
  --json
```

Continuation is append-only: it requires a new lab ID, binds the new receipt to
the predecessor receipt digest, and remeasures only the same exact qualified
flow. It is a sequential local screen. A regression is rejected and an
immaterial result is distinguished from missing confidence, but a material win
still stops at `paired_verification_required`. Project-owned correctness and an
independently runnable paired comparison remain required before shipping.
Same-snapshot Node evidence from another Node version remains in history but is
marked runtime-incompatible and remeasured rather than silently reused.

When a distinct incumbent checkout already matches the predecessor snapshot,
the same continuation can finish the bounded acceptance loop:

```bash
pnpm runtime:run-performance-lab -- \
  --repo /absolute/path/to/current-product \
  --lab-id product-local-accepted-2026-08-13 \
  --continue-from product-local-2026-08-12 \
  --incumbent-repo /absolute/path/to/incumbent-product \
  --correctness-adapter vitest \
  --correctness-target src/example.test.ts \
  --correctness-name "preserves the exact behavior" \
  --json
```

CodeVetter first requires that both source snapshots remain stable and that the
incumbent matches the predecessor. It then runs exactly one caller-selected
correctness test in each checkout and, only when both pass exactly once, runs
the existing ten-pair interleaved verifier. A shipping recommendation completes
as `candidate_accepted`; failed correctness or paired evidence rejects, while
operational, identity, or selection uncertainty stops with no confidence. The
full paired report is stored beside the receipt and referenced by path, digest,
and byte count. This gate does not replace a product's broader test suite.

A repository can make the correctness relationship part of the flow instead of
requiring those three flags on every continuation. The fixed snapshot-bound
`codevetter.performance.json` file contains a bounded list of exact
performance identities and exact correctness scopes:

```json
{
  "schema_version": "codevetter-performance-flows/v1",
  "flows": [
    {
      "sources": ["src/example.ts"],
      "performance": {
        "adapter": "vitest",
        "target": "src/example.performance.test.ts",
        "name": "scales with input size"
      },
      "correctness": {
        "adapter": "vitest",
        "target": "src/example.test.ts",
        "name": "preserves the exact behavior"
      }
    }
  ]
}
```

With that same manifest present in the predecessor-matching incumbent and the
current checkout, acceptance needs only `--incumbent-repo`. CodeVetter reports
bound and stale entry counts, requires exact identity, records the manifest
digest, and refuses a conflicting explicit scope. The 64 KiB document is data,
not executable configuration: unknown fields, duplicate identities, symlinks,
escaping targets, and unsupported adapters fail before project execution.

The optional `sources` array gives review a cold-start ownership path. Each
entry is one exact repository-relative file (no globs or commands, at most 16
per flow). If a changed file has one repository-owned correctness scope,
CodeVetter can run that exact test even when the repository has no accepted
performance receipt yet. Conflicting scopes fail closed, and an unmapped file
does not trigger a guessed test. This first produces current correctness
evidence; performance remains explicitly `not_measured` unless that exact test
passes and the same binding authorizes the bounded characterization below.

After that exact current correctness test passes, the same repository-owned
binding now authorizes one bounded current performance characterization. Review
runs two measurement samples with no warmup plus the profiler's separate CPU,
allocation, and process-memory lanes, rechecking the source snapshot afterward.
The compact evidence contains current exact-flow metrics and deterministic
bottleneck inference. It emits a source candidate only when the top-level
diagnosis is actionable; a startup-dominated result can retain lower-level
observations but cannot hand them to the reviewer as optimization work.

This result is deliberately `current_characterization_only`. Without a
compatible baseline and paired acceptance, CodeVetter cannot call the change
faster, slower, safe to ship, or representative of production. Failed current
correctness skips the performance run, while timeout, mutation, or binding drift
keeps correctness evidence and marks performance unavailable or no-confidence.
The [cross-product review artifact](../../benchmarks/performance-lab/review-owned-performance-characterization-2026-08-13.json)
records the current Go, React/Vitest, and CodeVetter self-review proof.

Each successful characterization now retains its validated redacted capsule as
an immutable local record under
`.codevetter/performance-review-history/`. The record binds the manifest,
source owner, exact performance and correctness scopes, both target-file
digests, runtime command identity, and source snapshot. Records are ignored by
Git, capped at 64 entries and 8 MiB each, never overwrite an existing snapshot,
and are not automatically pruned. Unsafe paths, symlinks, target mutation,
tampering, incompatible identities, or a full inventory fail closed without
discarding the current characterization.

For a later distinct compatible snapshot, review automatically screens the new
capsule against the latest local record. The projected status is
`sequential_screening_only`: it may show metric movement and request the
existing interleaved paired verifier, but always reports
`shipping_recommended: false`. Because the measurements were taken at different
times, the screen cannot establish an improvement, regression, causation, or
production impact. It is a cheap evidence-backed routing decision, not the
acceptance gate.

When that screen is material and comes from the current Git revision, review
can now run the acceptance gate itself. Eligibility requires every current
change to be one of the selected binding's declared source files; the manifest,
performance target, correctness target, package authority, and runner authority
must remain tracked and unchanged. CodeVetter then streams the clean revision
from local Git into an owned `.codevetter/review-incumbent-*` directory, without
creating a worktree, installing packages, persisting a patch, or modifying the
developer checkout.

Node baselines may graft the matching existing root or package-local
`node_modules` directory while execution remains rooted in clean source. The
graft is revalidated separately from the Git-tree fingerprint, and a direct
dependency link back into mutable workspace source stops the pair before
execution. Both roots must pass the exact bound correctness test before the
existing ten-sample interleaved verifier runs. An accepted result requires that
verifier's shipping decision and is stored once with a payload digest; an exact
repeat reuses it. Correctness failures are rejected, while unsafe trees,
identity drift, mutation, incomplete evidence, and artifact tampering remain
no-confidence. The result is still one exact local flow, never production or
project-wide evidence. The fixture and chosen-product eligibility proof is in
the [automatic paired-review artifact](../../benchmarks/performance-lab/automatic-review-paired-verification-2026-08-13.json).

An ineligible pair now explains itself. The compact result classifies the
snapshot-approved changed paths as binding-owned source, evaluator, or unrelated
files and emits one closed next action. `establish_evaluator_baseline` means the
manifest and exact evaluator targets must first exist as tracked baseline
authority; `isolate_owned_source_change` means unrelated changes prevent clean
attribution. These are non-mutating instructions: CodeVetter does not stage,
commit, reset, delete, or otherwise modify the checkout. The same evidence and
action survive characterization and the Rust review prompt without becoming a
performance claim.

An accepted run can now inform CodeVetter's automatic review without asking an
agent to paste benchmark output into the change description. Before a review
starts, the bundled runtime searches the bounded local lab directory and
projects at most one result. It revalidates the closed receipt, current source
snapshot, repository-owned correctness manifest digest, full paired-artifact
byte count and SHA-256, compact-summary parity, and the paired shipping verdict.
The Rust review boundary then requires the candidate source file to appear in
the exact review target. Qualified evidence reaches both specialist and
coordinator prompts as separate `observed`, `inferred`, and `unverified` data;
the review result and activity metadata retain the same projection.

Stale, rejected, malformed, tampered, or unrelated lab evidence never reaches
the model. Missing Node or missing evidence is non-blocking: review continues
and records a bounded unavailable/excluded reason instead of inventing a test
or performance result. The projection is local and exact-flow scoped. It does
not establish production impact, project-wide correctness, or behavior of an
untested flow.

One stale case still carries safe testing authority. When the Git revision is
unchanged, only the bounded source snapshot moved, the accepted candidate file
belongs to the exact review target, and the repository-owned manifest plus full
paired artifact remain intact, CodeVetter reruns the bound correctness test
before model review. It checks the expected snapshot before execution, proves
exactly one named Node/Vitest/Jest/Go test ran, and checks the snapshot again.
Pass, failure, timeout/setup uncertainty, and selection ambiguity remain
distinct observed outcomes. The prompt explicitly excludes all historical
performance metrics; fresh correctness cannot revive an old speedup claim.

On the current Significant Hobbies checkout, this path used the accepted
`getBucketListSuggestions` source relationship to select the repository-owned
determinism test. Exactly one Vitest case passed in 1,004 ms on source snapshot
`e2c544106b4f7f078399d7d16b41f83a9325c97c7e8e418beb45de90c17e095f`.
The earlier 28.885–50.268% local timing result remains stale and absent from the
fresh review evidence. The bounded replay is recorded in the
[review evidence artifact](../../benchmarks/performance-lab/significant-hobbies-review-evidence-2026-08-13.json).

The operation reads the executable-flow coverage report, measures exact
directly measurable flows, screens exact safe tests with explicit benchmark or
software-performance workload intent, establishes a qualified local browser runtime for React
journeys when needed, returns at most one source-bounded candidate with its
durable baseline, and then stops before a source edit. Both measurement paths use the
ten-sample shipping floor.
It accepts a bounded dirty agent snapshot but refuses changing, sensitive, or
unbounded snapshots, safety-flagged workloads, arbitrary commands, remote
browser origins, and workload invention. A visible high-signal
screen may run when the broader inventory is truncated, but the receipt retains
that incomplete-inventory boundary and never claims full coverage. MCP exposes
the same contract as `run_autonomous_performance_lab`.

Runs are sequential and capped at eight steps. The timeout applies to each
owned child process; the supervisor derives a bounded whole-measurement
deadline from the adapter's required passes. This consumes only local CPU and
bounded `.codevetter/` evidence storage. It does not install packages, call a
cloud profiler, or authorize remote-service traffic. The latest receipt is at
`.codevetter/performance-labs/<lab-id>/receipt.json`; immutable lifecycle
snapshots are retained in its `history/` directory. See the
[qualification artifact](../../benchmarks/performance-lab/README.md) for the
current denominator and claim boundary.

On its first evidence write, CodeVetter creates `.codevetter/.gitignore` with a
local `*` rule when that file does not already exist. Receipts therefore remain
available in the product checkout without making `git status` dirty. An
existing ignore file is never overwritten, and `.codevetter` remains excluded
from runtime snapshot identity regardless of its local evidence contents.

Snapshot identity hashes the Git revision plus at most 256 tracked, untracked,
deleted, mode-changed, or symlink changes, with 8 MiB per-file and 64 MiB total
bounds. Secret-like paths are rejected before content reads; escaping symlinks
and special files are rejected. Qualification checks the fingerprint before
and after discovery, every receipt carries it, and supervision or browser
capture invalidates results when the fingerprint changes. CodeVetter never
stages, stashes, resets, commits, cleans, or edits the profiled repository.

Go allocation context is bounded to three repository functions, not three
individual pprof lines. Direct `alloc_objects` functions take precedence over
cumulative callers. Ordinary diagnosis uses two independent profile runs. It
derives a capped fixed `Nx` iteration count from the unprofiled median
`ns/op`, requires that exact count in both profile outputs, and reports direct
objects/op only for a file/function repeated in both runs. This avoids dividing
pprof totals from hidden Go benchmark calibration rounds by only the final
reported `b.N`. A repeated leaf below the existing direct-share floors remains
measured guardrail evidence and cannot seed an autonomous source experiment.
Within that bound, a one-line `fmt.Sprintf` using only
literal text, `%%`, and `%s` verbs can make a directly sampled source at or above 5%
object share the single experiment candidate; generic direct sources retain the
10% floor. The receipt records only pattern kind, line, and `%s`-verb count—not
the format or values—and explicitly treats argument types and concatenation as
an unverified hypothesis. Numeric, width, precision, dynamic, multiline, and
other formats receive no preference.
The diagnosis retains at most eight allocation findings from those bounded
contexts, while each lab response exposes only the highest-ranked eligible
candidate. Exclusions are canonical finding IDs, are sorted into the receipt
policy, and never authorize a new source or workload. Excluding every eligible
finding completes with `candidate_exclusions_exhausted`; it does not claim the
findings were verified as rejected.
Within a multi-flow inventory, an exhausted diagnosis remains visible as
`candidate_exhausted` and counts as measured for that exclusion policy, but it
yields to the next safe unmeasured flow. The terminal exhaustion action appears
only after no other safe automatic flow remains. Stored diagnoses and finding
eligibility are never rewritten by this projection.
Finding IDs remain evidence-specific. Eligible source-bounded profile findings
also carry a candidate key derived from the bounded selected function-body
digest, stable file/function anchor, detector, finding kind, inference mechanism,
and operation kind. Unrelated repository edits and line movement therefore keep
the key stable, while editing the selected function or changing the mechanism
produces a different key. The raw function body is not retained. Legacy findings
without a context digest continue to validate against their recorded snapshot
identity. CLI and MCP accept at most eight canonical keys, record them in policy,
and interpret them only as caller skips—not verified rejections.

For a statically qualified Vite flow, the laboratory resolves the contained
installed Vite module and launches it directly on the exact declared loopback
host and port. It disables repository Vite configuration and automatic
environment-file loading, and never evaluates `webServer.command` or package
scripts. Startup, repository/family attestation, and
process-tree cleanup are bounded and compactly recorded. One already-running
attested Vite server may be reused but is never terminated by CodeVetter; an
unverified occupied port blocks capture. An already-running Next.js server may
be reused only after the same attestation. For an eligible stable Next flow,
CodeVetter may instead resolve the contained installed Next package and launch
its programmatic development server with a closed custom configuration. This
bypasses `next.config.*`, package scripts, deployment adapters, and telemetry,
uses an isolated `.codevetter/next-runtime` directory, and stops before startup
when `.env`, `.env.local`, `.env.development`, or `.env.development.local`
exists. Only file names are inspected; `.env.example` is inert. The owned
process is repository/family-attested and terminated after capture.

When qualification finds one literal query-free `page.goto`,
`page.request.get`, or request-fixture GET path, the owned Next runtime performs
one bounded loopback warmup without following redirects or retaining a body.
The runtime receipt distinguishes completed and unavailable warmups. Next
development framework resources are excluded only when this exact runtime mode
is recorded; production Next chunks remain observable. This mode does not
evaluate repository redirects, rewrites, headers, plugins, aliases, or compiler
configuration and does not establish repository-configured or production-build
equivalence. An existing standalone build remains ineligible unless its
artifact identity is cryptographically bound to the qualified revision.
Wrangler, generic Node, multi-service, dynamic-origin, remote-origin, and
missing-runtime cases remain explicit non-execution boundaries. The standalone capture command below
still requires an already-running server; lifecycle ownership belongs only to
the autonomous laboratory operation.

### Qualified local browser capture

Browser capture is an internal stage of `runtime:run-performance-lab`, not a
second agent workflow. For one exactly qualified Playwright declaration, the
lab may launch an installed config-disabled Vite or Next runtime on loopback,
run an owned Playwright config, deny non-loopback browser traffic, capture a
bounded Chromium trace, and stop its process tree. It never evaluates
repository Playwright/Vite/Next configuration, package scripts,
`webServer.command`, environment files, migrations, or cloud commands.

Qualification may statically parse literal Playwright `projects` entries backed
by installed `devices[...]` descriptors or literal viewports. It also resolves
one exported named typed literal project array when the config uses that array
by shorthand; the module is never evaluated. Static `testIgnore` filters and
literal device-field overrides are applied to each exact target. Each project
is a separate exact-flow identity, but the bounded capture floor prefers
distinct test declarations before selecting extra device variants. The owned
configuration resolves the selected descriptor in an isolated dependency
process, applies its viewport/scale/mobile/touch behavior and literal overrides,
and retains those fields in the receipt without storing the user agent. Dynamic
projects remain ineligible; when no project is declared, the receipt explicitly
labels CodeVetter's 1280×720 generic desktop profile.

The compact evidence includes navigation and request timing, renderer main
thread intervals, outer-main-frame LCP, bounded V8 samples, verified inline
source-map anchors, and peak RSS sampled across the owned Playwright and
Chromium process tree.
When the nearest package manifest declares React, CodeVetter also reruns the
same selected Playwright test through an owned loader in a separate diagnostic
pass. A bounded React DevTools-compatible hook records renderer versions,
commit counts, positive `actualDuration`, and component activity without
retaining props, state, DOM text, URLs, raw fibers, or source. Component names
become repository candidates only when a bounded source scan finds one unique
declaration; framework and ambiguous names remain explicitly external. This
instrumentation supports both ESM and CommonJS-transpiled Playwright test
modules while intercepting only the selected target. A private owned page
binding accepts only the closed React summary and preserves up to eight
document reports across navigation or teardown; final-page evaluation remains
a fallback. The delivery receipt contains only counts and state, never page
URLs or application values. This pass never supplies the authoritative browser clock. Three compatible captures
on each side may use total React duration as a secondary paired metric and
regression guard, but commit count alone cannot confirm an optimization.
The agent-facing capture and laboratory receipts also retain a closed main-
thread summary: JavaScript, style, layout, and paint totals; long-task count and
duration; and repository CPU sample count, self time, and attribution state.
This lets `no_findings` distinguish a cheap flow from missing source attribution
without opening the full result artifact. An unavailable trace summary remains
`null`; it is never reported as zero work.
Only unexpected observed HTTP 400–599 responses are failures. Exact statuses
asserted statically in the selected test are retained as expected behavior;
policy denials, transport artifacts, and Vite development resources cannot
become optimization findings.
Raw traces, response bodies, source text, headers, commands, PIDs, and absolute
paths are not retained.

Each bounded `page.goto` becomes a separate navigation parent, and resource
evidence is assigned to the nearest preceding navigation rather than collapsed
across a multi-page journey. Query values are still discarded, but a SHA-256
identity over pathname and query distinguishes variants without retaining the
query itself. Contained Next `webpack-internal` V8 URLs may be associated with
repository files; without a content-verified inline source map, that provenance
remains diagnostic and cannot independently authorize an experiment.

A statically resolved local Vite journey may run without request fixtures while
the denial proxy blocks remote traffic. Request fixtures remain mandatory for
the separate repeated forced-GC lanes. When the local origin was synthesized
from a remote-default Playwright configuration, server-document assertions such
as rewritten titles or metadata are excluded because a plain Vite server cannot
reproduce those semantics. A failed selected assertion remains flow evidence;
the bounded laboratory continues to later safe flows instead of treating one
application failure as an infrastructure crash.

Browser peak RSS is a one-run total that includes test-runner and browser
startup; it is not React heap attribution, detached-DOM evidence, or a leak
claim. When Chromium emits `UpdateCounters`, the normalized main-thread result
also retains one renderer's first, last, peak, and delta values for JavaScript
heap, DOM nodes, documents, and listeners. Multiple renderer processes are
never aggregated. These counters are not collected after forced garbage
collection, so even a positive delta remains an observation rather than leak
evidence. Node and Go profiles also run three separate RSS passes. Their median
peak is a regression guard, not source attribution, and never contaminates the
latency samples. Go memory passes directly execute a precompiled owned benchmark
binary, excluding compilation and `go test` orchestration, but RSS still cannot
independently confirm a source-level optimization. Two additional Node, Vitest, or Jest
executions collect V8 sampling-allocation profiles at a fixed 32 KiB average
interval. Test workers write bounded checkpoints because they may skip
`beforeExit`; checkpoint overhead is isolated from timing and RSS runs. Up to
three material repository functions repeated in both profiles may become
allocation candidates. A CPU-aligned source remains first; when CPU evidence
exists, secondary experiments stay in that repository file so setup remains
observed without displacing measured-path work. These sampled bytes include objects collected by
minor and major GC; they are not exact retained bytes, a peak-memory value, or
leak proof. Go benchmarks retain the stronger `B/op`, `allocs/op`, and
allocation-profile evidence. Paired verification rejects a material memory
increase even when latency improves.

The autonomous-lab response projects the compact process-tree peak and renderer
counter summary directly beside the browser diagnosis. An agent does not need
to open the retained `result.json` merely to discover that memory evidence ran;
the result reference remains available for the complete normalized trace.

For exact request-fixtured Playwright declarations, a separate memory pass uses
the selected test unchanged three times in fresh contexts. A worker-scoped ESM
loader wraps only that test's `page` fixture, invokes Chromium garbage
collection before and after the interaction, and retains bounded heap/DOM
samples. The pass receives only the original capture deadline's remaining time,
runs with remote traffic denied, and cannot influence timing or CPU evidence.
Fresh contexts provide a repeatable post-GC distribution for later before/after
comparison; they do not demonstrate same-page retained-object leakage.

The worker also attempts three executions of the unchanged project callback in
one ephemeral page and context. Forced-GC samples form an ordered retention
sequence while the primary timing/CPU capture remains untouched. This lane is
fail-open for the primary capture: a repeated assertion failure makes only the
same-page evidence unavailable. During the sequence, bounded V8 allocation
sampling retains only objects alive after each forced GC and normalizes only
repository-contained source frames; it never stores heap snapshots, object
values, raw URLs, or response data. A source is reported only when it is present
in at least two of the three profiles, grows monotonically, and crosses both
20% and 64 KiB. Test and fixture frames cannot qualify. This is approximate
sampled-live source attribution—not exact retained bytes, a dominator path,
proof of unbounded growth, or a confirmed leak. Full-callback replay can still
repeat route fixtures, authentication, listener setup, and intentional caches.

This proves only the selected local journey. It does not establish production
traffic, remote latency, cache behavior, representative device CPU, Core Web
Vitals, user impact, or a safe optimization without paired measurement and
correctness verification.

> Numbers below are **machine-relative** (captured 2026-06-19, Apple Silicon,
> release build). They are a baseline to diff against, not an absolute spec.
> Re-run on your machine before/after a change and compare *deltas*.

## 1. Session indexing — the headline cost

`history.rs` already skips files whose mtime is unchanged. The waste is in the
*append* case: when a live session file grows, the whole file is re-read via
`std::fs::read_to_string` and re-parsed. Parsing runs at ~400 MB/s:

| transcript size | lines    | parse time |
|-----------------|----------|------------|
| 4 MB            | 11.3 k   | ~10 ms     |
| 16 MB           | 44.9 k   | ~42 ms     |
| 64 MB           | 179 k    | ~159 ms    |

It grows linearly with file size. On this machine the largest real transcript is
**211 MB**, so one ~4 KB append currently triggers a **~525 ms full re-parse**.

`bench_incremental_waste` quantifies what an incremental byte-offset reader saves:

```
base file:        64 MB
full re-parse:    162.5 ms   (current cost per append)
incremental tail: 0.0104 ms  (4 KB only — target cost)
waste factor:     15,619x
```

At 211 MB the waste factor is ~50,000x.

### ✅ Fixed — incremental byte-offset indexer (v1.1.90)

`cc_sessions` now carries `last_indexed_byte_offset` + `last_indexed_line_count`.
When an indexed file only grows, the indexer seeks to the saved offset, parses
just the appended tail (up to the last newline, so half-flushed events are never
indexed), and **merges deltas** into the session — appending archive rows with
continued `message_index`/`source_line`, bumping day buckets, summing token
totals, and recomputing cost from the new totals. A shrunk/rotated file falls
back to a clean full reparse. (`history.rs::index_adapter_session`.)

Two guarantees, both tested:

- **Correctness** — `incremental_index_matches_full_reindex_byte_for_byte` proves
  an incremental index is byte-identical to a one-shot full re-index (totals,
  cursor, cost, every archive row, day buckets). `file_shrink_falls_back_to_full_reparse`
  covers rotation.
- **Speed** — `bench_incremental_reindex_vs_full` on a 23.5 MB indexed file:

  ```
  full reparse:       1275.9 ms   (old behavior, every append)
  incremental append:    2.114 ms (new behavior, 4 KB tail)
  speedup:             604x
  ```

  The gap widens with file size — the old path also rewrote all ~80k archive +
  FTS rows on every append; the new path writes only the handful that arrived.

```bash
cargo test --release bench_incremental_reindex_vs_full -- --ignored --nocapture
```

`bench_index_parse` above is unchanged — a *cold* first index is still linear
(you must read the file once). The win is on every subsequent append.

## 2. FTS query latency

`bench_query` seeds 20,000 archived messages across 50 sessions and times the
archive search users hit from the Roadmap page:

```
seeded:     20,000 rows across 50 sessions in ~343 ms
search avg: ~14.3 ms/query (limit 25, 200 iters)
```

But that 14 ms is the **worst case**: a term present in every one of the 20k rows,
so bm25 ranks all of them. The number users actually feel is the selective case —
a term matching a handful of rows:

```
worst case:   14.5 ms/query  (term in every row)
realistic:     0.05 ms/query  (selective term, ~25 matches) — ~300x faster
```

So real-world archive search is ~50 microseconds. There is no query problem to
fix. `datetime(a.timestamp)` is only a *tiebreaker* (the primary sort is `rank ASC`),
not the bottleneck, so changing it would buy nothing and risks reordering results.
Left as-is, by measurement rather than assumption.

## 3. Frontend — desktop reality + render

This is a **Tauri desktop app**: the frontend loads from local disk, so network
transfer and cache reuse are not the startup constraint. Route splitting still
matters because JavaScript outside the entry route is not parsed, compiled, or
rendered at startup. The useful startup metric is therefore the entry module's
static import closure plus the default Home route—not the sum of every lazy route.

- **Bundle:** 1,601 KB total / 445 KB gzip across all lazy routes, while the
  **initial + Home closure is 452.8 KB raw**. `QuickReview`, Repo, Settings, and
  AgentPanel remain lazy and do not block Home startup. The suspected "heavy" deps
  (`react-markdown`, `@xterm/*`, `rehype-highlight`, `remark-gfm`) are **imported
  nowhere** — dead dependencies, tree-shaken out of the bundle entirely. Removing
  them from `package.json` is install/supply-chain hygiene, not a runtime win.
- **Render:** `QuickReview` is already heavily memoized (79 memo hooks / 87 states).
  The one real inefficiency was the diff renderer: the parser joined hunk lines into
  a string and the render re-`split` them on *every* re-render. Fixed — hunks now
  carry pre-split `lines` (computed once in the memoized parse). Remaining
  opportunity (only if large diffs ever feel janky): virtualize the diff line list /
  wrap the per-file diff in `React.memo`. Deferred — speculative without a profile,
  and risky in a 6k-line file.

### Bundle budget guard (`bench:bundle`)

Reads Vite's manifest to compute the actual entry + Home static closure and fails
if that exceeds **550 KB raw**, if any individual chunk exceeds **500 KB raw**, or
if the complete lazy distribution exceeds **1,800 KB raw**. This catches startup
regressions without treating intentionally deferred code as startup work:

| chunk / closure | raw KB | gzip KB | note |
|-----------------|-------:|--------:|------|
| initial + Home | 452.8 | — | startup parse boundary |
| `AgentPanel-*` | 457.0 | 114.8 | largest lazy feature chunk |
| `index-*` | 396.7 | 127.4 | entry/vendor |
| `RepoPage-*` | 239.4 | 58.2 | lazy route |
| `QuickReview-*` | 200.8 | 52.6 | lazy route |
| **all lazy routes** | **1,601.3** | **444.7** | distribution guard |

## 4. Release-history graph — backfill, time travel, and scrubbing

The temporal graph reads immutable Git objects without checkout, builds exact
release/HEAD checkpoints, and stores commit-level materialization deltas. The
history path is incremental in four places:

- changed revisions read only changed/deleted Git paths and reuse the previous
  structural snapshot;
- compatible cached deltas resume without rebuilding either side;
- historical source excerpts are omitted while path/line/column anchors remain;
- checkpoints and deltas are zlib-compressed in SQLite instead of duplicating a
  fully normalized graph for every commit.

`flate2` is a deliberate native dependency here. The payloads are immutable,
highly repetitive local JSON, and compression reduced the measured 24-commit
database from about **1.59 GiB to 23.88 MiB** without adding a service or network
boundary.

### Backend baseline

Captured 2026-07-13 on Apple Silicon against this repository in a release build,
using a bounded 24-commit window (310 files, 19,055 nodes, 30,356 edges, two
releases, four checkpoints):

| operation / resource | measured result |
|----------------------|-----------------|
| cold backfill | 19.62 s total |
| checkpoint build | 237.10 ms p50 / 271.95 ms p95 |
| commit delta | 461.62 ms p50 / 552.37 ms p95 |
| one-commit refresh | 622.86 ms |
| exact as-of reconstruction | 119.45 ms p50 / 124.27 ms p95 |
| no-op refresh | effectively 0 ms |
| checkpoint cache hit rate | 16.7% in the measured run |
| SQLite growth | 23.88 MiB total / 1,019 KiB per commit |
| compressed payloads | 11.42 MiB checkpoints / 3.04 MiB deltas |
| process RSS during benchmark | 1,053.5 MiB |
| CPU / filesystem block ops | 28.90 s user + 1.67 s system / 0 reads + 0 writes |

The original full-snapshot implementation took about 95.2 seconds for the same
24-commit shape, produced about 1.59 GiB of SQLite data, and peaked near 1.89 GiB
RSS. Storage and latency are now practical; peak memory during a cold long-lived
backfill remains the main measured pressure point. History stays usable because
backfill runs off the UI thread, publishes progress/coverage, supports
cancellation, and makes HEAD/release checkpoints useful first.

The 2026-07-14 release qualification covers 445 files, 35,775 nodes, and 58,344
edges. Serialized full construction is **369.54 ms** and a one-file refresh is
**235.79 ms**. Delete and rename repair on a deterministic repository fixture are
**0.02 ms** and **0.05 ms** and assert that deleted/old paths leave no stale
nodes. Snapshot transfer costs 25.51 ms, warm status is 1.5589 ms, persistence is
854.91 ms, cold SQLite hydration is 157.08 ms, and in-memory search is
0.1338/0.1481 ms p50/p95. The normalized SQLite graph consumes 82.97 MiB and the
maximum sampled process RSS is 436.5 MiB. Candidate ordering, ambiguity, repair,
and evidence semantics remain deterministic.

The 2026-07-18 candidate indexes 854 files into 81,307 nodes and 143,860 edges.
It measured 1,189.64 ms full construction, 842.13 ms one-file refresh, 0.06 ms
delete repair, 0.08 ms rename repair, 6.654 ms warm status, 3,479.25 ms
persistence, 665.33 ms cold hydration, and 2.0978/2.4725 ms search p50/p95.
The normalized database was 242.21 MiB and sampled peak RSS was 1,037.4 MiB.

The 2026-07-25 workbench rebaseline compared the same current graph engine
against exact `origin/main` and release-candidate trees. The 844-file baseline
produced 85,282 nodes, 150,686 edges, a 253.48 MiB database, and 1,109.9 MiB
sampled peak RSS. The 876-file candidate produced 87,687 nodes and 154,932
edges; its repeated database measurement was 260.24 MiB and sampled RSS ranged
from 1,136.1 to 1,194.6 MiB. Full build, incremental refresh, persistence,
hydrate, and search remained inside their existing ceilings. The resource
ceilings were therefore rebaselined to 272 MiB and 1,280 MiB for this measured
source growth; this is not a larger-repository or asymptotic scaling claim.

The signed-release workflow runs this gate before the Tauri build. These are
fixed ceilings for the current named-machine repository profile, with measured
headroom over the candidate. They are a regression/resource envelope, not a
claim about asymptotic scaling. Material corpus growth requires a separately
recorded multi-size scaling run before any rebaseline:

| operation / resource | release maximum |
|----------------------|----------------:|
| cold full build | 2,200 ms |
| one-file refresh | 1,000 ms |
| delete / rename repair | 100 / 150 ms |
| warm status/no-op | 10 ms |
| persist | 4,000 ms |
| cold hydrate | 750 ms |
| search p50 | 2.5 ms |
| search p95 | 3.0 ms |
| normalized SQLite growth | 272 MiB |
| sampled peak RSS | 1,280 MiB |

The benchmark runner forces one test thread; its previous parallel execution
introduced CPU/SQLite contention and produced incomparable numbers. The cold
build ceiling includes headroom for the observed 1.19–1.91 second named-machine
range while still catching a material regression above 2.2 seconds.

Query relevance uses the checked repository-owned `structural-coverage-v1`
fixture. It covers a cross-package Rust symbol-isolation case and a cross-file
Swift extension case. Across three expected-answer queries,
CodeVetter and the in-memory raw-text baseline both covered 3/3; CodeVetter ran at
0.0026 ms p50 / 0.0036 ms p95 versus raw search at 0.0004 / 0.0004 ms. On the
current 81,324-node CodeVetter candidate, both covered 3/3 expected files; graph
retrieval ran at 1.2433 ms p50 / 1.5140 ms p95 versus the preloaded raw-text scan
at 0.8853 / 1.9763 ms. This does not claim universal ranking: graph retrieval was
slower at the median and faster at p95 for this corpus and query set. Each
latency result covers 200 iterations of three deterministic queries; the raw
baseline excludes filesystem I/O so it does not make graph retrieval look
artificially favorable.

```bash
cargo test --release perf_bench::bench_structural_graph_query_relevance -- --ignored --nocapture --test-threads=1
```

The causal query benchmark seeds 10,000 evidence events: **4.78 ms p50 / 5.12 ms
p95**, with a 7.24 MiB database. Re-run both backend benches from
`apps/desktop/src-tauri/`:

```bash
CV_HISTORY_BENCH_COMMITS=24 cargo test --release bench_history_backfill_incremental_and_as_of_real_repo -- --ignored --nocapture
cargo test --release perf_bench::bench_history_causal_query -- --ignored --nocapture
```

### UI budget

The deterministic data-path benchmark uses 1,500 nodes, 2,200 edges, 500 graph
transitions, and 2,000 revisions:

- topology transition: **1.053 ms p50 / 1.174 ms p95** (8 ms p95 gate);
- bounded revision search: **0.186 ms p50 / 0.203 ms p95** (4 ms p95 gate);
- heap used: **26.5 MiB** (64 MiB gate).

The Playwright scrub test delays mocked background indexing for 1.2 seconds and
measures at least 40 animation frames while the slider changes. The latest
calibrated local qualification measured **8.3 ms p50 / 10.2 ms p95 / 10.3 ms
max**, against enforced
50 ms p95 / 120 ms maximum bounds. Shared hosted runners report these timings
while keeping deterministic interaction assertions enforced. This is a
browser-level responsiveness proxy; the Rust benchmark above separately measures
native backfill CPU, memory, and I/O.

### Production Chrome audit

Captured 2026-07-14 from the optimized Vite output on an unthrottled local
Chrome session. The browser preview loads the same route chunks as the packaged
application; Tauri serves them from local application assets instead of the
temporary loopback preview server.

| route | LCP | CLS | maximum critical chain |
|-------|-----|-----|------------------------|
| Home | 390 ms | 0.025 | 70 ms |
| Review | 386 ms | 0 | 73 ms |
| Repo | 385 ms | 0 | 72 ms |

All requests stayed local, with no image, font, or third-party-origin startup
requests. Chrome attributed **0 ms estimated FCP/LCP savings** to the stylesheet
and found no useful preconnect opportunity.

The interaction trace started a 1.2-second history backfill and scrubbed 60
revision inputs concurrently. It observed **27 ms INP** (1 ms input delay, 6 ms
processing, 19 ms presentation), **0 CLS**, and no estimated interaction savings.
The scrub itself produced 58 measured frames at **8.3 ms p50 / 9.3 ms p95 / 9.3
ms max**, and the 96-node structural projection remained rendered. This audit
also exposed and fixed a foreground/prefetch request-serial race that could leave
the graph stuck on `loading revision`; the Playwright contention test now asserts
that all 96 nodes render before measuring the slider.

```bash
pnpm bench:history-ui
pnpm exec playwright test tests/e2e/repo-unpacked.spec.ts
```

Coverage is intentionally explicit: history is bounded to the requested recent
commit limit; shallow repositories, unsupported languages, missing Git objects,
and parser failures remain visible as gaps. Mandatory reachable-release and HEAD
checkpoints are exact for their recorded coverage. Intermediate states reconstruct
from ordered materialization deltas and fall back to exact Git-object extraction
when a compatible chain is unavailable.

## 5. Local MCP sidecar

`pnpm bench:mcp` builds the release binary, creates an isolated WAL-mode fixture
database, launches the real stdio process, verifies zero TCP listeners and zero
target-repository mutation, then measures initialization and three progressive
query shapes. Captured 2026-07-14 on Apple Silicon after caching HEAD and the
release-tag fingerprint together for one second while retaining per-request
enablement checks:

| operation / resource | p50 | p95 | response |
|----------------------|----:|----:|---------:|
| cold initialize | 5.28 ms | 7.90 ms | — |
| `graph_query` compact overview | 2.34 ms | 2.56 ms | 1,960 B |
| `history_list_releases` | 2.17 ms | 2.43 ms | 1,464 B |
| `history_search` across 10k events | 2.29 ms | 2.53 ms | 1,722 B |
| `history_get_evidence` | 2.16 ms | 2.43 ms | 1,765 B |
| resource listing | 2.15 ms | — | 931 B |

The long-lived fixture contains 10,000 evidence events in a 0.92 MiB database;
the release binary was 7.04 MiB and idle RSS was 12.31 MiB. The earlier small
fixture measured 5.30 ms / 6.18 ms cold initialize p50/p95, 1.37–1.40 ms warm p50,
and 12.22 MiB idle RSS. The first scoped read
after one idle second refreshes Git HEAD and release tags; subsequent queries
reuse both while every request still rechecks repository enablement. A regression
that recomputed the tag fingerprint through Git on every result raised warm p50
to about 9 ms; sharing the bounded freshness cache restored 2.16–2.34 ms p50
without weakening live disable or tag-aware staleness. One of 25 launches was a
442.81 ms cold outlier; p95 remained 7.90 ms.

`bench:mcp` always fails on listeners, repository mutation, protocol framing
errors, or query failures. Its hardware-specific latency and memory ceilings
apply only on the named Apple M5 Pro profile and are listed with the current
qualification below; the sidecar binary ceiling remains 10 MiB.

Rust remains the implementation choice: a Go sidecar would duplicate the canonical
Rust query contracts or pay an IPC hop, while the measured native path is already
roughly 2.2 ms warm with a small standalone footprint. See `MCP-SDK-EVALUATION.md` for
the full dependency and Rust-versus-Go decision.

## 6. Local history MCP

The MCP benchmark uses a separate temporary Git repository and SQLite database;
it never writes to the repository being protected. The qualification fixture has
65 commits, 64 tagged releases, 10,000 history events, 512 structural nodes, and
1,024 edges. Before timing, the harness verifies strict read-only schemas,
non-empty graph/history/evidence results, complete resource pagination, redaction,
the 256 KiB response ceiling, zero TCP listeners, and unchanged protected-repo
HEAD/status.

Run from `apps/desktop/`:

```bash
pnpm bench:mcp:smoke            # quick correctness check; never enforces budgets
pnpm bench:mcp                  # full named-machine qualification
pnpm bench:mcp --skip-build     # reuse an already-built release sidecar
```

Qualification refreshed 2026-07-18 on an Apple M5 Pro with a release sidecar,
3 process warmups, 50 recorded starts, 10 workload warmups, and 200 recorded
rounds. The sidecar now exposes 22 schema-validated tools; each round includes
five individual read workloads plus a true four-request concurrent batch.

| workload | p50 | p95 |
|---|---:|---:|
| process initialize, disk warm | 6.09 ms | 6.33 ms |
| graph query | 5.10 ms | 8.74 ms |
| release list | 5.00 ms | 12.02 ms |
| broad 10k-event history search | 5.73 ms | 11.02 ms |
| evidence hydration | 4.29 ms | 6.28 ms |
| resource list | 3.12 ms | 5.19 ms |
| mixed concurrency 4 | 18.26 ms | 22.58 ms |

The 8.90 MiB sidecar finished at 33.92 MiB RSS and grew 3.16 MiB across the
second half of the recorded rounds. The fixture database shape is unchanged and
the process opened no TCP listeners. Compared with the earlier 13-tool profile,
the broader 22-tool schema and result surfaces cost latency and binary/RSS
headroom; the table records that regression rather than carrying forward the
older measurements.

Absolute gates apply only to the named Apple M5 Pro qualification profile:
initialize 25 ms p95; every individual query 8 ms p50; graph query 12 ms p95;
release list and broad history 15 ms p95; evidence hydration and resource list
10 ms p95; mixed concurrency 22/30 ms p50/p95; final RSS 36 MiB; second-half
growth 8 MiB; binary 10 MiB. Other machines still run every correctness and
safety check but report timings without claiming that these hardware-specific
gates passed.

## 7. Warm local browser verification

The warm-verification qualification uses the checked-in 20-scenario manifest,
one persistent loopback target, and one persistent Playwright Chromium process.
Each recorded invocation includes exact Git worktree collection, deterministic
capability selection, 20 fresh browser contexts, automatic observation,
reporting, and context teardown. Intentional observer-negative fixtures remain
in correctness tests and are excluded from timing samples.

Run from `apps/desktop/`:

```bash
pnpm bench:verify
```

The 2026-07-15 qualification on the Apple M5 Pro used Chromium revision 1217,
two excluded warm-up batches, and 20 recorded batches. Cold harness startup was
1054.265 ms (148.949 ms browser launch; 845.355 ms Vite server readiness). The
qualification target runs React through Vite and installs client-scoped named
state through the real MSW state bridge. Vite's HMR client and target modules
were ready in 787.844 ms before a recorded 250 ms settle window completed.

| batch parallelism | profile p50 | profile p95 | max |
|---:|---:|---:|---:|
| 1 | 9625.403 ms | 9850.835 ms | 9850.835 ms |
| 2 | 5288.303 ms | 5319.061 ms | 5319.061 ms |
| 3 | 4047.724 ms | 4058.937 ms | 4058.937 ms |
| 4 | 3520.239 ms | 3558.023 ms | 3558.023 ms |

Parallelism 4 is therefore the fastest stable default on the recorded machine.
The independent 20-sample gate at that setting passed with **3605.560 ms p50,
4792.196 ms p95, and 5320.379 ms max**, against the required p95 below 30 seconds.

The machine-readable report at
`tests/fixtures/warm-verification/qualification-2026-07-17.json` preserves all
20 invocation durations, target/config/manifest identities, exact benchmark and
app source hashes, machine and browser details, cold startup, HMR conditions,
parallelism profiles, and per-stage summaries. Per-scenario stage values are
summed work time and can overlap under parallel execution; `whole_invocation` is
the wall-clock release gate.

The normal small changed-capability path is measured separately with one exact
mapped scenario; it does not replace or relax the 20-scenario release gate. Run:

```bash
pnpm bench:verify:stability
```

After two warm-ups, 20 whole focused invocations recorded **506.426 ms p50,
512.035 ms p95, and 515.900 ms max**. The focused regression budget is 2000 ms,
leaving operating headroom while remaining materially tighter than the
independent 30-second full-corpus gate.

The same command executed 100 additional warm batches: 80 passes, 10 intentional
deterministic regressions, and 10 cancellations triggered only after scenario
execution started. Every batch closed all contexts and retained the same Vite
and Chromium identities. Peak Node RSS grew 13,582,336 bytes against a
134,217,728-byte budget; second-half median RSS did not grow. Retention finished
at its 20-run cap using 4470 bytes, below its 104,857,600-byte cap. The measured
path recorded only its 110 required Git subprocess calls and zero Cargo, Tauri,
or production-build invocations. Its raw samples, exact source hashes, resource
gates, command audit, and temporary-root cleanup proof are in
`tests/fixtures/warm-verification/stability-2026-07-17.json`.

## 8. Warm-verification implementation growth

The third cleanup gate measured the complete warm-verification surface against
`75f1deb1`, the parent of the first runtime implementation commit. These are
source-line changes, not bundle size:

| Surface | Files | Net lines |
|---|---:|---:|
| TypeScript runtime core | 25 | +9589 |
| TypeScript runtime tests | 26 | +5688 |
| Rust persistence and repository bridge | 2 | +1762 |
| T-Rex UI and focused browser spec | 3 | +999 |
| Review read-only integration and proof | 9 | +710 |
| Qualification scripts | 2 | +890 |
| Browser target, fixtures, and recorded reports | 15 | +3730 |
| Full selected surface, including config/operator docs | 85 | +23701 |

The number is intentionally reported rather than described as small. It includes
5688 lines of unit tests plus checked-in browser fixtures and raw qualification
evidence. The production core is still substantial and should not grow by
copying another runtime or control surface.

The cleanup removed the unused review-specific warm-run column/filter/index,
the backend run-ID fallback, a duplicate current-identity type, an unused CLI
error field, and a 20-row T-Rex read where only the newest row was rendered. It
also found that the existing projection adapter was test-only; deleting it would
have hidden an incomplete spec. The adapter is now used by a bounded read-only
Review history, timeline, same-flow comparison, and historical execution-finding
surface without duplicating legacy QA rows, preferences, controls, or persisted
review-finding indices. That correction made the cleanup slice net +122 lines
across 14 feature files (+228/-106) while closing the missing production path.

## 9. Agent-facing runtime diagnosis (experimental)

The repository CLI can profile one exact Node test, standalone Node benchmark
script, Vitest/Jest test, or Go benchmark and turn the bounded capsule into a
deterministic agent-facing diagnosis. This is separate from the desktop
performance harness above: it is for understanding a target application's
runtime path.

For Node and Vitest workloads, the local flow lane packages this engine as a
machine-queryable product capability rather than a profiling playbook:

The desktop bundle includes the same canonical laboratory behind its shipped
execution CLI:

```bash
codevetter performance-lab \
  --repo /path/to/project \
  --lab-id first-pass \
  --max-steps 8 \
  --json
```

The shipped command accepts the same continuation and optional incumbent plus
exact-correctness acceptance contract.

This bridge requires an existing `node` executable on the developer's PATH and
never downloads one. A missing executable or packaged runtime resource stops
before project execution. This prerequisite matches the initial Node/React and
Go developer audience but is a portability limitation, not an embedded runtime
claim.

The repository-local commands remain the development and reproducibility
surface:

```bash
pnpm --silent runtime:capture-flow -- \
  --repo /path/to/project \
  --adapter node-test \
  --target test/http.test.mjs \
  --name "exact request flow" \
  --samples 3 \
  --warmups 1 \
  --json

pnpm --silent runtime:mcp -- --repo /path/to/project
```

`--silent` is required when pnpm is the launcher because stdout is the CLI JSON
or MCP protocol stream. MCP clients may instead execute
`node scripts/runtime-failure-capsule/mcp.mjs --repo /path/to/project`
directly.

That runtime MCP is currently available from a CodeVetter source checkout. It
is intentionally separate from the bundled `codevetter-mcp` history/graph
sidecar, whose read-only and short-query contract remains unchanged. Agents
using an installed release invoke the execution CLI; distributing a durable
long-running performance-job MCP is still unsupported.

The repository-scoped local MCP keeps the existing closed capture, inspect,
explain, verify, qualification, and evidence-read operations. Its high-level
loops are `run_autonomous_performance_lab` and the browser-specific
`plan_browser_optimization_loop`, `get_next_browser_experiment`, and
`evaluate_browser_experiment` protocol. Captures are held in memory for the
current MCP session, capped at eight, and use opaque IDs. The MCP does not
accept arbitrary commands, patches, or benchmark definitions after startup.

One unprofiled pass supplies the root timing distribution, one separate
diagnostic pass observes loopback `fetch`, Node HTTP server activity, and
request-scoped built-in `node:sqlite` operations, and two independent V8
profile passes test source-candidate repeatability. A separate bounded V8
coverage pass records repository-owned named function call counts without
arguments, return values, or duration. Node tests use raw V8 coverage; Vitest
uses its repository-local V8 provider so transformed modules map back to
original TypeScript. An `AsyncLocalStorage`
request context nests SQLite operations beneath the server flow; startup SQL
outside a request is ignored. The capsule records operation, normalized SQL
shape, outcome, and duration, but never bind arguments or returned rows.

HTTP query strings are discarded, variable-looking path segments and SQL
literals are normalized, and all owned raw artifacts are deleted after
normalization. Child interval union provides accounted and unaccounted time
inside one diagnostic request without double-counting concurrent children.
Because the root timing comes from different executions, child durations are
still not subtracted from the root median.

A V8 source candidate is actionable only when both profile passes select the
same repository-owned file/function and each pass contributes at least five
samples, 10 ms self time, and 10% sample share. Weaker evidence returns
`no_confidence` with a scale-up experiment. Optimization comparison separately
reports whether movement is mechanically confirmed, materially useful, and
strong enough to recommend shipping. Function frequency becomes a repeated-work
candidate only when its source range intersects CPU evidence. Frequency alone
never assigns duration. The MCP verification response returns a compact
comparison and the two capture IDs; it does not duplicate the complete stored
capsules.

Vitest leaf names work inside nested `describe` blocks. CodeVetter accepts the
scope only when exactly one assertion executes; a missing or duplicate leaf
name fails closed. If the repository does not provide Vitest's V8 coverage
provider, function frequency is reported as unavailable while independently
complete timing and CPU evidence remain usable.

```bash
pnpm runtime:diagnose-performance -- \
  --repo /path/to/project \
  --adapter vitest \
  --target src/recommendations.scale.test.ts \
  --name "recommendation catalogue scale profiles representative catalogue sizes" \
  --samples 3 \
  --warmups 1 \
  --json
```

Supported adapters are `node-test`, `node-script`, `vitest`, `jest`, and `go-bench`.
The target must be a repository-contained file and the optional workload name
is applied as an exact selector. `node-script` accepts only `.js`, `.mjs`, or
`.cjs`, supplies no caller arguments, and does not describe exit success as a
correctness check. Profiling uses local runtime primitives and removes its
owned temporary profiles after normalization.

```bash
pnpm --silent runtime:diagnose-performance -- \
  --repo /path/to/project \
  --adapter node-script \
  --target benchmarks/parser.mjs \
  --samples 3 \
  --warmups 1 \
  --json
```

Failed performance passes retain only bounded redacted operational error,
stdout, and stderr on the exact failed execution. Every execution also reports
whether bounded output confirmed the requested workload. This distinguishes a
workload failure from a runner/profiler incompatibility without retaining raw
profiles or successful-run logs.

The `runtime-performance-diagnosis/v1` result separates:

- `observed`: ranked measurements, scale curves, and repository source samples;
- `inferred`: deterministic interpretations that reference observation IDs;
- `unverified`: hypotheses with an explicit falsification step;
- `next_action`: one bounded experiment instead of a list of speculative fixes;
- `verification`: the identical adapter, target, name, and sample policy for a
  before/after comparison;
- `performance_capsule`: the complete bounded source evidence.

For explicit `ms/op` scale metrics, the diagnosis also applies an absolute-cost
guardrail. If the largest recorded supported input is at or below `0.1 ms/op`,
CodeVetter keeps the workload as a regression baseline but does not recommend
source optimization merely because the profiler can identify a hot function.

For runtime-selected repository locations, the diagnosis also includes a
redacted bounded source window and exact matched pattern lines. The first
pattern family recognizes full sorting before a bounded slice, eager mapping,
repeated traversal of the same source collection, and nested collection
lookups. Function anchors are corrected against the original TypeScript source
when a transformed V8 location points above the declaration. These observations
influence a hypothesis only when they intersect runtime evidence; CodeVetter
does not run a repository-wide performance linter.

Node, Vitest, and Jest console benchmark metrics are normalized from the same
`samples` unprofiled timing executions. CPU and memory diagnostics remain
separate. This avoids duplicate runner passes while preventing profiler or RSS
sampling overhead from confirming an optimization.

Vitest specifically uses its JSON and verbose reporters together on those
unprofiled executions. JSON alone suppresses user console output; verbose alone
lacks the structured assertion durations needed for startup-share
classification. CodeVetter accepts only an embedded object matching the Vitest
result shape, then normalizes bounded `[benchmark]` lines after redaction. Both
evidence types therefore describe the same exact execution.

Every exact Vitest pass also uses one fork worker with file parallelism
disabled. This fixes execution topology across timing, RSS, coverage, CPU, and
heap mechanisms, but it does not by itself prevent a bundler from amplifying a
large static fixture. Qualification therefore resolves bounded contained
relative `.json` imports with metadata-only inspection. A file above 1 MiB adds
`large_static_json_fixture_signal`; the flow remains visible but cannot enter
autonomous execution. Small JSON fixtures remain eligible.

Optimization verification also binds both capsules to the same recorded runner
command. Adapter kind alone is insufficient: executable identity, ordered
redacted public arguments, and repository-relative working directory must all
match. A changed worker pool, reporter, loader, benchmark count, executable, or
package root therefore returns `no_confidence` instead of being mistaken for a
product improvement. Capsules missing this command identity also fail closed.
Go capsules additionally bind comparison identity to the fixed profile
iteration count, preventing calibrated and corrected source evidence from being
compared.

V8 source attribution requires the same repository-owned candidate in two
independent profiles plus minimum sample and self-time evidence. A candidate can
be material relative to the full profile, or—when test-runner and dependency
frames dominate—its file can own a majority of the captured application CPU as
long as application work itself clears a bounded total-profile floor. The
report records which materiality mode qualified the candidate.

Use `/performance_capsule` from the diagnosis as the baseline JSON for the next
run. A diagnosis never edits source or invokes a model. `actionable` means the
measurements identify a candidate worth testing; it does not mean the candidate
has been proven causal. A startup-dominated or incomplete run asks for better
evidence instead of naming application code.

After changing one candidate, verify the identical scope against either the
saved performance capsule or the full saved diagnosis:

```bash
pnpm runtime:verify-optimization -- \
  --repo /path/to/project \
  --adapter vitest \
  --target src/recommendations.scale.test.ts \
  --name "recommendation catalogue scale profiles representative catalogue sizes" \
  --baseline artifacts/baseline-diagnosis.json \
  --samples 3 \
  --warmups 1 \
  --json
```

When the laboratory selected a secondary Node allocation candidate, pass its
exact `source.file` and `source.function` with
`--allocation-source-file` and `--allocation-source-function`. The verifier
compares that source in both heap runs. A source decrease cannot confirm an
allocation optimization unless total repository-application sampled bytes also
show a separated improvement; otherwise the result remains inconclusive as a
possible attribution shift.

`runtime-optimization-verification/v1` compares matching scale inputs and units,
or matching Go benchmark timing and allocation metrics. It returns `confirmed`,
`rejected`, `inconclusive`, or `no_confidence`; a failed or incompatible
workload can never confirm an optimization. Explicit in-workload benchmark
metrics are compared independently from process startup timing, so noisy runner
wall time cannot override a stable exact-scope `ms/op` series.

The lab stops with the exact source candidate and durable baseline run. After
one bounded source change, use `runtime:verify-optimization` or the paired lane
below with the same adapter, target, name, runtime, and sample policy. Project-
owned correctness must pass independently; T-Rex remains supplemental browser
smoke and is not performance evidence. The laboratory receipt includes its
bounded executable-flow denominator and next action; coverage is not a second
public workflow.

When both revisions are independently runnable, prefer the paired lane:

```bash
pnpm runtime:verify-paired-optimization -- \
  --baseline-repo /path/to/baseline-checkout \
  --repo /path/to/candidate-checkout \
  --adapter node-test \
  --target test/performance.test.mjs \
  --name "exact performance workload" \
  --samples 3 \
  --warmups 1 \
  --json
```

The two repositories must be distinct, contained runnable checkouts with the
same relative target and exact workload name. CodeVetter alternates baseline and
candidate order for each sample, records `paired_schedule`, and labels the
report `evidence_mode: paired_interleaved`. Any failed run or missing comparable
metric yields `no_confidence`. For Node, Vitest, and Jest, the paired lane
alternates three process-tree RSS passes per side. For Go, CodeVetter first
compiles one owned benchmark binary per side outside the measured interval,
then alternates three direct binary RSS passes so compiler and `go test`
orchestration memory are excluded. Node adapters
additionally alternate two V8 allocation-profile passes per side. Go alternates
two fixed-iteration pprof executions per side and divides each direct repository
`alloc_objects` value by that exact count. Both sides use the smaller derived
count so the profile workload itself is compatible. A
Go source gate activates only when the same application file and function has
non-zero direct allocation evidence in both baseline profiles; cumulative-only
call paths remain diagnostic and cannot become direct-source claims. A 20% and
0.5-object-per-operation source increase rejects the candidate, while a missing
row in two complete current profiles counts as zero. Missing or incomplete
profiles return `no_confidence`. These values are local allocation churn, not
retained heap or peak memory. A qualified Node baseline allocation source
activates an exact-source gate. Median sampled bytes remain visible, but a
verdict uses the complete paired ranges: the largest current run must be at
least 20% and 64 KiB below the smallest baseline run to improve, or the
smallest current run must clear both thresholds above the largest baseline run
to regress. Overlapping and threshold-adjacent ranges remain stable instead of
allowing sampling noise to override an exact-workload result. Incomplete
current profiles return `no_confidence`. Source absence in a complete current
profile counts as zero; profile absence never does. Compatible peak RSS is an independent 10% plus
16 MiB regression gate even when an explicit benchmark metric is primary.
These runs verify sampled allocation churn, not exact retained bytes or leaks.
Use `diagnose-performance` first to identify a source candidate.

The same operation accepts one exact Playwright flow. Changed revisions must
provide explicit sealed source boundaries; the verifier requires every changed
file to stay inside them and the Playwright test itself to remain byte-identical.
The direct CLI example below shows the one-file form. Autonomous campaigns use
their bounded `allowed_files` list for multi-file React changes:

```bash
pnpm runtime:verify-paired-optimization -- \
  --baseline-repo /path/to/baseline-checkout \
  --repo /path/to/candidate-checkout \
  --adapter playwright \
  --target e2e/consumer-flow.spec.ts \
  --name "exact consumer flow" \
  --project mobile \
  --source src/components/Candidate.tsx \
  --samples 3 \
  --warmups 1 \
  --json
```

Baseline and current captures alternate. CodeVetter starts, attests, and stops
the declared Vite runtime for every sample; it does not include browser or Vite
startup in the root-flow metric. A local React optimization is confirmed only
when median root-flow time, renderer JavaScript time, outer-main-frame LCP,
process-tree RSS, final same-page post-GC heap, or a repeated sampled-live
source materially improves without another metric materially regressing. Timing
requires 10% and 10 ms;
RSS uses 10% and 16 MiB; post-GC heap uses 10% and 1 MiB. A new sampled-live
source must qualify in at least two independent current captures before it can
reject a change. The aggregate receipt is durable under
`.codevetter/browser-verifications/`; individual normalized captures remain
under `.codevetter/playwright-runs/`. These are local exact-flow gates, not
production or representative-device claims. When a project is selected, both
sides must resolve the same installed descriptor and compact profile; otherwise
verification stops before making a timing verdict.

## 10. Official 1BRC Node artifact

The repository-owned Node adaptation of the official One Billion Row Challenge
provides enough application work for the runtime tools without a production
database or giant fixture:

```bash
pnpm bench:1brc
```

It deterministically generates 20,000, 200,000, and 800,000
`station;temperature` rows, checks exact count/min/max/sum aggregates, validates
the official sorted min/mean/max output contract with UTF-8 station names, and
emits the existing `size<N>=<duration>ms/op` contract. Dataset construction is
outside the timed region. The benchmark's
[README](../../benchmarks/runtime-challenges/temperature-aggregation/README.md)
contains the exact diagnosis command, while its
[artifact record](../../benchmarks/runtime-challenges/temperature-aggregation/ARTIFACT.md)
records attribution and the differences from the official Java challenge.

The initial qualification used CodeVetter to select the parser at 77.64% CPU
share before source inspection. Replacing per-row string splitting with a
single cursor pass reduced the 800,000-row median from 118.928 to 35.744 ms/op,
and the identical-scope verifier confirmed a 69.945% improvement. A second
micro-optimization improved the largest case by only 8.863% and regressed the
smallest by 4.079%; it was reverted after the verifier returned inconclusive.
See the active OpenSpec
[qualification](../../openspec/changes/add-scaled-parsing-challenge/qualification.md)
for the complete evidence and limitations.

The challenge is not an official submission and does not claim one- or
nine-billion-row performance. Its current boundary is one in-memory generated
string at 800,000 rows. The next useful product lane is chunked input plus
observed peak RSS and bytes processed, not an extrapolated completion time.

## 11. CodeVetter-on-CodeVetter qualification

The runtime tools also have a permanent self-profiling workload around V8
function-coverage normalization:

```bash
node --test scripts/runtime-failure-capsule/function-coverage-performance.test.mjs
```

The synthetic ten-sample stress fixture grew from 1.138 ms/op at 80 source
anchors to 405.185 ms/op at 3,200. CodeVetter localized 56.54% of
repository-owned CPU samples to `collectV8FunctionCoverage` and captured its
repeated source-offset scan. A line-start index plus binary-search lookup
reduced the 3,200-anchor measurement to 4.830 ms/op, a 98.808% improvement for
that deliberately adversarial one-file fixture while exact source-line output
remained unchanged. This is not an end-to-end or representative CodeVetter
speedup.

A follow-up replay used 91 real V8 coverage documents emitted by the full
runtime suite. After filtering the collector's own coverage document so source
offsets remained comparable, 11-run medians improved from 39.873 to 32.652 ms,
or 18.11%, with identical normalized function-output SHA-256. The representative
result is therefore 18.11% for the coverage-normalization stage; 98.808% remains
only the worst-case regression fixture.

The self-trial is also an accuracy fixture. CodeVetter's first inference blamed
a bounded coverage-filename sort even though the workload held file count at
one. That hypothesis was rejected from the captured workload identity before
the observed offset helper was optimized. The active OpenSpec
[qualification](../../openspec/changes/add-runtime-performance-capsules/qualification.md)
records the complete evidence, the conservative shipping limitation, and the
decision-explanation bug found and fixed during the loop.

The autonomous lab now profiles CodeVetter's crowded inventory without
pretending its 128-flow bound is complete. Self-profiling first exposed a
qualification false positive: a synthetic diagnosis test inherited direct
measurement intent from an `allocs/op` assertion literal. Direct Node timing
evidence now requires an executable timing call inside the exact declaration.
On the corrected snapshot, the lab selected the declared Go
`BenchmarkAggregateFile` workload and attributed 27.12% of sampled allocation
objects to `aggregateReader`. Stable aggregate blocks reduced the one-worker
case from 144 to 82 allocs/op and the eight-worker case from 1,221 to 725; the
ten-sample verifier confirmed the change without a latency, bytes/op, or RSS
regression. The compact evidence is recorded in the
[self-improvement proof](../../benchmarks/performance-lab/codevetter-self-proof-2026-08-12.json).

The next Node replay separated whole-process setup from the declared operation.
Although fixture generation was the largest sampled allocator, the lab selected
`parseTextRows` because it was also the leading repeated CPU function. Two
station-interning implementations removed about 99.5% to 100% of that source's
sampled allocation bytes but were rejected: one oscillated around the 10%
latency rejection threshold and the byte parser regressed 27.702%. Both parser
edits were reverted.

After those candidate mechanisms were excluded, the lab selected general text
redaction inside function-coverage normalization. A syntax-conservative fast
path for ordinary function identifiers retained full scrubbing for credential,
path, URL, query, and truncation-shaped values. Three independent ten-sample
verifications improved the 3,200-function point by 41.857%, 44.613%, and
45.421%; the original 16.69–17.12 MB sampled `redactText` source disappeared in
both current heap profiles, RSS did not regress, and a credential regression
test proves the secret is absent. The verifier now correctly treats a
post-change CPU source falling below attribution materiality as non-blocking
when explicit metrics and the activated allocation gate are complete.

The next candidate in the same exact workload was the collector's own metadata
allocation. Replacing one object per discovered function with an index Map and
parallel arrays, then materializing only the final bounded 128 results, reduced
the source's sampled allocation bytes by 50.148%–57.351% across three
independent ten-sample runs. The conservative range still improved
46.166%–54.096%. Largest-input latency moved +0.345%, +3.603%, and +1.495%; RSS
moved +0.498%, +1.681%, and +1.447%, all below regression thresholds and not
reported as latency or peak-memory improvements. Duplicate aggregation,
ranking, source anchors, native coverage, and redaction tests pass.

A subsequent Go `parseTemperature` CPU candidate improved only 0.081% with
unchanged allocations and was reverted as immaterial. This negative result is
retained beside the accepted allocation evidence in the self-proof.

Because candidate identity is bound to changed function context, the lab then
re-profiled the columnar collector instead of suppressing its new behavior. It
localized the residual source to composite identity construction in
`addFunction`. Numeric hashing with exact field comparison and linked collision
chains reduced sampled source bytes by 55.436%, 59.123%, and 55.602%; the
conservative ranges improved at least 48.275%. The 3,200-function point improved
19.723%, 17.394%, and 17.213%, while RSS moved +1.431%, +0.529%, and −0.607%.
A deterministic regression contains two actual 32-bit hash-colliding function
names and verifies distinct identities plus duplicate count aggregation.

The internal Node candidate window now matches the existing eight-key
exclusion budget while each lab invocation still returns only one candidate.
After the first three sources were excluded, a CodeVetter replay reached
`redactCoverageFunctionName` without manual heap-profile inspection. Diagnostic
heap sampling was tightened from 32 KiB to 8 KiB and the interval was added to
paired scope identity, so sparse profiles are more useful and different
sampling densities cannot be compared accidentally. Existing sample-count and
profile-byte limits remain unchanged.

For ordinary names, returning the original string instead of allocating a
redaction-result wrapper removed that source from all six current heap profiles.
Against the same dense baseline, three independent ten-sample verifications
showed conservative total repository-allocation improvements of 15.105%,
19.010%, and 20.622%. Largest-input latency moved -6.255%, +0.546%, and
+0.294%; RSS moved only +0.653%, +0.529%, and +0.373%. Credential and
URL-shaped names still take the full scrubber path. These are exact local
workload results, not production-memory claims.

The next autonomous replay first selected CodeVetter's own heap-profile
serialization (`writeProfile`) with 1.69 MB and 2.06 MB sampled in the two
profiles. That is observer overhead after the measured operation, not product
work. The owned heap preload is now retained as `test_or_harness` evidence but
excluded from application totals and experiment selection. A real replay
completed eight further measurements and screens with no replacement candidate
instead of recommending the profiler itself.

The same replay exposed two admission gaps. Nested TypeScript `node:test`
targets now require a declared contained `tsx` loader and run from their nearest
package root, allowing package-local `tsconfig` aliases without evaluating a
package script. The previously failing desktop history test completed a full
ten-sample profile under `local:node-test+tsx`; three more exact tests passed in
the following lab run, and no material source was invented for the small flow.
Standalone generator/build/publish/migration-style scripts and direct
filesystem-write sources now receive blocking safety flags. This was added
after a benchmark-named dataset generator changed two tracked generated files;
supervision invalidated the result, the two lab-created changes were restored,
and no performance conclusion was retained.

A Significant Hobbies replay then proved the representative-workload loop on a
consumer computation. The first exact suggestion test was rejected at 0.703%
assertion share. A scaled 0/10/50-item contract reached 46.575% and independently
localized repeated title tokenization through allocation and CPU evidence.
Caching each title's tokens for the duration of one call repeated across three
ten-sample verifications: wall time improved 36.868–39.581%, selected-source
sampled allocation improved 96.018–96.085%, total application sampled allocation
improved 92.763–92.798%, and process-tree RSS improved 7.988–10.923%. The full
484-test suite, typecheck, and lint pass. These numbers describe the exact local
workload only; they do not establish production frequency or field-device impact.

The same replay separated compact reporting from incomplete evidence. A fully
parsed heap profile can retain only its top 16 hotspots without setting
`truncated`; actual parser limits and malformed input still do. This preserves
the candidate while keeping the machine-facing report bounded.

The initial Significant Hobbies capsules also had empty `console_metrics`
because Vitest's JSON-only reporter suppressed the scale line. A same-execution
dual-reporter replay retained five-sample medians of 3.981, 5.388, and 9.742
ms/op for 0, 10, and 50 existing items, a 64.084 ms assertion median, and
418,660,352-byte median process-tree RSS. No extra workload execution was added;
these remain exact local comparison values rather than production estimates.

The first dual-reporter replay still lost its allocation finding because the
combined union of two complete heap runs exceeded the public hotspot window.
Aggregation now propagates real per-run truncation only. Replaying the same
scope restored the repeated source and let CodeVetter select the allocation-
heavy `shuffle` path without manual ranking. Parallel typed keys and stable
index ordering preserved the exact hash across nine fixed input/seed cases.
Three ten-sample verifiers reduced conservative source sampled allocation by
24.765–26.387% and total application sampled allocation by 11.977–13.106%; the
50-item metric moved +1.238–1.935% and RSS stayed between −0.797% and −0.008%.
All three runs were shipping-recommended, and the full 484-test suite,
typecheck, and lint pass. These are local allocation results, not retained-heap
or production-impact claims.

A later four-project robustness pass found one additional material candidate:
`qs` flat query parsing improved 45.086% at 40,000 parameters in a ten-pair
interleaved run and passed all 1,045 upstream tests. Picomatch and Pixelmatch
candidates stayed below the 10% materiality policy or regressed, while GJSON's
selected benchmark already reported zero allocations and no material
bottleneck. These negative results are part of the product evidence, not failed
qualification runs.

## 12. Autonomous local optimization campaigns

An optimization campaign turns the single-run profiling primitives above into
a resumable local laboratory. The coding agent still proposes and applies one
bounded source edit. CodeVetter owns the immutable evaluation scope,
correctness-first execution, screening verdict, paired promotion, incumbent,
budgets, and tamper-evident history.

Create `.codevetter/optimization-campaigns/<id>/manifest.json` in the target
repository before initialization. The manifest is closed and versioned:

```json
{
  "schema_version": "optimization-campaign-manifest/v1",
  "campaign_id": "parser-loop",
  "repository_revision": "0123456789abcdef0123456789abcdef01234567",
  "artifact_directory": ".codevetter/optimization-campaigns/parser-loop",
  "allowed_files": ["src/parser.js"],
  "correctness": [
    {
      "adapter": "node-test",
      "target": "test/parser.test.js",
      "name": "preserves parser behavior",
      "timeout_ms": 10000
    }
  ],
  "performance": {
    "adapter": "node-test",
    "target": "test/parser.performance.test.js",
    "name": "profiles representative parser input",
    "project": null,
    "timeout_ms": 30000,
    "screening": { "samples": 3, "warmups": 1 },
    "promotion": { "samples": 10, "warmups": 1 }
  },
  "budgets": {
    "max_experiments": 12,
    "max_elapsed_minutes": 120,
    "max_consecutive_non_improvements": 4,
    "max_consecutive_crashes": 2
  }
}
```

Evaluator targets cannot overlap writable `allowed_files`. Unsupported
adapters, ambiguous test selection, changed manifests, escaping paths,
out-of-scope diffs, incomplete evidence, or altered ledger/evidence digests all
fail closed. Screening can only return `promising`; only correctness-preserving,
ten-sample paired evidence with no blocking limitation can return `keep` and advance the
incumbent.

```bash
pnpm --silent runtime:campaign -- init \
  --repo /path/to/candidate \
  --campaign .codevetter/optimization-campaigns/parser-loop --json

pnpm --silent runtime:campaign -- baseline \
  --repo /path/to/candidate \
  --campaign .codevetter/optimization-campaigns/parser-loop --json

pnpm --silent runtime:campaign -- screen \
  --repo /path/to/candidate \
  --campaign .codevetter/optimization-campaigns/parser-loop \
  --hypothesis "Remove one redundant allocation without changing output." --json

pnpm --silent runtime:campaign -- promote \
  --repo /path/to/candidate \
  --incumbent-repo /path/to/independent-incumbent \
  --campaign .codevetter/optimization-campaigns/parser-loop \
  --hypothesis "Remove one redundant allocation without changing output." --json
```

`performance.adapter: "playwright"` uses the same campaign ledger and may pin a
literal project name in `performance.project`. Its baseline
records exact-flow qualification; screening and promotion both require
`--incumbent-repo`, alternate owned browser captures, apply the manifest's
`allowed_files` as sealed source boundaries, and can advance the incumbent only
from a materially improved, correctness-preserving paired verdict.

The same six operations are available from `runtime:mcp`. Start that server
with `--repo /path/to/candidate --incumbent-repo /path/to/incumbent` so the
promotion checkout is fixed outside tool arguments. The checked-in
[agent program](../../scripts/runtime-failure-capsule/AUTONOMOUS_OPTIMIZATION_PROGRAM.md)
defines the loop and its authority boundary.

Campaign artifacts are local JSON under the declared directory: one manifest,
an atomic append-only `ledger.ndjson`, and bounded evidence blobs. Status is
derived from those records, so restarts cannot reset experiment, elapsed-time,
plateau, or crash budgets. Recovery means fixing the local checkout or
reproducing the incumbent in a separate worktree and calling status again; do
not edit the ledger. The initialization record also pins a digest of the
CodeVetter evaluator implementation; an evaluator upgrade can inspect old
history but must start a new campaign before making new decisions. Removing a
finished campaign is a manual local cleanup choice. The engine installs nothing,
invokes no production or cloud endpoint,
and never commits, pushes, resets source, or manufactures a checkout.

## 13. Qualifying a workload before profiling

Runtime detection proves that a repository contains a supported toolchain; it
does not prove that an arbitrary test is representative enough to profile. Use
the read-only qualification planner before selecting a target:

```bash
pnpm --silent runtime:qualify -- --repo /path/to/repository --json
```

The planner reads bounded manifests and test source without running project
code. It returns package-scoped candidates, exact literal workload identities,
score evidence, possible external-operation flags, and one of `ready`,
`needs_selection`, `no_representative_workload`, `unsupported`, or
`inaccessible`. Only `ready` includes a recipe for the existing profiler; even
then, the result is a candidate and not proof of production representativeness.

A portfolio scan uses an operator-owned manifest so CodeVetter does not assume
a sibling-directory layout or compile private project paths into the product:

```json
{
  "schema_version": "runtime-qualification-portfolio-manifest/v1",
  "repositories": [
    { "id": "catalog-api", "path": "../catalog-api" },
    { "id": "web-client", "path": "../web-client" }
  ]
}
```

```bash
pnpm --silent runtime:qualify-portfolio -- --manifest ./portfolio.json --json
```

Entries are inspected sequentially, output preserves manifest order, and
absolute paths are omitted. The operation does not install dependencies, start
services, use a browser, contact databases or networks, or execute the selected
workloads. Agents can also call the read-only MCP operation
`qualify_runtime_repository` before `capture_local_flow` or an explicit
performance profile.

## 14. Preserving a profiling attempt under failure

Use the outer supervisor when a workload may crash, receive a signal, exceed
its deadline, or produce unusable output. The supervisor writes an initialized
receipt before it launches the existing diagnosis pipeline, updates a bounded
heartbeat, and atomically records one terminal state:

```bash
pnpm --silent runtime:supervise-performance -- \
  --repo /path/to/repository \
  --run-id parser-baseline-01 \
  --adapter node-script \
  --target benchmark/parser.mjs \
  --samples 3 \
  --warmups 1 \
  --timeout-ms 30000 \
  --json

pnpm --silent runtime:inspect-performance-run -- \
  --repo /path/to/repository \
  --run-id parser-baseline-01 \
  --json
```

Artifacts live under
`.codevetter/performance-runs/<run-id>/`. `receipt.json` is atomically replaced
as lifecycle evidence changes; a successful run also owns one validated,
digest-addressed `result.json`. Starting a duplicate run ID fails closed. The
start command exits `0` only for `succeeded` and `2` for every complete but
non-success state. Inspection is read-only and is also available through the
MCP tool `inspect_performance_run`, whose repository is fixed when the MCP
server starts.

The supervisor accepts only existing closed adapters and their exact target and
test-name scope. It does not accept arbitrary executable arguments, inherit
application secrets, install dependencies, contact cloud services on its own,
or alter source control. Child output is byte-bounded and redacted before it can
become failure evidence; successful JSON is redacted, schema-validated, and
hashed before preservation.

Recovery is deliberately conservative. A killed profiling child, timeout,
ordinary exit, spawn failure, or malformed result gets a terminal receipt and
authorizes no performance conclusion. If the supervisor or entire machine dies,
the last initialized/running heartbeat remains, but this version does not
reconcile it automatically or resume partial profiling. Local CPU and memory
limits still come from the workload and per-execution timeout; OS-level resource
budgets are future work.

## 15. Choosing the next local flow

Qualification finds runnable workloads; the flow-campaign planner screens a
bounded safe subset and decides which one deserves an optimization campaign:

```bash
pnpm --silent runtime:plan-flow-campaign -- \
  --repo /path/to/repository \
  --max-flows 3 \
  --samples 3 \
  --warmups 1 \
  --timeout-ms 30000 \
  --json
```

Automatic screening requires direct benchmark timing. Remote-network,
database, browser, integration, and required-argument signals remain excluded;
loopback-only HTTP may run through the closed Node or Vitest adapters. Workloads
that merely contain URL fixture data remain eligible unless they invoke a
network client. Workloads execute sequentially so their CPU profiles do not
contaminate one another. Raw profiles are removed after normalization.

The planner ranks only comparable application metrics: the largest explicit
`ms/op` input or Go `ns/op` converted to milliseconds. Runner wall time is not
treated as product latency. A project can add reviewable product context:

```json
{
  "schema_version": "runtime-flow-priority-manifest/v1",
  "flows": [
    {
      "candidate_id": "0123456789abcdef",
      "frequency_weight": 8,
      "user_impact_weight": 5,
      "rationale": "Runs for every interactive request."
    }
  ]
}
```

Pass it with `--priority-manifest path/to/priorities.json`. The deterministic
ranking is `supported_scale_ms × frequency_weight × user_impact_weight`.
Missing entries use neutral weights and remain explicitly unverified; the
planner never fabricates production frequency. An already-fast flow stays as a
regression guardrail, while the highest-ranked actionable flow becomes the one
handoff to `runtime:campaign`. MCP clients can invoke the equivalent closed
`plan_flow_optimization_campaign` tool.

## 16. React static-redundancy discovery

Runtime profiling cannot identify code that never enters the exercised flow.
For JavaScript and TypeScript repositories, CodeVetter can therefore reuse
already-installed, directly declared Knip and jscpd analyzers. Knip uses the
repository's own configuration; jscpd uses CodeVetter's closed JavaScript and
TypeScript clone policy:

```bash
pnpm --silent runtime:inspect-react-redundancy -- \
  --repo /path/to/react-app \
  --json

codevetter react-redundancy --repo /path/to/react-app --json
```

Agents can call the equivalent MCP tool `inspect_react_redundancy`. CodeVetter
does not use a shell, package-manager fallback, install, cache, watch mode,
Knip fix flag, or jscpd Git blame. Analyzer output, candidate inventory, paths,
execution time, and repository identity are bounded. jscpd writes JSON only to
an owned temporary directory, which is removed after capture. Timeout, malformed
or oversized output, path escape, repository mutation, or excessive inventory
returns no-confidence.

Each analyzer reports repository declaration and local installation separately.
This lets an agent distinguish an analyzer that the project never authorized
from a declared dependency whose local executable is absent or invalid. The
operation still does not repair the project installation or obtain a fallback.

The report deliberately distinguishes unused enum/namespace members, unused
files or dependencies, unused public export surfaces, unused type exports, and
duplicate export groups. A duplicate export group is not duplicate
implementation code. An unused exported symbol may still be used internally;
its candidate is to narrow the export surface, not delete the implementation.
Every item remains `static_candidate`, `safe_to_remove` remains false, and the
report supplies the build/test/flow verification required after an external
edit. Clone candidates retain only format, token and line counts, plus the two
repository-relative ranges. jscpd's source fragment is deliberately discarded.
Its duplication percentage describes analyzed source, not latency, memory,
throughput, or production performance.

The report intersects each candidate range with the same revalidated Git
snapshot. Exact changed-line intersections appear first, then candidates in a
changed or untracked file, then unchanged repository debt. `summary.diff_relevant`
gives the compact review budget. This is snapshot correlation only: one changed
side of a clone does not prove that the current change introduced the clone.

A small contradiction screen also prevents a reported unused dependency from
surviving when a declared package script directly invokes it. The
[2026-08-13 React redundancy proof](../../benchmarks/performance-lab/react-redundancy-proof-2026-08-13.json)
records why this matters: Significant Hobbies' Knip configuration reported
`jscpd` as unused even though a quality script invokes it, so CodeVetter
screened the item out. Anime List retained four unused enum-member candidates
and one export-surface candidate. Repository-wide reference inspection confirmed
that the enum members were neither referenced nor handled by the corresponding
field accessors, while `READ_PAGE_MAX` was used internally but never imported.
Removing those four members and narrowing only that constant's export reduced
the follow-up Knip inventory to zero; 137 product tests, typecheck, lint, and the
production build passed. This is a verified static-hygiene cleanup, not evidence
of a runtime, bundle-size, memory, or production-performance improvement.
CodeVetter retained six type-export candidates in its own repository without
claiming that their internally used declarations were dead.

The same replay also made partial coverage actionable: Anime List and
Significant Hobbies now report `jscpd` as `declared_not_installed`, while Knip
reports a separately verified repository-local executable. Previously both the
undeclared and incomplete-install cases collapsed to `unavailable`.

Self-hosting then reached a different safety boundary: CodeVetter's active
worktree contained 308 changed files, above the fixed 256-file snapshot limit.
The operation now returns a normal `codevetter-static-redundancy/v2`
no-confidence receipt with the observed count, limit, truncated-file marker,
and both analyzers marked `not_run`. It does not rerun or reuse the six
candidates from the older snapshot, and the limit was not raised to make the
self-test pass.

The v2 cross-product run showed the independent coverage boundary. High Signal
had both analyzers installed: CodeVetter observed 73 clone groups across 281
JavaScript/TypeScript sources (1,097 duplicated lines) alongside 55 Knip
candidates. Manual inspection confirmed substantive repeated React filter UI
and API route handlers among the largest groups. PostTrainLLM exposed 73 groups,
including two browser-training drivers sharing 132 lines; Pace had no clone at
the fixed threshold. Anime List retained its Knip evidence while jscpd was
unavailable, and Significant Hobbies retained the screened Knip result while
its declared jscpd payload remained unavailable. These are discovery results,
not verified refactors or performance gains.

The dirty Anime List and Significant Hobbies replays each returned zero
diff-relevant candidates, correctly keeping pre-existing static debt below the
active optimization work instead of presenting it as newly introduced code.

This lane still does not diagnose unnecessary rerenders or bundle duplication.
Those require React commit/runtime and bundler authorities joined to the same
flow and diff rather than inferred from static clone evidence.

## 17. Exact-flow browser loading evidence

An owned Playwright capture now normalizes the selected flow's bounded HAR
resource snapshots into `loading` evidence. It reports resource and transfer-
size coverage, completed-response bytes, failed/aborted request count and hashed
identity, closed resource categories, the eight largest resources, and the
explicit absence of a trustworthy initiator graph. Earliest, slowest, and
largest resources share the existing bounded trace inventory.

The two totals have deliberately different authority. `complete_transfer_bytes`
is present only when every retained resource has a transfer size and the trace
was not sampled. `completed_responses.complete_transfer_bytes` may still be
complete when failed or aborted requests have no size; it excludes those
requests and request bytes. Paired verification can compare that second metric
only across three compatible captures per side when the failed-request count
and hashed identity set are unchanged. A 10% and 64 KiB decrease can confirm a
local loading improvement; the equivalent increase is a regression guard.

For Vite development routes, an entry is repository-owned only when the
query-free decoded route resolves to one contained regular source file outside
generated and dependency directories. The compact receipt separately ranks up
to eight such repository modules. Generated Next chunks, Vite dependency
optimizer output, ambiguous paths, symlinks, and missing files remain
unresolved. Credential-shaped opaque path segments are redacted while the
request retains a SHA-256 identity for compatibility checks.

The
[2026-08-13 browser-loading proof](../../benchmarks/performance-lab/browser-loading-proof-2026-08-13.json)
records the same feature on Anime List and Significant Hobbies. Anime's Vite
flow mapped 32 local modules, while the Next flow correctly mapped none of its
generated chunks. Both produced complete completed-response totals and
incomplete all-resource totals because denied or aborted requests had no
transfer size. A same-snapshot repeat preserved each failed-request digest;
Anime's byte total was identical and Hobbies moved by 75 bytes. These local
development captures do not claim an optimization, production bundle size,
compression, CDN/cache behavior, representative devices, network latency, or
user impact.

## 18. Playwright action-window diagnosis

The browser result now preserves a bounded action timeline in addition to the
aggregate flow. Modern combined `action` records and legacy `before`/`after`
pairs normalize to closed framework identities such as `frame.goto`,
`frame.click`, `frame.expect`, and `frame.evaluateExpression`. Categories
separate setup, navigation, interaction, input, wait, assertion, evaluation,
observation, and other work. Known CodeVetter network-interception setup is
excluded.

The public inventory retains at most 64 completed actions: half of the budget
protects sequence order and the remainder protects the slowest tail. Compact
evidence includes the first 16 and slowest 8. Each entry contains duration,
completion state, resource starts, completed/failed response counts, a complete
completed-response byte total when available, the three largest query-free
redacted resources, and renderer long-task overlap. Selectors, parameters,
input values, arbitrary test titles, call identities, attachments, absolute
paths, and error details are discarded.

This is intentionally an action *window*, not a causal stack. Playwright action
time includes browser waits and framework overhead. A request beginning or a
long task overlapping the window does not prove that the action initiated it,
that an application function owns it, or that its entire duration belongs to
the action. Nested actions may reference the same observation.

The
[2026-08-13 browser-action proof](../../benchmarks/performance-lab/browser-action-proof-2026-08-13.json)
shows the distinction on real product flows. In Anime List, CodeVetter followed
the existing interactive journey through navigation and assertions to the
28.239 ms `Add to List` click, then surfaced the completed
`/api/watched/add` response in that window. In Significant Hobbies, it showed
HMR resources beginning during the local-storage evaluation and explicitly
kept that as temporal overlap rather than blaming the evaluation. Both action
inventories were complete and unsampled; neither single local capture proves an
optimization or production impact.

## 19. Owned browser-to-server correlation

For an eligible CodeVetter-owned config-disabled Next runtime, the primary
Playwright pass now sends one validated `x-codevetter-capture` identity. The
owned Node preload admits only matching requests and streams bounded completed
server events while the process is still alive. Separate React and memory
passes omit the header. Request-scoped built-in SQLite and loopback `fetch`
operations retain their AsyncLocalStorage parent, normalized operation shape,
duration, and contained diagnostic call site when available.

The result joins browser and server observations only when method and normalized
query-free route occur exactly once on both sides. It does not compare their
clock domains. Repeated identities remain ambiguous. A browser resource may be
associated with a retained Playwright action window, but that remains temporal
evidence rather than proof that the action initiated the request. Per-request
accounting unions supported child intervals before reporting residual time; it
does not sum overlap or call the residual exclusive handler CPU.

The deterministic `browser_server_unaccounted_time` detector reports one
material residual request but never makes it source-edit eligible on residual
evidence alone. Agents first need a supported child operation, a contained
handler source, or a narrower experiment, followed by identical correctness-
passing paired verification.

The
[2026-08-13 browser-server proof](../../benchmarks/performance-lab/browser-server-proof-2026-08-13.json)
exercised a real High Signal Next/Playwright flow. Ten scoped server requests
were retained and nine joined uniquely to the navigation. `GET /` took
853.396 ms server-side, nearly the same as its 854.597 ms browser resource
interval, with no supported child operation; CodeVetter correctly labeled the
853.396 ms residual rather than blaming application code. Static Next routing
uniquely mapped that request to `src/app/page.tsx:13`, but the detector retained
the route as an inspection starting point rather than runtime causation. The product assertion
failed under config-disabled Next, so the artifact authorizes no optimization.

That run also found and fixed three cross-project harness gaps: owned Next had
rewritten tracked `next-env.d.ts`, Playwright device lookup started from the
monorepo root instead of the selected package, and the repository Playwright
revision lacked its managed browser. The final run suppressed the two known
Next TypeScript metadata writes, resolved Playwright from the exact target
package, used installed system Chrome with explicit receipt provenance, left
the source tree clean, and stopped its server.

Unsupported lanes stay closed. An existing listener is unowned; Vite is a
frontend development server rather than the application backend; a Next
package with a loadable development env file remains blocked without reading
it; and Go request correlation requires explicit repository/OTLP integration.
These boundaries preserve the existing Go CPU/allocation profiler and browser
evidence without fabricating server, database, production, or scale claims.

## 20. Isolated owned-request CPU sampling

For capture-scoped dynamic requests in an owned Next runtime, CodeVetter now
starts a bounded V8 CPU profile immediately before handler dispatch and stops it
after the response completes. It profiles at most eight requests, skips Next
assets and extension-shaped routes, and permits only one process-wide profile at
a time. An overlapping captured dynamic request marks the active profile
contaminated and removes every source candidate.

Raw profiles live only in the owned temporary runtime directory and disappear
during cleanup. Public evidence contains sample totals, a closed sample-scope
breakdown (repository, dependency, generated, runtime, idle, unresolved), and
at most eight candidates. A candidate needs at least five samples and 10% of
the entire request profile. Its source must resolve to a regular contained file
either directly or through a closed Next server `webpack-internal` URL.
Dependency, generated, malformed, oversized, uncontained, and secret-shaped
frames cannot become candidates.

The deterministic `browser_server_cpu_hotspot` detector can narrow a hypothesis
to observed repository self-CPU, but a single capture is never edit-eligible.
Profiler startup deliberately precedes handler dispatch and perturbs the run;
the flow must still pass project-owned correctness and a compatible paired
measurement must improve end-to-end behavior.

The
[2026-08-13 request-CPU proof](../../benchmarks/performance-lab/request-cpu-proof-2026-08-13.json)
demonstrates both outcomes. A controlled Node fixture located its 40 ms hot
repository function, skipped a static resource, and rejected an overlapping
profile. The real High Signal `GET /` request retained 16,089 samples across
2,259.708 ms: 15,481 idle, 391 dependency, 203 runtime, 6 generated, 8
unresolved, and zero repository samples. CodeVetter therefore returned
`insufficient_evidence` and no source candidate. That is materially stronger
than the earlier static route hint: it shows that this development request is
not evidence for optimizing `src/app/page.tsx`, while still making no
production, scale, or successful-flow claim because the assertion failed.

## 21. Request-context async callback delay

The owned Node diagnostic pass now observes the time from creation to the first
callback for a closed set of async resource categories: timers, immediates,
filesystem work, DNS, connects, and selected worker-pool operations. Capture is
limited to resources created under the exact matching request context, completed
before that response, delayed by at least 1 ms, and admitted within a 256-resource
pending bound. Generic promises, ticks, sockets, handles, resource values, raw
async identities, callback arguments, requested timer delays, filenames, hosts,
and addresses are not retained.

Each request exposes at most eight resources, an explicit complete/incomplete
inventory, and unioned temporal overlap. This evidence is intentionally separate
from supported database/HTTP child accounting and is never subtracted from
residual request time. AsyncLocalStorage propagation shows request context, not
that the response awaited a callback or that the callback was on the critical
path. Consequently, the deterministic `browser_server_async_delay` detector is
never edit-eligible from a single observation; a source-bounded candidate still
needs project correctness and compatible paired end-to-end improvement.

The
[2026-08-13 request-async proof](../../benchmarks/performance-lab/request-async-proof-2026-08-13.json)
demonstrates the distinction. A controlled fixture retained an awaited timer,
excluded a post-response timer, normalized filesystem work without values, and
proved bounds, overlap union, and truncation semantics. In the real High Signal
flow, `GET /` took 1,091.445 ms and retained a 498.46 ms timer first-callback
delay in its request context. No contained creation source was resolved, so
CodeVetter reported low confidence and refused an experiment. The product
assertion also failed under config-disabled Next; the run therefore proves the
evidence and refusal paths, not an optimization or production impact.

## 22. Response-finalization async lineage

Request context alone admitted a bad ranking failure: a large background timer
could look more important than a smaller callback that actually fed response
completion. The owned preload now keeps a private bounded scheduling lineage
for active dynamic requests. Trigger edges propagate the identities of
supported async callbacks; promise resolution propagates those identities to
already-created continuations. Destroyed resources are released after their
lineage has been forwarded. At `response.end`, only the resulting supported
ancestor set is retained long enough to classify completed callbacks.

Public evidence exposes only `response_completion_descendant`, `context_only`,
or `unknown`, plus bounded timing. It never exposes async IDs, promises, the
private graph, or resource values. A complete context-only relationship is now
dismissed by the response-bottleneck detector. A linked callback may clear the
absolute 5 ms delay floor without also occupying 20% of a long request. An
unknown relationship keeps the older request-share threshold and the explicit
incomplete-evidence warning. None of these states proves JavaScript `await`
syntax, exclusive blocking time, a complete critical path, or a safe edit.

The same cross-product iteration removed two execution barriers. Static
qualification now resolves a narrow source-declared pattern such as
`process.env.PORT ?? '3000'` feeding one loopback URL template and shorthand
`baseURL`; it never reads the actual environment. This changed Karte from zero
to twelve capture-eligible desktop/mobile flows. Its checkout lacked a local
Next package, so execution still stopped without installing anything. When a
declared port is occupied by an unrelated process, a config-disabled owned Vite
or Next capture may instead lease one ephemeral port on the same loopback host.
Only the port changes, the existing listener is never stopped, and the owned
process must still pass repository/family attestation and bounded cleanup.

The
[2026-08-13 response-lineage proof](../../benchmarks/performance-lab/response-lineage-proof-2026-08-13.json)
records the resulting real replay. Polaris remained healthy on port 3000 while
CodeVetter ran the existing High Signal flow on owned port 61440. For the
1,537.079 ms `GET /`, the retained set contained three response-completion
descendants (18.345, 8.071, and 7.582 ms) and five complete context-only
callbacks, including a 498.89 ms timer. The corrected detector selects the
18.345 ms descendant and dismisses the much larger background timer as a
response bottleneck. No creation source was resolved and the existing heading
assertion failed, so the result remains low-confidence and edit-ineligible.
An immediately preceding repeat selected a 20.459 ms descendant and dismissed
another 498.915 ms context-only timer, preserving the classification while
timings varied. The sampled Playwright-plus-Next process tree peaked at 1.90 GB; that is local
diagnostic-run overhead, not steady application or production memory.

## 23. Direct async creator source authority

Async initialization stacks can lose an application caller when a public
promise-based Node API creates its resource inside runtime internals. The owned
diagnostic preload now hands a contained source through a closed set of global
timers, `node:timers/promises`, and `node:fs` promise methods. Public evidence
labels this stronger observation `node_async_creator_callsite`, while ordinary
initialization-stack evidence remains `node_diagnostic_callsite`. Arguments,
paths, requested delays, resolved values, resource objects, callback data, and
raw async identities are never retained.

The handoff is deliberately direct. If the first external caller is in
`node_modules` or outside the repository, CodeVetter records no source instead
of skipping that frame and blaming an application ancestor. It also does not
fill a missing creator from static route ownership or the frame that later
calls `response.end`. Source provenance can improve an agent's starting point,
but it still cannot authorize an edit without exact correctness and paired
end-to-end improvement.

The
[2026-08-13 async-creator proof](../../benchmarks/performance-lab/async-creator-source-proof-2026-08-13.json)
captures both sides. Controlled execution preserved the direct caller for
promise timers and filesystem reads, kept API behavior unchanged, removed
private values, and left a dependency-owned timer source-null. The unchanged
High Signal replay then retained a 19.345 ms response-completion timer inside a
2,049.115 ms `GET /`, but its source correctly remained null; the 498.684 ms
unknown-lineage timer was also unattributed. The detector returned low
confidence with zero edit-eligible findings. The existing browser assertion
failed and the local config-disabled Next process tree peaked near 1.90 GB, so
this is attribution/refusal evidence rather than an optimization or production
performance claim.

## 24. Closed Next request phases

The owned Next diagnostic runtime now consumes the framework's existing
performance-measure bridge under one fixed CodeVetter prefix. It maps only
three exact names into public categories: route resolution, component-tree
creation, and client-component loading. A measure is admitted only while the
exact correlated dynamic request is active. Static assets, unrelated requests,
unknown names, out-of-request measures, raw names, attributes, detail, routes,
application values, and source locations are excluded.

Each request exposes at most eight ordered phases, an explicit complete or
incomplete inventory, and interval-union overlap. These intervals stay separate
from supported database and HTTP child accounting: they are neither added nor
subtracted as exclusive time. The deterministic phase detector requires both
5 ms and 20% of the parent request, refuses incomplete inventories, and is
always source-null and edit-ineligible from one observation.

The
[2026-08-13 request-phase proof](../../benchmarks/performance-lab/node-request-phase-proof-2026-08-13.json)
shows why refusal matters. In the unchanged High Signal replay, `GET /` took
2,356.447 ms. Its complete framework-phase inventory contained route resolution
(0.142 ms), component-tree creation (0.663 ms), and client-component loading
(0.016 ms), for 0.821 ms of unioned overlap—about 0.035% of the request. The
detector ran and produced no finding. This rules out those observed phases as
the material bottleneck in that capture; it does not explain the remaining
request time or prove that every Next phase was measured. The existing exact
browser assertion timed out, and the run used local config-disabled Next, so
the artifact authorizes no optimization, source edit, or production claim.

## 25. Same-runtime Next preflight timing

The owned Next runtime now replaces the boolean-only route warmup with exactly
two sequential body-free GET observations under the same ten-second deadline.
It retains only ordinal, rounded duration, status class, and completeness. It
does not follow redirects or retain bodies, headers, URLs, queries, routes, or
application values in runtime evidence. Vite and existing unowned listeners do
not receive preflight timing authority.

The exact browser capture compares those observations only with one uniquely
correlated `GET` server request whose static route and status class match. Fixed
100 ms and 2× thresholds yield a closed classification: first-preflight
outlier, browser-request outlier, repeated high latency, no material outlier, or
insufficient evidence. A material classification is always source-null,
low-confidence, and edit-ineligible. It describes timing shape; it does not call
the gap compilation, cache work, exclusive server time, or production impact.

The
[2026-08-13 Next preflight proof](../../benchmarks/performance-lab/next-preflight-timing-proof-2026-08-13.json)
shows the distinction on unchanged High Signal. The first `GET /` preflight took
2,183 ms, its immediate repeat took 842 ms, and the later browser-correlated
request took 1,175.502 ms. CodeVetter classified a first-preflight outlier: the
first request was 2.59× the repeat, while the browser request was only 1.40× the
repeat. This is evidence that an initial-route effect exists, but it is not an
explanation for all latency because both later observations remained expensive.
The browser request still had 1,175.502 ms unaccounted, only 0.674 ms in the
closed Next phases, and zero repository CPU samples. The existing exact
assertion timed out, so the finding authorizes no edit or optimization claim.

## 26. Node response API boundary partition

The owned Node preload now observes four per-request response API boundaries:
the first commitment call, optional first body-production call, `end` call, and
`finish` event. It delegates with the original receiver and arguments and never
inspects headers, body chunks, argument values, socket state, or application
data. Explicit headers, implicit headers, streamed responses, and empty
responses retain their normal behavior; malformed or incomplete timing fails
closed.

A complete request is partitioned into preparation (request start to first
commitment), emission (commitment through `end`), and finish tail (`end` through
`finish`). These are elapsed API intervals, not browser/network TTFB, byte
delivery, exclusive CPU, or framework phases. They stay outside child-operation
accounting. The deterministic detector requires both 5 ms and 50% of the parent
request, and its result is always source-null, low-confidence, and
edit-ineligible.

The
[2026-08-13 response-boundary proof](../../benchmarks/performance-lab/node-response-boundary-proof-2026-08-13.json)
narrows the unchanged High Signal replay without overstating it. Its correlated
`GET /` took 984.979 ms: 954.632 ms (96.9%) elapsed before the first response
commitment, 30.209 ms from commitment through `end`, and 0.138 ms through
`finish`. The previously captured Next phases overlapped only 1.215 ms, no
supported child operation appeared, and no repository CPU sample was retained.
CodeVetter can therefore direct the next probe into the pre-commit interval, but
cannot yet distinguish compilation, rendering, data access, waits, or an
application source. The existing exact assertion timed out, so this is bounded
local diagnostic evidence rather than an optimization or production claim.

## 27. Pre-commit process CPU pressure

The owned Node runtime now snapshots `process.cpuUsage()` at request admission,
first response commitment, and finish. Public evidence retains only user/system
deltas, totals, CPU-to-wall ratios, and bounded overlap counts; absolute process
counters and request identities are discarded. Pre-commit overlap is tracked
separately from whole-request overlap, so static resources that begin after a
document commits do not erase the earlier isolated interval.

A material complete pre-commit interval is classified with fixed thresholds:
at least 0.5 is high process CPU, at most 0.2 is low observed process CPU, and
the interval between is mixed. This ratio is not utilization and may exceed one
when multiple process threads consume CPU. Even without admitted request
overlap, the measurement is process-wide and can include background work. Every
classification is therefore source-null, low-confidence, and edit-ineligible.

The
[2026-08-13 pre-commit CPU proof](../../benchmarks/performance-lab/node-precommit-cpu-proof-2026-08-13.json)
records the corrected unchanged High Signal replay. `GET /` took 1,269.592 ms,
with 1,225.79 ms before commitment. The process consumed 524.729 ms of CPU in
that interval, a 0.4281 CPU-to-wall ratio, so CodeVetter classified it as mixed
rather than CPU-heavy or low-observed-CPU. Seven static requests overlapped
later, while none overlapped pre-commit. The capture also retained 549.325 ms of
overlapping async delay, but that inventory was incomplete and cannot be added
or called exclusive waiting. The exact Playwright assertion failed, so the
result requests a narrower probe and authorizes no optimization or production
claim.

## 28. Closed pre-commit probe routing

The request CPU profile now retains a complete pre-commit slice by walking V8
sample deltas up to the first response-commit boundary. That slice exposes only
bounded time and closed repository, dependency, generated, runtime, idle, and
unresolved categories. Truncation, overlap, a boundary outside the profile, or
malformed evidence fails closed.

The deterministic router reconciles that slice with process CPU, response-linked
async overlap, and closed framework phases. It selects one main-thread scope,
off-main/background capture, async kind, framework phase, mixed evidence, or a
specific missing observation. Routing is always source-null, low-confidence,
and edit-ineligible. It identifies what the agent should measure next; it does
not identify a cause.

The autonomous lab also distinguishes a validated failed-flow diagnosis from a
successful trace and an operational capture failure. It verifies the persisted
result bytes, digest, and compact diagnosis, then can inspect that diagnosis
without recapturing the browser flow. Failed correctness remains explicit and
cannot authorize an optimization.

The
[2026-08-13 probe-routing proof](../../benchmarks/performance-lab/node-precommit-probe-routing-proof-2026-08-13.json)
records one unchanged High Signal lab. `GET /` spent 1,630.353 ms before commit
and the process consumed 507.435 ms CPU. The complete pre-commit main-thread
slice retained 232.086 ms non-idle time, 45.74% of observed process CPU, with
195.755 ms classified as runtime. CodeVetter therefore selected
`capture_worker_or_background_cpu` instead of blaming application code. The lab
then consumed the failed exact-flow diagnosis as a second step without
recapture. The assertion remained failed, the async inventory remained
incomplete, and no source edit or performance improvement was claimed.

## 29. Request-correlated Node Worker CPU

The owned Node preload now registers public CommonJS and ESM `Worker`
construction without retaining constructor arguments, worker data, messages,
environment, thread IDs, or paths. On one selected dynamic request it admits at
most four already-online Workers, snapshots their CPU usage, starts their V8 CPU
profiles before handler dispatch, and stops them at the first response
commitment. Late creation, exits, overlap, unsupported runtimes, truncation, or
incompatible intervals remain explicit instead of being interpreted as zero.

Public evidence is anonymous and bounded. It exposes per-Worker ordinals, CPU
deltas, interval offsets, and closed repository, dependency, generated,
runtime, idle, or unresolved sample scopes. Raw profiles stay in temporary
capture storage. Node versions before 24.8 report unsupported Worker CPU
profiling rather than silently producing empty evidence.

The deterministic router preserves main-thread precedence. Otherwise, Worker
CPU must reach both 5 ms and 20% of observed pre-commit process CPU, with a
25 ms interval tolerance. It can select a Worker scope, request better Worker
attribution, or move the next observation to child-process/native/background
CPU. Every route remains source-null, low-confidence, and edit-ineligible.

The
[2026-08-13 Node Worker CPU proof](../../benchmarks/performance-lab/node-worker-cpu-proof-2026-08-13.json)
records an unchanged High Signal replay. Its `GET /` spent 1,216.029 ms before
commit and used 510.433 ms of process CPU. The complete pre-commit slice retained
266.334 ms of non-idle main-thread samples, 52.18% of process CPU, dominated by
runtime frames. The new Worker lane was supported and complete but observed
zero registered Workers and zero Worker CPU. CodeVetter therefore kept
`inspect_main_thread_runtime` instead of forcing the earlier
Worker-or-background hypothesis. The autonomous lab verified and reused that
durable failed-flow diagnosis without recapture. This rules out registered Node
Workers only for this local interval; child processes, native threads, libuv
work, production behavior, and a source optimization remain unproven.

## 30. Exact Node main-thread CPU reconciliation

Node 22.19 and newer expose current-thread CPU counters separately from
process-wide CPU. The owned preload now snapshots the process counter before
the thread counter at admission, then the thread counter before the process
counter at response commitment and finish. This deliberately encloses the
thread interval inside the process interval. Only deltas survive normalization;
absolute counters, thread IDs, process IDs, and machine identity are discarded.

The public process CPU evidence now carries a closed thread partition:
`observed`, `unsupported`, `incomplete`, or `inconsistent`. An observed partition
contains rounded main-thread and other-thread CPU totals and ratios for both the
pre-commit and whole-request intervals. The two parts must reconcile to process
CPU within 1 ms. Older Node evidence remains valid with an explicit unsupported
partition rather than a fabricated zero.

Exact CPU now decides whether work belongs to the request-handling thread. The
V8 profile only names repository, dependency, generated, or runtime scope after
the exact main-thread CPU crosses the fixed 5 ms and 50% thresholds. Worker CPU
is compared with the compatible other-thread residual, not total process CPU;
Worker over-accounting fails closed. The remaining terminal probe is native,
V8-background, or libuv-thread activity. Child processes are excluded because
Node's process CPU counter does not include their CPU; their cost requires a
separate end-to-end flow contract.

The
[2026-08-13 exact main-thread CPU proof](../../benchmarks/performance-lab/node-main-thread-cpu-proof-2026-08-13.json)
records an unchanged High Signal replay. Its `GET /` spent 1,718.955 ms before
commit and consumed 449.793 ms of process CPU. Exact current-thread CPU was
269.254 ms (59.86%); other threads in the same process consumed 180.539 ms.
Compatible V8 sampling retained 209.831 ms of non-idle time, with 175.043 ms in
runtime scope, so CodeVetter selected `inspect_main_thread_runtime` from exact
thread ownership plus sampled scope—not by treating sampled time as exact CPU.
The complete Worker inventory again observed zero Workers. The autonomous lab
verified the durable failed-flow diagnosis without recapture. The assertion
remained failed, so the result authorizes no source edit or optimization.

## 31. Request-scoped Node native activity

The owned Node runtime now enables a fixed trace-event category set immediately
before one selected dynamic handler dispatch and disables it at first response
commitment. A private monotonic marker joins the trace to the exact request. The
collector reads at most 16 MiB and 50,000 events from the still-live partial
trace container, accepts only complete JSON event objects, and fails closed on
malformed, oversized, unpaired, truncated, overlapping, or unsafe evidence.

Public evidence retains only closed libuv threadpool classes and V8 GC or
compilation classes, with counts and unioned elapsed activity. Raw names,
arguments, IDs, thread and process identity, absolute timestamps, paths,
versions, and application values are discarded. The elapsed intervals are not
CPU: CodeVetter never subtracts them from CPU, divides them by CPU, or claims
that temporal overlap caused exact other-thread CPU.

After exact main-thread and public Worker evidence have been reconciled, at
least 5 ms of compatible libuv execution activity can select a narrower
`inspect_libuv_threadpool_<class>` probe. Complete zero activity advances to
deeper native-thread CPU sampling; unsupported, incomplete, contaminated,
invalid, and interval-incompatible states each request a specific recapture.
All routes remain source-null, low-confidence, and edit-ineligible.

The
[2026-08-13 Node native-activity proof](../../benchmarks/performance-lab/node-native-activity-proof-2026-08-13.json)
includes a controlled real `pbkdf2` handler that selects the crypto probe and an
unchanged High Signal replay. High Signal's `GET /` retained 5 zlib intervals
covering 0.048 ms, 257 GC intervals covering 13.636 ms, and 23 compilation
intervals covering 0.076 ms inside the 3,066.092 ms observed interval. The
libuv work stayed below the 5 ms floor, so the proof claims capture and
normalization—not a bottleneck or optimization. The existing assertion failed,
so it authorizes no edit.

## 32. Durable browser-probe inspection

The repository CLI operation `inspect-browser-probe` and MCP tool
`inspect_browser_probe` reload one diagnosis by capture ID. The loader accepts
only the fixed `.codevetter/playwright-runs/<capture-id>` location, checks
regular non-symlink receipt and result files, verifies byte count and SHA-256
digest, recomputes the compact diagnosis, and requires the caller's probe name
and retained server-request ordinal to match exactly.

The result contains only the selected request's identity, response timing,
process/thread CPU, Worker and native summaries, and at most eight compatible
repository-contained source candidates. Main-thread and Worker samples,
libuv-compatible async callsites, response-linked async callsites, framework
context, and the common incomplete async/framework inventory gap use closed
mappings. Unknown probe families fail closed.

This is a read-only evidence projection, not another profiler run. A candidate
is a non-causal correlation and remains low-confidence, edit-ineligible, and
subject to a correctness-passing recapture. A changed source snapshot returns a
stale result with no candidates; a failed assertion cannot be overridden.

The
[2026-08-13 browser-probe inspection proof](../../benchmarks/performance-lab/browser-probe-inspection-proof-2026-08-13.json)
replayed an unchanged High Signal capture through both operations. They returned
the same normalized object for exact `GET /` request ordinal 1. Its async
inventory was incomplete, so CodeVetter returned no source candidate and the
specific action `recapture_same_exact_flow_with_complete_async_and_framework_inventories`.
That is a tooling proof and refusal result, not an optimization claim.

## 33. Executable browser-probe recapture

The CLI operation `recapture-browser-probe` and MCP tool
`recapture_browser_probe` execute the supported durable inventory and
main-thread runtime probes. The caller supplies only the
prior capture ID, its exact probe, a new recapture ID, and an optional bounded
timeout. CodeVetter validates the prior receipt/result/diagnosis/snapshot,
resolves the same target, test name, and browser project through qualification,
and reuses its owned local Vite/Next runtime and exact Playwright capture. The
caller cannot provide a command, base URL, environment, filesystem path, or
network policy.

Ordinary browser captures still retain at most eight async resources and eight
framework phases per server request. This one probe selects a closed expanded
profile capped at 32 of each. Full captured intervals still drive overlap union
and request accounting, so expanded presentation cannot change elapsed-time or
CPU semantics. Counts beyond 32 remain explicitly incomplete.

Each attempt writes
`.codevetter/browser-probe-runs/<recapture-id>/receipt.json`. The receipt binds
the old and new capture identities, probe, exact request ordinal, source
snapshot, local-runtime cleanup, requested inventory outcome, Playwright
correctness, and capture digests. Evidence completion is independent from test
success and remains low-confidence, non-causal, edit-ineligible, and
correctness-gated.

The
[2026-08-13 browser-probe recapture proof](../../benchmarks/performance-lab/browser-probe-recapture-proof-2026-08-13.json)
used both product surfaces on unchanged High Signal. Each recapture expanded the
root `GET /` request from 8 of 12 async observations to all 12 of 12, while
retaining all 3 framework phases. Both assertions failed. One run's pre-commit
CPU ratio was 0.2077 and selected `inspect_main_thread_runtime`; the other's was
0.1946 and selected `capture_narrower_precommit_evidence`. That threshold
instability is a remaining product gap, not evidence for choosing whichever
diagnosis looks more actionable.

The operation runs only local application and Chromium processes and makes no
production or cloud call. It still consumes local CPU, memory, and wall time.
Other emitted main-thread, Worker, libuv, response-linked async, and narrower
pre-commit probes remain inspection-only until each has genuinely different
bounded instrumentation.

## 34. Repeated browser-probe stability

The read-only CLI operation `assess-browser-probe-stability` and MCP tool
`assess_browser_probe_stability` compare two to five durable recaptures. Each
probe receipt and linked Playwright receipt/result is revalidated before the
comparison. Runs must share the exact source snapshot, source probe, request,
flow, project, expanded presentation profile, runtime identity, and completed
evidence. The caller supplies only unique recapture IDs; command, path,
environment, network, and execution arguments are rejected.

Three or more repetitions must unanimously retain the same non-null
classification and next probe before the route is called stable. Two agreeing
runs remain `insufficient_repetitions`; one disagreement makes the set
`unstable` immediately, without majority voting. Even a stable route cannot be
followed unless every included correctness flow passed. The assessment remains
low-confidence, non-causal, and edit-ineligible.

The
[2026-08-13 browser-probe stability proof](../../benchmarks/performance-lab/browser-probe-stability-proof-2026-08-13.json)
compared the two unchanged High Signal recaptures through both product
surfaces. CLI and MCP returned the same normalized assessment. Their 0.2077 and
0.1946 pre-commit CPU ratios straddled the fixed 0.20 context threshold and
selected different routes, so CodeVetter reported `unstable` and withheld a
next probe. Both assertions also failed. This prevents a noisy single run from
driving an edit; it does not identify a bottleneck or optimization.

Assessment reads local artifacts only and starts no app, browser, server,
production process, or cloud workload. The bounded scheduler below owns the
remaining repetition and cost decision.

## 35. Bounded browser-probe stability scheduling

The CLI operation `stabilize-browser-probe` and MCP tool
`stabilize_browser_probe` turn a source capture, supported executable probe, and
schedule ID into one durable local repetition decision. They accept up to three
existing recapture IDs, validate those artifacts first, and admit at most three
total compatible observations. Any new recaptures run sequentially and use
derived IDs; callers cannot provide commands, paths, environment, base URLs,
concurrency, or network policy.

The scheduler stops at the first terminal boundary: two routes disagree, three
passing routes agree, correctness fails, evidence is incomplete, source state
changes, an operation fails, or the admitted budget is exhausted. Disagreement
is never erased through majority voting. The receipt reports requested,
admitted, executed, remaining, and reused budget separately and is atomically
stored under
`.codevetter/browser-probe-stability-schedules/<schedule-id>/receipt.json`.
Reusing the same exact schedule ID revalidates its source and child receipt
digests and returns the prior result without execution.

The
[2026-08-13 stability-schedule proof](../../benchmarks/performance-lab/browser-probe-stability-schedule-proof-2026-08-13.json)
gave unchanged High Signal's two real recaptures an allowance for one new run.
CodeVetter reused both, observed their contradictory routes, and stopped with
`new_runs_executed: 0`; CLI and MCP returned the same idempotent normalized
receipt. This is a measurable cost and accuracy win, not a performance
optimization. Both assertions failed and the result remains low-confidence,
non-causal, edit-ineligible, and without a next probe.

Fresh schedules can start at most three local application and Chromium runs,
each with the existing per-run timeout. They can consume local CPU, memory, and
wall time, but never contact production or cloud infrastructure. The next
automation gap is broadening genuinely distinct executable probe families;
repeating the same instrumentation cannot answer Worker or libuv questions that
require different capture mechanisms.

## 36. Main-thread runtime mechanism probe

Fresh exact-request Node CPU summaries now split the broad `runtime` scope into
twelve closed mechanisms. The split includes module loading, compilation, GC,
promise microtasks, timers, HTTP/streams, buffers, filesystem,
crypto/compression, inspector activity, V8 builtins, and an `other_runtime`
fallback. Only aggregate sample count, sampled self time, and runtime-time share
survive normalization. Raw URLs, function names, node IDs, engine labels,
versions, and source locations do not.

Whole-request and exact pre-commit views remain separate; only a complete,
isolated pre-commit view may route. A non-inspector mechanism must retain at
least 5 ms and 20 percent of runtime sampled time. Inspector dominance selects
`repeat_with_lower_overhead_cpu_measurement`; diffuse, sub-threshold, legacy,
or incomplete evidence requests narrower capture. Every route is
low-confidence, source-null, non-causal, and edit-ineligible because sampled
self time is neither exact nor exclusive CPU.

`inspect_main_thread_runtime` is executable through the existing recapture and
stability operations. Recapture reuses the same request, test, browser project,
source snapshot, local-only network policy, and request-scoped V8 profile. Its
receipt stores the mechanism inventory separately from Playwright correctness.
Repeated assessments compare the narrowed mechanism route rather than the
unchanged outer probe name. Existing v2 CPU, v13 browser-flow, and v1 inventory
recapture artifacts continue to validate without fabricated mechanism values.

The
[2026-08-13 main-thread runtime proof](../../benchmarks/performance-lab/main-thread-runtime-probe-proof-2026-08-13.json)
first reloaded High Signal's legacy inspection, recaptures, and schedule without
execution. One new unchanged local `GET /` run retained 167 pre-commit runtime
samples and 178.457 ms of sampled time. A single 153.25 ms inspector-attributed
sample dominated 85.875 percent, so CodeVetter refused to call application code
a bottleneck and selected a lower-overhead measurement. The browser assertion
failed, independently stopping follow-up. This proves capture, narrowing, and a
useful refusal—not an optimization or production-performance result.

## 37. Profiler-disabled runtime corroboration

An inspector-dominated runtime result now exposes the derived probe
`repeat_with_lower_overhead_cpu_measurement`. Inspection accepts it only after
reloading the durable result and recomputing the observer-effect route. The
existing recapture and stability operations execute it; callers still provide
only capture identity, the selected probe, a new receipt identity, and an
optional bounded timeout.

This probe starts an owned alternate Next runtime under the closed
`profiler_disabled_runtime` profile. The preload omits both main-thread V8 and
public Worker sampling profilers while preserving exact process/thread CPU
deltas, response boundaries, async lineage, framework phases, bounded native
trace events, browser correctness, and remote-network denial. An unowned
listener cannot satisfy the profiler-state attestation. The result must contain
null main-thread and Worker CPU-profile artifacts before it can claim the
profilers were disabled.

Corroboration routes only complete isolated GC, compilation, or one closed
libuv mechanism with at least 5 ms of request-scoped union activity. Trace
intervals remain elapsed observer time; CodeVetter never converts them to CPU
or assigns them to source. Exact pre-commit main-thread CPU below 5 ms is
insufficient. Material exact CPU with only sub-threshold trace activity remains
unresolved. Every outcome is low-confidence, source-null, non-causal, and
edit-ineligible.

The
[2026-08-13 profiler-disabled proof](../../benchmarks/performance-lab/low-overhead-runtime-probe-proof-2026-08-13.json)
ran one unchanged High Signal `GET /` flow. Both sampling artifacts were null;
the recapture retained 201.8 ms process CPU, 66.867 ms main-thread CPU, and
16.923 ms of GC union activity, selecting `inspect_gc_pressure`. Compared with
the observer-affected run, wall time was 3.356 percent higher while observed
process and main-thread CPU were 49.659 and 72.991 percent lower. With one run
per mode these numbers demonstrate observer sensitivity, not causal overhead or
an optimization. GC also crossed the fixed floor in the earlier trace, making
it the first independently corroborated narrower mechanism.

The browser assertion still failed. The bounded scheduler therefore reused the
receipt, executed zero additional runs, and stopped at `correctness_failed`.
The proof made no cloud or production call and claims no application
bottleneck, source cause, memory improvement, or optimization.

## 38. Request-scoped GC-pressure probe

`inspect_gc_pressure` is now an executable, provenance-bound follow-up to a
completed profiler-disabled recapture. Inspection reloads the upstream probe,
its Playwright receipt and result, recomputes the `low_overhead_gc` route, and
requires the same source snapshot, browser flow, request ordinal, method, and
route. A missing or mismatched upstream identity fails closed. A failed
upstream assertion remains inspectable, but neither recapture nor the bounded
scheduler starts another application process.

An eligible recapture starts a fresh owned Next runtime under the private
`gc_pressure_runtime` profile. Main-thread and Worker CPU sampling stay off.
V8 heap allocation sampling starts before the exact dynamic handler dispatch
and stops at the earliest response commit. CodeVetter joins that marker to the
same request, aggregates allowlisted GC trace intervals by elapsed union, and
retains bounded before/commit heap observations plus contained sampled
allocation sources. Heap deltas are process observations, sampled bytes are
not exact allocated or retained bytes, and GC overlap is neither exclusive CPU
nor source causation.

Only complete isolated evidence with at least 5 ms of GC union activity may
route. A repository source must also cross the existing sampled-byte and share
floors. One run permits low-confidence source inspection only; it never permits
an edit. Three compatible passing runs must retain the same classification and
leading source before the scheduler emits terminal `diagnosis_stable`.
Disagreement, incomplete evidence, source drift, operational failure, or
failed correctness stops the sequence without majority voting.

The
[2026-08-13 GC-pressure proof](../../benchmarks/performance-lab/gc-pressure-probe-proof-2026-08-13.json)
contains three separate results. A controlled live Node handler proved exact
request-scoped allocation sampling with CPU sampling disabled and repository
source containment. An unchanged current Anime List React/Vite flow passed in
2.14 seconds and retained browser CPU, React, loading, repeated-memory, and
same-page evidence; its 897,318,912-byte local process-tree RSS peak includes
Chromium and Playwright, and its frontend-only Vite runtime correctly supplied
no server-GC evidence. Finally, unchanged High Signal evidence selected GC but
failed its browser assertion; a real recapture and schedule both executed zero
new runs and persisted `correctness_failed`. These are local development
observations, not production cost, latency, memory, frequency, or optimization
claims.

## 39. Static Playwright base URL constants

Read-only qualification now admits a Playwright `baseURL` backed by one
unambiguous immutable string constant. The terminal may be a quoted literal or
`process.env.NAME ?? 'literal fallback'` (including the equivalent `||` form).
Only the fallback enters qualification: CodeVetter does not import the config,
read the environment value, execute a command, or retain the environment name.
The existing loopback normalizer still rejects remote URLs, credentials,
queries, fragments, and invalid ports.

The grammar remains intentionally small. Environment-only, call-derived,
property-derived, computed, ambiguous, escaped, empty, oversized, and
unterminated declarations remain unresolved. Existing single-port template
support still requires a valid numeric port. A declaration is admitted only as
a terminal `const` statement; source that continues with an operator cannot be
mistaken for a literal constant.

The
[2026-08-13 static-config proof](../../benchmarks/performance-lab/static-playwright-config-alias-proof-2026-08-13.json)
requalified unchanged clean RolePatch from zero owned-runtime candidates to 16
exact bounded desktop journeys at `http://localhost:3000`, with Next inferred
from its existing package script. The owned runtime then stopped before launch
at the environment-file safety boundary, so no browser result, memory sample,
diagnosis, or probe route was fabricated. A second clean old product, TrueHire,
qualified 14 Next journeys but lacked installed dependencies; an offline,
script-disabled frozen install could not complete and its partial dependency
tree was moved recoverably to Trash. Neither attempt contacted production or
cloud infrastructure, and neither establishes a performance finding.

## 40. Clean-snapshot browser runtime

An exact, clean Next.js browser flow can now fall back to a private committed-
source execution snapshot when the developer checkout is blocked only by a
loadable environment filename. The fallback is automatic inside the existing
performance lab and browser-probe recapture loops; it adds no twentieth MCP
operation.

The authoritative checkout supplies qualification, revision identity, source-
drift checks, and durable `.codevetter` evidence. A bounded `git archive`
supplies the only application and test source executed. Ignored files never
enter the archive. Git-tracked paths already classified as sensitive are
excluded by literal Git pathspec before extraction; CodeVetter retains only the
number excluded and a digest of sorted filenames, not their names or contents.

Already-installed `node_modules` directories may be grafted into the snapshot.
Each graft must resolve inside the authoritative repository's dependency tree,
contain no direct workspace-source links, and preserve its filesystem identity.
No package install or registry access occurs. Receipts disclose the snapshot
tree digest, bounded file/byte counts, exclusion attestation, and path-free
dependency attestation. This is verified local dependency reuse, not a hermetic
install.

The mode is unavailable for dirty source. It never silently profiles `HEAD`
when the user's change differs. Owned Next and Playwright processes execute
with their existing minimal environments and remote browser HTTP denial.
Framework writes are allowed only below direct non-symlink `.next` and
`.codevetter` roots in the isolated tree. After process stop those roots are
removed, the remaining source tree and graft identities are reverified, the
authoritative source is rechecked, and the whole snapshot is removed. Any
failure invalidates the measurement.

Cold snapshots have no Next build cache. Listener readiness remains capped at
30 seconds, while the shared two-request preflight may consume the caller's
remaining deadline up to 60 seconds and reports total startup up to 90 seconds.
It follows at most three query-free same-origin redirects. Cross-origin,
credentialed, cyclic, query-bearing, and excessive redirect chains fail closed.

The
[2026-08-13 clean-snapshot proof](../../benchmarks/performance-lab/clean-browser-snapshot-proof-2026-08-13.json)
ran unchanged clean RolePatch's exact desktop `landing page renders` flow. One
sensitive tracked path was excluded without content access, one local dependency
tree was attested, and the 421-file snapshot was removed. The Playwright flow
passed with remote HTTP denied and retained browser, React, loading, memory,
action, and 13-request server evidence. A second exact main-thread recapture
also passed but retained zero compatible runtime-mechanism samples, so it ended
truthfully at `evidence_incomplete`, with low confidence and no edit authority.

The proof made zero cloud, production, or package-registry calls. Its local
development timing, incomplete transfer bytes, and process-tree RSS do not
establish production performance. Most importantly, it identifies no verified
RolePatch optimization yet; the capability proof is successful precisely
because the tool refuses to turn unattributed CPU into a source claim.

## 41. Redirect-safe pre-commit and streamed native evidence

Request profiling now distinguishes another dynamic request that begins before
response commitment from a redirect target that begins only after the profiled
response has committed. A true pre-commit overlap still invalidates the whole
profile. A later overlap keeps the whole-request state contaminated, publishes
no whole-request source candidates, and may retain only the isolated samples at
or before the exact commitment boundary. Older raw profiles lack this split and
continue to treat every overlap conservatively as pre-commit contamination.

An executed runtime recapture can now integrity-bind its receipt, passing
correctness, exact request identity, and selected observer-effect route into the
profiler-disabled follow-up. This closes a real continuation gap: the original
capture no longer has to contain evidence produced only by the later runtime
probe.

Owned browser runtimes now separate process sealing from evidence-directory
cleanup. After the primary Playwright assertion and all React/memory passes,
CodeVetter stops only its own server, parses the flushed flow evidence, then
removes the private directory during mandatory cleanup. Unowned and repository-
declared listeners expose no seal operation and are never terminated.

Cold Next.js tracing can exceed the earlier 16 MiB whole-file limit. The native
collector now accepts at most 128 MiB of private trace input, scans it in at
most 256 KiB chunks, and retains only closed trace categories whose timestamps
touch one of at most eight admitted request markers. Existing 50,000-event and
64 KiB per-event bounds still apply. A versioned closed reason distinguishes
unsupported, contaminated, unavailable, malformed, truncated, oversized, and
interval-incomplete evidence without retaining raw trace identity.

The
[2026-08-14 RolePatch continuation proof](../../benchmarks/performance-lab/rolepatch-precommit-runtime-proof-2026-08-14.json)
records the full iterative result. The repaired sampled recapture retained 151
pre-commit runtime samples and 516.169 ms of sampled time, but one inspector
sample accounted for 495.958 ms, so CodeVetter selected the independent lower-
overhead route rather than blaming application code. Two profiler-disabled
runs exposed an incomplete native trace; the new reason classified the next
run as `trace_oversized`. After bounded streaming landed, the unchanged flow
produced complete profiler-disabled evidence: 65.636 ms pre-commit wall time,
59.919 ms main-thread CPU, 49.782 ms other-thread CPU, and no retained closed
GC, compilation, or libuv interval.

The terminal route is therefore `low_overhead_unresolved`, not an optimization.
Timings across these runs use different instrumentation and cache-free local
Next development starts, so they are not a before/after performance comparison.
The proof establishes that CodeVetter recovered evidence, identified its own
observer effect, executed an independent corroboration, and stopped without
source or edit authority. It made zero cloud, production, registry, or package-
installation calls, and every temporary source snapshot was removed.

## 42. Continuous pre-armed main-thread source evidence

`inspect_continuous_main_thread_source` is now the executable follow-up when a
correctness-passing profiler-disabled request still contains at least 5 ms of
main-thread CPU but no material closed GC, compilation, or libuv mechanism.
Inspection and recapture require the prior receipt, its exact request ordinal,
method and route, the unchanged source snapshot, and the prior
`low_overhead_unresolved` route. This adds no twentieth MCP operation: the
existing inspect, recapture, and stability tools accept the derived probe.

The owned Node preload enables 1 ms V8 sampling at startup. After Next warm-up
and preflight, CodeVetter sends one private loopback-only arm request that the
preload intercepts before application dispatch. The preload discards the
startup profile and immediately restarts sampling before Playwright begins the
exact qualified flow. This preserves pre-request sampling while preventing
cold build samples from making the stop callback unbounded. The application
never sees the arm request, no source is modified, and callers cannot provide a
command, URL, environment, or header.

At the selected response commitment, the preload stops the profiler and stores
one private profile capped at 8 MiB and 100,000 samples. Normalization uses only
ordered profile deltas, the independently observed request duration, and the
measured stop tail; it never aligns absolute clocks. Another dynamic request
before commitment contaminates the result, while post-commit redirect work is
excluded. Stop tails above 100 ms, malformed profiles, target ambiguity,
incomplete intervals, and source drift all retain zero candidates.

Only repository-contained source-mapped frames with at least five samples,
5 ms of sampled self time, and 10% of non-idle sampled time become candidates.
Dependency, generated, runtime, idle, and unresolved frames remain aggregate
scope counts. A candidate is still sampled correlation, not exclusive work or
causality. Three compatible passing runs must retain the same leading source
before stability permits source inspection; no result grants edit authority.

The
[2026-08-14 RolePatch continuous-source proof](../../benchmarks/performance-lab/rolepatch-continuous-source-proof-2026-08-14.json)
records the real iteration. The first exact run passed correctness but rejected
its excessive profiler stop tail. Pre-flow rotation fixed that product gap
without relaxing the 100 ms bound. The next unchanged run passed and retained
complete evidence for the exact 35.209 ms pre-commit interval: 35 samples,
including 0 repository, 17 dependency, 7 runtime, and 11 unresolved samples.
CodeVetter therefore returned `unresolved`, no source candidate, and no edit
authority. That is a successful accuracy result, not a RolePatch optimization.
The runs made zero cloud, production, registry, or package-install calls and
left the RolePatch source checkout clean.

## 43. Cross-product allocation diagnosis and acceptance

The
[2026-08-14 Calorie proof](../../benchmarks/performance-lab/calorie-gym-guidance-proof-2026-08-14.json)
records a complete React/Node product trial. Qualification selected the existing
35,000-entry Vitest flow. Two independent CPU and heap profiles localized
`calculateGymGuidance`, where the baseline attributed about 148 MB of sampled
allocation per run to one repeated source. The agent replaced transient tuple
and winner-wrapper allocations with scalar winner state; CodeVetter did not edit
the product source.

The sequential screen stopped at the paired-verification gate despite a 62.2%
largest-input movement. Acceptance then rejected an escaping dependency symlink
and a checkout that omitted baseline untracked files. A self-contained exact
incumbent passed snapshot identity, after which CodeVetter ran one exact
correctness assertion on each checkout and ten interleaved performance pairs.
The accepted comparison moved the 35,000-entry point from 0.296 to 0.111 ms/op
(-62.5%) and the selected source's median sampled bytes from 149,890,856 to
336,340 (-99.776%). Process-tree peak RSS moved +4.414%, below the regression
gate. The full 149-test product suite, lint, typecheck, and build also passed.

This is exact local synthetic compute evidence. It says nothing about Calorie's
browser, Worker, D1, network, iOS, retained heap, production frequency, or user
impact.

The trial also exposed an agent-facing source-coordinate bug. The V8 profiles
named the correct file and function but reported transformed line 177, while the
unique contained TypeScript definition was at line 254. Heap findings now reuse
the bounded function resolver already applied to CPU evidence. A fresh public
laboratory replay returned `line: 254` and retained `reported_line: 177`; its
stable candidate key remained unchanged. Ambiguous function names still keep
the raw line rather than selecting an arbitrary declaration.

The same snapshot exercised the project-owned React redundancy lane. The first
Knip/jscpd pass returned 38 clone candidates and 6.768% apparent duplication,
but generated `worker-configuration.d.ts` declarations dominated the ranking.
CodeVetter now recognizes the exact Wrangler generation marker, excludes the
file from the analyzer input, and defensively screens it if an analyzer still
returns it. A bounded contained-source check also screens clones confined to
both files' import preambles.

The corrected run analyzed 15,087 authored lines, reported 1.379% duplication,
and retained 14 review candidates. Knip found no unused file, export, or
dependency candidate. The leading remaining clone is shared onboarding/settings
form markup with different lifecycle contexts, so CodeVetter retained
`safe_to_remove: false` and no Calorie source was changed. Static similarity is
not runtime cost or deletion evidence.

## 44. React component commit-hotspot diagnosis

The separate React diagnostic pass now derives bounded component self-render
duration by subtracting direct-child `actualDuration` from each component's
inclusive duration and clamping at zero. It retains only aggregate timing and
component names—never props, state, DOM values, application values, or Fiber
graphs. Legacy captures remain readable but cannot authorize this detector.

One `browser_react_component_commit_hotspot` detector runs in the ordinary
Playwright diagnosis path. It requires three profiled commits, presence in
three commits, 5 ms derived self duration, 10% of root React duration, complete
measurement, and a complete bounded source scan with one unique repository
declaration. It emits at most one candidate. Presentation truncation is
reported but does not erase complete retained evidence; incomplete measurement
or source attribution fails closed. The finding describes repeated activity,
not redundant work, exact exclusive CPU, causality, production frequency, or
user impact. Existing correctness and paired browser timing/memory gates remain
authoritative.

The
[2026-08-14 Anime List proof](../../benchmarks/performance-lab/react-component-hotspot-proof-2026-08-14.json)
records the first unchanged product replay. Seven commits produced 19.6 ms of
root React duration. Inclusive ranking would have emphasized `QueryProvider`
at 19.2 ms, but its derived self duration was only 0.5 ms. CodeVetter instead
selected `HomePage` at `src/pages/HomePage.tsx:55`: it appeared in five commits
with 7.5 ms derived self duration, or 38.27% of the root total. The source was
opened only after the finding and was not edited. This is a source-linked
experiment candidate, not a confirmed Anime List optimization.

The component detector adds no dedicated public API. Qualification, autonomous
capture, compact diagnosis, source selection, and paired verification reuse the
existing operations.

## 45. Autonomous browser optimization loop

The browser loop turns one successful durable Playwright capture into a
breadth-first evidence dossier and a deterministic experiment queue. It
combines the capture's timing, loading, memory, React, and action evidence with
a bounded static initial-route dependency graph and CodeVetter's existing
performance-review evidence selector. When review binds a matching changed
source to one repository-owned correctness flow, the experiment carries that
scope into correctness-first screening. A current digest-bound accepted review
receipt is supporting evidence; a stale receipt requests reverification and
cannot confirm a new speedup. Runtime bytes and timings remain authoritative for
performance ranking and keep/reject decisions. A closed Vite `manualChunks`
subset can identify literal `includes`, `startsWith`, `endsWith`, equality, and
boolean predicates without importing configuration or invoking a package
script. Unsupported syntax is a reported coverage gap.

```bash
pnpm --silent runtime:plan-browser-optimization-loop -- \
  --repo /path/to/project \
  --loop-id home-route \
  --campaign .codevetter/optimization-campaigns/home-route \
  --capture-id exact-home-capture \
  --entry src/main.tsx \
  --build-dir dist \
  --json

pnpm --silent runtime:get-next-browser-experiment -- \
  --repo /path/to/project --loop-id home-route --json

pnpm --silent runtime:evaluate-browser-experiment -- \
  --repo /path/to/project \
  --loop-id home-route \
  --incumbent-repo /path/to/clean-incumbent \
  --json
```

The repository MCP exposes the underscore-named equivalents. The plan, event
ledger, and terminal report are versioned and bounded. Every experiment names
its observed evidence, inference, allowed source files, predicted metric,
correctness scope, paired verifier, rejection rule, and limitations. The host
agent applies one edit; CodeVetter accepts no patch or command, rejects
out-of-bound changes before execution, and requires exact incumbent restoration
after a rejection. A confirmed keep creates a new incumbent generation and
replans the same flow.

Current coverage is local Vite/React entry graphs plus evidence already present
in one qualified Playwright capture. Existing build artifacts contribute byte
and chunk closure only when contained and bounded; without a matching source
attestation they remain unverified and cannot confirm a win. Non-literal imports,
unsupported bundler expressions, incomplete source maps, missing resource joins,
and unavailable React or memory probes remain explicit gaps. The loop does not
run builds, installers, migrations, cloud workloads, paid models, production
traffic, or deployment operations.

Terminal states distinguish queue exhaustion, plateau, budget exhaustion,
operational failure, and host blockage. A no-win result covers only the tested
queue for that exact local flow. It does not establish application-wide or
production optimality.

The
[2026-08-14 Anime autonomous-loop proof](../../benchmarks/performance-lab/autonomous-browser-loop-anime-proof-2026-08-14.json)
now includes a complete rejected-and-retained product trial on an isolated
checkout. The planner measured `lucide-react` as a 4,263,394-byte local Vite
dependency response and traced the exact initial-flow boundary to
`components/Navigation.tsx` and `components/ui/dropdown-menu.tsx`; lazy-route
importers remained deferred. A five-file Radix subpath candidate reduced median
completed-response bytes by 9.254% and was rejected below the 10% floor. The
two-file Lucide boundary candidate then passed correctness, cleared the
three-sample screen, and was automatically promoted to ten alternating samples
per side. Median navigation response bytes moved from 11,871,129 to 7,616,611
(-35.839%) without a policy-level timing, memory, loading, or React regression,
so the loop retained it, advanced the incumbent, and replanned generation two.

That keep is deliberately qualified as a local development-flow improvement.
Separate empty-HOME production builds moved the complete HTML-referenced initial
JavaScript closure from 159,923 to 159,423 gzip bytes (-0.313%), which is not a
material shipped-bundle win. The earlier -28.452% headline compared selected
chunk redistribution rather than the complete initial closure and is
superseded. Rechecking the historical chunk-rule candidate against the full
closure produced only -3.602%, so it was correctly rejected. The trial also
closed four product gaps: multiline imports are parsed, static and deferred
importers are separated, sealed dirty candidates are rechecked around every
capture, and transfer verification uses the complete zero-failure navigation
action cohort instead of later analytics/evaluation request noise.

A review-enabled replay on the same Anime snapshot found a repository-owned
recommendation binding, but the current browser experiment was in
`src/pages/HomePage.tsx`. The planner retained the review observation as partial
coverage and correctly refused to attach the recommendation test to that
different source. This is intentional: review authority joins experiments by
exact file identity and cannot silently substitute a convenient verifier.

## Principle

A feature is on-budget when it doesn't make the app re-do work proportional to
data it has already seen, and doesn't grow the initial payload without cause. The
benches encode that: re-reading 211 MB for a 4 KB append is the canonical thing we
refuse to keep doing.
