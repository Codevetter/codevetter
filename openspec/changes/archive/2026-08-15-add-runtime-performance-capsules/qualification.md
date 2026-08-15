# Runtime Performance Capsule Qualification

## Environment

- Date: 2026-08-08
- Target: App Health `0582049a97893a98ac135496158e6a237817c0c7`
- Machine: MacBook Pro (Mac17,8), Apple M5 Pro, 48 GB RAM
- OS: macOS 27.0 build 26A5388g
- Runtimes: Node v24.19.0, Go 1.26.5 darwin/arm64
- Target repository remained clean; no production service or credential was used

These are local directional measurements, not portable performance budgets.
Unrelated Devin and Chrome processes caused material host contention during the
later Go trial, which the capsule now records through host load and sample
spread.

## App Health Node middleware benchmark

Scope: `packages/node/test/benchmark.test.ts`, Vitest, two measured processes
and one evidence profile, no warmup in the recorded sample below.

- Exact-scope wall median: 901 ms
- Exact Vitest assertion median: 349.96 ms
- Console benchmark evidence: bare 0.491 ms/request, instrumented 0.477
  ms/request, observed delta -14.6 us/request over 300 iterations
- V8 profiles: 1 file, 776 samples, 168,503 bytes
- Repository-owned CPU hotspots: 0

The negative middleware delta is measurement noise, not proof of an
improvement. Vitest supplied useful workload and application metrics, but its
worker did not flush a repository source profile; the capsule disclosed that
limitation instead of naming a bottleneck.

## App Health Go benchmarks

Scopes used three measured processes, one warmup, and one CPU-artifact pass.

| Workload | Median internal time | Bytes/op | Allocs/op | Exact-scope wall median |
| --- | ---: | ---: | ---: | ---: |
| `BenchmarkNormalizeRouteTemplate` | 493 ns/op | 144 | 2 | 1,688 ms |
| `BenchmarkMiddlewareOverhead` | 2,506 ns/op | 7,371 | 30 | 937 ms |

The normalization wall samples ranged from 663 ms to 2,071 ms under host
contention even though internal benchmark measurements were substantially more
stable. This motivated the sample-spread gate: noisy wall evidence cannot
support a baseline regression verdict.

## Demonstrated coverage

- Exact Node test and Vitest target execution with bounded samples
- Exact Go benchmark selection without unrelated tests
- Wall distributions separated from profiler-perturbed execution
- Exact Vitest assertion durations and bounded console benchmark metrics
- Go `ns/op`, `B/op`, and `allocs/op` distributions
- Repository-owned Node test CPU hotspot attribution in hermetic fixtures
- Compatible saved-baseline regression detection
- Temporary profile and Go test-binary cleanup
- Redaction and fail-closed unsuccessful workload outcomes

## Cross-product flywheel qualification

On 2026-08-09, a read-only profiling agent exercised two consumer products and
the App Health Go lane. It did not install dependencies, change target files,
contact production services, or retain raw profiles.

### Anime List

- Revision: `048b1b6`, with owner worktree changes present
- Scope: `src/recommendations.test.ts`, Vitest
- Post-hardening wall samples: 691 ms and 1,024 ms
- Reported assertion median total: 1.51 ms, or 0.219% of wall median
- Diagnostic profiles: 2 files, 1,097 samples
- Application source frames: none

The capsule now reports `dirty: true`, including the pre-existing untracked
artifact directory, and emits `startup_dominated_scope`. No product bottleneck
is attributed. A separate concurrent edit to `index.html` appeared after the
initial agent run and was preserved; the profiler cannot write that file.

### Significant Hobbies

- Revision: `f416b49`, dirty owner worktree
- Scope: `src/lib/recommendations.test.ts`, Vitest
- Post-hardening wall samples: 720 ms and 1,004 ms
- Reported assertion median total: 3.749 ms, or 0.521% of wall median
- Diagnostic profiles: 2 files, 1,016 samples
- Repository source sample: `src/lib/hobbies.ts:251`, 1.25 ms self time,
  0.11% sample share

