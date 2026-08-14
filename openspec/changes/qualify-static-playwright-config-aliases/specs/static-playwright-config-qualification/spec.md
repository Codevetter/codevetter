## Purpose

Allow CodeVetter to recognize bounded constant-backed loopback Playwright
origins while preserving read-only static qualification and fail-closed safety.

## ADDED Requirements

### Requirement: Resolve bounded static base URL constants

CodeVetter SHALL resolve a Playwright `baseURL` identifier only when one
unambiguous immutable declaration provides a bounded quoted literal or a
supported environment fallback to that quoted literal.

#### Scenario: Literal constant

- **WHEN** a static Playwright config assigns a quoted loopback URL to one
  immutable constant and references it from `baseURL`
- **THEN** qualification returns that normalized loopback origin

#### Scenario: Environment fallback constant

- **WHEN** a static Playwright config assigns `process.env.NAME ?? <quoted
  loopback fallback>` or the equivalent `||` form to one immutable constant
  and references it from `baseURL`
- **THEN** qualification uses only the quoted fallback regardless of the
  process environment value

### Requirement: Qualification remains non-evaluating

CodeVetter MUST NOT evaluate the Playwright config, read an environment value,
execute a declared server command, or retain the environment variable name
while resolving a static base URL constant.

#### Scenario: Config contains executable code

- **WHEN** a config contains a throw, call, getter, or other executable
  expression outside the supported static declaration
- **THEN** qualification does not execute that expression and derives evidence
  only from supported source syntax

### Requirement: Unsupported aliases fail closed

CodeVetter SHALL withhold local-runtime qualification when a referenced base
URL constant is ambiguous, environment-only, remote, interpolated beyond the
existing port template rule, call-derived, property-derived, oversized, or
otherwise outside the closed grammar.

#### Scenario: Dynamic or ambiguous constant

- **WHEN** the referenced identifier has no literal fallback, has conflicting
  declarations, or is computed dynamically
- **THEN** no loopback base URL evidence is emitted from that identifier

#### Scenario: Remote fallback

- **WHEN** the referenced identifier falls back to a non-loopback URL
- **THEN** no local browser origin or owned-runtime authority is emitted

### Requirement: Existing static qualification remains compatible

CodeVetter SHALL preserve current literal `baseURL`, bounded port-template,
project-profile, server-family, and autonomous-execution behavior.

#### Scenario: Existing supported config

- **WHEN** an already-supported Playwright config is qualified
- **THEN** its normalized flow identity and safety classification remain
  unchanged
