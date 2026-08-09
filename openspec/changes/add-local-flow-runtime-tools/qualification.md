# Local Flow Runtime Tools Qualification

Date: 2026-08-09

## Method

The product tools were exercised without a profiling skill, model call, target
source modification, production service, or hosted dependency. The MCP process
was separately started over stdio and successfully served `initialize` and
`tools/list`; capture qualification used the CLI transport over the same flow
service and evidence engine so the complete capsule could be retained for
inspection. Raw owned artifacts were removed after every run.

The package qualification also found that pnpm's normal script banner pollutes
the stdout protocol stream. The documented launcher is therefore
`pnpm --silent`; the runtime process additionally accepts pnpm's forwarded
standalone `--`. Both the silent package entrypoint and direct Node entrypoint
are covered by executable smoke tests.

The investigator selected an existing exact test by name. Source inspection was
not used to choose or strengthen a runtime candidate after capture.

## Foundry Local HTTP Flow

- Repository revision: `560a9b42342427cc6eecb9d2ef2449643948b831`
- Worktree state recorded by CodeVetter: clean
- Adapter/scope: Node test,
  `ops/test/founder-control-service.test.mjs`, exact test
  `serves owner views and rejects unauthenticated mutations`
- Policy: three measured executions, one warmup, one separate HTTP diagnostic
  execution, and two independent V8 profiles
- Root unprofiled median: 122 ms
- Captured: 12 child flows, comprising six loopback HTTP client/server pairs
- Representative observed client/server timings: `GET /health` 8.031/0.938 ms;
  authenticated mission accept 4.761 ms server time; mission start 3.289/1.453
  ms; `GET /v1/home` 2.061/0.391 ms
- Dynamic mission identifiers were returned as `/v1/missions/:value/...`; query
  data was absent
- HTTP server flows were nested under their matched client flows with separate
  causal relationships
- Root accounting remained
  `unavailable_across_separate_executions`; child time was not subtracted from
  the root median

The two profiles repeated on
`ops/lib/founder-control/projections.mjs:242`, but the candidate contributed
only three samples, 3.791 ms self time, and 5.07% sample share in the summarized
run. CodeVetter therefore returned `insufficient_source_evidence`,
`no_confidence`, and `capture_more_material_source_evidence` instead of an
optimization recommendation. This is the correct accuracy outcome: the flow
breakdown is useful, but the source attribution is not yet material.

The normalized capture recorded two profile files, 117 samples, one flow file,
12 flow events, no retained temporary artifacts, and no cloud activity.

## Anime List Non-HTTP Flow

- Repository revision: `2be4c95d790b5c7adf98d49527dc333e52eb4d00`
- Worktree state recorded by CodeVetter: dirty, including pre-existing local
  recommendation work
- Adapter/scope: Vitest, `src/recommendations.test.ts`, exact test
  `buildTasteRecommendations scores unseen anime from positive watchlist signals`
- Root unprofiled median: 585 ms
- Captured HTTP child flows: zero, as expected for this pure local workload
- Vitest assertion time: 0.238% of exact-scope wall time
- Independent V8 profiles did not both recover an application source candidate

CodeVetter returned `startup_dominated_workload` with high confidence,
`needs_better_workload`, and `design_representative_workload`. It did not
attribute the 585 ms runner process to recommendation code. The run normalized
four worker profile files and 1,669 samples, applied ten redactions, retained no
temporary artifacts, and made no hosted request.

## Foundry Request-Scoped SQLite Depth

The deeper package qualification ran the same exact Foundry test at revision
`e4a52d0adfb6efadefcc6dad5557e311a6d9a7f4`. CodeVetter recorded the concurrently
dirty worktree instead of claiming a clean snapshot; the qualification did not
modify Foundry. The root median remained 123 ms.

The diagnostic execution captured 54 nested events:

- six HTTP clients and six matched HTTP servers;
- 42 request-scoped built-in SQLite executions;
- 14 `run` calls totaling 0.879 ms;
- six `exec` calls totaling 0.416 ms;
- 11 `all` calls totaling 0.252 ms; and
- 11 `get` calls totaling 0.097 ms.

The slowest server flow was
`POST /v1/missions/:value/accept` at 4.918 ms. Its 12 SQLite children accounted
for 0.492 ms, or 10% of that request, leaving 4.426 ms unaccounted within the
same diagnostic execution. The deterministic flow analysis therefore returned
`database_not_primary` and selected `capture_synchronous_application_spans` as
the next missing boundary. The largest individual database execution was only
0.149 ms.