The bounded single-fork diagnostic pass now flushes a Vitest worker profile and
can recover application source. The source share remains far below the 5%
hotspot threshold, so CodeVetter correctly emits no bottleneck finding.

### App Health

- Revision: clean `0582049`
- `BenchmarkBareHandler`: 1,350 ns/op, 6,143 B/op, 20 allocs/op
- `BenchmarkMiddlewareOverhead`: 2,465 ns/op, 7,366 B/op, 30 allocs/op
- Observed middleware delta: 1,115 ns/op, 1,223 B/op, 10 allocs/op

The allocation delta was the only actionable product-level signal in this
three-product pass. The follow-up power-law qualification below adds bounded Go
symbol and allocation-path attribution.

## Power-law product qualification

On 2026-08-09, CodeVetter exercised one representative performance path in a
Go library and one in a React product. All runs were local. They installed no
dependencies, used no credentials, and sent no traffic to production or
Cloudflare resources.

### App Health middleware allocation attribution

- Revision: clean `0582049a97893a98ac135496158e6a237817c0c7`
- Scope: `BenchmarkMiddlewareOverhead`, three measured processes and one
  diagnostic `go test` pass
- Exact-scope wall median: 918 ms, 2.941% sample spread
- Internal benchmark median: 2,423 ns/op, 7,358 B/op, 30 allocs/op
- Diagnostic evidence: repository-owned CPU and `alloc_space` rows normalized
  through the installed `go tool pprof`; temporary profiles were removed

The strongest observed application-owned allocation paths were the middleware
wrapper at `packages/go/middleware.go:55` (10.59% cumulative profile bytes) and
`responseWriter.Write` at `packages/go/middleware.go:137` (10.37%). Background
delivery paths at `packages/go/client.go:227` and `:250` each accounted for
roughly 5.6%. CPU attribution independently included middleware wrapping,
`Client.record`, and route resolution. These are candidate paths, not proof
that one source line owns the benchmark's `B/op`; cumulative diagnostic-profile
bytes are deliberately named separately from per-operation allocation data.

Test and benchmark files ending in `_test.go` are classified as harness code.
Allocation and CPU rows also receive separate bounded quotas so one profile
kind cannot crowd the other out of the normalized evidence.

### Anime List recommendation scale

- Revision: `bc366c032ea2790ec111279178ae5a33910072f5`
- Scope: deterministic recommendation catalogues with 5% watched titles,
  representative genre/theme/type variety, and a 12-item result limit
- Internal median: 0.448 ms/op at 1,000 titles over 15 iterations
- Internal median: 5.662 ms/op at 10,000 titles over 7 iterations
- Internal median: 22.646 ms/op at 35,000 titles over 3 iterations
- Exact test median: 187.14 ms across the three sizes; exact-process wall
  median: 735 ms with 4.354% spread

The 35k catalogue was about 50.5 times slower than 1k for 35 times more input,
consistent with the current full-catalog filtering, mapping, and sorting path.
The largest repository-owned CPU frame was `scoreAnime` in
`src/recommendations.ts`, followed by `buildTasteRecommendations` and its
catalog transforms. This identifies a real application path rather than
Vitest startup; it does not yet establish a user-facing latency regression.

CodeVetter correctly rejected an isolated checkout whose Vitest executable was
a symlink escaping the repository boundary. The benchmark was therefore added
temporarily to the owner checkout, profiled, and removed. Its pre-existing
`artifacts/loading-review/` directory was preserved. The detached preparation
worktree remains under `/tmp` at approximately 45 MB because no destructive
cleanup was authorized.

### Significant Hobbies browser lane

No browser trace was captured. Chrome DevTools reported that its dedicated
profile was already in use. Read-only inspection confirmed live Chrome PID
52032 held that profile and its singleton socket. The run stopped rather than
killing the process, changing global connector configuration, or substituting
traffic against a hosted Significant Hobbies deployment. This is an
operational qualification blocker, not a product performance finding.

The qualification also exposed and fixed an exact-selection mismatch: Vitest's
JSON reporter identifies a test by its flattened full name while the verbose
profiling reporter renders ancestor separators. A successful non-zero Vitest
summary now confirms the already exact-filtered diagnostic pass.

