# Full field on one project — `got`

Every retrieval tool that installs and exposes a ranked, non-LLM result surface,
measured on one repository so that the comparison is between tools rather than
between corpora. Companion to the multi-repository work in [README](README.md); this
page is the single-project field, and nothing here generalises past `got`.

## Gates

- controls present: **pass**
- controls lose to the field: **pass**

## all — every case (108 cases)

| Arm | r@1k | r@4k | r@16k | median tokens | p50 ms | unavailable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| semble | 47.8% | 83.6% | 85.0% | 3,939 | 1,788 | 0.0% |
| codevetter-structural-context | 79.4% | 80.9% | 80.9% | 927 | 271 | 0.0% |
| ck | 35.5% | 74.9% | 74.9% | 2,610 | 34,850 | 0.0% |
| repowise | 46.1% | 63.5% | 63.5% | 2,023 | 40,076 | 0.0% |
| codegraph | 24.6% | 55.9% | 57.8% | 3,253 | 1,976 | 0.0% |
| graft | 46.1% | 46.9% | 46.9% | 267 | 2,564 | 0.0% |
| graphify | 28.9% | 43.5% | 45.8% | 1,678 | 2,436 | 0.0% |
| cocoindex-code | 7.4% | 39.6% | 51.8% | 5,008 | 1,800 | 0.0% |
| token-savior-regex | 18.8% | 39.5% | 40.0% | 2,274 | 2,771 | 0.0% |
| code-review-graph | 16.4% | 37.0% | 66.9% | 9,621 | 3,087 | 0.0% |
| jcodemunch | 24.6% | 35.2% | 36.0% | 1,165 | 927 | 10.2% |
| agent-default | 0.0% | 15.4% | 43.8% | 59,536 | 83 | 0.0% |
| filename-match | 2.0% | 13.2% | 24.4% | 3,075 | 16 | 0.0% |
| ripgrep | 0.0% | 11.1% | 38.9% | 63,496 | 175 | 0.0% |
| keyword-search | 0.0% | 10.7% | 39.1% | 62,239 | 49 | 0.0% |
| token-savior | 8.6% | 8.6% | 8.6% | 24 | 20,970 | 0.0% |
| gitnexus | 0.0% | 8.5% | 52.8% | 16,385 | 17,978 | 0.0% |
| gortex | 6.9% | 7.1% | 7.1% | 43 | 4,374 | 0.0% |
| ast-grep | 0.0% | 4.6% | 20.8% | 33,512 | 271 | 12.0% |
| _random-code-files_ (control) | 0.0% | 4.5% | 18.1% | 31,270 | 17 | 0.0% |
| _random-files_ (control) | 0.0% | 0.7% | 9.1% | 33,617 | 17 | 0.0% |
| chunkhound | 0.0% | 0.0% | 0.0% | 73 | 9,076 | 0.0% |
| _churn-ranked_ (control) | 0.0% | 0.0% | 28.9% | 86,197 | 33 | 0.0% |

Whole-repository packers, listed apart because they do not rank:

| Arm | r@1k | r@4k | r@16k | median tokens |
| --- | ---: | ---: | ---: | ---: |
| repomix-compressed | 0.0% | 0.0% | 6.9% | 82,502 |
| repomix-pack-all | 0.0% | 0.0% | 0.0% | 163,444 |

## no_path_leak — cases whose query does not name a file in the answer (54 cases)

| Arm | r@1k | r@4k | r@16k | median tokens | p50 ms | unavailable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| semble | 48.0% | 83.2% | 83.2% | 3,926 | 1,676 | 0.0% |
| codevetter-structural-context | 76.8% | 76.8% | 76.8% | 903 | 263 | 0.0% |
| ck | 36.3% | 74.1% | 74.1% | 2,613 | 35,880 | 0.0% |
| repowise | 46.1% | 60.5% | 60.5% | 2,008 | 41,914 | 0.0% |
| codegraph | 31.6% | 58.0% | 59.0% | 3,253 | 1,949 | 0.0% |
| graft | 45.2% | 46.1% | 46.1% | 263 | 2,486 | 0.0% |
| graphify | 28.5% | 45.7% | 50.3% | 1,680 | 2,558 | 0.0% |
| token-savior-regex | 17.8% | 40.9% | 41.8% | 2,239 | 2,470 | 0.0% |
| cocoindex-code | 9.3% | 39.5% | 50.0% | 4,991 | 1,787 | 0.0% |
| jcodemunch | 27.6% | 35.8% | 35.8% | 1,233 | 902 | 13.0% |
| code-review-graph | 10.8% | 33.8% | 62.8% | 9,194 | 2,971 | 0.0% |
| gitnexus | 0.0% | 9.6% | 48.8% | 16,385 | 18,706 | 0.0% |
| gortex | 6.6% | 7.1% | 7.1% | 43 | 4,198 | 0.0% |
| keyword-search | 0.0% | 5.6% | 34.9% | 61,942 | 48 | 0.0% |
| token-savior | 5.3% | 5.3% | 5.3% | 24 | 22,592 | 0.0% |
| ripgrep | 0.0% | 4.6% | 34.4% | 63,228 | 164 | 0.0% |
| agent-default | 0.0% | 2.8% | 25.8% | 58,582 | 77 | 0.0% |
| _random-code-files_ (control) | 0.0% | 1.5% | 17.4% | 31,735 | 17 | 0.0% |
| _random-files_ (control) | 0.0% | 1.4% | 11.4% | 30,902 | 17 | 0.0% |
| ast-grep | 0.0% | 0.9% | 8.2% | 25,100 | 276 | 22.2% |
| chunkhound | 0.0% | 0.0% | 0.0% | 73 | 9,297 | 0.0% |
| _churn-ranked_ (control) | 0.0% | 0.0% | 35.8% | 85,195 | 33 | 0.0% |
| filename-match | 0.0% | 0.0% | 0.0% | 1,544 | 16 | 0.0% |

