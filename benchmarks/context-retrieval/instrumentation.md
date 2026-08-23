# Instrumentation faults

The single canonical list of defects found in this benchmark's own harness. It lives on
its own page because it is the most reusable thing here: the numbers describe one
repository at one moment, and this describes how measurement of this kind goes wrong.

Thirty faults. Every one below produced a plausible-looking result or assurance first.
All twenty-nine score-affecting faults **under-reported a tool that worked** — none
inflated a score. The thirtieth made the promised mid-range verification impossible.
Nine arm-results of 0.0%, from seven distinct causes, turned out to be faults rather
than findings about the tools.

## The catalogue

Published for methodological transparency, because every one of them made results
look **better or cleaner than reality**, and each looked individually plausible:

| Bug | Wrong result it produced |
| --- | --- |
| `setInterval` RSS sampler blocked by synchronous `execFileSync` | Every provider reported 0 MB memory delta; the printed figures were Node's own heap growing in run order |
| System-wide RSS sampler too noisy | `random-files`, which only lists filenames, reported a 231 MB delta; graphify and codesearch were reported inverted (1,129 MB vs 369 MB, actually 81 MB vs 3,166 MB) |
| Controls reported `tokens_delivered: 0` | Zero-cost controls got an unlimited token budget and won every budget row |
| `hosted` missing from `TIER_ORDER` | `indexOf` returned −1, sorting memory-heavy hosted tools **first**, inverting the sequential-safety ordering |
| Literal `0x1f` separator lost in a text edit | Commit parsing in the staleness probe silently broke |
| Staleness classifier matched its own worktree path | Probe named worktrees `stale-<provider>`; the tool echoed that path; the classifier saw "stale" and scored **all three providers as staleness-aware with 0% phantoms** — the exact opposite of the truth |
| `recall@k` ignoring payload cost | A query-blind churn ranker appeared to beat real products at 37.3%; charged properly it scores 0.0% at a 1k budget |
| `peakRssMbOf` re-ran the command after the index existed | codesearch's cold build was published as **15.6 MB**; it is actually **2,830 MB** — the figure was the warm re-run |
| `/usr/bin/time` output swallowed by an inner `2>/dev/null` | Peak-RSS rows came back empty and were briefly read as "no measurable memory use" |
| Path-regex result parsing vs. interned paths | jcodemunch returns `@1`/`@2` refs plus a legend instead of paths; the generic parser found none and scored a working retriever **0.0%** |
| `parsePaths` hook destructured in the factory but read in a sibling function | The override was silently out of scope, so every jcodemunch query returned `parsePaths is not defined` and the arm was scored **0.0% with 100% unavailable** — one commit after the row above was written about the same provider |
| Ran a daemon-backed provider with no daemon | gortex `track` writes config without indexing and without starting the daemon, so all 76 queries failed with a usage dump and the arm scored **0.0% / 100% unavailable** — a setup omission, not a retrieval result |
| Memory guard measured `free + inactive` pages | On macOS that omits most reclaimable memory: it read **4.4 GB** while `memory_pressure` reported **71% free** on the same 48 GB machine. The guard was therefore primed to abort healthy runs, and every in-session headroom figure was understated |
| **Adapter sorted one provider's ranking backwards** | The graph query returned an ascending match-rank (lower = better); the adapter sorted descending. So `recall@5` for that arm measured its five *worst* results, on every repository and every tier, for the whole session. Corrected, the same binary scores 27.1% instead of 17.6% at a 4k budget on fastify — **the arm was understated by ~9.5 points everywhere** |
| **Extension allowlist narrower than the ground truth** | Path extraction matched 15 source extensions. Ground truth is "the files the fix touched", which includes `package.json`, `go.mod`, `CHANGES.rst`, `globals.css`, `deploy-health.sh`, `.gitignore`, `Dockerfile` and `.husky/pre-push`. **174 of 764 cases (22.8%) had at least one ground-truth file the extractor could not express**, so those cases were unscoreable however good the answer — and the rate ran from 1.2% of fastify cases to 53.7% of private-D's |
| **Four different allowlists, one per adapter, no two alike** | `generic-cli`, `mcp-client`, `controls` and `agent-default` each carried their own vocabulary. An MCP arm could name a `.json` file where a CLI arm could not, so **the arms were not being asked the same question** — and `controls` used a third list, so the control gate compared a tool against a control with a different ceiling |
| **`return` inside a `finally` block** | Written as `if (reuseIndex) return;` to skip teardown in fixed-index mode. A `return` in `finally` does not skip the block — it *replaces the value the `try` block produced*. Every fixed-index call resolved to `undefined`, so **the entire large tier recorded no results**, which was read as retrieval tools failing to scale rather than as the harness discarding their answers |
| **One provider's spec declared twice in the same object literal** | The second `repowise:` key silently overwrote the first, so the arm ran without `--limit` and without `--format json` — measured under different settings than the ones documented beside it |
| **A stored gate verdict trusted across a differently-shaped run** | Arms were later measured one per process so a 42-second-per-query tool could not gate twenty-four others. Every artifact then truthfully reported "controls absent" — the controls were in sibling files — and the reporter stamped **"gate failed" on all 25 arms** of a run whose controls were present and losing. A verifier reading that either rejects sound numbers or learns to ignore the gate, and the second is worse. Gates are now recomputed over the union of loaded artifacts |

