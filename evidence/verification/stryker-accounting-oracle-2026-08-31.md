# Accounting-oracle mutation qualification — 2026-08-31

StrykerJS was evaluated against
`scripts/qualify-codex-accounting-oracle.mjs`, a deterministic verification
boundary where a false pass would corrupt CodeVetter's accounting evidence.

| Measurement | Initial trial | Strengthened suite | Final ratchet |
|---|---:|---:|---:|
| StrykerJS | 10.0.0 | 10.0.0 | 10.0.0 |
| Mutants | 218 | 218 | 208 |
| Killed | 88 | 185 | 197 |
| Survived | 130 | 33 | 11 |
| Mutation score | 40.37% | 84.86% | 94.71% |
| Wall time | 14 seconds | 53 seconds | 125 seconds |

The added tests cover invalid and zero numeric evidence, inverted cost bounds,
provider selection, duplicate and missing daily buckets, CLI success/mismatch/
malformed-input exits, and the exact CodexBar subprocess arguments and
`CODEX_HOME` handoff.

The final suite adds exact epsilon-boundary behavior, both out-of-range cost
directions, missing and invalid oracle days, deterministic multi-date ordering,
missing CLI input, the default executable path, and a forced CodexBar non-zero
exit. Five redundant/equivalent implementation expressions were removed rather
than excluded from mutation. The 11 remaining survivors are ten diagnostic-only
string/encoding changes and the equivalent `process.argv` index-zero mutation;
they remain visible in the ignored JSON report.

The maintained local command is `pnpm quality:mutation:accounting`. It uses
ephemeral, exactly-versioned StrykerJS and TypeScript packages, writes its report
under ignored `artifacts/tooling/stryker/`, and fails below 90%. It is deliberately
bounded to one high-value oracle rather than applied as a universal score.

## TAP runner comparison

The exactly matched `@stryker-mutator/tap-runner` 10.0.0 was trialled with the
same 218-mutant source and test file. Its mutation phase finished in 49 seconds,
but it killed only 136 mutants, left 15 survived, classified 66 as no-coverage,
and reported one error. Total score fell to 62.67% (90.07% over covered mutants)
because the oracle's subprocess CLI checks are outside TAP's per-test-file
coverage boundary.

The faster runner therefore loses evidence precisely on the CLI behavior this
oracle exists to verify. The repository keeps the command runner, adds no TAP
plugin dependency, and retains
`scripts/stryker-accounting-tap-trial.config.mjs` only as a reproducible rejected
trial. The 90% break threshold is a score ratchet over the full 208-mutant
command-runner scope; no mutator exclusions were added to reach it.
