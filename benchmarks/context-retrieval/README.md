# Retrieval-quality benchmark

Measures whether a code-context provider actually finds the code a change needed.
No agent, no model, no network, no cost. It answers a narrower question than the
[context-provider experiment](../context-providers/README.md) — retrieval quality,
not task success — and it exists because that experiment cannot currently answer
anything at all (see [Why this exists](#why-this-exists)).

> **Every provider number dated 2026-08-22 in this file is superseded and should not
> be cited.** Four harness defects found on 2026-08-23 invalidate them: path
> extraction could not express the file types 22.8% of cases were scored against,
> four adapters each used a different vocabulary so the arms were not asked the same
> question, a `return` in a `finally` block discarded every fixed-index result, and
> one provider's spec was declared twice so it ran under settings other than the ones
> documented. All four are described in
> [Instrumentation bugs](#instrumentation-bugs-found-in-this-benchmarks-own-harness).
> The corrected single-project field measurement is in
> [full-field-got.md](full-field-got.md) — 25 arms on one public repository under
> the amended plan. Whoever picks this up next should start at
> [HANDOFF.md](HANDOFF.md), which says what is measured, what is void and what will
> mislead a verifier.
> Re-measurement is in progress; the tables below are retained because the
> methodology and the failure modes are the durable part, not the figures.


## How it works

A case is built from one real fix commit in a local repository:

- **query** — the commit subject, with its conventional-commit prefix stripped
- **base revision** — `commit^`, the tree as it was *before* the fix
- **ground truth** — the code files that fix actually changed

A provider is asked what it would surface for the query at the base revision, and
its answer is compared against the ground truth. Everything is local git.

```bash
pnpm retrieval:corpus --limit 966 --out /tmp/corpus.json          # this repo
pnpm retrieval:corpus --repo ~/src/other --limit 400 --out /tmp/other.json
pnpm retrieval:score --corpus /tmp/corpus.json --format markdown
```

## Ground-truth hygiene

A changed-file list is not a clean need set. Four filters matter, and each one was
added because it was measurably distorting results:

| Filter | Reason |
| --- | --- |
| Docs, images, lockfiles, `.github/`, `openspec/` | Not code; nobody had to locate them |
| Tests sharing a stem with a changed source | Trivially derivable from the source name, so free recall |
| `package.json`, `tauri.conf.json`, `Cargo.toml` | Version bumps ride along with fixes — kept only when the change *is* the manifest |
| `release:`/`chore:`/`revert:` subjects | Sweeps, not retrieval tasks |

Cases with more than eight required files are dropped as feature work rather than
located fixes.

## Strata

Averaging over easy and hard cases hides the only interesting result, so the
scorer splits them:

- **baseline missed** — cases the reference baseline could not fully locate at
  rank 10. This is the stratum where a provider must demonstrate value. Difficulty
  is *derived from the baseline's measured result*, never predeclared.
- **baseline solved** — full recall at rank 10; by construction 100%.
- **path leak / no path leak** — whether query vocabulary appears in the ground-truth
  file paths. A property of the query, not a difficulty label: content search does
  not read paths. Reported so path-matching providers can't quietly bank the leak.

## Baseline result — 2026-08-22

`keyword-search` is the reference baseline: `git grep` over the pre-fix revision,
ranked by distinct query terms matched, skipping files over 512 KB because no
competent agent reads a 20 MB data blob on a single token match.

| Repository | Cases | recall@10 | prec@10 | never found | baseline missed | median tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| codevetter | 155 | 59.4% | 10.8% | 19.4% | 83 (54%) | 196,906 |
| anime-list | 80 | 56.5% | 9.0% | 22.5% | 43 (54%) | 43,261 |
| email-manager | 49 | 57.2% | 10.8% | 24.5% | 25 (51%) | 12,346 |
| free-ai | 24 | 68.8% | 12.3% | 20.8% | 9 (38%) | 62,743 |

Two findings replicate across all four repositories:

1. **Roughly half of real fixes are not fully locatable by keyword search** at
   rank 10, and on that stratum recall collapses to 16–24%. In 36–56% of those
   cases grep never surfaces a single required file even at rank 20.
2. **Precision is ~9–12%.** The baseline delivers tens to hundreds of thousands of
   tokens to find a handful of files. That is the headroom a context provider would
   have to exploit, and it is the first concrete target for the token-efficiency
   claims the category makes.

## Provider comparison — 2026-08-22

153 cases across three repositories. Every case indexed at its own pre-fix
revision; zero revision mismatches across all provider runs. `tok/recall` is
median tokens delivered divided by mean recall@10 — the cost of a unit of
retrieval.

| Repository | Provider | recall@10 | missed r@10 | full@10 on missed | never found | tokens | tok/recall |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| email-manager | keyword-search | **57.2%** | 16.0% | 0% | 24.5% | 12,346 | 21,599 |
| email-manager | graphify | 42.9% | 18.1% | 8% | 38.8% | 1,673 | 3,899 |
| email-manager | codevetter | 22.3% | 17.7% | 12% | 63.3% | **103** | **462** |
| free-ai | keyword-search | **68.8%** | 16.7% | 0% | 20.8% | 62,743 | 91,262 |
| free-ai | graphify | 32.3% | 8.3% | 0% | 50.0% | 1,971 | 6,103 |
| free-ai | codevetter | 13.0% | 23.6% | 11% | 75.0% | **118** | **906** |
| anime-list | keyword-search | **56.5%** | 19.1% | 0% | 22.5% | 43,261 | 76,554 |
| anime-list | graphify | 41.9% | 24.4% | 9% | 38.8% | 1,682 | 4,016 |
| anime-list | codevetter | 30.8% | 19.0% | 7% | 52.5% | **133** | **430** |

**The token-efficiency claim holds; the capability claim does not.** Both graph
providers deliver far less text per unit of retrieval — Graphify 5–19× cheaper
than grep, CodeVetter 50–200×. That effect is real and replicates. But neither
finds more: grep wins recall on all three repositories, and the graph providers
return nothing at all in 39–75% of cases against grep's 21–25%. What these tools
sell is compression, not better retrieval.

**On the stratum that matters, nothing separates them.** Across the
baseline-missed cases all three cluster between 8% and 24% recall@10, at n=25,
n=9 and n=43. Those differences are noise. The one encouraging signal is that the
graph providers reach *full* recall on 7–12% of cases where grep scores zero by
construction — real, but far from significant.

Two biases favour grep and belong on the record: queries are commit subjects,
whose prose appears in comments and string literals that content search reads and
symbol graphs do not; and this measures one-shot retrieval, while a real agent
iterates. Neither touches the token-efficiency result.

## Scorecard — email-manager, 47 cases

`recall@k` is not comparable across providers: ten whole files from grep costs
12,345 tokens, ten excerpts from CodeVetter costs 100. Ranking on `recall@k`
silently rewards whoever returns the bigger payload. **Recall at a fixed token
budget** is the primary metric because it asks what an agent actually faces —
given this many tokens, how much of what I need do I get?

`agent-default` is the honest baseline: reciprocal-rank fusion of content grep and
filename globbing, which is what an agent already does before installing anything.
Grep alone understates the free competition.

| Contender | r@1k | r@4k | r@16k | tokens | p50 ms | peak RSS | fails |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **agent-default** | 26.7% | 51.3% | **68.8%** | 12,069 | 67 | **11 MB** | 0 |
| keyword-search | 28.8% | 52.1% | 63.8% | 12,345 | 46 | 11 MB | 0 |
| filename-match | 15.6% | 28.6% | 29.9% | **764** | **11** | **8 MB** | 0 |
| **codesearch** | **46.8%** | **57.0%** | 57.0% | 1,514 | 565 | **3,166 MB** | 4 |
| graphify | 37.7% | 50.2% | 50.5% | 1,672 | 596 | 81 MB | 0 |
| codevetter | 23.8% | 28.1% | 28.1% | 100 | 262 | 53 MB | 0 |
| *churn-ranked* (no query) | 0.0% | 3.2% | 20.0% | 84,238 | 19 | 11 MB | 0 |
| *random-files* | 2.1% | 5.7% | 17.5% | 16,304 | 12 | 8 MB | 0 |

Peak RSS is per-process, measured with `/usr/bin/time -l` on the indexing step.

### There is no single winner, and the tradeoff is sharp

**A crossover decides whether any of this is worth installing.** Below ~4k tokens
of context, codesearch wins decisively — 46.8% against the free baseline's 26.7%,
a 1.75x advantage. At 16k the free baseline wins outright at 68.8%. codesearch
plateaus because it returns 20 chunks and stops; grep plus globbing keeps paying
off as you give it room. So a semantic retriever earns its keep **only if you are
context-constrained**.

**Fusing filename globbing into grep is free and beats grep alone**, lifting
recall@10 from 59.6% to 66.1% and taking the top spot at 16k. `filename-match`
alone is weak (29.9%) but very cheap (764 tokens, 11 ms); its whole value is in the
fusion. Any provider has to clear the fused baseline, not the grep-only one.

**codesearch costs 3.1 GB of RAM to index a 168-file repository** — 280x grep's
footprint and 39x graphify's. It is the direct cause of a memory alert during this
work. Combined with an 8.5% query-failure rate from its `--`/`+` parse bug, the
tool with the best tight-budget accuracy also has the worst operational profile.
Accuracy alone would have hidden both.

### Controls belong at the bottom once cost is charged

An earlier run reported `churn-ranked` at 37.3% recall@10, apparently beating real
products without reading the query. That was an artifact of `recall@k` ignoring
cost. Charged the whole-file tokens it actually imposes — 84,238 for 20 files — it
scores **0.0% at a 1k budget**. Budget-normalisation dissolved the finding. The
controls are still mandatory, but the churn prior is not the threat it appeared to
be at fixed `k`.

## There is no single ranking, and the sort key picks the winner

The most important thing to know before reading any number below: **five different
providers win depending on which defensible metric is used as the sort key.**

| Sort key | Winner |
| --- | --- |
| recall at a 1k budget | **codesearch** (51.0%) |
| recall at a 4k budget | **semble** (75.1%) |
| recall at a 16k budget | semble (75.8%) |
| recall@10, unbounded | **agent-default** (75.7%) — nothing is worth installing |
| recall per 1k tokens | **codevetter** (5.86) |
| lowest failure rate | agent-default / ripgrep / git grep (0.0%) |
| lowest phantom rate | **ripgrep / git grep** (0.0%) — the only arms that cannot go stale |
| lowest latency | filename-match (11 ms) |

Earlier drafts of this file sorted by the 4k budget and declared semble the winner.
That was a defensible choice presented as more objective than it was: 4k is simply
where the curves separated. Ranked by unbounded recall the free baseline wins and no
provider justifies installation; ranked per token CodeVetter wins by 12x.

Read the by-decision table instead of a leaderboard.

### Which to pick, by what you are optimising

| If you are… | Pick | Because |
| --- | --- | --- |
| Token-constrained on a paid API | **codevetter** | 5.86 recall per 1k tokens, 12x the next provider |
| Working at a 4–16k retrieval budget | **semble** | ~75% recall, zero failures across 251 cases |
| On the tightest budget, ~1k | **codesearch** | 51.0%, but one query in five fails |
| Running a large context window | **grep + glob** | 75.7% unbounded, free, nothing to install |
| Unable to tolerate stale results | **grep only** | Every indexed provider serves phantoms |

## Full field — gin, 76 cases, 19 arms

| Provider | Mechanism | r@1k | r@4k | r@16k | r@10 | tokens | per 1k tok | fails |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| semble | hybrid vector | 44.0% | **75.1%** | **75.8%** | 62.1% | 3,848 | 0.20 | **0** |
| codesearch | vector + BM25 | **51.0%** | 59.2% | 59.2% | 59.2% | 1,184 | 0.50 | 5 |
| graphify | AST symbol graph | 43.4% | 56.8% | 57.9% | 54.2% | 1,669 | 0.35 | 0 |
| gortex | graph, explicit token budget | 39.5% | 55.5% | 55.9% | 52.2% | 888 | 0.62 | **0** |
| token-savior-regex | symbol index, per-token regex | 29.4% | 52.3% | 52.3% | 51.6% | 1,914 | 0.27 | **0** |
| codevetter | tree-sitter graph | 36.1% | 39.1% | 39.6% | 33.9% | **68** | **5.86** | 0 |
| jcodemunch | symbol index, interned paths | 32.5% | 33.8% | 33.8% | 33.8% | 482 | 0.70 | 6 |
| token-savior | fastembed semantic, symbol-level | 15.1% | 15.1% | 15.1% | 15.1% | **25** | **6.05** | 3 |
| cocoindex-code | embedding chunks | 5.7% | 21.9% | 27.5% | 26.9% | 5,196 | 0.04 | **0** |
| agent-default | grep + glob fusion | 0.7% | 15.6% | 51.4% | **75.7%** | 67,886 | 0.01 | 0 |
| gitnexus | graph, callers-by-file | 2.4% | 12.8% | **60.8%** | 54.3% | 16,385 | 0.01 | **0** |
| ripgrep | lexical (agent default) | 0.7% | 11.2% | 53.0% | 73.3% | 70,681 | 0.01 | 0 |
| keyword-search | lexical (git grep) | 0.7% | 11.2% | 53.0% | 73.3% | 70,681 | 0.01 | 0 |
| filename-match | path tokens | 3.2% | 8.4% | 16.1% | 24.7% | 218 | 0.74 | 0 |
| zoekt | trigram index | 0.0% | 8.2% | 45.2% | 59.3% | 62,006 | 0.01 | 0 |
| ast-grep | structural pattern | 1.6% | 7.8% | 16.1% | 27.6% | 27,918 | 0.01 | 12 |
| ugrep | lexical | 0.0% | 2.6% | 23.7% | 47.1% | 66,693 | 0.00 | 2 |
| *random-files* | control | 0.0% | 2.6% | 10.1% | 9.2% | 24,793 | 0.00 | 0 |
| *churn-ranked* | control, no query | 0.0% | 1.8% | 28.8% | 50.8% | 88,455 | 0.00 | 0 |

**Caveat on recall-per-token**: like any ratio it rewards returning less. A provider
emitting one token at 1% recall would score 10. CodeVetter's figure is meaningful
only because its absolute recall (39.6% at 16k) is real rather than trivial — read
the ratio and the absolute number together, never the ratio alone.

token-savior's semantic mode is the case that proves the point. At a 25-token median
payload it posts the highest ratio in the field (6.05) while recalling 15.1% — it
returns a handful of scored symbols and nothing else. That is a genuinely useful
operating point for an agent that will read files itself, and a bad one for an agent
that will not. The ratio cannot tell you which; only the pair can.

Widening the field to 18 arms sharpened rather than softened the earlier conclusion,
and added one thing the narrower field could not show: **the budget where you measure
decides the winner, and the disagreement is now total.** codesearch wins at 1k,
semble at 4k, gitnexus at 16k, token-savior on cost, and agent-default on plain
`r@10`. gitnexus is the clearest illustration — last among real tools at a 1k budget
(2.4%) and first in the entire field at 16k (60.8%), because it spends 16,385 tokens
to get there. A single-number leaderboard over this table would be a choice about
budget disguised as a finding about quality.

### What this metric does not measure

Every number here comes from a **one-shot, single-query** proxy. Real agent use
differs in ways that matter, and the gaps favour some designs over others:

- Agents iterate — query, read, refine, re-query. Measuring the first shot penalises
  precise-but-narrow providers and flatters broad ones.
- There is no retrieval-only token budget in practice; the context window is shared
  with the task, the conversation and pending edits. The 1k/4k/16k buckets are a
  modelling convenience.
- Agents can recognise bad results and re-query. This metric assumes the first
  result set is accepted.
- Task success, not file recall, is what actually matters. Retrieval recall is a
  proxy — which is precisely what the executable-check harness in
  [the context-provider experiment](../context-providers/README.md) measures and
  this benchmark deliberately does not.

## Public-corpus results — 251 cases, four languages

Reproducible from `public-corpus.json`: anyone can clone at the pinned commit,
regenerate a byte-identical corpus, and re-run. Best whole-file arm shown against
best chunk arm at each budget.

| Repo | Cases | 1k budget | 4k budget | 16k budget | recall@10 |
| --- | ---: | --- | --- | --- | --- |
| express (JS) | 28 | graphify **50.9%** vs 0.0% | codesearch **58.9%** vs 44.0% | agent-default 64.9% ≈ graphify 64.0% | agent-default 67.9% |
| flask (Python) | 39 | graphify **28.6%** vs 0.0% | graphify **35.5%** vs 5.1% | graphify **35.5%** vs 17.9% | keyword-search 30.1% |
| gin (Go) | 76 | codesearch **51.0%** vs 0.7% | codesearch **59.2%** vs 15.6% | codesearch **59.2%** vs 53.0% | agent-default 75.7% |
| got (TS) | 108 | codesearch **31.5%** vs 0.0% | graphify **43.5%** vs 15.9% | graphify 45.8% vs 44.7% | agent-default 64.8% |

**Whole-file retrieval scores 0.0–0.7% at a 1k budget on every public repository.**
Real codebases have files of roughly 2–4k tokens, so a 1,000-token budget buys zero
complete files. Chunk-based retrieval wins at every budget up to 16k on all four.

Whole-file arms win only on unbounded `recall@10`, which is not an operating
condition any agent has.

### A conclusion this corrected

An earlier single-repository run (`email-manager`, 47 cases) produced the opposite
headline: that a semantic retriever "earns its keep only if you are
context-constrained," because whole-file arms won there from 4k upward. That
repository has unusually small files and was the outlier. Reporting from it alone
was confidently backwards. Per-repository results are therefore reported rather
than pooled.

### Availability — the reliability dimension

| Provider | Failure rate | express | flask | gin | got |
| --- | ---: | ---: | ---: | ---: | ---: |
| agent-default / keyword-search / graphify | **0.0%** | 0/28 | 0/39 | 0/76 | 0/108 |
| codesearch | **19.9%** | 2/28 | 2/39 | 5/76 | **41/108** |

codesearch's FTS layer parses the query as a query *language*, so natural-language
queries containing `--` or `+` throw `Syntax Error`. On `got`, whose commit subjects
are dense with package syntax, **38% of queries fail outright**. A single-repository
run showed 5–7% and badly understated it. Accuracy tables that omit availability
would rank this tool first while it silently refused one query in five.

## Index build cost and incrementality

Cold build measured on a fresh index directory, warm build by re-running against the
same directory. `gin`, 131 files, per-process peak RSS via `/usr/bin/time -l`.

| Tool | Cold time | Cold peak RSS | Warm time | Warm peak RSS | Incrementality |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoekt | **0.07 s** | 115 MB | 0.06 s | 96 MB | ~1.0 (rebuilds) |
| graphify | 0.74 s | **75 MB** | 0.70 s | 93 MB | ~1.0 (rebuilds) |
| codesearch | 20.02 s | **2,830 MB** | **0.01 s** | **16 MB** | **~0.0005** |

Two opposite strategies, both defensible:

- **codesearch** pays an enormous one-time cost — 20 seconds and 2.8 GB for 131
  files — then is essentially free to keep current. Its incrementality factor is
  ~0.0005, so on a tree that changes constantly the cold cost amortises away.
- **zoekt and graphify** rebuild from scratch every time, but their cold cost is so
  small that it does not matter. zoekt indexes 131 files in 70 ms.

The choice therefore depends on churn, not on the headline numbers. A CI job that
indexes once per run wants zoekt; a long-lived workspace wants codesearch.

Reported caveat: an earlier attempt measured codesearch's index at 15.6 MB peak,
which was the **warm** run — `peakRssMbOf` re-executed the command after the index
already existed. Cold and warm must be measured against a fresh directory and the
same directory respectively, or the two collapse into one misleading figure.

## Staleness — the dimension nobody reports

Every other metric here assumes the index matches the tree. In real use it does not:
you indexed this morning and the code moved since. The failure that matters is a
provider confidently returning code that no longer exists, because an agent will
then edit a function that was deleted yesterday.

`pnpm retrieval:staleness --repo <path>` probes it by deletion, because "returned a
file that is gone" cannot be argued with the way "returned slightly stale content"
can:

1. materialize a worktree at revision R, where the target file exists
2. let the provider build its index there
3. check out R+1 in the **same** worktree — the file is now gone
4. query **without re-indexing**
5. classify what comes back

`keyword-search` is the reference arm: it holds no index and reads the tree live, so
its phantom rate is 0 by construction. Every indexed provider is trading exactly
that guarantee for speed, and this measures the price.

18 deletion cases across three repositories, six each.

| Provider | Holds index | free-ai | anime-list | email-manager | **Pooled** | Detects staleness |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| keyword-search | no | 0% | 0% | 0% | **0%** (0/22) | n/a — nothing can go stale |
| codesearch | yes | 83% | 33% | 17% | **44%** (8/18) | **no** |
| codevetter-structural-context | yes | 83% | 33% | 100% | **72%** (13/18) | **no** |
| graphify | yes | 100% | 100% | 100% | **95%** (21/22) | **no** |
| zoekt | yes | — | — | — | **100%** (4/4, gin only) | **no** |

**Not one indexed provider detected that its index was out of date, and every one
served phantoms.** Graphify returned the deleted file in **all 18 cases across all
three repositories** — as the entry point of its own answer
(`Start: ['command-code.ts']`), for a file that no longer existed. That consistency
is not noise: its BFS traversal starts from the stale node and it performs no
revision check at all.

The indexed providers vary widely by repository (codesearch 17–83%, CodeVetter
33–100%), so a single-repository phantom rate would have been misleading in either
direction. Graphify is the exception, and its exceptionality is the finding.

Reported honestly: 6 of keyword-search's 18 clean results were `empty-result` — it
found nothing rather than correctly excluding the deleted file. Its phantom rate is
still 0 by construction, which is the point, but 12 of 18 were genuine exclusions
rather than 18.

A provider returning nothing also avoids phantoms without demonstrating any
awareness, so `empty-result` is recorded separately from `no-phantom` rather than
being credited as correct exclusion.

This reframes the category. These tools are not merely "faster search" — they are
cache-coherence problems, and none of the ones measured report their coherence.

## How the candidate field was assembled

The first version of this registry was written from memory, and that is a defect in
a benchmark meant to be published: a reader cannot distinguish a tool that was
judged and excluded from a tool nobody thought of. Absence has to be auditable.

So the field is now re-derived by a script, and the queries are part of the artifact:

```bash
node scripts/context-retrieval/discover-candidates.mjs \
  --registry benchmarks/context-retrieval/candidates.json \
  --fresh-since 2026-02-22
```

It runs 20 keyword and 8 topic searches against GitHub above a 1,000-star floor,
drops anything without both a code signal and a retrieval purpose in its name or
description, and prints what the registry is missing. On the 2026-08-22 run it
surfaced 48 in-scope repositories and **34 above the star floor that recall had
missed** — five of them genuine members of the category, one of which
(`token-savior`) turned out to be among the most token-efficient arms measured.

Two honest caveats. The triage regexes are crude, so the sweep is tuned for recall
and a human still reads the longlist. And a keyword sweep cannot find a tool whose
description avoids the category's vocabulary; the star floor and the six-month
freshness cutoff are also judgement calls, which is why both are flags rather than
constants. Rerun it before publishing — this category moves fast enough that any
fixed longlist is already stale.

### Installability is the dominant filter, not quality

Widening the field made the real obstacle obvious, and it is not retrieval quality:

| Obstacle | Count | Examples |
| --- | --- | --- |
| Needs a database or container beside it | 4 | Neo4j, Milvus/Qdrant, Postgres, Milvus |
| Undeclared or optional dependency blocks the advertised feature | 3 | `sentence_transformers`, `sqlite-vec` then `fastembed` |
| Broken against a current dependency | 2 | tree-sitter API drift |
| Wrong toolchain absent | 1 | no Zig compiler |
| Not a retriever despite the category label | 4 | packers, orientation maps, session memory |

More candidates fail to start than score badly. `token-savior` advertises semantic
search and ships a wheel that cannot do it until you install two more packages —
it names them in its own error text, which is better than most, but a reader
choosing from GitHub descriptions would never know. That gap between the claim and
the default install is the most consistent finding in this whole registry.

### What reproducing this actually costs

Per-arm cost is dominated by indexing, and index cost varies by more than two orders
of magnitude across the field. Measured on gin (109 files, 76 cases):

| Arm | Index per case | Peak RSS | 76 cases |
| --- | ---: | ---: | ---: |
| gortex | 2.3 s | 44 MB | ~4 min |
| token-savior (regex) | 0.11 s | low | ~2 min |
| token-savior (semantic, `--no-daemon`) | 0.11 s | moderate | **~25 min** |
| gitnexus | 13.9 s | 1,678 MB | ~18 min |
| codesearch (cold) | 20.0 s | 2,830 MB | ~25 min |

Two things a reproducer should know before starting. Semantic arms invoked as
one-shot CLI calls reload their embedding model every query, so `token-savior`
spends 20 s per case on a 0.11 s index — its daemon mode would amortize that, and
running it daemon-less is a deliberate process-hygiene choice, not the tool's fault.
And a full multi-repo run across every arm is **hours, not minutes**.

Providers are scored strictly sequentially, and free memory is re-checked before
each one against a floor (`--min-free-memory-mb`, default 3072) — codesearch
alone peaks at 2.8 GB on a 109-file repository, so a run that was safe to start can
become unsafe partway. When the floor is crossed the run aborts with partial results
and records which arms were skipped, rather than taking the machine down.

## Tiers, and why the earlier results were one tier mislabelled as the field

Every repository in the first version of this benchmark held between **83 and 141
code files**. Those numbers were published as "the field" when they described one
narrow regime — and the single most consequential fact about any provider in the
registry, that one of them cannot index a 1,461-file repository at all, was
invisible because nothing that large was ever measured.

Repositories are now assigned to tiers by **measuring them**, never by choosing a
repository to fill a tier. That ordering is the whole point: picking the repo after
you know the boundary is how a benchmark ends up with tiers that happen to match
some tool's sweet spot.

| Tier | Code files | Repositories | Protocol |
| --- | --- | --- | --- |
| small | ≤ 250 | express (141), gin (99), got (85), flask (83) | per-case index |
| medium | 251–1,000 | fastify (300), hugo (932) | per-case index |
| large | > 1,000 | fastapi (1,142), django (3,040) | fixed index |

The medium ceiling sits at 1,000 rather than a rounder 1,500 for a specific reason:
a 1,461-file repository must land in **large**, or the regime where import ceilings
bite would be measured under the small-repo protocol. The tier test asserts that
relationship rather than the constant, so it cannot drift back — and it caught this
exact error when the boundary was first written at 1,500.

### Two protocols, because per-case reindexing does not survive scale

On a 109-file repository a single index costs between 3 and 43 seconds depending on
the provider, so 76 cases across 19 arms is already hours. On a 3,000-file
repository the same design is days, and **a benchmark nobody reruns is not a
benchmark** however correct it is.

So the large tier indexes **once** at a pinned revision R, and draws cases only from
fixes that landed strictly after R. That preserves the property that actually
matters — the index never contains the fix — at one index per repository instead of
one per case. Admissibility is enforced with `git merge-base --is-ancestor` and
covered by a test against real history, because an off-by-one here would hand every
provider the answer and silently inflate the entire tier.

It is also arguably closer to real use: an agent queries an index built earlier, not
one rebuilt for its question. The cost is that incremental-reindex behaviour cannot
be credited in this tier, which is recorded rather than hidden.

### No overall winner is computed

There is no cross-tier or cross-budget aggregate, and the reporter is unable to
produce one — a test asserts that every leader line is scoped to a tier and a
budget. On the small tier alone the leader changes at all three budgets. Averaging
that would manufacture one answer out of a real disagreement, and **the
disagreement is the finding**.

### Medium tier — fastify (300 files, JS) + hugo (932 files, Go), 111 cases

Plan `084fc2621f9aac8d` (superseded by `4937d61d19d81518`; see the amendment in
`plan.json`). Gates passed on both repositories: the query-blind control
scored 0.0% against a 32.7% leader.

| Provider | r@1k | r@4k | r@16k | tokens | answered | coverage |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| graphify | **24.8%** | **32.7%** | 32.7% | 1,683 | 99.1% | medium · 2 repos |
| gortex | 16.0% | 16.7% | 16.7% | **640** | **61.3%** | medium · 2 repos |
| token-savior-regex | 1.8% | 16.2% | 17.0% | 3,860 | 95.5% | medium · 2 repos |
| agent-default | 0.0% | 6.0% | 26.2% | 83,066 | 100.0% | medium · 2 repos |
| keyword-search | 0.0% | 2.0% | 20.8% | 111,994 | 100.0% | medium · 2 repos |
| *random-files* | 0.0% | 0.0% | 1.3% | 30,793 | 100.0% | control |
| *churn-ranked* | 0.0% | 0.0% | 5.9% | 108,393 | 100.0% | control |

**Everything gets worse as repositories grow, but not at the same rate, and the
failure modes differ.** Tracking the same two arms across three sizes:

| | gin (99) | fastify (300) | hugo (932) |
| --- | ---: | ---: | ---: |
| graphify r@4k | 56.8% | 35.4% | 30.1% |
| graphify answered | 100% | 98.8% | 100% |
| gortex r@4k | 55.5% | 21.6% | 11.8% |
| gortex answered | 100% | 64.6% | 51.7% |

The two are within a point of each other on the small tier and separated by nearly
3x one tier up. And the accuracy column understates it: gortex stopped *answering*.
On fastify it returned nothing on 29 of 82 queries while still reporting zero
failures, and on hugo it failed to index 11 of 29 cases inside a five-minute
per-call timeout. Its daemon grew from 14.7 MB to roughly 2.5 GB over about 110
repository indexes, and before the timeout existed a single query was observed
running past 30 minutes.

**None of that is visible in a recall number.** It took the outcome taxonomy to
separate "answered badly" from "did not answer", and a per-call timeout to convert
"hangs forever" into a recorded failure. A benchmark reporting recall alone would
have published gortex at 16.7% with no asterisk and called it competitive.

## Small-project result — the defendable table

Every row is measured on **all four repositories** (express 28, gin 76, got 108,
flask 39 = **251 cases**; 65–141 code files), with a **single binary per provider**,
weighted per case. Rows measured on one repository are listed separately and are not
part of the ranking. Gates passed on every run: the query-blind control scored 4.2%
against a 74.5% leader.

| Provider | r@1k | r@4k | r@16k | tokens | answered |
| --- | ---: | ---: | ---: | ---: | ---: |
| semble | 43.8% | **74.5%** | **76.5%** | 3,891 | 100% |
| codevetter | **71.5%** | 72.3% | 72.3% | **559** | 99% |
| codesearch | 40.7% | 50.4% | 50.4% | 1,236 | — |
| graphify | 36.7% | 48.9% | 50.9% | 1,681 | 99% |
| jcodemunch | 24.7% | 29.9% | 30.2% | 608 | 90% |
| agent-default | 0.3% | 14.7% | 46.4% | 63,112 | — |
| keyword-search | 0.3% | 13.1% | 44.0% | 65,685 | — |
| cocoindex-code | 3.7% | 12.2% | 14.1% | 3,254 | 99% |
| *churn-ranked* | 0.0% | 4.2% | 32.2% | 76,557 | 100% |
| *random-files* | 0.3% | 2.5% | 13.2% | 25,601 | 100% |

**Excluded — single-repository only, therefore hints not findings:** gortex (55.5% at
4k), token-savior-regex (52.3%), gitnexus (60.8% at 16k), token-savior (15.1% on a
25-token payload), ripgrep, zoekt, ast-grep, filename-match. All gin-only.
`checkRankingComparable` fails any report that ranks them alongside the table above.

### What this supports

- **The budget decides the winner, and the two leaders are close.** Under 1k tokens
  codevetter leads by 28 points. At 4k and 16k semble leads by 2 and 4. There is no
  single answer, which is why no overall winner is computed.
- **Payload differs 7x between the leaders.** codevetter delivers 72.3% on 559 tokens;
  semble delivers 74.5% on 3,891. Within noise on accuracy, decisive on cost.
- **codevetter's curve is flat** (71.5 / 72.3 / 72.3): everything arrives inside 1k and
  extra budget buys nothing. semble keeps climbing.
- **Specialists only earn their keep under a budget.** agent-default — grep and glob
  fusion — reaches 46.4% at 16k, beating five specialist retrievers, on 63,112 tokens.
- **At 16k the query-blind control reaches 32.2%**, above four real providers.

### One correction worth reading

An earlier version of this table averaged codevetter's **pre-improvement** gin run
with its **post-improvement** runs on the other three repositories, producing 62.0%
at 4k — a number describing neither version of the product. It was found by the
reporter disagreeing with a hand-computed table, not by any gate. The stale artifacts
are retained as evidence for the retraction and marked `superseded_by`, which
aggregation now honours. The lesson generalises: **one binary per provider per table,
enforced, or the average is meaningless.**

### Private repositories — 5 owner projects, 242 cases

| Provider | r@1k | r@4k | r@16k | tokens | answered | coverage |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| graphify | 28.9% | **42.0%** | 42.8% | 1,745 | 99% | 5/5 |
| semble | 20.2% | 36.4% | 36.7% | 3,636 | 100% | 5/5 |
| jcodemunch | 13.6% | 13.6% | 13.6% | 559 | 92% | 5/5 |
| cocoindex-code | 0.8% | 3.3% | 4.2% | 2,607 | 100% | 5/5 |
| codevetter | 50.3% | 51.7% | 51.7% | 675 | 96% | **160/242 cases** |

**The ranking inverts between public and private code.** semble leads the public
small tier at 74.5% and is second here at 36.4%; graphify goes the other way. Same
tools, same tier, opposite order — the strongest argument in this benchmark for
measuring on your own code rather than trusting a published table, this one included.

codevetter's row is held apart: it was abandoned on one repository whose median case
revision is a 2,000-file monorepo, so it is scored on 160 of 242 cases and is not
comparable to the rows above it.

## What "defendable" requires, and where this benchmark stands against it

A number in this benchmark is defendable when a hostile reader can check it in ten
minutes and cannot dismiss it on structure. Six conditions, each mapped to a gate:

| Condition | Gate | Status |
| --- | --- | --- |
| Query-blind control present and beaten | `checkControlsPresent` + `checkControlsLose`, run refused otherwise | enforced |
| Ranking drawn from comparable evidence | `checkRankingComparable` — warns when single-repo and multi-repo arms are ranked together | enforced |
| Install failure never read as poor recall | `classifyOutcome`, five outcomes incl. `refused-own-capacity-limit` | enforced |
| Metric and budgets fixed before results | `plan.json`, hashed, hash printed in every report | enforced |
| Corpus reproducible byte-for-byte | rebuild-and-compare | enforced |
| Every published cell traces to an artifact | `results/` committed alongside the README | enforced |

The condition that took longest to satisfy is the second, and it is the one most
benchmarks in this category fail. At one point the small tier ranked a
**single-repository 75.1% above a four-repository 50.4%** as though they were the
same kind of claim. They are not: one is a hint and the other is a finding. Ranking
them together is not a rounding error, it is the whole result being wrong — and no
amount of decimal places fixes it.

Two conditions this benchmark does **not** meet, stated rather than buried:

- **Third-party reproduction.** Nobody but its author has run it. That is the only
  check that catches the biases the other six share, and it is outstanding.
- **Adapter parity.** Integration effort was uneven across providers and effort
  correlates with score. Per-provider effort is disclosed in `candidates.json`, which
  makes the bias visible but does not remove it.

## Reliability gates

These were conventions followed by hand in the first version, and conventions rot.
Each is now a check that fails loudly, and each corresponds to a specific bug that
shipped a wrong number.

| Gate | What it caught |
| --- | --- |
| Controls required in every run | A report without a query-blind arm cannot detect a broken metric; the run is refused outright |
| A control scoring above half the leader fails the run | The churn ranker at 37.3% against a 59.2% leader. Also fires on under-powered samples: on 3 cases the control *tied* the leader |
| Corpus rebuild must hash-match | Silent drift in ground truth |
| Zero / all-unavailable / near-perfect scores flagged | Four arms scored 0.0% for four unrelated harness bugs and zero tool defects |
| Deterministic mid-range audit sample | The plausible middle is where bias hides, and it is exactly what got no scrutiny before |
| Coverage travels with every row | Six arms had one repository and six had four, printed identically |
| Outcome taxonomy kept separate | More candidates fail to *install* than score badly; collapsing those is the largest distortion available here |

The metric and budgets are frozen in `plan.json` before results exist and hashed;
the hash appears in every report. That does not prevent gaming — it makes gaming
leave a trace in git history, which is the most any format can do.

## Instrumentation faults

Twenty-five defects have been found in this harness itself, every one of which produced
a plausible number before it was caught, and every one of which under-reported a tool
that worked. The full catalogue, the corpus-by-corpus cost of the worst of them, and the
pattern they share are in **[instrumentation.md](instrumentation.md)**.

## Not every "code context tool" is a retriever

The single most useful thing this benchmark produced is a taxonomy. The category
label covers at least three designs with incompatible interfaces, and only one of
them is comparable on retrieval. Scoring the other two as retrievers produces
numbers that look damning and mean nothing.

| Kind | Interface | Examples | Comparable here? |
| --- | --- | --- | --- |
| **Retriever** | natural-language query → ranked files | codesearch, graphify, CodeVetter graph | Yes |
| **Packer** | no query; emits the whole repository | Repomix, code2prompt | No — recall is 1.0 by construction, only token cost is meaningful |
| **Orientation map** | needs identifiers or live chat state, not prose | Aider repo-map, RepoMapper | No — has no natural-language entry point |

### Worked example: repo-map is not a retriever

RepoMapper implements Aider's tree-sitter + personalized PageRank map. Scored
against natural-language queries it looks terrible — `repomap-personalized`
reached 11.1% recall@10, *below* the 20.0% random floor and below its own
unpersonalized run at 22.4%.

That number is invalid, and the cause is instructive. `--mentioned-idents` applies
a 10× boost gated on `tag.name in mentioned_idents` — an exact match against
extracted identifier names. Prose tokens from a commit subject (`canonical`,
`auth`, `fallback`) essentially never match a camelCase tag, so they buy no boost
while still perturbing map composition, which is why personalization scored *worse*
than none. Fed real identifiers instead:

| `--mentioned-idents` | Top result for the auth query |
| --- | --- |
| `canonical auth fallback domain` (prose) | `src/lib/auth.ts` absent from top 6 |
| `getGmailAccessToken AuthEnv` (identifiers) | **`src/lib/auth.ts` ranked first** |

The tool works correctly. The benchmark was feeding it the wrong kind of input. In
Aider those identifiers come from live chat state — files open, symbols under
discussion — which a commit-subject corpus cannot supply. Only `repomap-global`
is measurable here, and it lands next to the controls (22.4% against random's
20.0%) because a query-blind orientation map is exactly what it is.

Its PageRank also returns `Rank value: 1.0000` for every file in both modes, so the
adapter records `rank_is_degenerate` rather than scoring an arbitrary order as
though it were a ranking.

## Full field with controls — email-manager, 47 cases

Every provider and both controls on one corpus, after the query-specificity filter.
Zero revision mismatches across all 282 case-provider pairs.

| Provider | recall@5 | recall@10 | recall@20 | prec@10 | never found | payload | tokens | median ms | n/a |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| keyword-search | **52.4%** | **59.6%** | **67.5%** | 11.3% | 23.4% | whole files | 12,345 | 38 | 0 |
| codesearch | 46.6% | 54.2% | 57.0% | 10.6% | 31.9% | chunks | **1,514** | 829 | 4 |
| graphify | 39.5% | 44.7% | 50.5% | **14.5%** | 38.3% | node summaries | 1,673 | 126 | 0 |
| **churn-ranked** *(no query)* | 24.7% | 37.3% | 59.1% | 5.5% | 34.0% | control | 0 | 36 | 0 |
| **random-files** | 8.0% | 20.0% | 32.5% | 3.4% | 53.2% | control | 0 | 21 | 0 |
| codevetter | 14.5% | 21.1% | 28.1% | 11.8% | 63.8% | excerpts | 100 | 48 | 0 |

Two results worth separating out.

**codesearch is the first credible version of the category's claim.** Its four
`n/a` cases are not retrieval failures: its FTS layer parses the query as a query
*language*, so natural-language queries containing `--` or `+` throw
`Syntax Error` (`pre-push --if-present syntax…`, `create better-auth migrations +
schema mapping…`). Scored on the 43 queries it can parse, it reaches **59.2%
recall@10 against keyword search's 62.2% on the same 43** — within 3pp — while
delivering 1,514 tokens against 12,345. Near-parity recall at an eighth of the
payload is the first honest 8× token result in this benchmark. The parse defect
costs it 5.0pp and is fixable by whoever owns the tool; it is left unpatched here
so the number reflects the shipped product.

**A query-blind control still beats two real products at rank 20.** `churn-ranked`
reaches 59.1% recall@20 — above codesearch (57.0%), graphify (50.5%) and
codevetter (28.1%). And `random-files` at 32.5% beats codevetter's 28.1%.

## Null controls — read this before any provider number

Every provider score above is meaningless without a floor to compare it to. Two
controls do no retrieval whatsoever, and both are mandatory in any run:

- **`random-files`** — returns k files chosen by a seeded hash. Establishes what
  coverage alone buys: returning 20 of a 200-file repo scores 10% by luck.
- **`churn-ranked`** — returns the most frequently changed files, counted from
  `git log <base_revision>` so only ancestors are visible. **It never reads the
  query.** Ground truth here is "files this commit changed", and files that churn
  keep churning, so this measures the benchmark's own prior.

| Repository | Provider | recall@10 | recall@20 |
| --- | --- | ---: | ---: |
| email-manager | keyword-search | 57.2% | 66.8% |
| email-manager | graphify | 42.9% | 50.5% |
| email-manager | **churn-ranked** (no query) | 35.8% | **58.7%** |
| email-manager | codevetter | 22.3% | 28.9% |
| email-manager | **random-files** | 19.1% | **33.2%** |
| free-ai | keyword-search | 68.8% | 78.1% |
| free-ai | **churn-ranked** (no query) | **47.0%** | **63.0%** |
| free-ai | graphify | 32.3% | 33.3% |
| free-ai | **random-files** | 13.5% | **36.3%** |
| free-ai | codevetter | 13.0% | 17.2% |
| anime-list | keyword-search | 56.5% | 64.6% |
| anime-list | graphify | 41.9% | 48.0% |
| anime-list | codevetter | 30.8% | 36.2% |
| anime-list | **churn-ranked** (no query) | 21.5% | 33.4% |
| anime-list | **random-files** | 6.2% | 13.0% |

Three conclusions, and they override the provider table above:

1. **`churn-ranked` beats CodeVetter on all three repositories** and beats Graphify
   on free-ai, without reading the query at all. Any provider that does not clearly
   beat churn has demonstrated nothing. Only `keyword-search` clears it everywhere.
2. **CodeVetter's structural context is at or below the `random-files` floor on two
   of three repositories** — 13.0% vs 13.5% on free-ai, and 17.2% vs 36.3% at
   rank 20. Its earlier "50–200× cheaper per unit recall" is not efficiency; it is
   cheap because it returns almost nothing relevant.
3. **`random-files` swings from 6.2% to 19.1% across repositories**, purely with
   repository size. Absolute recall is therefore not comparable across repos without
   the control. Report the control or report nothing.

### Query-dependence check

`--shuffle-queries` feeds each case a different case's query while keeping its
revision. A provider that ignores the query scores the same.

| Provider | real recall@10 | shuffled recall@10 | drop |
| --- | ---: | ---: | ---: |
| keyword-search | 57.2% | 22.4% | −34.7pp |
| graphify | 42.9% | 6.2% | −36.7pp |
| codevetter | 22.3% | 9.3% | −13.0pp |

Graphify collapsing to 6.2% — below the random floor — is evidence *for* it: it
returns a tight, query-specific set and confidently returns the wrong files when
given the wrong query. That is real retrieval. CodeVetter's shallow drop from an
already near-random score is the opposite signal.

### A win that was not a win

An earlier run recorded CodeVetter as uniquely solving a three-file change across
`EmailDetail.tsx`, `EmailList.tsx` and `Subscriptions.tsx` where keyword search
found nothing. The query was `fix email manager bugs (#4)`. There is nothing in it
to retrieve: the graph matched `Email*` filenames against the token "email" in a
repository called *email-manager*. On the specific queries in the same corpus
(`use canonical auth fallback domain`, `fix filter builder selection`) CodeVetter
returned nothing and keyword search returned the correct file.

The corpus builder now rejects such cases. A query must retain at least two tokens
after removing generic fix vocabulary (`bugs`, `handling`, `various`, …) and the
repository's own name tokens. This dropped 2 of 49 email-manager cases and is the
reason provider numbers here may differ from earlier runs.

### Providers excluded, with evidence

| Provider | Result |
| --- | --- |
| CodeGrok MCP 3.4.7 (`dondetir/CodeGrok_mcp`) | **Not measured — indexing did not complete.** The generic MCP client handshakes and discovers its tools fine, and it pulls `nomic-ai/CodeRankEmbed` (523 MB) on first run. But `learn` never returned on a 168-file repository within 178 s and the server exited; stderr shows only a `resource_tracker: leaked semaphore` warning from its `parallel_indexer`. Recorded as unmeasured rather than broken: a tool defect cannot be cleanly separated from this harness's subprocess handling on the evidence available. |
| Claude Context (`zilliztech`) | Not yet adapted. Requires a Milvus/Zilliz instance plus an embedding provider. |
| GitNexus (`abhigyanpatwari/GitNexus`, 45.7k stars) | Not yet adapted. Verified real; MCP-served local graph, so the generic MCP client should reach it. |
| RepoMapper / Aider repo-map | Measured as `repomap-global` only. Its declared `tree-sitter>=0.20.0` has no upper bound, so pip resolves 0.26 where `Language.query()` is gone; 0.25.2 has both `QueryCursor` and `Language.query` and works. A correct pin fixes it with no code change — unlike CodeGraph, whose shim is wrong for every version. |
| CodeGraph (`codegraph-ai` 0.3.1, PyPI) | **Cannot index any repository as shipped.** `adapters/_ts_compat.py` fails three times in sequence against its own declared `tree-sitter>=0.25.2`: `parser.parse()` receives a decoded `str` where bytes are required, then `tree.root_node()` and `child_count()` are called as methods where 0.25+ exposes properties. Reproduced with `--lang python`, so the defect is in the shared shim, not one language adapter. The npm package named `codegraph` is an unrelated 1.5 KB stub from 2024. |
| RepoWise (`repowise` 0.1.99, npm) | Excluded by owner decision on data egress. Bundle references `api.repowise.ai` and `app.repowise.ai/billing` with 48 matches on api-key/telemetry/fetch patterns; custom `"RepoWise"` license with no LICENSE file shipped (`files: ["dist/bin"]`). |
| DeepWiki | Inapplicable, not merely unapproved: it indexes public GitHub repositories and cannot index a private local tree at a chosen revision. |
| Sourcegraph | Enterprise authentication plus source egress. |

### Provider notes

- **CodeVetter cannot index this repository.** A full snapshot of `codevetter` is
  248 MB / 101,053 nodes against `MAX_IMPORT_BYTES` of 32 MB and
  `MAX_IMPORT_NODES` of 100,000 in `interchange.rs`. It builds, then cannot be read
  back, so the comparison runs on smaller repositories. Scoped claim: this is the
  experiment adapter's JSON round-trip, which the Stage 0 probe declares as the
  provider interface. The shipped app may query the graph in memory and never hit
  it.
- **The fixture tool's `revision` argument is a label, not a checkout.** Indexing
  discovers files with `git ls-files -co` against the working tree. Both graph
  adapters therefore materialize a detached worktree per revision; without that,
  every case would index HEAD and stamp it with a historical SHA.
- **Graphify** ran as `update --no-cluster`, which is pure AST extraction with no
  LLM call. It indexes prose too — `docs/**/lessons.md` nodes appeared in results
  for code queries — and warned about a missing `tree_sitter_sql` dependency and
  four `.astro` files with syntax errors, all of which cost it precision.

## Why this exists

The [30-task agent corpus](../agent-tasks/README.md) cannot measure context
providers: 28 of its 30 fixtures are single-file repositories and the rest have
two, so the observed need set is one file per task and retrieval recall is 1.0 by
construction. Stage 1 of the context-provider experiment consequently produced a
result driven entirely by agent capability and fixture size, not by context.

## Limitations

- **One repository per run.** Cross-repo agreement above is suggestive, not a
  generalization claim, and every repository here belongs to the same author.
- **Changed files are a proxy** for the files a fix had to *find*. A valid fix may
  touch a different boundary than the one that was actually taken.
- **Queries are friendlier than reality.** Commit subjects were written with the
  fix already in hand. The path-leak stratum bounds one form of that advantage;
  it does not remove it.
- **Retrieval quality is not task success.** A provider can rank well here and
  still not help an agent. Executable outcomes remain the authority, and this
  benchmark makes no success claim.
- **`codevetter` scores itself.** Using this repo to evaluate CodeVetter's own
  context is fine for comparing providers under identical conditions and unfit
  for any absolute claim about it.
