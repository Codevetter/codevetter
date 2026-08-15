# Qualification

Date: 2026-08-09

## Hermetic Node campaign

The first real campaign used a dependency-free Node repository at revision
`37b017ef3ae66f619ba520d17f5bd8d4f7b79c4f`. Its immutable scopes were one
exact correctness test and one exact `size100000` performance test.

The first run exposed a verifier gap: the candidate's internal median improved
from 0.894 to 0.098 ms/op, but a single input point was ignored and process
startup made the result inconclusive. CodeVetter was changed to compare
repeated, compatible single-input benchmark metrics directly while retaining
multi-input exponent analysis for scale curves. A fresh evaluator-pinned
campaign then recorded this history without ledger edits:

1. `baseline_ready` for the two-pass `map` then `reduce` implementation;
2. `discard` for a constant-return shortcut because correctness failed before
   performance profiling;
3. `promising` for one allocation-free indexed loop;
4. `keep` after 22 paired interleaved executions.

Promotion measured 0.843023 to 0.078448 ms/op, a 90.694% synthetic workload
improvement, with identical workload SHA-256 and no promotion limitations. The
campaign took 0.592 elapsed minutes. This qualifies decision composition and
history; it is not an application-wide performance claim.

## Evaluator self-improvements

The loop found and fixed three evaluator limitations before the external trial:

- compatible repeated single-input Node metrics no longer fall back to runner
  startup timing;
- every slash-separated Go test or benchmark selector component is anchored,
  preventing prefix-colliding benchmarks from contaminating an exact scope;
- a zero-allocation Go benchmark can now confirm a latency-only improvement at
  the 10% materiality threshold, while any allocation regression still rejects
  the candidate.

Campaign initialization pins a SHA-256 over the evaluator implementation. Each
of these changes therefore required a fresh campaign rather than allowing new
rules to reinterpret an existing incumbent.

## External Go campaign: go-chi/chi

The external local trial used the clean existing checkout of `go-chi/chi` at
revision `8b258c7bb28f97a5f2a856ff7ef962578fec9215`. No dependency install,
production endpoint, cloud runner, paid model, commit, push, or PR was used.
The workload was exact `BenchmarkWalkXFF/n=10000`; five exact client-IP and
security tests were the declared correctness gate.

Baseline evidence measured approximately 52.5 microseconds/op, 0 B/op, and 0
allocations/op. The CPU profile attributed 39.5% cumulative time to `walkXFF`.
An ASCII-only boundary trim screened as promising and paired promotion measured
50,992 to 43,677 ns/op, a 14.345% improvement with 0 B/op and 0 allocations/op.
All 257 upstream tests also passed.

That result was not preserved. A new local holdout for non-ASCII boundary
whitespace demonstrated a compatibility regression: the original
`strings.TrimSpace` returned `1.2.3.4`, while the candidate retained the Unicode
spaces. This behavior was outside the declared campaign scopes, so the
campaign's `keep` verdict accurately described its manifest but was
insufficient for shipping.

A compatibility-preserving ASCII fast path plus Unicode fallback passed the
holdout. Its screening medians were 51,141 versus 51,743 ns/op, a 1.177%
regression, so CodeVetter returned `discard`. The source checkout was restored
clean; no external source change was retained. The positive and negative Chi
campaigns consumed under two minutes of recorded local campaign time combined.

## Accuracy conclusion

The laboratory can reliably enforce the contract it is given: exact selection,
correctness before performance, materiality, paired promotion, resource
regressions, immutable evidence, and deterministic stopping. It cannot infer an
omitted behavioral invariant. Campaign authors must therefore include holdout
flows or an independently produced full-suite verification receipt before a
shipping verdict becomes authoritative. Composing that broader project
verifier into promotion is the highest-value next accuracy improvement; the
current MCP and CLI should not claim universal correctness without it.
