# ast-grep SARIF qualification — 2026-08-31

## Scope

This trial evaluates ast-grep's native SARIF output before considering it for
repository code-scanning upload. It does not evaluate ast-grep's matching
engine generally and does not add a rule pack.

## Tool and fixture

- Tool: ast-grep 0.45.2
- License: MIT
- Rule: an inline TypeScript pattern matching
  `localStorage.setItem($KEY, $VALUE)`
- Target: `apps/desktop/src/lib/review-service.ts`

The matcher found both expected calls with exact file, line, column, byte, and
snippet locations. That establishes useful structural-match fidelity for this
fixture.

## SARIF result

The `--format sarif` envelope is not valid SARIF 2.1.0:

- the root `version` is `0.45.2`, which is the ast-grep tool version rather
  than the required SARIF format version `2.1.0`;
- the root `$schema` declaration is absent;
- the tool driver omits its own version even though that information was
  written into the incompatible root field.

Locations, rule IDs, severity, and messages are otherwise present. The output
should not be uploaded to GitHub code scanning or treated as interoperable
SARIF without a repository-owned repair step and schema validation.

## Decision

Trialled, not wired. Biome and CodeQL already cover the current repository
lanes. Add ast-grep only when a concrete structural rule closes a demonstrated
gap, and either upstream emits a conforming envelope or a bounded converter is
qualified with fixtures.