This did not find a database optimization to ship. It did eliminate the
database as the primary explanation for the slowest request and moved the
investigation one level deeper without manual query inspection. SQL comments,
literals, arguments, and rows were absent from the capsule; raw artifacts were
removed.

## Qualification Conclusion

The product now improves an agent's view of local HTTP execution even when it
cannot yet name code to change: it exposes recursive request and built-in
SQLite evidence, keeps timing provenance honest, and tells the agent which
stronger experiment is required. On a small non-HTTP unit test it correctly
declines to profile framework startup as product work.

The remaining end-game gap is synchronous application-span attribution. The
Foundry result localizes 90% of the slowest request outside SQLite, while the
separate V8 profiles remain too sparse to name the function responsibly.
Filesystem operations, third-party database clients, React render work,
arbitrary function/value transitions, and a same-execution root breakdown also
remain outside this slice.

## Foundry Deterministic Application Frequency

The next qualification used the packaged silent MCP entrypoint against the
exact same Foundry Node test at revision
`f2d18bccef16644dbc8e6fb48abc61f5f74d87f8`. The worktree already contained an
unrelated `ops/teammates/SCORECARD.md` edit, which CodeVetter recorded as dirty.
No production, hosted service, or model was used.

Before target-source inspection, CodeVetter selected `buildProjections` in
`ops/lib/founder-control/projections.mjs:37-280` as repeated application work:
eight calls across six server flows, intersecting CPU evidence at line 242 with
9.084 ms self time, six samples, and 6.65% aggregate sample share. The strict
CPU materiality gate still returned `no_confidence`; the function-frequency
lane separately returned an unverified repeated-work candidate and required an
identical-scope experiment.

Only then did source inspection find two unnecessary eager projection rebuilds:
one occurred before an unauthenticated mutation was rejected, and another
before a draft mutation whose response used only the post-mutation projection.
The Foundry handler was changed to create the request-local projection lazily.
Its focused service suite passed all eight tests.

The persistent MCP session then compared the stored baseline with a fresh
capture. `buildProjections` fell from eight calls to six, a directly observed
25% reduction on the same exact workload. Median closed-process wall time moved
from 117 ms to 122 ms, only 5 ms or 4.274%, so the verifier correctly reported
stable/inconclusive rather than claiming a speed improvement. The current
slowest request still spent only 0.530 of 5.045 ms in SQLite (10.51%), leaving
4.515 ms of synchronous application time outside the database boundary.

This qualification proves a narrower but useful loop: runtime evidence selected
the code to inspect, a small change removed observed recomputation, and the
verifier confirmed the implementation effect while withholding an unsupported
latency claim. It also exposed an oversized MCP response because verification
embedded both complete capsules; the service now returns the bounded comparison
and capture identifiers without duplicating those capsules.

## Significant Hobbies Vitest Cross-Project Check

The next blind run targeted `src/lib/recommendations.test.ts` in Significant
Hobbies at revision `3656bfb055d22381bc57ba6ce8bd0ad6b2ae7d3d`. Its pre-existing
`src/lib/hobbies.ts` edit was preserved, and CodeVetter recorded the worktree as
dirty. No product source was inspected before the run and no target file was
changed.

The first attempt revealed that an exact leaf name nested under `describe`
blocks selected zero Vitest assertions. CodeVetter already rejected that run,
but the adapter made a valid user scope unnecessarily unusable. The selector
now matches the escaped leaf only at the end of Vitest's full name and accepts
the result only when exactly one assertion executed.

The corrected run then showed that parent-process `NODE_V8_COVERAGE` does not
contain Vitest's transformed application modules. CodeVetter now invokes the
repository-local V8 coverage provider for this optional pass, writes JSON into
its owned temporary directory, disables only diagnostic coverage thresholds,
and normalizes original TypeScript anchors. The final run captured one positive
named application function and removed all raw artifacts.

No optimization was proposed. The selected assertion took a 0.955 ms median
inside a 523 ms median closed process, only 0.183%. CodeVetter returned
`startup_dominated_workload` and `needs_better_workload`, with no repeated-work
candidate. This negative result is useful: the same feature that found Foundry's
avoidable recomputation generalized across the Vitest adapter without turning
one tiny function call into a false bottleneck.
