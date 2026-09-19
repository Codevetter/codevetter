# Agent Evaluation vs Tests vs Code Review: What Each Can Actually Prove

**Slug:** agent-evaluation-vs-tests-vs-code-review
**Target Query:** agent evaluation vs tests vs code review
**Search Intent:** Architectural comparison and strategy guide for technical leaders, engineering managers, and AI platform teams structuring quality systems for coding agents.
**Meta Title:** Agent Eval vs Tests vs Code Review | What Each Proves
**Meta Description:** Understand the distinct proof boundaries of agent evaluation, software testing, and static AI code review when checking agent-written software changes.

---

## Article Outline

- **Introduction:** The confusion surrounding quality gates for AI-generated code.
- **The Core Comparison Matrix:** Comparing inputs, outputs, strengths, and limits.
- **1. Static Code Review:** What it proves (syntax, maintainability) and what it misses.
- **2. Software Testing:** What it proves (assertion validity) and its gaps.
- **3. Execution-Backed Agent Evaluation:** Binding task intent, changes, and verification.
- **Why Relying on Any Single Mechanism Fails:** Complementary roles in development.
- **Building a Unified Quality Pipeline:** Combining review, tests, and task evaluation.
- **Recommended Internal Links:** Exploring CodeVetter's verification content.
- **Next Action:** Tactical recommendations for engineering leadership.
- **Source Notes (Non-Publishable):** Repository evidence sources and operational bounds.

---

## Understanding Quality Gates in the Era of AI Coding Agents

As AI coding agents take on complex software tasks, technical leaders face a critical question: how do we know an agent-authored pull request is safe to merge?

In traditional software development, quality assurance relies on **automated test suites** (unit, integration, and end-to-end tests) and **human code review**. With generative AI, organizations have added **static AI code review**, where an LLM inspects diffs. More recently, **execution-backed agent evaluation** systems have emerged to assess whether an agent completed a requested task correctly.

However, teams frequently blur the boundaries between these mechanisms, treating them as interchangeable. This leads to misplaced confidence—such as assuming a green test suite proves an agent understood the prompt, or believing an AI review comment proves a bug was fixed.

To build a reliable software delivery pipeline for AI-generated code, teams must understand what static code review, software testing, and execution-backed agent evaluation can—and cannot—actually prove.

---

## The Core Comparison Matrix

The table below outlines the fundamental differences across all three mechanisms:

| Dimension | Static AI / Human Code Review | Automated Testing (Unit / Integration / E2E) | Execution-Backed Agent Evaluation |
| --- | --- | --- | --- |
| **Primary Input** | Code diff, repository files, style rules | Source code, test scripts, test data | Task intent, repository revision, patch, executable checks |
| **Primary Output** | Text findings, style suggestions, risk flags | Pass/fail counts, stack traces, coverage reports | Portable evidence receipt, failure taxonomy, completion verdict |
| **What It Proves** | Code readability, pattern match, maintainability | Whether specific assertions pass under defined inputs | Whether selected checks support the requested task outcome, with regression evidence only where checks cover it |
| **Core Limitation** | Cannot execute code; plausible diffs can fail | Cannot determine if tests match prompt intent | Requires explicit executable checks; bounded by runner |
| **Failure Mode** | High false positives or false praise from text | Green suite passing on an incomplete task | Reports `no_confidence` when required evidence is absent or partial |

---

## 1. Static Code Review: Evaluating Appearance and Maintainability

Static code review—performed by engineers or AI models—inspects source text. It evaluates structure, style, and architectural patterns without executing the application.

### What Static Code Review Can Prove
- **Conformity to Style and Conventions:** Verifies that variable naming, organization, and formatting match repository standards.
- **Surface Risk Identification:** Flags known anti-patterns, such as hardcoded credentials or missing error-handling blocks.
- **Maintainability and Readability:** Evaluates whether code is modular and understandable for future maintainers.

### What Static Code Review Cannot Prove
- **Operational Correctness:** A diff can be beautifully formatted and completely broken at runtime due to an unhandled null pointer or async race condition.
- **Task Completion:** A reviewer inspecting a diff cannot verify if an API endpoint handles real HTTP headers or whether a migration executes cleanly.

---

## 2. Automated Testing: Verifying Specific Code Assertions

Software testing executes code within a controlled runner to verify that specific functions satisfy predefined code assertions.

### What Testing Can Prove
- **Assertion Validity:** Proves that specified code paths yield expected return values under defined test inputs.
- **Regression Detection for Covered Code:** Demonstrates that existing behaviors continue to function after new code is added.
- **Performance Benchmarks:** Measures execution wall time, memory consumption, or CPU utilization for specific benchmark functions.

### What Testing Cannot Prove
- **Alignment with Task Intent:** A coding agent can satisfy test runners by altering test assertions or deleting failing tests entirely. The test suite passes, but the business requirement is unsatisfied.
- **Correctness of Un-Tested Requirements:** If a task requires handling an edge case that lacks a written test, a passing test suite provides zero proof that the edge case works.

---

## 3. Execution-Backed Agent Evaluation: Verifying Task Completion

