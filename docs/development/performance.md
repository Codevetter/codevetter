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
script, Vitest test, or Go benchmark and turn the bounded capsule into a
deterministic agent-facing diagnosis. This is separate from the desktop
performance harness above: it is for understanding a target application's
runtime path.

For Node and Vitest workloads, the local flow lane packages this engine as a
machine-queryable product capability rather than a profiling playbook:

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

The repository-scoped local MCP exposes four closed operations:
`capture_local_flow`, `inspect_local_flow`, `explain_local_flow`, and
`verify_local_optimization`. Captures are held in memory for the current MCP
session, capped at eight, and use opaque IDs. The MCP does not accept arbitrary
commands or repository paths after startup.

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

Supported adapters are `node-test`, `node-script`, `vitest`, and `go-bench`.
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

Node and Vitest console benchmark metrics are captured in `samples`
independent, unprofiled executions and normalized by median. The profiled
execution remains separate for CPU attribution. This prevents profiler overhead
or one noisy host interval from confirming an optimization.

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

`runtime-optimization-verification/v1` compares matching scale inputs and units,
or matching Go benchmark timing and allocation metrics. It returns `confirmed`,
`rejected`, `inconclusive`, or `no_confidence`; a failed or incompatible
workload can never confirm an optimization. Explicit in-workload benchmark
metrics are compared independently from process startup timing, so noisy runner
wall time cannot override a stable exact-scope `ms/op` series.

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
metric yields `no_confidence`. This operation captures timing/domain metrics
only; use `diagnose-performance` separately for source attribution.

### Explicit Playwright flow evidence

An existing repository-owned Playwright test can be selected explicitly as a
local performance scope. Qualification lists browser candidates but never
declares one representative automatically:

```bash
pnpm runtime:profile -- \
  --repo /path/to/react-app \
  --adapter playwright \
  --target tests/checkout.spec.ts \
  --name "completes checkout" \
  --samples 3 \
  --warmups 1 \
  --json
```

The capsule records the exact test duration reported by Playwright separately
from owned-process wall time. Missing, failed, retried, ambiguous, or truncated
reporter evidence yields `no_confidence`. Paired Playwright verification uses
the same scope with `runtime:verify-paired-optimization`; direct comparisons
require at least three samples, while campaign promotion retains the ten-sample
floor. Confirmation requires at least 10% and 10 ms median test-duration
improvement with no process-wall regression above 20%.

An existing Vite output can be inspected without running a build:

```bash
pnpm runtime:profile -- \
  --repo /path/to/react-app \
  --adapter playwright \
  --target tests/checkout.spec.ts \
  --name "completes checkout" \
  --vite-build-dir dist \
  --vite-entry index.html \
  --json
```

Only a bounded initial HTML/static-JavaScript closure is read. Raw and gzip
bytes are always labelled `existing_unverified_vite_artifact`; they cannot
confirm or keep an optimization because CodeVetter did not run or attest the
build. MCP exposes the same closed inputs as `profile_local_performance` and
`verify_paired_performance`; neither accepts commands or installs packages.

This compact lane deliberately does not restore the retired general browser
runtime. It does not capture Chrome traces, Core Web Vitals, React commits,
browser memory, request waterfalls, production traffic, or automatic patches.
Those gaps remain explicit in every Playwright performance capsule.

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
[qualification](../../openspec/changes/archive/2026-08-15-add-runtime-performance-capsules/qualification.md)
records the complete evidence, the conservative shipping limitation, and the
decision-explanation bug found and fixed during the loop.

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
limitation-free, ten-sample paired evidence can return `keep` and advance the
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

The same six campaign operations are available from `runtime:mcp`. Start that server
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

### Candidate challenge and contribution closeout

A campaign `keep` proves only the declared local scopes. Commit the candidate
before paired promotion so the kept record names the future PR head; uncommitted
source at challenge time fails closed. Before publishing, challenge that exact
retained SHA:

```bash
pnpm --silent runtime:campaign -- challenge \
  --repo /path/to/candidate \
  --campaign .codevetter/optimization-campaigns/parser-loop \
  --selected-sequence 4 \
  --justification "The direct lookup adds no cache or fallback state." --json
```

The challenge binds the kept record, current commit, diff digest, complexity,
and deterministic risk observations. It requires either a directly comparable
qualified candidate or a bounded reason that a simpler comparison is not
applicable. Candidate comparison retains the largest scale or latency value as
the target and treats smaller scale points, bytes/op, and allocations/op as
controls when they exist. The simpler candidate must stay within the same 5%
tolerance on every retained metric. Risk tokens request evidence; they are not
a model score and cannot offset correctness or performance.

Inspect one published pull request with the returned challenge path:

```bash
pnpm --silent runtime:campaign -- inspect-contribution \
  --repo /path/to/candidate \
  --campaign .codevetter/optimization-campaigns/parser-loop \
  --challenge .codevetter/optimization-campaigns/parser-loop/closeout/challenge-<sha>-<digest>.json \
  --pr https://github.com/owner/repository/pull/123 \
  --trex-policy optional --json
```

`trex-policy` is `optional`, `required`, or `not_applicable`. A supplied T-Rex
preview receipt is read from a contained local path and must identify the same
candidate SHA. CodeVetter does not launch T-Rex, a browser, preview, or hosted
load from this operation.

The contribution receipt keeps correctness, performance, patch quality, T-Rex,
head freshness, checks, review threads, and merge authority as independent
gates. It distinguishes failed checks from fork-workflow approval, retains
outdated and resolved feedback without treating either as current work, and
reports `waiting_for_maintainer` when upstream owns merge. Use
`refresh-contribution` for one explicit reread; there is no polling.

The append-only receipt also carries bounded maintainer-feedback learning when
a reviewed candidate is superseded: exact before/after SHAs and complexity,
the actionable thread, prior deterministic risk signals, the revised campaign
hypothesis, repeated local gates, and observed upstream disposition. This is
evidence from one contribution, not a universal style rule.

`closeout/publication.json` is a concise projection of the newest current
receipt. A different PR head marks an existing projection `stale` while keeping
its original receipt digest; only a newly challenged, current receipt can
regenerate it. The receipt ledger remains the authority.

The GitHub adapter uses one fixed read-only GraphQL query. It cannot comment,
resolve a thread, request review, approve, merge, deploy, install an app, create
a required check, or change pull-request metadata. Raw receipts remain local;
an author can copy a concise summary separately.

The challenge, inspection, and refresh operations are also available through
`runtime:mcp`; their repository is fixed when the server starts.

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

## Principle

A feature is on-budget when it doesn't make the app re-do work proportional to
data it has already seen, and doesn't grow the initial payload without cause. The
benches encode that: re-reading 211 MB for a 4 KB append is the canonical thing we
refuse to keep doing.
