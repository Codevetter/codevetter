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
3. **Selective Omission:** A summary can omit unexecuted suites, skipped assertions, timeouts, or intermediate failures.
4. **Lack of a Stable Contract:** Free-form summaries lack the schema needed for reliable automated validation.

Structured, machine-readable **verification evidence receipts** make these claims easier to inspect. They complement source review and runner controls; the receipt format itself does not make an agent safe.

---

## General Receipt-Design Principles vs. Current Implementations

A verification evidence receipt is a versioned, portable artifact recording the evidence its producer collected, along with missing measurements and trust limitations.

In general receipt design, an evidence specification defines structured schemas that bind source code identities to execution telemetry. In practical software systems, these fall into two distinct categories:

- **Experimental / Ingested Project Receipts:** Ingestion schemas (such as `codevetter.project-verification-receipt/v1`) that parse raw external runner outputs (Playwright JSON, JUnit XML, LCOV) without mutating local state or asserting full system authority.
- **Persisted Native / Local Receipts:** Local execution receipts (such as `codevetter.local-check/v1`) emitted and stored in local databases during supervised verification passes.

The sections below propose a general design checklist, not a single shipped CodeVetter schema. The experimental project-receipt analyzer does not execute tests, discover commands, or persist receipts into the desktop database. It cannot supply measurements absent from its input. Hashes identify content; they do not authenticate the producer or make storage immutable.

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

Checking these identities against the candidate revision helps detect "replay drift"—where an older receipt is attached to a new pull request. Declared identity fields alone do not prove which code the producer executed.

---

## 2. Execution Records and Inventory

The execution section records every command invoked during the verification pass, documenting exact inputs and outputs:

- **Command Identity:** The selected command and safe arguments, with credential-bearing values redacted. Record omissions explicitly rather than copying secrets into a receipt.
- **Terminal Exit States:** Numeric exit codes, process signal terminations (e.g., `SIGKILL`), and cancellation flags.
- **Bounded Output Captures:** SHA-256 hashes of stdout and stderr logs, accompanied by bounded text excerpts (e.g., capped at 64 KiB) capturing the failure tail.
- **Test Inventory Details:** Individual counts for total discovered tests, passed tests, failed tests, skipped tests, and suite durations.
- **Stable Failure Signatures:** Normalized, hashed representations of error messages and stack traces, stripping non-deterministic elements like timestamps.

---

## 3. Failure Taxonomy and Classification

A simple pass/fail flag collapses important operational distinctions. A receipt can record the following classifications when baseline and runner evidence support them; otherwise attribution should remain uncertain:

- **Agent-Introduced Defect:** The test failed due to a logical error or broken assertion directly within the code written by the agent.
- **Side-Effect Regression:** A test outside the immediate scope of the requested task failed after the patch was applied, indicating unexpected breakage.
- **Pre-Existing Failure:** The check failed identically on the base commit SHA before the agent's patch was applied.
- **Operational / Environment Failure:** Execution was aborted due to infrastructure conditions, such as missing dependencies or port conflicts.
- **Transient Recovery:** A test that failed initially but passed upon immediate re-execution, flagged for flaky behavior tracking.

---

## 4. Resource, Egress, and Safety Boundaries

Executing arbitrary agent code presents security and resource risks. A receipt should describe the controls and observations available to assess those risks, without treating incomplete telemetry as proof of safety:

- **Resource Consumption:** Peak process-tree Resident Set Size (RSS memory in MiB), sampled CPU usage, wall-time duration, and process spawn counts.
- **Network Egress Evidence:** Observed requests or escapes, collection coverage, and the policy actually enforced. An absent network field is not evidence of zero egress; destination details should be minimized or redacted where sensitive.
- **Sandbox State:** The configured isolation boundaries and evidence that enforcement was active. A producer's declaration alone is not independent attestation.

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
4. **Re-Check Receipt:** Records that the targeted check passed at the new revision and links the retained attempts. Broader regression checks and incomplete coverage remain separate from that result.

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
- **Local Application Architecture:** CodeVetter has a native macOS viewer and local CLI/MCP tools. Persisted native/local receipts use SQLite (`rusqlite`); experimental project-receipt ingestion does not persist there. There is no centralized hosted review server.
- **Supported Producer Adapters:** The experimental repository-owned loader accepts Playwright JSON, JUnit XML, LCOV, Cobertura XML, Lighthouse JSON, and Chrome trace JSON. Unsupported formats fail before analysis. Supported reports with missing qualification evidence retain `no_confidence` in the relevant dimensions; coverage and trace observations are not shipping verdicts.
- **Current Operational Scope:** Core execution qualification focuses on TypeScript/Node web application environments, Playwright browser flows, and local process supervision.
