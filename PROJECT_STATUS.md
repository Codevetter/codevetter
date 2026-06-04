# Project Status

Last updated: 2026-06-04

## Current Scope

CodeVetter is a local-first desktop workbench for checking agent-generated code. The active product direction is evidence-backed software quality review: code review, bug finding, synthetic user QA, replay, and debugging surfaces that help a human decide whether agent-written work is actually shippable.

## Done

- Desktop app and local workflow foundation are in place, with repo unpacking, review entry points, and local-first positioning documented in the README.
- Bug finding and code review are the primary implemented workflows.
- Review replay prototypes were added for synthetic QA and intent debugging, including `/qa-replay` and `/intent-debugger` routes.
- Synthetic user QA has a first-loop prototype that maps intent to Playwright evidence and supports local Vite-style app checks.
- Intent debugging has CLI/test entry points through `test:intent-debugger` and `intent-debugger`.
- Product direction has been consolidated around agent-written code verification, evidence levels, timelines, and explainable codebase history.

## Planned Next

1. Turn synthetic user QA from a prototype into a first-class desktop workflow with clear inputs, evidence output, failure states, and saved sessions.
2. Promote intent debugging into the main review loop so agent claims can be checked against code, tests, and observed UI behavior.
3. Add richer evidence levels for findings so users can distinguish static suspicion, test-backed proof, replay proof, and user-flow proof.
4. Build the first durable codebase-history explainer around commits, files, and review findings.

## Deferred / Parked

- Broad IDE replacement behavior is parked; CodeVetter should stay focused on verification and review.
- Generic synthetic browser testing for every app type is deferred until the supported local-app matrix is explicit.
- Marketplace, hosted multi-tenant collaboration, and CI enforcement are deferred behind a stronger local evidence loop.
