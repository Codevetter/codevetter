# Handoff — retrieval benchmark, 2026-08-23

Written for whoever picks this up next, including an agent asked to verify it. It says
what is measured, what is void, what is unfinished, and where every number came from.
Read [Before you trust anything here](#before-you-trust-anything-here) first.

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

**3. The bias runs one way.** Every fault found so far *under*-reported a tool that
worked. None inflated a score. Assume the same direction for faults not yet found, and
treat the published ordering as a lower bound on the field rather than a settled result.

## Where things are

| Path | What it is | Durable? |
| --- | --- | --- |
| `scripts/context-retrieval/` | Harness: `score.mjs` (runner), `adapters/`, `gates.mjs`, `tiers.mjs`, `paths.mjs`, `preregister.mjs`, `report-tiered.mjs`, tests | in repo, **untracked** |
| `benchmarks/context-retrieval/plan.json` | Pre-registered plan, hash `4937d61d19d81518` | in repo, **untracked** |
| `benchmarks/context-retrieval/instrumentation.md` | The 25 harness faults — read before trusting any zero | in repo, **untracked** |
| `benchmarks/context-retrieval/candidates.json` | 54 candidate tools with stars, licence, mechanism | in repo, **untracked** |
| `benchmarks/context-retrieval/results/full-field-got/` | 27 score artifacts, 108 case rows each | in repo, **untracked** |
| `benchmarks/context-retrieval/corpora/` | Corpora for public upstreams only | in repo, **untracked** |
| `scripts/context-retrieval/field-report.mjs` | Regenerates `full-field-got.md` from the committed artifacts | in repo, **untracked** |
| `apps/desktop/src-tauri/src/bin/codevetter-graph.rs` | Headless bin driving the real product code | in repo, **untracked** |
| Private-repo corpora | 7 corpora built from the owner's own repositories | **session scratchpad only — gone** |
| Tool binaries under `nbin/`, `gnx/`, `bin/gortex` | codegraph, graft, ck, gitnexus, gortex | **session scratchpad only — gone** |

Private corpora were deliberately not committed: this repository is public and those
corpora carry commit subjects and file paths from private codebases. Rebuild them with
`build-corpus.mjs` against the local checkouts if they are needed.

## Reproducing the headline numbers

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
| codevetter-structural-context | this repo | `cargo build --bin codevetter-graph` | leader at 1k; needs uncommitted product changes |
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

## Uncommitted work you need to know about

Nothing in this directory is committed. `git status` shows `?? benchmarks/context-retrieval/`
and `?? scripts/context-retrieval/` — 115 new files — plus modified product files under
`apps/desktop/src-tauri/src/commands/structural_graph/` (contracts, extract, interchange,
query/index, query/search, query/limits, query/mod, query/tests) and a new
`src/bin/codevetter-graph.rs`. **The CodeVetter arm's numbers depend on those product
changes**; building `codevetter-graph` from a clean checkout will not reproduce 76.8% at
1k. Committing is the outstanding step and has not been done.

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
5. **Mid-range results are unaudited.** `gates.mjs` has `nominateForAudit`, which
   deterministically samples mid-range cases for hand-checking. It has never been read.
   Every fault found so far was found because a number was extreme enough to look wrong;
   a plausible wrong number would still get through. This is the known weakness.

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