## Agent-facing diagnosis qualification

On 2026-08-09, the new `diagnose-performance` operation ran against the same
local App Health and Anime List workloads. It made no model call, installed no
dependency, retained no owned raw profile, and contacted no hosted service.

For App Health at clean revision `0582049a97893a98ac135496158e6a237817c0c7`,
the operation returned `allocation_pressure` with medium confidence. It linked
the observed median 7,370 B/op and 30 allocs/op to the strongest cumulative
repository path at `packages/go/middleware.go:55` (10.75%), labeled that source
relationship as inferred, and emitted a falsifiable hypothesis: the identical
benchmark must reduce B/op without regressing allocations. Benchmark latency
spread was 38.51%, so latency was retained as observed evidence but was not the
optimization success criterion.

For Anime List at revision `bc366c032ea2790ec111279178ae5a33910072f5`, the
operation returned `superlinear_scaling` with medium confidence. The measured
points were 0.408 ms/op at 1,000 items, 5.586 ms/op at 10,000, and 22.572 ms/op
at 35,000. The report calculated the observed 35x input ratio, 55.324x value
ratio, 1.581x normalized-cost ratio, and 1.129 endpoint exponent, then linked
the leading repository CPU observation at `src/recommendations.ts:38`
(`scoreAnime`) only as a candidate. Its verification requires all recorded
sizes to rerun and rejects the hypothesis unless high-end cost and the scale
curve improve.

Both reports included the originating capsule, stable evidence IDs, one next
action, and the identical adapter/target/name/sample policy. The Anime fixture
was temporary and removed after the run; its prior owner worktree state was
preserved.

## Source-aware optimization qualification

The first source-aware Anime List run exposed profiler perturbation: console
metrics taken from the V8-profiled pass reported an anomalous 60.287 ms at
35,000 items. CodeVetter now runs console benchmark metrics in a separate exact
unprofiled pass and reserves the profiled pass for CPU attribution.

The corrected local run at revision
`bc366c032ea2790ec111279178ae5a33910072f5` observed 0.409 ms/op at 1,000 items,
5.001 ms/op at 10,000, and 20.850 ms/op at 35,000. That is 35x more input,
50.978x more time, 1.457x higher per-input cost, and a 1.106 endpoint exponent.

Without manual source interpretation, `diagnose-performance` then reported:

- `bounded_result_overwork` with medium confidence;
- runtime CPU candidate `src/recommendations.ts:38` (`scoreAnime`);
- full sort before bounded slice at lines 74–75;
- eager mapping before sorting at lines 72–74;
- five collection-wide operations in the bounded source window;
- the falsifiable hypothesis to replace the full sort with bounded top-k
  selection and defer mapped result materialization;
- verification requiring all recorded sizes to pass, the largest input to
  improve, and the scale exponent not to regress.

This is the first qualification where CodeVetter itself connected runtime
evidence to the concrete optimization pattern. The hypothesis is not yet a
confirmed product improvement: no Anime List source change was retained.

The new pure optimization verifier is qualified for confirmed, rejected,
inconclusive, and incompatible scale comparisons; Go allocation improvement
with latency protection; full-diagnosis baseline loading; and a real closed CLI
before/after Node workload. A real Anime top-k patch remains the next end-to-end
confirmation trial.

## Significant Hobbies independent confirmation

On 2026-08-09, CodeVetter was run against Significant Hobbies at revision
`3656bfb055d22381bc57ba6ce8bd0ad6b2ae7d3d`. The existing recommendation test
was only 0.142% of exact-process wall time, so the diagnosis correctly returned
`startup_dominated_workload` instead of attributing a product bottleneck. A
temporary local-only test then measured the same recommendation operation at
1,000, 10,000, and 35,000 phases over 40 internal iterations.

The cross-project run exposed three architecture gaps and drove bounded fixes:

- transformed Vitest/V8 locations could point above the original TypeScript
  function declaration, so runtime source context now records the reported
  line while anchoring a uniquely identified original function;
- source diagnosis did not recognize repeated traversal or a `find` plus `some`
  nested lookup, and could inspect unrelated adjacent functions;
