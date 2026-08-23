# Handoff — retrieval benchmark, 2026-08-23

Written for whoever picks this up next, including an agent asked to verify it. It says
what is measured, what is void, what is unfinished, and where every number came from.
Read [Before you trust anything here](#before-you-trust-anything-here) first.

## The ticket

Work is tracked in **[#159 Compare Code Context Providers](https://github.com/Codevetter/codevetter/issues/159)**.

## State in one paragraph

There is a working single-project full-field measurement: 25 arms on `got` at a pinned
revision, 108 cases, artifacts committed under `results/full-field-got/`. The numbers
are in [full-field-got.md](full-field-got.md). Everything published before
2026-08-23 is **void** — four harness defects invalidated it, all documented in
[instrumentation.md](instrumentation.md). One arm (`code-graph-context`) is unmeasured:
its adapter fault is fixed, but the corrected run costs ~90 s per case and was stopped. The multi-repository
tiered work exists in code and in the plan but has **no valid results** right now.

## Before you trust anything here

Three things will mislead you if you don't know them.

**1. Each artifact says its gates failed. That is a false alarm.** Every artifact in
`results/full-field-got/` carries:

```
"limitations": ["RELIABILITY GATE FAILED — do not publish these numbers: controls
absent: random-files, random-code-files, churn-ranked", ...]
```

Each arm was run in its own `score.mjs` process, so that one 42-second-per-query tool
could not gate the other twenty-four. The consequence is that no single artifact
contains the controls — they are in sibling files. The gate must be recomputed on the
union of artifacts, which is what `field-report.mjs` does, and on the union **it
passes**. Do not read the per-artifact limitation as a real failure, and do not delete
the check either: the union recomputation is the thing to verify.

**2. Nine 0.0% arm-results, from seven distinct causes, were harness faults rather
than results.** Every 0.0% you
see should be treated as a claim about the setup until one query has been run by hand
and the raw bytes read. Confirmed cases: a working 3,174-node graph scored 0.0% because
the adapter passed a whole sentence to a term-matching search; a working 961-function
graph scored 0.0% because the tool's own cleanup command was disabled by config and
failed silently; two packer arms scored 0.0% while delivering every required file.

**3. The score bias runs one way.** Every score-affecting fault found so far
*under*-reported a tool that worked. None inflated a score. Assume the same direction
for faults not yet found, and treat the published ordering as a lower bound on the field
rather than a settled result.

## Where things are

| Path | What it is | Durable? |
| --- | --- | --- |
| `scripts/context-retrieval/` | Harness: `score.mjs` (runner), `adapters/`, `gates.mjs`, `tiers.mjs`, `paths.mjs`, `preregister.mjs`, `report-tiered.mjs`, tests | committed on `main` |
| `benchmarks/context-retrieval/plan.json` | Pre-registered plan, hash `4937d61d19d81518` | committed on `main` |
| `benchmarks/context-retrieval/instrumentation.md` | The 30 harness faults — read before trusting any zero | committed on `main` |
| `benchmarks/context-retrieval/candidates.json` | 54 candidate tools with stars, licence, mechanism | committed on `main` |
| `benchmarks/context-retrieval/results/full-field-got/` | 27 score artifacts, 108 case rows each | committed on `main` |
| `benchmarks/context-retrieval/corpora/` | Corpora for public upstreams only | committed on `main` |
| `scripts/context-retrieval/field-report.mjs` | Regenerates the published tables in `full-field-got.md` from the committed artifacts | committed on `main` |
| `apps/desktop/src-tauri/src/bin/codevetter-graph.rs` | Headless bin driving the real product code | committed on `main` |
| Private-repo corpora | 7 corpora built from the owner's own repositories | **session scratchpad only — gone** |
| Tool binaries under `nbin/`, `gnx/`, `bin/gortex` | codegraph, graft, ck, gitnexus, gortex | **session scratchpad only — gone** |

Private corpora were deliberately not committed: this repository is public and those
corpora carry commit subjects and file paths from private codebases. Rebuild them with
`build-corpus.mjs` against the local checkouts if they are needed.

## Reproducing the headline numbers

Verified from a fresh `--depth 1` clone with **no `pnpm install`**: the regeneration
command below reproduces the committed tables byte-for-byte, and 38 of the harness
tests run on Node's built-in runner with zero dependencies. Anything involving a real
provider needs the tool inventory further down.

```bash
# 1. Clone the pinned upstream. The corpus is pinned to this revision.
git clone https://github.com/sindresorhus/got /tmp/got
git -C /tmp/got checkout e3924aa1e53a6ca3eb93a43618ce532442a89b40

# 2. Build the CodeVetter arm's binary (needs the uncommitted product changes, see below)
cargo build --release --manifest-path apps/desktop/src-tauri/Cargo.toml --bin codevetter-graph

# 3. One arm, one process. This is the shape every arm was run in.
node scripts/context-retrieval/score.mjs \
  --corpus benchmarks/context-retrieval/corpora/corpus-got.json \
  --repo /tmp/got \
  --cache-dir /tmp/cache-semble \
  --provider semble \
  --cli-tool semble="$(command -v semble)" \
  --out /tmp/semble.json --format json

# 4. Regenerate the published tables from the committed artifacts. One command; it
#    recomputes the gates over the union, which is the check that matters.
node scripts/context-retrieval/field-report.mjs \
  benchmarks/context-retrieval/results/full-field-got

# 5. Or via the tiered reporter, which additionally refuses to name an overall winner.
node scripts/context-retrieval/report-tiered.mjs \
  $(for f in benchmarks/context-retrieval/results/full-field-got/*.json; do
      case "$(basename "$f")" in EXCLUDED-*) ;; *) printf -- '--score %s ' "$f";; esac
    done)
```

Controls take seconds and need no binary: `--provider random-files,random-code-files,churn-ranked`.
Run those first — if they don't reproduce, nothing else is worth checking.

## Tool inventory as measured

Versions matter; several of these are pre-1.0 and move fast.

| Arm | Version | Install | Note |
| --- | --- | --- | --- |
| semble | 0.5.5 | `~/.local/bin` | leader at 4k/16k |
| codevetter-structural-context | this repo | `cargo build --bin codevetter-graph` | leader at 1k in this scoped run |
| ck | @beaconbay/ck-search@0.7.11 | `npm i @beaconbay/ck-search` | 36 s/query |
| repowise | 0.45.0 | `~/.local/bin` | 42 s/query; run `init --no-prose` (key-free) |
| codegraph | @colbymchenry/codegraph@1.5.0 | `npm i @colbymchenry/codegraph` | |
| graft | @nanonets/graft@0.12.0 | `npm i @nanonets/graft` | 263 median tokens, the leanest arm |
| graphify | 0.8.47 | `~/.local/bin` | |
| cocoindex-code | (see `--version`) | `~/.local/bin` | |
| token-savior / -regex | `ts` | `~/.local/bin` | two modes, same binary |
| code-review-graph | 2.3.8 | `~/.local/bin` | **must** be queried per token, not per sentence |
| jcodemunch | 1.108.291 | `~/.local/bin` | MCP; interned-path wire format |
| gitnexus | 1.6.9 | `npm i` | 19 s/query |
| gortex | v0.63.8 | scratchpad | needs `gortex daemon start --detach` first |
| ast-grep | 0.45.1 | homebrew | pattern matcher, not a retriever |
| ripgrep | 15.2.0 | homebrew | baseline |
| repomix | 1.16.0 | homebrew | packer, not a ranker |
| code-graph-context | CodeGraphContext 0.6.5 | `~/.local/bin` (`cgc`) | needs `ALLOW_DB_DELETION=true` in env or its cleanup silently no-ops |
| chunkhound | 0.1.dev1 | `~/.local/bin` | **cannot run**: `index` refuses without an embedding provider |
| seagoat | 1.2.0 | `~/.local/bin` | **incompatible**: needs a long-lived per-repo server |

Not installable / not reached at all: `ugrep`, `grepai`, `zoekt`, `codegrok`, `serena`,
`codesearch`. Pending candidates above 1,000 stars are listed in `candidates.json`.

## What landed, and how

Merged to `main` as seven dependency-ordered pull requests, #170 through #176,
because a single one was 131 files against this repository's own 40-file gate. The
gate came from `agent/enforce-reviewable-pr-size` and it was right.

CI rejected two of them on the way through, both correctly. The complexity gate
flagged six functions over a ceiling of 20 — one at 51 — and the duplication gate
caught five clones my adapters had added. Fixing the second surfaced a live defect:
three call sites passed a bare worktree path where the shared helper takes an
options object, so `cwd` was never set and `ripgrep` searched *this* repository
while claiming to have searched the tree under test. The unit tests missed it
because they invoke `/bin/echo`, which ignores `cwd`.

Released as **v1.10.0**. Minor rather than patch: the query ranking changed
behaviour and relevance flipped direction, so any consumer ordering those hits must
sort descending.

Two things about this history are worth knowing:

- **`main` was force-pushed once, and it rewrote every commit SHA in the repository.**
  Ten score artifacts measuring private repositories were committed into this public
  repository by mistake — file paths and commit SHAs, no query text — and were purged
  with `git filter-repo`, along with the branch that still carried them
  (`feat/retrieval-benchmark`, from closed PR #169).

  I first recorded here that only the three most recent commits changed SHA. That was
  wrong: `filter-repo` rewrote all 997. The check behind the claim asked whether an
  old commit object still *existed* (`git cat-file -e`) when the question was whether
  it was still an *ancestor* — and the object was there, un-garbage-collected. The
  visible consequence was that every open pull request branch pointed into orphaned
  history, so GitHub computed PR #168's diff across two divergent ancestries as 100
  files when its real change was 11. It was landed by cherry-picking its content
  instead. Nothing before `44bad09` should be assumed reachable by its old SHA.
- **Private repository names are generalised** to `private-A` … `private-F`
  throughout. The corpora for those repositories were never committed and are not
  recoverable from here; rebuild them with `build-corpus.mjs` against local
  checkouts.

## What is unfinished

1. **`code-graph-context` is unmeasured.** Its first result was void (silent cleanup
   failure); the fix is in place and tested, but the corrected run costs ~90 s/case —
   2.7 hours for one arm — and was stopped. Re-run only if that arm matters.
2. **The multi-repository tiered result does not exist.** `tiers.mjs`, `plan.json` and
   `report-tiered.mjs` are built and tested, and the small/medium/large tiers are
   assigned by measurement, but every tiered number produced so far is void. The large
   tier has never produced a valid result at all — a `return` inside a `finally` block
   was discarding every fixed-index result, now fixed and regression-tested, but never
   re-run.
3. **No third-party reproduction.** Nobody outside this machine has run any of it. This
   is the single largest gap in defendability.
4. **Adapter parity is uneven and correlates with score.** Three arms needed a bespoke
   query form before they scored at all. Arms that got less debugging are likely
   understated. There is no fix for this except more debugging per arm, disclosed.
5. **Mid-range results are only partially audited.** The 44 stored nominations now
   pass an independent top-five, corpus, and Git-history audit; see
   [mid-range-audit-got.md](mid-range-audit-got.md). That audit found the legacy
   nomination record preserved only five paths for a recall@10 selection and omitted
   its expected files. The current artifacts therefore cannot prove ranks 6–10. Future
   artifacts preserve the full evidence window, but completing this audit for the
   published run requires fresh provider runs.

## Verification worth doing first

In rough order of value per unit effort:

1. Run `node scripts/context-retrieval/field-report.mjs benchmarks/context-retrieval/results/full-field-got`
   and diff its output against the tables in `full-field-got.md`. They should match
   exactly; the file was generated by that command.
2. Re-derive the leak-free table from the artifacts independently and check it against
   `full-field-got.md`. Case counts must be 108 and 54 for every arm — unequal counts
   are how the incomparable `baseline_missed` subset was caught.
3. Take the top three arms and hand-check five cases each against `required_files`.
4. Confirm `random-code-files` scores above `random-files` at every budget. If it does
   not, the control pools are wrong.
5. Re-run the controls from scratch; they are cheap and fully deterministic given the
   revision and query.
