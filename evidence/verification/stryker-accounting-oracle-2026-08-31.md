# Accounting-oracle mutation qualification — 2026-08-31

StrykerJS was evaluated against
`scripts/qualify-codex-accounting-oracle.mjs`, a deterministic verification
boundary where a false pass would corrupt CodeVetter's accounting evidence.

| Measurement | Initial trial | Strengthened suite |
|---|---:|---:|
| StrykerJS | 10.0.0 | 10.0.0 |
| Mutants | 218 | 218 |
| Killed | 88 | 185 |
| Survived | 130 | 33 |
| Mutation score | 40.37% | 84.86% |
| Wall time | 14 seconds | 53 seconds |

The added tests cover invalid and zero numeric evidence, inverted cost bounds,
provider selection, duplicate and missing daily buckets, CLI success/mismatch/
malformed-input exits, and the exact CodexBar subprocess arguments and
`CODEX_HOME` handoff.

The 33 survivors are primarily error-message string changes and equivalent or
low-value implementation mutations. Remaining behavioral cases include exact
epsilon boundaries, deterministic multi-date ordering, and a forced CodexBar
non-zero exit. They remain visible in the ignored JSON report rather than being
excluded from mutation.

The maintained local command is `pnpm quality:mutation:accounting`. It uses
ephemeral, exactly-versioned StrykerJS and TypeScript packages, writes its report
under ignored `artifacts/tooling/stryker/`, and fails below 80%. It is deliberately
bounded to one high-value oracle rather than applied as a universal score.
