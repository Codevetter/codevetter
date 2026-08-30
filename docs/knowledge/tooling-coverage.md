---
title: Code coverage tooling
description: Coverage collection across Rust, TypeScript and Python, the LCOV transport decision, and the two traps that produce false verdicts.
sidebar:
  order: 12
---

# Code coverage tooling

Verified **2026-08-30**. See [tooling-decisions.md](./tooling-decisions.md) for
the cross-category summary.

Coverage matters to CodeVetter for one specific question: **did the agent's
change actually get exercised?** That is changed-line coverage, not project
coverage, and it shapes every decision below.

## The stack

Collect with per-ecosystem native tooling, normalise everything to **LCOV**, and
parse it in the Rust backend:

| Layer | Choice | License |
|---|---|---|
| Rust collection | `cargo-llvm-cov` | MIT OR Apache-2.0 |
| JS/TS collection | per-runner native (vitest/jest v8), `c8` as universal fallback | MIT / ISC |
| Python collection | `coverage.py` | Apache-2.0 |
| Transport | LCOV + a JSON summary | (format, unlicensed) |
| Parsing | Rust `lcov` crate | MIT OR Apache-2.0 |
| Diff coverage | **compute in-backend** | — |

LCOV is the only format every ecosystem emits, which is the entire reason to
choose it. It has **no formal specification** — the de-facto definition is the
`geninfo(1)` man page, in prose, and lcov 2.x has extended it. Pin behaviour
with your own fixtures rather than trusting a parser to match.

## Rust — `cargo-llvm-cov`

Dual MIT/Apache-2.0, v0.9.0 (2026-08-16). A thin wrapper over LLVM source-based
coverage: `--lcov` is literally `llvm-cov export -format=lcov`, `--json` is
`-format=text`.

Best sidecar candidate in this whole evaluation: it publishes a
**`universal-apple-darwin`** tarball per release, releases are immutable, and
releases since 0.8.5 carry GitHub artifact attestations verifiable with
`gh attestation verify`.

- **Offline caveat:** requires the `llvm-tools-preview` rustup component. If
  absent it may try to install it. **Pre-flight check for this component before
  promising an offline run.**
- `cargo llvm-cov show-env` → run any command → `cargo llvm-cov report --lcov`
  is the right shape for "run the agent's own test command, then extract
  evidence."
- **Do not build verdicts on Rust branch coverage.** `--branch` is unstable and
  nightly-only; `--doctests` is listed under known limitations. Both are
  explicitly flagged upstream.
- `cargo llvm-cov nextest` is first-class, but **nextest does not support
  doctests** — run those separately and merge.

**`cargo-tarpaulin` is a viable cross-check, and the "Linux x86_64 only" belief
about it is out of date.** Its LLVM engine is the default on macOS and Windows,
and 0.37.2 ships `aarch64-apple-darwin` and `universal-apple-darwin` binaries.
The ptrace restriction is Linux-only. Position it as secondary — `cargo-llvm-cov`
is closer to the LLVM metal with roughly 2.5× the download volume.

## JavaScript / TypeScript

`c8` (ISC) is **not stale** — v12.0.0 shipped 2026-07-14. Its value here is that
it **wraps any command** (`c8 npm test`, `c8 node --test`, `c8 vitest`) with no
instrumentation and no runner integration, which is exactly right for a harness
that must run someone else's test command unmodified.

Node's built-in `--experimental-test-coverage` is the zero-dependency baseline.
Note it is still `Stability: 1 – Experimental` in Node 22, 24 and 26 despite the
test runner itself being stable. There is **no `--test-coverage-lcov` flag** —
LCOV comes from the reporter: `--test-reporter=lcov
--test-reporter-destination=lcov.info`. That reporter emits no test results, so
pair it with a second reporter. `NODE_V8_COVERAGE` auto-propagates to
`child_process.spawn` subprocesses, which is genuinely useful when the agent's
test command shells out.

On the "istanbul is dead" claim — half wrong, and worth stating precisely.
`nyc` shipped a v18.0.0 major on 2026-02-22. The **`istanbuljs` monorepo
underneath it** is what stalled: last commit 2025-08-18, 201 open issues, and
Vitest found it necessary to maintain its own fork. Either way, avoid `nyc` as a
primary path — it requires injecting a Babel plugin into someone else's build,
which is precisely the invasive change a verification harness should not make.

Vitest's v8 provider has done AST-aware remapping since v3.2.0 and its docs
claim parity with Istanbul, which removes the historical reason to pay the
instrumentation tax.

## Python — `coverage.py`

Apache-2.0, v7.16.0. **The repo moved to
`github.com/coveragepy/coveragepy`.** Prefer driving `coverage run -m pytest`
directly over `pytest-cov` — one less layer, identical output, and it works for
non-pytest suites.

Relevant if runtime cost is part of your evidence: on **Python 3.14+ the
`sysmon` (PEP 669) core is the default** and dramatically cheaper; 3.10–3.13 use
the C tracer. The same repo will show very different overhead across Python
versions, so **record the active core** in the bundle.

Note `--fail-under` exits with status **2**, not 1.

## Rejected — hosted services

**Codecov and Coveralls both upload coverage data off-machine.** For a
local-first product they are architecturally disqualified, not merely
inconvenient. Their uploader binaries are permissively licensed, so they *could*
be vendored — but every one exists solely to make that network call. There is
nothing to salvage.

Codecov specifically: their security page says they do not store source code,
but archived raw uploads may contain it, and the Impact Analysis path sends
per-line execution counts with file paths. Their self-hosted option is a trap —
the commercial on-prem offering is end-of-lifed and bare-metal/HA deployments
are no longer supported. Note also the 2021 Bash Uploader compromise: a coverage
uploader was the supply-chain vector. Directly on point for why a verification
tool should not phone home.

**Do not bundle `lcov` / `genhtml` / `geninfo`** — the Perl toolchain is
GPL-2.0. The format carries no license; the Rust `lcov` crate reads and writes
it under MIT/Apache-2.0.

## Diff coverage — own this

`diff-cover` (Apache-2.0, active) is the best external option and reads LCOV
directly. **Use it as a cross-check oracle in the test suite, not as a runtime
dependency** — it is Python, and this metric is core product logic.

The computation is small and fully deterministic:

```
git diff -U0 <base>..<head>   →  {file: set<added_line_no>}
lcov crate parse(lcov.info)   →  {file: {line_no: hit_count}}
intersect                      →  covered_changed / total_changed
                                  + the exact uncovered line list
```

## Two traps that produce false verdicts

1. **V8 coverage only reports files that were *loaded*.** A source file the
   tests never import is simply **absent**, which is indistinguishable from 0%.
   An agent that adds a brand-new untested module would therefore score
   *better*. Force never-loaded files into the report: `--all --src` (c8),
   `--test-coverage-include-all` (Node), `coverage.all` (vitest),
   `collectCoverageFrom` (jest).
2. **Line-granular LCOV under-reports on dense lines.** For "did this exact
   changed expression run?", `DA:` records lose sub-line detail. Store the
   high-precision artifact alongside LCOV where available —
   `cargo-llvm-cov --json` is LLVM region-level; monocart's `v8-json` preserves
   byte ranges.