Whole-repository packers, listed apart because they do not rank:

| Arm | r@1k | r@4k | r@16k | median tokens |
| --- | ---: | ---: | ---: | ---: |
| repomix-compressed | 0.0% | 0.0% | 6.3% | 81,589 |
| repomix-pack-all | 0.0% | 0.0% | 0.0% | 161,195 |

> **Publication scope:** exploratory one-shot retrieval evidence for one pinned
> TypeScript repository. This is publishable as a corpus, harness, raw-artifact set,
> and scoped measurement. It is not an overall product leaderboard, purchasing
> recommendation, or evidence that any tool improves an agent. Nobody outside the
> originating machine has reproduced the provider executions, and the legacy audit
> records cannot independently reconstruct ranks 6–10; see
> [mid-range-audit-got.md](mid-range-audit-got.md).


## Arms that could not be scored, and why

Recorded as outcomes, not as zeros. Five of this benchmark's 0.0% rows have turned out
to be harness faults rather than results, so a zero is now treated as a claim about the
setup until one query has been run by hand and the bytes read.

| Arm | Outcome | What was actually observed |
| --- | --- | --- |
| chunkhound | did-not-index | `chunkhound index .` aborts with "No embedding provider configured", and `search` then fails with "Database not found". The documented key-free path is unreachable, so there is nothing to score. |
| seagoat | protocol-incompatible | Needs a long-lived per-repository embedding server. The per-case protocol builds a fresh worktree for each of 108 cases, which would mean standing a server up and tearing it down 108 times. Not a quality result. |
| code-graph-context | not measured | Its first result was void (its own cleanup command was disabled by config and failed silently, so the shared graph accumulated 110 stale worktrees). The re-run with the fix in place costs roughly **90 s per case** — index, query, then a deletion that is itself slow — which is 2.7 hours for one arm against 1.7 s/query for the leader. Stopped rather than finished; the per-case cost is itself the finding. |

## Faults found in this run's own harness

Six, all found while producing this one table, and every one of them had produced a
plausible number first. They are listed with the other twenty-four in
[instrumentation.md](instrumentation.md) — one catalogue rather than two.

The two most consequential were adapters of mine reporting working tools as broken:
`code-review-graph` went from 0.0% to 33.8%/62.8% once queried per token instead of per
sentence, and `code-graph-context` was void because the tool's own cleanup command was
disabled by config and failed silently.

## What the numbers say

**The category works.** The leader reaches 83.2% at a 4k budget where plain keyword
search gets 5.6% and a random draw over source files gets 1.5%. Five arms clear 45%.
Whatever else is true, these tools are not marginal.

**Cost is the real gap, not accuracy.** Two of the four strongest arms take 36 and 42
seconds per query. Ten retrieval calls in an agent loop is six minutes of wall clock.
The 1k leader answers in 263 ms — two orders of magnitude apart at comparable 4k recall.
Roughly a quarter of the installable field also needed its operational surface debugged
before it would produce a number at all: a dead daemon, a cleanup command disabled by
default, an index that refuses without an embedding key, a server needed per repository.

**GitHub stars carry no information about retrieval quality.** Across the twelve arms
with published star counts, the correlation between stars and recall at 4k is
**r = +0.01**:

| Stars | Arm | r@4k (leak-free) |
| ---: | --- | ---: |
| 109,460 | graphify | 45.7% |
| 45,675 | gitnexus | 9.6% |
| 30,691 | code-review-graph | 33.8% |
| 15,613 | ast-grep | 0.9% |
| 6,165 | repowise | 60.5% |
| 5,932 | semble | **83.2%** |
| 4,257 | graft | 46.1% |
| 1,703 | ck | **74.1%** |

The two best third-party arms have 5,932 and 1,703 stars. Note that `ast-grep` is a
pattern matcher and not built for this task, so its 0.9% is category mismatch rather
than failure — but the top of the star ranking is not the top of the table either way.
The plain reading is that without a shared yardstick, attention does not track quality.

## How to read this

- **Three budgets, never collapsed.** The leader changes between them. Quoting one
  number without its budget is a choice about budget dressed as a finding about quality.
- **The controls are in the table, not in a footnote.** `churn-ranked` never reads the
  query; it reaches 28.9% at 16k, which is what an expensive query-blind guess buys.
  Any arm near it at that budget is not demonstrating retrieval.
- **`random-code-files` is the floor to clear**, not `random-files`. Sampling every
  tracked file is the honest null, but restricting the draw to source files is strictly
  harder to beat, and the gap between the two rows (4.5% vs 0.7% at 4k) is how much of
  a "floor" was previously just wasted slots on lockfiles and images.
- **`no_path_leak` is the subset to trust.** In 54 of 108 cases the commit subject names
  a file in the answer. The ordering barely moves between the two tables, which is the
  useful result: leakage is not what is driving it.
- **Latency is harness-inclusive.** It counts process spawning and per-case indexing, so
  it measures this protocol's cost for a tool, not the tool's steady-state speed.

## Limitations

One repository, one language, 108 cases. Ground truth is the files a real fix touched,
which is a proxy for the files someone had to find. Queries are commit subjects written
with the fix already in hand, so they are friendlier than real prompts. One shot, one
query, no iteration — which penalises precise-narrow tools and flatters broad ones.
Adapter effort is not uniform across arms, and effort correlates with score: three of
the six faults above were adapters of mine that under-reported a working tool, and the
only reason they were found is that their numbers looked wrong enough to check.
