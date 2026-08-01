# Context-provider experiment

This directory holds the reproducible comparison of plain repository tools and
optional code-context providers. It composes with the existing 30-task agent
corpus and executable graders; it does not create a second outcome authority.

## Stage 0 status

Stage 0 is planning-only. It records closed capability probes and an immutable
feasibility plan without starting a provider, building an index, launching an
agent, reading credential values, or incurring provider cost.

The pinned plan compares:

- `plain-repository-tools`, the required control with no provider tools; and
- `codevetter-structural-context` 1.7.0, the local MCP graph treatment with five
  observable graph tools.

The deterministic slice has four qualified tasks: two API and two browser
tasks across four categories. Two repetitions and two arms produce exactly 16
attempts with balanced first-position ordering.

The provider cohort is local, has no data egress, requires no credential names,
and has a $0 context-provider bound. Total duration and total cost remain
unknown because no agent profile or fresh CodeVetter snapshot has been pinned.
The plan is therefore blocked and is not execution approval.

Artifacts:

- [`stage0/feasibility-plan.json`](stage0/feasibility-plan.json)
- [`stage0/probes/plain-repository-tools.json`](stage0/probes/plain-repository-tools.json)
- [`stage0/probes/codevetter-structural-context.json`](stage0/probes/codevetter-structural-context.json)

Regenerate the plan from the repository root:

```bash
pnpm corpus:context-plan \
  --stage feasibility \
  --probe benchmarks/context-providers/stage0/probes/plain-repository-tools.json \
  --probe benchmarks/context-providers/stage0/probes/codevetter-structural-context.json
```

The output must remain descriptive until later runs satisfy the preregistered
hidden-check, completeness, isolation, and statistical qualification gates in
the OpenSpec change `compare-code-context-providers`.
