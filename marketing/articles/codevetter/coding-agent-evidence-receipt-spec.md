# What an Evidence Receipt for a Coding Agent Should Contain

**Slug:** coding-agent-evidence-receipt-spec
**Target Query:** coding agent evidence receipt specification
**Search Intent:** Architectural reference and specification guide for AI platform engineers and technical leads building auditable agent verification pipelines.
**Meta Title:** Coding Agent Evidence Receipt Spec | Verification Bundles
**Meta Description:** Learn what a machine-readable evidence receipt for AI coding agents must contain, including identity bindings, execution records, taxonomy, and failure trails.

---

## Article Outline

- **Introduction:** Why informal PR descriptions and self-reports fail auditability.
- **General Receipt-Design Principles vs. Current Implementation:** Conceptual standards vs. production receipts.
- **1. Identity & Scope Bindings:** Pinned repository, commit SHAs, task intent, and runner profile.
- **2. Execution Records & Inventory:** Commands, exit codes, resource bounds, and output streams.
- **3. Failure Taxonomy & Classification:** Categorizing regressions, environment noise, and pre-existing debt.
- **4. Resource, Egress, & Safety Boundaries:** Monitoring memory, CPU, network calls, and sandbox constraints.
- **5. Explicit Uncertainty & Coverage Bounds:** Marking unchecked requirements and `no_confidence` states.
- **6. Fix Linkage & Closure Trails:** Re-check chaining from initial failure to final pass.
- **Recommended Internal Links:** Navigating related CodeVetter technical documentation.
- **Next Action:** Steps for implementing evidence receipts in your agent pipeline.
- **Source Notes (Non-Publishable):** Repository evidence files, schema contracts, and scope limits.

---

## Why Informal Agent Self-Reports Fail Auditability

When an autonomous coding agent completes a task, it typically posts a pull request accompanied by an informal Markdown summary describing what it claims to have changed and tested.

While readable, these text summaries are unsuited for technical auditability or automated verification. An agent self-report suffers from four fundamental flaws:

1. **Non-Verifiable Claims:** An agent asserting that "all tests passed" provides no proof that tests were actually executed against the checked-in commit SHA.
2. **Missing Execution Context:** Summaries rarely record the precise environment variables, node versions, database states, CLI flags, or mock settings used during execution.
3. **Selective Omission:** Agents routinely omit unexecuted test suites, skipped assertions, transient timeouts, or intermediate failures.
4. **Lack of Machine Readability:** Free-form text summaries cannot be parsed or validated programmatically by CI/CD pipelines or security scanners.

To make autonomous coding agents safe for production software engineering, organizations must replace informal self-reports with structured, machine-readable **verification evidence receipts**.

---

## General Receipt-Design Principles vs. Current Implementations

A verification evidence receipt is a versioned, portable JSON artifact that records exact execution telemetry from an agent verification run.

In general receipt design, an evidence specification defines structured schemas that bind source code identities to execution telemetry. In practical software systems, these fall into two distinct categories:

- **Experimental / Ingested Project Receipts:** Ingestion schemas (such as `codevetter.project-verification-receipt/v1`) that parse raw external runner outputs (Playwright JSON, JUnit XML, LCOV) without mutating local state or asserting full system authority.
- **Persisted Native / Local Receipts:** Local execution receipts (such as `codevetter.local-check/v1`) emitted and stored in local databases during supervised verification passes.

```
┌─────────────────────────────────────────────────────────────────────────┐
│              VERIFICATION EVIDENCE RECEIPT SCHEMA (v1)                  │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. Identity & Scope    │ Base Commit, Patch SHA, Task ID, Runner Profile │
│ 2. Execution Inventory │ Commands, Exit Codes, Output Hash, Duration    │
│ 3. Failure Taxonomy    │ Agent Regressions vs. Environment vs. Pre-Exist│
│ 4. Resource Telemetry  │ Peak RSS, Wall Time, CPU, Egress, Sandbox State │
│ 5. Explicit Bounds     │ Unverified Requirements, Missing Test Paths     │
│ 6. Fix Closure Trail   │ Linkage to Initial Failure Receipt & Re-check   │
└─────────────────────────────────────────────────────────────────────────┘
```

Below is a detailed breakdown of what each section of a robust evidence receipt specification must contain.

---

## 1. Identity and Scope Bindings

An evidence receipt must be linked unambiguously to a specific source tree and task description. The receipt begins by pinning identity references:

- **Repository & Revision Identity:** Absolute Git commit SHA of the base repository, target branch, and exact SHA-256 digest of the agent's patch file.
- **Task Intent Reference:** A unique task identifier, along with a digest or text snapshot of the original prompt and acceptance criteria.
- **Environment & System Profile:** OS kernel version, architecture (e.g., `darwin-arm64`), runtime engine version (e.g., Node.js, Rust), and installed CLI versions.
- **Verifier Profile:** The specific verifier name, executable version, and schema version (e.g., `codevetter.local-check/v1`).

Binding these identities prevents "replay drift"—where a passing test receipt from an older commit is falsely attached to a new pull request.

---

## 2. Execution Records and Inventory

The execution section records every command invoked during the verification pass, documenting exact inputs and outputs:

