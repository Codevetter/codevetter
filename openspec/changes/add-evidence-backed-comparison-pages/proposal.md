## Why

Provider-backed awareness checks surface CodeRabbit and Greptile for coding-agent
review and verification queries, while CodeVetter has no direct pages that explain
its execution-evidence boundary against either product. The missing comparison
intent makes the product harder for people and retrieval systems to identify
correctly.

## What Changes

- Add canonical CodeVetter-versus-CodeRabbit and CodeVetter-versus-Greptile pages.
- Base competitor statements on dated first-party sources and distinguish review
  findings from task-linked executable verification.
- State explicitly that no common head-to-head benchmark has been run.
- Reuse the existing editorial registry, Markdown alternate, sitemap, structured
  data, and internal-link system.

## Capabilities

### New Capabilities

- `evidence-backed-product-comparisons`: Public comparison pages answer buyer
  intent with sourced claims, honest limitations, agent-readable alternates, and
  links to CodeVetter's verification evidence.

### Modified Capabilities

None.

## Impact

The change touches only the Astro landing application, its typed content registry,
agent-readable content projection, tests, and durable project status. It changes no
desktop behavior, verification runner, benchmark data, dependency, deployment, or
pricing.