Six of these flattered a provider or the harness; the rest understated one instead,
which is the same defect pointed the other way — an instrument that cannot see an
answer reports its absence as a zero.

The last four rows arrived together and they invalidate every provider number
published above them. Three were found by running `biome check`, not by reading
results: the linter flags `noUnsafeFinally` and `noDuplicateObjectKeys` as a matter
of course, and both were sitting in the harness while the reported numbers were being
argued over. **A benchmark's own lint gate is a measurement instrument.** The fourth
was found by asking a question the summary tables cannot answer — *what fraction of
cases could any tool have scored?* — which is worth asking of any benchmark before
reading its rankings.

The vocabulary row is the more dangerous of the two extraction defects, and not
because it is larger. A uniform ceiling costs everyone the same cases and leaves the
ordering roughly intact; **four different ceilings change what each arm was asked**,
and no comparison-based gate can see it, because the control it compares against had
a ceiling of its own. That is the same blind spot as the sort inversion one row up:
the gates all ask "is this arm out of line with the others", and a defect that moves
the others too is invisible to every one of them.

There is now one shared definition in `scripts/context-retrieval/paths.mjs`, and it
is deliberately not a list of file types: a candidate is path-*shaped* if it carries
a separator or an extension, and whether it is a real file is settled by the
filesystem at the case's base revision. Widening the control pool the same way makes
the random control weaker, which flatters every real provider, so it is recorded in
that file rather than left as a silent default.

Three rules came out of this list, and they are the ones worth copying:

- **Charge for the payload.** `recall@k` alone let a query-blind churn ranker beat
  shipping products. Ranking under a token budget is what made the field legible.
- **Keep null controls in every run.** They are what caught it.
- **Classify mechanically before reading prose.** The staleness classifier matched
  its own worktree name out of the tool's echoed output.

The sort-inversion row is the most instructive failure in this table, because it
defeated every gate above. It was not a zero, not an all-unavailable arm and not a
near-perfect score, so nothing flagged it. It affected exactly one provider, so it
read as a property of that tool rather than of the harness. And it understated
*systematically* rather than randomly, which is the direction that looks like a
finding. It survived because plausible mid-range numbers got no scrutiny — the one
weakness in this benchmark that had been identified in writing and left unfixed. The
deterministic mid-range audit sampler exists precisely for this and was not yet
being read.

**A provider's score is not a number until you know its direction.** Both orderings
produce a plausible-looking table.

And one that only shows up when you widen the field: **a zero is a claim about your
setup until you have run one query by hand and read the bytes.** Of the four arms
that first scored 0.0% here, *none* was actually bad at retrieval: two returned
correct results in a format the default reader could not see, one hit a scoping bug
in the fix for the first two, and one had no daemon running. Four different causes,
one indistinguishable published number.

That rule earned its keep immediately. The fix for the interned-path row above
introduced the row below it: the custom reader was wired into the wrong scope, so
the provider went from "0% because the regex cannot read it" to "0% because the fix
throws" — the same published number, a second unrelated cause, and nothing in the
summary table to distinguish either from a tool that genuinely finds nothing. Run
one query by hand and read the bytes before believing a zero.


## Found while producing the single-project field measurement

Six more, all from the `got` run. Same shape as the rest.

