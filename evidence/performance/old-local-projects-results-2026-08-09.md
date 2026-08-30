# Old local project performance pass — 2026-08-09

## Scope

This pass inspected every locally checked-out Fleet project whose canonical
lifecycle is `past`. It deliberately used local execution only: no production
database, external API, Cloud Player, deployment, or cloud benchmark was run.
The historical `mashup` project was excluded because it has been incorporated
into Foundry and has no independent checkout.

The qualification manifest is
`artifacts/performance/old-local-portfolio-manifest.json`.

## Portfolio result

Before adding a benchmark, CodeVetter classified the 12 checked-out projects as:

- `ready`: 0
- `needs_selection`: 8
- `no_representative_workload`: 4

After the Web Playables benchmark was added, CodeVetter independently selected
that exact test and classified the repository as `ready`:

- adapter: `vitest`
- target: `games/idle-startup/test/performance.test.ts`
- test: `scales deterministic company ticks`
- qualification score: 70

This is a useful product result: qualification can rediscover a good workload,
but it cannot manufacture representative workloads from generic correctness
tests. The portfolio initially had zero workloads with direct timing evidence.

## Verified optimization

### Web Playables — idle startup tick

The benchmark advances deterministic game state for 1,000, 10,000, and 50,000
ticks. The production tick function calculated gross revenue and burn, then
called `netPerSec()` for milestone checks, redundantly calculating both again.
The change reuses `gross - burn` within the same tick.

Observed CodeVetter comparison:

| Scale | Baseline | Optimized | Change |
| ---: | ---: | ---: | ---: |
| 1,000 ticks | 3.613 ms | 2.807 ms | -22.31% |
| 10,000 ticks | 21.666 ms | 12.338 ms | -43.05% |
| 50,000 ticks | 104.190 ms | 57.964 ms | -44.37% |

The enclosing Vitest wall time improved from 831 ms to 655 ms (-21.18%).
CodeVetter returned `confirmed`, `mechanically_confirmed: true`, and
`materially_useful: true`. It correctly withheld `shipping_recommended`
because the baseline had only three samples and independent Vitest profiles did
not all contain application source frames.

Validation after the change:

- 34 tests passed (27 simulation, 6 prestige, 1 performance)
- TypeScript `tsc --noEmit` passed
- Biome passed for the changed production and benchmark files
- `git diff --check` passed

The checkout was clean before the experiment. It now contains only the scoped
simulation change, the new benchmark, and the local `.codevetter` evidence.
The lockfile-existing dependencies were installed locally with scripts disabled;
69 packages came from cache and four were downloaded. No dependency was added.

## Project-by-project disposition

| Project | Qualification / inspection result | Action |
| --- | --- | --- |
| Aliveville | Generic Vitest tests suggested simulation work, but no timed workload existed and the Web3D dependency tree was not installed. | Inspected the world tick and catch-up paths; no evidence-backed change made. Best next workload is a deterministic multi-NPC catch-up benchmark. |
| Companion Robot | No representative code/test workload; effectively a project shell. | No optimization to make. |
| Elves HQ | Build/dev workspace with no benchmark or test workload. | No evidence-backed optimization to make. |
| EverythingRated | Generic tests only; checkout already had 109 dirty entries. | Preserved existing work and made no speculative edit. |
| Forecast Lab | No representative code/test workload; effectively a project shell. | No optimization to make. |
| Materia | Generic content tests only; checkout already had 18 dirty entries. | Preserved existing work and made no speculative edit. |
| Open Historia | Correctness tests, no timed workload. Storage restore already uses keyed lookup rather than a quadratic scan. | No material local hotspot found; no edit made. |
| Protein Index | Highest-signal work depends on database/network behavior. | Excluded from this backend-independent pass. |
| SaaS Ideas | No representative workload; checkout already had three dirty entries. | Preserved existing work and made no speculative edit. |
| Today Little Log | Browser/auth-oriented tests and lifecycle is deleted. | Excluded from local CPU optimization. |
| TrueHire | Generic tests only; likely runtime cost is external repository fetching and inputs are small. | A synthetic scoring microbenchmark would not be representative, so no edit was made. |
| Web Playables | Newly qualified deterministic tick benchmark. | Verified 44.37% improvement at 50,000 ticks. |

## CodeVetter gaps exposed

1. **Representative workload discovery is the limiting step.** File and test
   names are not enough; direct timing evidence was absent in all 12 projects.
2. **Vitest source profiling is incomplete.** V8 CPU profiling captured the
   Vitest/Vite runner process, not useful application frames from the fork that
   executed the test. The measurement and before/after verdict worked, but the
   tool did not locate the redundant calculation by itself.
3. **Dirty-snapshot qualification is coarse.** The repository is marked dirty,
   but untracked benchmark/evidence identity needs to remain explicit in every
   receipt.
4. **The shipping gate is usefully conservative.** It did not turn a three-sample
   baseline into a shipping claim even after a large observed improvement.

## One Billion Row Challenge status

The current CodeVetter artifact is a bounded Node parser experiment, not an
official 1BRC implementation:

- largest measured input: 800,000 rows
- latest parser-only time: 34.325 ms (the retained supervised run was 32.465 ms)
- latest throughput: approximately 23.31 million rows/second
- naive linear parser-only projection to one billion rows: 42.91 seconds
- official 8-core winner: 1.535 seconds
- optimistic gap: 27.95 times slower, or 3.58% of the winner's throughput

That gap is intentionally labelled optimistic. The current metric excludes file
I/O and startup, uses an in-memory string and a small generated station set, and
the file entry point reads the entire input with `readFile(..., "utf8")`. It is
therefore not yet capable of a credible official 12 GB run. Cross-machine
wall-clock results are not directly comparable either.

The next honest milestone is not a smaller microbenchmark number. It is a
streaming or chunked parser that can process the official file with bounded
memory, followed by an end-to-end same-machine benchmark against a baseline.

## Change policy

No commit, push, deployment, production configuration, or cloud resource was
created by this pass.