Execution-backed agent evaluation solves the "intent-to-execution" gap in autonomous software development. It connects the prompt, the exact patch, isolated local execution, and structured evidence collection.

```
[User Task Prompt] ──> [Agent Patch] ──> [Executable Verification] ──> [Evidence Receipt]
                                                │
                                                ├── Unit / Integration Tests
                                                ├── Headless Browser Flows
                                                └── Local API Assertions
```

### What Agent Evaluation Can Prove
- **Task Completion Evidence:** Runs checks against the requested behavioral boundary (such as headless browser state or API endpoints) and records what those checks support.
- **Failure Classification:** Uses a failure taxonomy to record whether an observed failure is classified as an agent defect, side-effect regression, pre-existing failure, or environment issue.
- **Auditability and Closure:** Produces machine-readable evidence receipts that can link an initial failure to a post-fix re-check when both receipts and their identities are available, creating an auditable closure trail.

### What Agent Evaluation Cannot Prove
- **Universal Code Quality:** A task evaluation provides evidence from selected runtime checks, but cannot guarantee that the underlying code architecture is elegant.
- **Coverage Beyond Executable Checks:** Agent evaluation cannot verify behavior for which no executable check or browser automation can be constructed.

---

## Why Relying on Any Single Mechanism Fails

Engineering organizations relying on only one mechanism face predictable failure modes:

1. **Code Review Alone:** Merges "plausible-looking code", leading to runtime outages, state corruption, or API breaks.
2. **Tests Alone:** Results in "passing suites with drift," where agents satisfy test runners by altering assertions or ignoring un-tested edge cases.
3. **Agent Evaluation Alone:** Yields functionally correct features that may accumulate tech debt or non-standard choices over time.

---

## Building a Unified Quality Pipeline for AI Code

Technical teams should integrate all three mechanisms into a unified, complementary quality loop:

```
                  ┌─────────────────────────────────────────┐
                  │ 1. STATIC CODE REVIEW                   │
                  │ Discover risks, check style & structure │
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │ 2. EXECUTABLE AGENT EVALUATION          │
                  │ Verify task completion & browser/API    │
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │ 3. AUTOMATED REGRESSION SUITE           │
                  │ Re-run tests to catch side effects      │
                  └─────────────────────────────────────────┘
```

1. **Use Static Review for Triage:** Let static AI code review scan incoming diffs to identify structural risks and maintainability concerns.
2. **Translate Acceptance Criteria into Executable Checks:** Ensure changes are exercised against real behavioral boundaries, such as Playwright browser flows or local API tests.
3. **Generate Machine-Readable Evidence Receipts:** Capture execution telemetry, failure taxonomies, and resource bounds into portable JSON receipts.
4. **Require Closure Trails Before Merging:** Require the agent to apply a fix and generate a passing re-check receipt linked to the original failure before approving the pull request.

---

## Recommended Internal Links

Explore related CodeVetter analysis and verification methodology:

- **[AI code review vs. verification](/ai-code-review-vs-verification):** Detailed side-by-side comparison of review and verification.
- **[Coding-agent verification](/coding-agent-verification):** Comprehensive guide to execution-backed task verification.
- **[How to verify AI-generated code](/verify-ai-generated-code):** Practical step-by-step checklist for checking agent patches.
- **[Verification evidence bundles](/verification-evidence-bundle):** Technical breakdown of portable evidence receipt schemas.
- **[Public benchmark](/benchmark):** Reproducible 27-case recognition benchmark dataset, scorer, and limitations.

---

## Next Action for Engineering Leadership

Audit your engineering team's current pull request process for AI-generated code. Establish an execution-backed evaluation layer that binds user prompt intent to isolated, executable checks and structured evidence receipts.

To inspect how local execution-backed verification functions in practice, download CodeVetter or review our public benchmark methodology.

---

## Source Notes (Non-Publishable)

*This section contains internal repository references and operational limitations for editorial review.*

### Supporting Repository Evidence Files
- `PRODUCT.md`: Establishes CodeVetter's core positioning as an execution-backed verification system rather than a generic reviewer.
- `PROJECT_STATUS.md`: Authoritative record of shipped capabilities, local execution model, Rust core architecture, and investment decisions.
- `docs/knowledge/learnings/verification-and-judgment.md`: Analysis of model judgment vs. executable outcome verification.
- `benchmarks/public-catch-rate/`: Public 27-case recognition benchmark dataset (catch rate, precision, F1) comparing static review against raw baselines.
- `docs/development/verification-receipts.md`: Producer contracts (`codevetter.project-verification-receipt/v1`) and result analysis boundaries.

### Product & Scope Limitations
- **Local Desktop Architecture:** CodeVetter operates as a local desktop application (SwiftUI/AppKit) and Rust CLI/MCP binary. Native application data resides in a local SQLite database; the experimental `codevetter.project-verification-receipt/v1` ingestion slice produces local artifacts and does not persist them into that desktop database. There is no hosted web service or cloud backend.
- **Active Core Focus:** Active core development focuses on Node.js/TypeScript web applications, API behavior, and Playwright browser journeys.
- **Benchmark Scope:** The public 27-case benchmark evaluates static bug recognition in synthetic fixtures. It does not prove general production performance across arbitrary enterprise repositories.
