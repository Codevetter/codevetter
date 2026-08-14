## Context

The qualification parser already scans source text without importing the
Playwright config. Its immutable-string table supports quoted literals,
single-port templates, and environment fallbacks only when the fallback is a
numeric port. `staticBaseUrlLiterals` already accepts an identifier backed by
that table. See `proposal.md` for motivation and the capability spec for the
observable contract.

## Goals / Non-Goals

**Goals:**

- Admit the common `const baseURL = process.env.NAME ?? 'http://localhost:3000'`
  shape through the existing static constant table.
- Keep all downstream loopback normalization, ambiguity handling, and server
  attestation unchanged.
- Prove the actual environment value and executable config code are ignored.

**Non-Goals:**

- General JavaScript or TypeScript constant folding.
- Evaluating Playwright config, package scripts, getters, calls, or imports.
- Resolving arbitrary object aliases, chained aliases, or remote origins.

## Decisions

### Generalize only the terminal quoted environment fallback

The existing environment-fallback parser will accept one bounded quoted string
instead of requiring the string itself to be a numeric port. The consuming
context remains authoritative: port templates still validate numeric ports,
while `baseURL` values still pass through strict loopback URL normalization.
This reuses the established scanner and ambiguity rules instead of adding a
second parser.

Alternative: add a Playwright-specific regular expression for the RolePatch
shape. Rejected because it would duplicate comment/string skipping and would
miss the existing shorthand-property path.

### Preserve the closed declaration boundary

Only `const <identifier> = <supported terminal>;` declarations enter the
table. The fallback must use an uppercase environment identifier, `??` or
`||`, one quoted value, and a terminating semicolon. Calls, property chains,
multiple declarations, environment-only values, and complex expressions remain
unresolved.

Alternative: parse the config AST through TypeScript. Rejected because the
current scanner covers this narrow grammar without adding a dependency or
creating pressure to evaluate TypeScript semantics.

### Keep evidence unchanged

Qualification emits the same normalized loopback origin and existing
provenance as an inline literal. It does not expose the environment variable
name or add a new public authority field. This keeps flow IDs and downstream
owned-runtime contracts compatible.

## Risks / Trade-offs

- **Risk: a generalized string fallback enters an unintended scanner
  consumer** → Existing consumers must still apply their own closed validation;
  focused tests cover port templates and base URLs together.
- **Risk: a real config uses a slightly richer static expression** → It remains
  ineligible rather than widening to partial JavaScript evaluation.
- **Risk: qualification admits a config whose application semantics depend on
  the live environment** → The receipt continues to state that the literal
  fallback, not the live environment, defined the owned local origin.

## Migration Plan

No persisted schema or migration changes. Existing qualification results
remain readable; newly eligible flows appear on the next read-only
qualification. Rollback is the parser change and its tests.