- one unprofiled console-metric execution allowed host noise to produce a false
  `confirmed` verdict, so Vitest now captures `samples` independent unprofiled
  metric executions and normalizes each metric by median.

With repeated metrics, the original implementation measured 0.504 ms/op at
1,000 phases, 2.805 ms/op at 10,000, and 9.116 ms/op at 35,000. CodeVetter's
first hypothesis was to merge two passes over `phases`. The identical verifier
measured 0.462, 2.859, and 8.846 ms/op and returned `inconclusive`: the 2.962%
high-end movement did not cross the 10% policy. That candidate was reverted.

The next diagnosis returned `nested_lookup_hotspot` and identified
`src/lib/hobbies.ts:252`: every category lookup scanned `HOBBY_CATEGORIES` with
`find` and each category's hobbies with `some`. Its falsifiable hypothesis was
to pre-index the catalog. Replacing that nested scan with a module-level map
produced medians of 0.191, 0.795, and 1.810 ms/op. The verifier returned
`confirmed`: the largest input improved 80.145%, the smaller inputs improved
62.103% and 71.658%, and the endpoint exponent improved from 0.814 to 0.633.

All 45 relevant Significant Hobbies tests passed with the temporary scale test,
and all 44 permanent hobby and recommendation tests passed after cleanup. The
temporary test and baseline JSON were removed. The seven-line indexed lookup in
`src/lib/hobbies.ts` remains as the only uncommitted Significant Hobbies product
change. No dependency was installed and no hosted application or cloud service
was contacted.

## Remaining gaps

1. Very short Vitest workloads can still be too sparse for an application CPU
   sample even though the worker profile is flushed; startup-dominated scopes
   are now identified explicitly.
2. Go pprof evidence identifies cumulative call paths, but line-level allocation
   ownership still requires a more specialized allocation experiment.
3. Scale-encoded console metrics and Go benchmarks have domain comparison;
   other console metric families still require caller-defined semantics.
4. Exact workload selection and baseline file management remain manual.
5. Browser render, long-task, and network-waterfall evidence remain blocked on
   a reliably isolated DevTools session; heap growth, database-query, and
   event-loop-delay evidence remain outside this slice.
6. Host process attribution is not captured; only load and timing variability
   are recorded.

## Blind open-source qualification

On 2026-08-09, CodeVetter profiled two immutable public projects using only
local execution. No hosted application, deployment, or paid service was used.

### go-chi/chi

At revision `8b258c7bb28f97a5f2a856ff7ef962578fec9215`, the existing
`BenchmarkMux` workload produced an `allocation_pressure` diagnosis. The
strongest owned cumulative path was `mux.go:87` at 69.55%, with the first route
sub-benchmark measuring a 93.29 ns/op median, 368 B/op, and 2 allocs/op. Source
inspection after attribution showed chi already documents that the allocation
comes from the required `http.Request.WithContext` and `context.WithValue`
contract. No unsafe patch was attempted.

The existing `BenchmarkWalkXFF` workload measured zero allocations and scaled
from about 5.6 ns at one entry to 50.7 microseconds at 10,000 entries. The CPU
profile correctly selected the reverse walker, but no material algorithmic
problem was present. This trial exposed a remaining gap: Go sub-benchmark names
such as `n=1000` are not yet normalized into input-scale curves.

### Marked

At revision `681373ccc058b5dc93c1f63291d755d7d714c2fa`, a temporary
Node test imported Marked's TypeScript source directly. A mixed Markdown
document remained approximately linear and localized the leading application
CPU sample to `Lexer.inlineTokens`. A secondary source-pattern hypothesis to
replace `split('\\n', 1)[0]` in `Tokenizer.list` improved the largest input only
3.059%, so verification returned `inconclusive` and the patch was reverted.

A reference-heavy document then exposed the high-leverage case. The repeated
median baseline was 1.046 ms/op at 100 references, 12.378 ms/op at 500, and
167.922 ms/op at 2,000, with an endpoint exponent of 1.695. CodeVetter reported
`repeated_linear_membership`: `Lexer.inlineTokens` materialized all reference
keys and called linear `includes` membership for each reference.

