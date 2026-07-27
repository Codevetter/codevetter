## 1. Experiment Contract

- [x] 1.1 Add a versioned hermetic experiment fixture covering paired A/B runs, paired A/A controls, hidden acceptance checks, optional diagnostics, and a predeclared qualification policy
- [x] 1.2 Document the receipt contract, control/treatment isolation rules, real-trial workflow, and the synthetic-fixture claim boundary
- [x] 1.3 Add root package commands for running and testing the structural-context evaluation without adding dependencies

## 2. Validation and Pairing

- [x] 2.1 Implement bounded CLI argument and manifest validation with actionable failures for malformed identities, policies, tasks, checks, and run receipts
- [x] 2.2 Implement exact pair construction that rejects missing, duplicate, mismatched, stale, or control-contaminated arms
- [x] 2.3 Preserve setup failure, agent failure, timeout, incomplete-check, regression, and successful completion as distinct normalized outcomes

## 3. Scoring and Reporting

- [x] 3.1 Score hidden-check task success, acceptance-check pass rates, paired treatment wins, control wins, ties, regressions, and per-task deltas
- [x] 3.2 Aggregate optional verification-selection, file, tool-call, token, latency, and cost diagnostics without treating missing values as zero
- [x] 3.3 Implement A/A discordance and predeclared qualification gates so descriptive results cannot silently become a positive product claim
- [x] 3.4 Emit deterministically ordered JSON, Markdown, and concise terminal reports from one normalized scorecard
- [x] 3.5 Emit a responsive, accessible, self-contained HTML report with qualification-first summary, paired outcome comparison, task check matrix, A/A noise, diagnostics, decision traces, and limitations

## 4. Verification

- [x] 4.1 Add focused Node tests for valid scoring, identity mismatch, stale graph context, control contamination, missing checks, missing diagnostics, A/A noise, qualification, deterministic output, and HTML/JSON parity
- [x] 4.2 Run the synthetic fixture and confirm its report is explicitly unqualified for real product value
- [x] 4.3 Capture and inspect the HTML report at 390, 768, and 1440 pixels; complete the preserve-lane critique, polish, accessibility audit, and design-review receipt
- [x] 4.4 Run the focused benchmark tests, root lint on touched files, strict OpenSpec validation, documentation validation, and `git diff --check`
