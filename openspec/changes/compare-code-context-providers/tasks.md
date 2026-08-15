## 1. Closed experiment contracts

- [x] 1.1 Add closed schemas and version constants for provider capability probes, immutable multi-arm plans, schedules, and aggregate comparison scores
- [x] 1.2 Add bounded validation for provider/version/configuration identity, interface kind, context kind, indexed revision, tool inventory, data-egress posture, setup evidence, and exclusion reasons
- [x] 1.3 Add privacy validation that rejects credentials, absolute paths, raw private source, provider account identifiers, unknown fields, and oversized artifacts

## 2. Deterministic planning and isolation

- [x] 2.1 Implement deterministic Stage 0, four-task Stage 1, and full-corpus Stage 2 planning with exact arm, task, trial, and attempt counts
- [x] 2.2 Implement balanced deterministic arm ordering and stable plan identities from the pinned corpus, cohort, agent, environment, provider, and policy inputs
- [x] 2.3 Gate paid, hosted, or unknown-cost plans on conservative cost bounds, credential-name availability, data-egress approval, and exact explicit approval identity
- [x] 2.4 Extend experiment adapter fixtures so every arm uses a fresh workspace, agent session, and isolated tool configuration with no undeclared provider access
- [x] 2.5 Reject stale provider indexes, baseline provider-tool calls, cross-provider tool calls, retained generated instructions, and other context contamination before scoring

## 3. Existing runner and scorer composition

- [x] 3.1 Project each admitted baseline-versus-provider arm set into the existing immutable evaluation-bundle and structural-context scoring path without changing its outcome authority
- [x] 3.2 Preserve provider identity, context kind, index snapshot, allowed tools, schedule position, and available run diagnostics through pairwise score artifacts
- [x] 3.3 Implement a non-executing multi-provider aggregator that validates common identities and scheduled-arm completeness across pairwise scores
- [x] 3.4 Apply the preregistered Holm family-wise adjustment while preserving raw counts, descriptive intervals, pairwise qualification, A/A noise, invalid arms, and negative or null outcomes
- [x] 3.5 Render deterministically equivalent JSON, Markdown, and optional self-contained local HTML comparison reports

## 4. Contract and regression verification

- [x] 4.1 Add hermetic Stage 0 fixtures for eligible, excluded, stale, paid, hosted, and contaminated planning inputs
- [x] 4.2 Add focused Stage 0 tests for deterministic schedules, plan drift, conservative cost and approval gates, provider eligibility, privacy, and contamination rejection
- [x] 4.3 Add later-stage fixtures and tests for isolated execution, missing arms, common-identity drift, pairwise composition, Holm adjustment, and byte-stable rescoring
- [x] 4.4 Verify existing corpus qualification, runner, receipt composition, structural-context scoring, and benchmark outputs remain unchanged
- [x] 4.5 Run `pnpm test:corpus-contracts`, `pnpm corpus:readiness`, `pnpm bench:graph-context`, the new focused comparison tests, `pnpm lint`, and `git diff --check`

## 5. Capability probes and feasibility plan

- [x] 5.1 Probe plain repository tools and CodeVetter as the required baseline and local treatment with exact current identities
- [x] 5.2 Probe CodeGraph, Graphify, and Repowise one at a time without adding production dependencies; record eligibility, setup, interface, freshness, observability, privacy, license, and terms limitations
- [x] 5.3 Probe DeepWiki and Sourcegraph only for separate MCP/CLI and hosted/enterprise cohorts; exclude them when reproducibility, permission, data-egress, or publication requirements are unmet
- [x] 5.4 Generate the deterministic four-task Stage 1 slice and free/local feasibility plan without launching agents or providers
- [x] 5.5 Review exact attempts, expected duration, cost posture, privacy posture, and claim gates with the owner before any Stage 1 execution

## 6. Evidence-gated execution and handoff

- [x] 6.1 After explicit approval, run Stage 1 and preserve every terminal receipt, operational failure, missing diagnostic, invalid arm, and cleanup result
- [x] 6.2 Score Stage 1 locally and make only a feasibility decision: stop, revise the probe/adapter, or request a separately approved Stage 2 plan
- [ ] 6.3 If separately approved, run the preregistered 30-task repeated trial and produce the qualified or explicitly unqualified multi-provider report
- [x] 6.4 Document commands, artifact identities, limitations, private/public publication boundaries, and reproducibility instructions
- [ ] 6.5 Link the implementing pull request to GitHub issue #55, archive the OpenSpec change after verified completion, and record only the shipped outcome in `PROJECT_STATUS.md`
