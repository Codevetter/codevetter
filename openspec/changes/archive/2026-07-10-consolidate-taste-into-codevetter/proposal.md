## Why

ShipRank no longer needs an independent product boundary, but its evaluation architecture fills a real gap in CodeVetter. Consolidating now gives CodeVetter one evidence-backed path from code review, through executable verification, to target-audience validation while avoiding further investment in a standalone SaaS that will be retired.

## What Changes

- Add a staged CodeVetter verification loop: review the change, run executable tests or browser QA, then validate relevant user-facing outcomes with a defined audience.
- Add evaluation diagnostics derived from ShipRank: criterion-level judgments, agreement and disagreement summaries, order-sensitivity checks, majority strength, cycle detection, and calibrated confidence.
- Add an audience-validation artifact that records the audience definition, candidate experience, task or question, responses, evidence, and outcome without requiring a public evaluator marketplace.
- Reuse CodeVetter's existing local browser, screenshot, review-finding, benchmark, and SQLite infrastructure instead of moving ShipRank's Hono, D1, Pages, R2, or capture-worker stack.
- Preserve useful ShipRank algorithms, tests, fixtures, datasets, and research history; adapt concepts to CodeVetter contracts instead of copying the application wholesale.
- **BREAKING**: Retire ShipRank as an active standalone fleet product after CodeVetter accepts the retained capability. Its product routes, deployment surfaces, and active roadmap will stop receiving feature work.
- Preserve source history and any data requiring retention. Production D1 data, capture queues, and cloud resources are not deleted or mutated without a separate explicit operator-approved decommission step.

## Capabilities

### New Capabilities

- `staged-change-verification`: A change moves through code review, executable testing, and optional or required audience validation with one evidence-linked outcome.
- `evaluation-signal-diagnostics`: CodeVetter measures agreement, disagreement, order sensitivity, majority strength, cycles, and confidence across evaluation judgments.
- `audience-validation`: CodeVetter defines a target audience and records structured human validation of a user-facing change or candidate experience.
- `shiprank-retirement`: ShipRank is frozen, its durable assets are preserved or transferred, its fleet status is retired, and external decommissioning is gated safely.

### Modified Capabilities

None. The shared store has no existing capability specifications; current CodeVetter review and synthetic-QA behavior remains compatible and becomes input to the new staged verification contract.

## Impact

- **CodeVetter:** review orchestration, result contracts, local SQLite persistence, typed Tauri IPC, Review UI, proof export, tests, benchmark/calibration tooling, `PROJECT_STATUS.md`, and recommendation context.
- **ShipRank/taste:** evaluation types and algorithms, label-pair concepts, useful fixtures and research artifacts, retirement copy/status, active fleet registration, and deploy documentation.
- **Fleet:** active-product inventory and recommendation metadata must identify CodeVetter as the owner of this capability and ShipRank as retired.
- **Dependencies:** no new production dependency is expected. CodeVetter's existing Rust, TypeScript, SQLite, Playwright/browser, and local-agent paths should be sufficient.
- **Deployment:** CodeVetter desktop release is out of scope until local acceptance passes. Cloud/D1/capture-resource decommissioning requires a separate explicit approval and data-retention check.