- **Normalized Command Strings:** The exact binary and arguments executed (e.g., `pnpm test:native --filter auth`).
- **Terminal Exit States:** Numeric exit codes, process signal terminations (e.g., `SIGKILL`), and cancellation flags.
- **Bounded Output Captures:** SHA-256 hashes of stdout and stderr logs, accompanied by bounded text excerpts (e.g., capped at 64 KiB) capturing the failure tail.
- **Test Inventory Details:** Individual counts for total discovered tests, passed tests, failed tests, skipped tests, and suite durations.
- **Stable Failure Signatures:** Normalized, hashed representations of error messages and stack traces, stripping non-deterministic elements like timestamps.

---

## 3. Failure Taxonomy and Classification

A simple pass/fail flag collapses important operational distinctions. An evidence receipt classifies execution outcomes using a precise failure taxonomy:

- **Agent-Introduced Defect:** The test failed due to a logical error or broken assertion directly within the code written by the agent.
- **Side-Effect Regression:** A test outside the immediate scope of the requested task failed after the patch was applied, indicating unexpected breakage.
- **Pre-Existing Failure:** The check failed identically on the base commit SHA before the agent's patch was applied.
- **Operational / Environment Failure:** Execution was aborted due to infrastructure conditions, such as missing dependencies or port conflicts.
- **Transient Recovery:** A test that failed initially but passed upon immediate re-execution, flagged for flaky behavior tracking.

---

## 4. Resource, Egress, and Safety Boundaries

Executing arbitrary agent code presents security and resource risks. An evidence receipt captures telemetry proving execution remained within safe operational bounds:

- **Resource Consumption:** Peak process-tree Resident Set Size (RSS memory in MiB), sampled CPU usage, wall-time duration, and process spawn counts.
- **Network Egress Telemetry:** Total outbound network requests, external IP addresses contacted, and confirmation that zero unauthorized external requests occurred during zero-egress test runs.
- **Sandbox State:** Affirmation of local isolation boundaries, such as loopback-only network guards or read-only root filesystems.

---

## 5. Explicit Uncertainty and Limitation Bounds

Missing evidence is not proof of success. If an agent modifies an API route that lacks test coverage, the evidence receipt must make that gap explicit.

The limitations section records:

- **Unverified Acceptance Criteria:** User requirements that could not be mapped to an executable check.
- **Unexecuted Code Paths:** Files modified by the agent that were not exercised by any executed test runner (supported by LCOV or Cobertura XML reports).
- **`no_confidence` States:** Sections where telemetry collection was partial or where test reports lack revision-bound selection or resource measurements.

---

## 6. Fix Linkage and Closure Trails

When an agent run fails verification, a fix cycle begins. A production-grade evidence receipt specification supports receipt chaining to establish an auditable history of resolution:

1. **Initial Failure Receipt:** Emitted when the agent's first patch fails an executable check, containing the failing signature and diff.
2. **Fix Candidate Linkage:** The corrective agent run references the initial failure receipt by its unique SHA-256 bundle identity.
3. **Targeted Re-Check Execution:** The new verification run re-executes the exact failing check identified in the initial receipt.
4. **Closure Receipt:** Emitted when the targeted check passes, confirming resolution while including the full history of prior attempts.

---

## Recommended Internal Links

For further technical detail on receipt schemas, local execution, and benchmarking:

- **[Verification evidence bundles](/verification-evidence-bundle):** Overview of portable evidence structures and formatting.
- **[Coding-agent verification](/coding-agent-verification):** Foundational concepts behind execution-backed verification.
- **[How to verify AI-generated code](/verify-ai-generated-code):** Practical workflows for applying verification receipts locally.
- **[AI code review vs. verification](/ai-code-review-vs-verification):** Comparing static review findings with receipt-backed proof.
- **[Public benchmark](/benchmark):** Exploring CodeVetter's public 27-case benchmark dataset and scoring.

---

## Next Action for Platform Engineers

Incorporate structured evidence receipts into your agent execution infrastructure. Replace informal Markdown summaries with a versioned, schema-validated JSON receipt specification that captures base commit identities, command inventory, failure taxonomy, resource bounds, and explicit limitation boundaries.

To inspect executable receipt schemas and CLI ingestion tooling, review CodeVetter's open verification documentation or download the local desktop viewer.

---

## Source Notes (Non-Publishable)

*This section contains internal repository references and operational limitations for editorial review.*

### Supporting Repository Evidence Files
- `docs/development/verification-receipts.md`: Details `codevetter.project-verification-receipt/v1` schema, CLI ingestion (`pnpm verification:ingest`), comparison (`pnpm verification:compare`), and adapter bindings (Playwright, JUnit, LCOV, Cobertura).
- `crates/codevetter-core/`: Rust backend implementing SQLite storage, receipt serialization, and CLI/MCP verification tools.
- `docs/architecture/verification-workbench.md`: Specifications for local execution, dry-run plans, and process supervision.
- `PROJECT_STATUS.md`: Authoritative record of shipped local receipt capabilities, local-check schemas (`codevetter.local-check/v1`), and local execution boundaries.

### Product & Scope Limitations
- **Local Application Architecture:** CodeVetter runs as a native macOS desktop application and local CLI/MCP tool. Receipts are stored in a local SQLite database (`rusqlite`). There is no centralized hosted server or web application.
- **Supported Producer Adapters:** Native receipt ingestion currently processes Playwright JSON, JUnit XML, LCOV, Cobertura XML, Lighthouse JSON, and Chrome trace JSON. Unknown formats fail closed as `no_confidence`.
- **Current Operational Scope:** Core execution qualification focuses on TypeScript/Node web application environments, Playwright browser flows, and local process supervision.