| Fault | Wrong result it produced |
| --- | --- |
| **A sentence passed to a term-matching search** | `code-review-graph` scored **0.0% on all 108 cases** with a working 3,174-node graph. By hand the term `dnsCache` returns 17 nodes and `cache` returns 20, while the commit subject they came from — "Fix \`dnsCache: true\` having no effect" — returns zero. Queried per token it scores **33.8% at 4k and 62.8% at 16k** |
| **A tool's own cleanup command refusing, silently** | `cgc delete <path> --yes` exits with "Repository deletion is disabled. Set ALLOW_DB_DELETION=true in config", which the adapter counted as a completed cleanup. The shared graph therefore grew for 108 consecutive cases until it held 110 stale worktree paths, and those copies won the result slots — a hand query returned 20 matches of which 19 pointed into earlier cases' worktrees. **0.0% on all 108 cases** for a working 961-function graph |
| **A packer's report truncated to 20 arbitrary paths** | Both repomix arms recorded **0.0% recall and a 1.0 zero-hit rate**. They in fact deliver every required file in **103 of 108 cases**; the truncation took the first twenty entries in `git ls-files` order — `.editorconfig`, `.github/…` — which are never the answer. "Finds nothing" and "finds everything, unaffordably" are opposite findings, and this turned the second into the first |
| A boolean flag passed a value | `--repomix true` threw `unknown argument: true`, so both packer arms exited 2 and produced nothing at all on the first attempt |
| A subset defined relative to its own run | With one arm per process, `baseline_missed` meant 49 cases for one arm and 81 for another. Presented side by side it would have read as a hard-subset finding. That column was dropped; `no_path_leak` is kept because it comes from per-case corpus metadata and is 54 cases for every arm |
| Corpus hygiene missing two extensions | `NOISE_EXTENSION` covered `.md .png .svg .txt` but not `.rst` or `.webp`, so flask's `CHANGES.rst` was ground truth in **14 of its 39 cases** and hugo had two `.webp` golden fixtures. A changelog is not a file anyone had to locate. `got` contains neither, so the published field measurement is unaffected |

## Found while landing the work

| Fault | Wrong result it produced |
| --- | --- |
| **An existence check used where an ancestry check was needed** | After force-pushing `main` to purge private artifacts, I reported that only three commits had changed SHA, on the strength of `git cat-file -e <old-sha>` succeeding. That asks whether an object exists, not whether it is still an ancestor — and the object was there, un-garbage-collected. `filter-repo` had rewritten all 997 commits, orphaning every open pull request branch. GitHub then computed one PR's diff across two divergent ancestries as **100 files, none of them the files that PR's own description named**, when the real change was 11 files. I nearly filed that as a scope problem with someone else's branch |
| **A leak "fixed" and verified with the instrument that missed it** | The first removal commit took out 38 artifacts, and I confirmed "private-repo artifacts in HEAD: none" using a filesystem glob and a JSON-parsing detector. Both silently skipped two more files carrying private paths and SHAs. `git ls-files` is the authority for what is committed; a working-tree glob is not |
| **A test that asserted on source text** | `abandon.test.mjs` matched the literal expression `consecutiveHardFailures = hard ? ... : 0` in `score.mjs`. Extracting that loop into a named function broke the test while the behaviour was identical — backwards from what a test is for, and it had never verified the abandonment behaviour at all |
| **A test pinned to one machine** | The tiering test pointed at a private local checkout *and* a session-scoped temp directory, so it skipped everywhere else and contributed nothing. Renaming the repository turned a silent pass into a silent skip, which is the only reason it surfaced |
| **The audit gate discarded the evidence it nominated** | The sampler selected partial recall@10 cases, then stored only the first five returned paths and read `changed_files` even though the corpus contract calls the field `required_files`. Every expected set silently disappeared and **0 of 44 nominations retained enough output to verify the metric that selected it**. An independent audit recovered the cases and verified the stored top-five bytes, but ranks 6–10 require fresh runs |

The first two share the shape worth naming: **a verification that cannot see the failure
it is verifying against.** Three times in one session I reported something as checked
when the checking instrument was itself the fault — the backwards sort, the ripgrep
`cwd`, and this. The rule that falls out is narrow enough to be useful: when confirming
a fix, the check must be a different mechanism from the one that produced the error, not
a rerun of it.

## How much each corpus was capped by the narrow allowlist

Before the extension-allowlist fault was found, a case whose answer included a config,
script or doc file could not be scored however good the answer was. The rate was wildly
uneven across repositories, so it biased repository-to-repository comparison as well as
capping recall:

| Corpus | Cases | Affected | Share |
| --- | ---: | ---: | ---: |
| fastify | 82 | 1 | 1.2% |
| got | 108 | 2 | 1.9% |
| hugo | 29 | 2 | 6.9% |
| gin | 76 | 6 | 7.9% |
| express | 28 | 8 | 28.6% |
| flask | 39 | 19 | 48.7% |

Across all fourteen corpora built so far it was **174 of 764 cases, 22.8%**. `got` sits
near the bottom of that range, which is part of why it was chosen for the single-project
field measurement.

## The pattern worth copying

The three most consequential faults — the backwards sort, the narrow allowlist, the
sentence-to-FTS query — share one shape: **a tool that works, wired up wrongly, reports
as a tool that does not work**, and no summary table distinguishes the two. Comparison
based gates cannot catch it either, because a defect that also moves the controls is
invisible to every one of them.

Each was caught only because its number was extreme enough to look wrong. A plausible
wrong number would still be in the published tables. The first bounded read of
`nominateForAudit` is now recorded in [mid-range-audit-got.md](mid-range-audit-got.md):
all stored top-five evidence passed, but the audit found that the legacy record had
discarded ranks 6–10 and therefore could not verify its recall@10 selection metric.