A naive `Set` created inside every `inlineTokens` invocation worsened the direct
2,000-reference measurement to 348.719 ms/op and was discarded. Caching one
indexed key set per lexer run produced repeated medians of 0.757, 2.630, and
9.923 ms/op. `verify-optimization` returned `confirmed`: the largest input
improved 94.091%, smaller inputs improved 27.629% and 78.753%, and the endpoint
exponent fell from 1.695 to 0.859.

Marked's 190 unit tests, 1,779 specification tests, esbuild build, declaration
build, and diff check passed. At this qualification stage no upstream branch,
commit, push, issue, or pull request had been created. The temporary clone
installed only its locked development dependencies and reported ten existing
audit findings; no audit mutation was run.

The same Marked optimization also qualified the paired verifier against two
independently runnable checkouts. Three measured samples alternated
baseline/current, current/baseline, then baseline/current after the same warmup
ordering. The operation required an identical SHA-256 target-file digest and
recorded every scheduled process. It confirmed a 94.399% largest-input
improvement under `evidence_mode: paired_interleaved`; all executions exited
successfully and the report had no limitations. Hermetic coverage separately
confirmed paired improvement and `no_confidence` when one side failed.

After upstream publication was authorized, the candidate received a second
cross-workload hardening pass. Replacing membership globally with
`Object.hasOwn` retained the reference-heavy improvement but made an ordinary
no-definition Markdown workload materially slower, so that implementation was
discarded. The submitted design enables constant-time own-property membership
only during the normal post-block inline phase, retains the existing dynamic
path for direct `inlineTokens` calls, and clears its temporary state in a
`finally` block.

