## 1. Safeguard And Inventory

- [x] 1.1 Record both repositories' current revisions, branches, dirty-file lists, and overlapping files without modifying or discarding existing work.
- [x] 1.2 Create a ShipRank transfer inventory that classifies evaluation algorithms, tests, fixtures, datasets, label-pair work, research notes, product UI, APIs, and cloud surfaces as transfer, archive, or discard-with-reason.
- [x] 1.3 Prepare an isolated CodeVetter implementation worktree from the current main revision so the existing dirty backend work remains untouched.

## 2. Evaluation Diagnostic Kernel

- [x] 2.1 Extract representative ShipRank fixtures for comparable judgments, reversed-order disagreement, majority strength, weak signal, and Condorcet cycles.
- [x] 2.2 Implement a focused Rust evaluation-signal module with normalized candidates/criteria, pairwise verdicts, agreement, majority strength, order inconsistency, cycle detection, and conservative confidence.
- [x] 2.3 Add fixture-parity Rust tests and verify the port matches the retained ShipRank behavior for supported cases.
- [x] 2.4 Integrate signal diagnostics into CodeVetter review/audience aggregation only when candidate and criterion scopes are comparable.

## 3. Staged Verification And Audience Persistence

- [x] 3.1 Add idempotent local SQLite schema and query helpers for audience-validation runs and provenance-preserving responses linked to reviews and repositories.
- [x] 3.2 Add Rust commands for creating, reading, updating, and aggregating audience-validation runs and responses without collecting required personal identifiers.
- [x] 3.3 Add typed Tauri IPC contracts and browser-safe fallbacks for audience definitions, responses, diagnostics, stage statuses, waivers, and aggregate verification summaries.
- [x] 3.4 Build the deterministic staged-verification summary from existing review, synthetic-QA/sandbox/procedure evidence, and audience-validation evidence.
- [x] 3.5 Add backend and TypeScript tests covering older reviews, failed required tests, audience waivers, agent-only panels, imported human evidence, insufficient responses, and mixed provenance.

## 4. Review Workflow And Proof Surface

- [x] 4.1 Add the smallest audience-validation section to the existing Review flow, with no new top-level navigation item.
- [x] 4.2 Support defining the target audience, task, candidate route/artifact, criteria, response threshold, and whether audience validation is required.
- [x] 4.3 Support local evaluator-agent judgments plus structured manual/imported human responses, with visible provenance and no human-validation claim for agent-only evidence.
- [x] 4.4 Render stage status, signal quality, disagreements, order warnings, cycles, caveats, and aggregate outcome beside the existing review/QA evidence.
- [x] 4.5 Extend copied verification proof and handoff packets with the audience definition, mode, response count, diagnostics, decision impact, and incomplete-stage warnings.
- [x] 4.6 Add targeted component or Playwright coverage for the review-to-test-to-audience path and proof output.

## 5. Verification And Acceptance

- [x] 5.1 Run the focused Rust tests after each backend slice, then the smallest relevant frontend tests and typecheck/lint checks.
- [x] 5.2 Exercise one local backend-only review with an audience waiver and confirm it does not claim audience validation.
- [x] 5.3 Exercise one local user-facing review through executable QA, an agent-simulated audience panel, and imported human evidence; verify provenance and aggregate confidence.
- [x] 5.4 Confirm existing reviews and QA histories still load and no ShipRank cloud service or new production dependency is required.

## 6. Product Ownership And Retirement

- [x] 6.1 Update CodeVetter `PROJECT_STATUS.md` and recommendation context to own staged review, executable testing, audience validation, and signal diagnostics.
- [x] 6.2 Add a concise ShipRank retirement inventory with its final active revision and transfer/archive/discard mapping.
- [x] 6.3 Update ShipRank README, `PROJECT_STATUS.md`, recommendation context, and agent guidance to mark it retired and superseded by CodeVetter.
- [x] 6.4 Remove ShipRank from active fleet product/release inventories and point recommendation ownership to CodeVetter.
- [x] 6.5 Verify fleet status tooling no longer treats ShipRank as an independent release unit while the repository remains recoverable.

## 7. Closure Gates

- [x] 7.1 Archive this OpenSpec change after all local acceptance scenarios pass and synchronize the final shipped/retired status records.
- [x] 7.2 Produce an exact inventory of remaining ShipRank Pages, Worker, D1, R2, domain, queue, and remote-repository resources without reading secrets or changing production.
- [x] 7.3 Present resource-specific data-retention and decommission actions for explicit operator approval; do not delete, migrate, deploy, or archive remote resources implicitly.