Five-sample paired verification of that upstream design measured 1.577 to
0.869 ms/op at 100 references, 15.472 to 3.326 at 500, and 217.253 to 12.761 at
2,000. The largest input improved 94.126% and the endpoint exponent fell from
1.644 to 0.897. A separate representative Markdown workload moved +2.722% at
its largest input and was correctly classified `inconclusive`, below the 10%
materiality threshold. Marked's complete `npm test` command passed. Open pull
request [`markedjs/marked#4048`](https://github.com/markedjs/marked/pull/4048)
contains one source file and no generated or benchmark artifacts; it is no
longer a draft as of 2026-08-10.

## Pending-hypothesis closure

### Anime List bounded ranking

At revision `2be4c95d790b5c7adf98d49527dc333e52eb4d00`, the temporary
1,000/10,000/35,000-item recommendation workload recorded repeated baseline
medians of 0.466, 5.139, and 20.575 ms/op. The existing implementation scored
and fully sorted every eligible catalogue entry before slicing the 12-item
result.

Replacing the full result sort with stable bounded insertion produced medians
of 0.420, 3.525, and 10.386 ms/op. `verify-optimization` returned `confirmed`:
the largest input improved 49.521%, the 10,000-item input improved 31.407%, and
the endpoint exponent fell from 1.065 to 0.902. The permanent recommendation
tests passed, including a new stable tie-order and limit case; the temporary
benchmark and baseline were removed.

The initial diagnostic pass did not recover an application CPU frame and
therefore correctly withheld source attribution. A later profile did recover
`src/recommendations.ts`. This intermittent Vitest worker-profile capture is an
accuracy gap; the confirmation rests on three independent unprofiled domain
measurements, not process wall time or the inconsistent profile.

### App Health response-writer allocation

At clean baseline revision `0582049a97893a98ac135496158e6a237817c0c7`,
`BenchmarkMiddlewareOverhead` measured 30 allocs/op and a 7,366 B/op median.
CodeVetter localized the strongest cumulative owned allocation path to
`packages/go/middleware.go`, while Go escape analysis narrowed one actionable
allocation to the per-request `responseWriter` wrapper.

Reusing that wrapper through the standard-library `sync.Pool` reduced the
paired median from 30 to 29 allocs/op and from 7,361 to 7,334 B/op. The paired
interleaved verifier returned `confirmed`; median latency moved from 2,237 to
2,444 ns/op, a 9.253% secondary movement below the recorded 20% rejection
threshold. All 55 Go tests passed. This is a small but real request-path
allocation reduction, not a claim that the broad cumulative line owned all
middleware allocations.

## CodeVetter self-improvement qualification

CodeVetter profiled its own `collectV8FunctionCoverage` product operation through
the exact Node workload `function coverage normalization scales across source
anchors`. The workload creates one valid V8 coverage document at 80, 800, and
3,200 function anchors, asserts the retained function names and original source
lines, and times only normalization after fixture construction.

The ten-sample baseline measured 1.138, 33.105, and 405.185 ms/op. CodeVetter
classified the 40x input curve as superlinear with a 1.593 endpoint exponent.
Two independent V8 profiles repeated `collectV8FunctionCoverage` as the
repository-owned CPU candidate; the combined profile assigned it 1,517.376 ms
self time, 1,218 samples, and 56.54% sample share.

This pass also exposed an accuracy miss. The deterministic diagnosis inferred
that sorting coverage filenames before taking the bounded file prefix caused
the curve. The workload held coverage files constant at one, so that pattern
could not explain growth in function anchors. The same capture did correctly
include the `offsetLine` source window: it rescanned the source from byte zero
for both offsets of every function. The filename-sort hypothesis was therefore
falsified from captured workload identity, and the runtime-selected offset
mapping boundary became the candidate.

The product change indexes source line starts once per cached source and maps
each V8 byte offset with binary search. The identical ten-sample synthetic
candidate measured 0.642, 1.383, and 4.830 ms/op.
`verify_local_optimization` returned `confirmed`: the largest adversarial input
improved 98.808% and the exponent fell from 1.593 to 0.547 without any
smaller-input regression. The former hotspot fell to 16.332 ms combined self
time and below the independent source-repeatability threshold. This number is
specific to the deliberately worst-case one-file fixture and is not a claim
about whole-product or representative runtime performance.

The representative self-check generated coverage from the complete
CodeVetter runtime test suite: 91 V8 coverage documents totaling about 30.95
MB. The collector's normal bounds retained 32 files and 11,609,952 bytes. To
avoid self-referential source-offset drift, the replay excluded only the
collector module's coverage document while retaining all mapped repository
sources unchanged. Across 11 runs, the prior prefix-rescan implementation had
a 39.873 ms median and the indexed implementation had a 32.652 ms median, an
18.11% stage improvement. Both produced normalized function digest
`1e45039f8a24a651450f64a5d92c0c18d2c62f0de4011fe70389dfa90eea1f5a`.

The verifier conservatively retained `shipping_recommended: false` because the
candidate capsule carried that source-repeatability limitation. Qualification
found a separate reporting bug: the decision basis described every blocked
shipping recommendation as a sample-floor miss even when both sides had ten
samples. The decision text now distinguishes insufficient samples from recorded
evidence limitations, with focused coverage for both cases; the conservative
policy itself was not relaxed.

No network, cloud resource, database, model, production configuration, or
retained raw profile was used. Both captures share the same committed revision
because the product change is uncommitted; capture IDs and dirty state separate
the in-memory executions, but a content fingerprint remains an earned evidence
identity improvement.

## Current accuracy read

Across Anime List, Significant Hobbies, Marked, App Health, and CodeVetter's
self-trial, CodeVetter localized the relevant file in all five confirmed
optimization trials. It identified the concrete source pattern directly in
three; App Health required escape analysis inside the runtime-selected file,
and the CodeVetter trial required rejecting an unrelated pattern inside the
correct runtime-selected function before following the captured offset helper.

Before the Qs robustness pass, the verifier produced no observed false
confirmation. It returned
`inconclusive` for the 2.962% Significant Hobbies merge-pass change and the
3.059% Marked split-prefix change, then confirmed only the higher-leverage
indexed lookup, cached reference set, bounded ranking, and pooled wrapper. The
self-trial additionally confirmed indexed source-offset lookup. This is
promising directional evidence, not a statistically meaningful accuracy rate:
the corpus is four external product paths plus one self-hosted product path,
all under intentionally selected performance workloads.

## External robustness corpus

On 2026-08-09, a second local-only pass profiled four dependency-light public
projects at fixed shallow-clone revisions. It used no model, hosted service,
production data, database, or cloud resource.

### Picomatch and Pixelmatch

Picomatch revision `4f41a8edade7a5ab19832f7b40ecce46b288767f`
localized its repeated path-matching workload to `picomatch.test`. Replacing
the match-producing path with a `RegExp.test` shortcut regressed all recorded
sizes by 21.739% to 32.404%, and skipping an unused ignore callback improved
only 2.013% to 4%. Both candidates were reverted.

Pixelmatch revision `c6fee35afac3c52576b2cb424bd1061ab6a4bd06`
localized the workload to `pixelmatch` and `colorDeltaOpaque`. Deferring x/y
coordinate arithmetic for `includeAA: true` improved the three sizes by only
3.077% to 3.455%. The verifier returned inconclusive and the candidate was
reverted.

### GJSON negative control

GJSON revision `7d8b3821e9d2acf35e8a226b63fcf801078e9b96`
measured 953.8 ns/op at 100 fields, 10,192 ns/op at 1,000, and 42,888 ns/op at
4,000, with 0 B/op and 0 allocs/op. CodeVetter returned
`no_material_bottleneck_identified`; no source change was attempted. This is a
useful negative control: profiling a project does not require inventing an
optimization.

### qs confirmed flat-query candidate

Qs revision `3a890d4ecd3deb72a45d90be36f4f8c5970467c7`
localized a flat-query workload to `parseObject`, which ran once for each of
561,000 keys in the captured flow. The first fast-path implementation reduced
the performance metric but failed 24 upstream semantic assertions involving
mixed array and scalar inputs. A narrower string-only, entirely-flat path then
failed two more assertions for object input and decoded dotted keys. Those
failures were fixed before the candidate was remeasured.

The final candidate first proves every key is flat, then copies already parsed
values without building and merging a one-key object for every parameter. It
falls back to the original path for mixed/nested, object-input, prototype,
decoded-dot, and empty-key cases. All 1,045 upstream tests passed with 100%
statement and line coverage.

Ten-pair interleaved verification measured:

| Parameters | Baseline ms/op | Candidate ms/op | Change |
| ---: | ---: | ---: | ---: |
| 1,000 | 0.644 | 0.464 | -27.950% |
| 10,000 | 8.838 | 4.781 | -45.904% |
| 40,000 | 41.230 | 22.641 | -45.086% |

The endpoint exponent moved from 1.128 to 1.054. Both sides used ten measured
processes after one warmup; wall-time spread was 7.467% for the baseline and
3.747% for the candidate. CodeVetter returned `confirmed`, mechanically and
materially useful, with `shipping_recommended: true` and no recorded
limitations.

This trial also exposed an accuracy boundary. The source-pattern diagnosis
claimed two unconditional traversals of `parts`, but one traversal was gated
by `charsetSentinel` and did not run in the workload. Runtime function evidence
still selected the useful `parseObject` boundary, but the static causal
explanation was false. The detector now refuses to merge same-collection loops
at different lexical nesting depths, with a focused regression test for this
shape. More importantly, performance verification alone initially confirmed an
unsafe patch; the upstream correctness suite rejected it. A future end-to-end
optimization operation must compose performance and project correctness
receipts before presenting a shipping recommendation.

The disposable Qs clone installed 733 packages because a retry omitted the
intended development-dependency exclusion. The installation was local, ran no
package scripts or audit mutation, and is not a product runtime cost. The
temporary clones, dependency tree, profiles, and paired checkout were removed
after qualification.

On 2026-08-10, publication requalification at the same current upstream
revision used ten fresh alternating process pairs. It measured 0.772 to 0.518
ms/op at 1,000 parameters, 9.266 to 4.880 at 10,000, and 41.706 to 23.183 at
40,000. The largest input improved 44.413%, the endpoint exponent moved from
1.081 to 1.030, and the verifier again returned `shipping_recommended: true`
with no limitations. All 1,045 tests, lint, EditorConfig, README evaluation,
distribution build, and diff check passed. Draft pull request
[`ljharb/qs#592`](https://github.com/ljharb/qs/pull/592) contains only the
source change; the benchmark harness was removed before publication.
