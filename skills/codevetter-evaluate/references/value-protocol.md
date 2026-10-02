# Measuring incremental value

## Predeclare the comparison

Pick real TypeScript/Node tasks with known acceptance checks, including bug-bearing and clean changes. Freeze task/spec bytes, source revision, runtime, agent/model/version, initial prompt, tool access, time/attempt budget and available provider cost measurement. Keep hidden acceptance checks inaccessible to both coding attempts. Use fresh independent workspaces; prevent one arm from seeing the other's result.

Compare the same agent with normal repository tools against that agent with normal tools plus one CodeVetter flow. Hold other conditions fixed. Randomize arm order across tasks and repeat to expose nondeterminism; include an A/A control. Hold the total task budget equal, charging CodeVetter work to the treatment. If equal-budget execution is impractical, report the difference as an uncontrolled limitation. Do not compare different agents and attribute the difference to CodeVetter.

Separate the interventions:

| Flow | Comparator | Primary outcome | Costs and failure modes |
| --- | --- | --- | --- |
| Review | The same agent's ordinary review of the same change | Independently adjudicated true defects caught and missed | False positives, duplicate findings, human adjudication time, review latency, available tokens/cost |
| Testing | The same agent using repository-owned tests | Hidden acceptance pass rate after repair; reproducible failing-before/passing-after evidence | Incorrect fixes, false passes, unavailable targets, extra attempts, runtime and agent latency |
| Performance | The same agent using the existing benchmark tools | Correct candidate with a qualified same-workload paired improvement | Correctness regressions, unsupported speedup claims, extra runtime/agent cost, workload drift |

A review-only comparison measures defect detection. A performance receipt measures the workload. To claim improved task completion or lower agent effort, run the full task-to-repair experiment with and without that evidence.

## Evidence and accounting

Keep every planned pair and attempt: successful, failed, interrupted, blocked and unavailable. Record why an arm could not run. Associate each tool receipt and invocation with the exact task, arm, source and attempt; repeat command calls are not separate task wins. Distinguish fixture, historical real-project and current real-project evidence. A predeclared experiment population is different from every invocation in the activity ledger.

Preserve canonical artifacts and SHA-256 identities. Store independent ground-truth judgments separately from provisional keyword mappings. A label missed by a mapper is not necessarily a reviewer miss. Keep clean tasks so false alarms can be measured. Show numerator and denominator for every rate and uncertainty across tasks/repeats; a single successful run does not support a general productivity claim.

Do not derive money from advertised provider rates when usage was not measured. Use null/unavailable for cost. Do not turn test wall time into developer time saved. Do not count an observed bug as a prevented production incident. Safety/rejection behavior may be useful, but requires a matched case where the comparator makes the unsupported claim.

## Decision rule

Before running new paid or provider-backed experiments, write a decision rule appropriate to the task set: required acceptance improvement or defect-recall gain, tolerated false-positive burden, correctness non-regression and maximum added runtime/cost. Prefer the owner's threshold; otherwise propose a concrete threshold for the experiment rather than tuning it after seeing results. Use effect sizes and uncertainty; do not invent a universal ROI cutoff.

Keep the flow when it improves the declared outcome within the overhead budget. Narrow or change it when a specific subset helps but the default adds noise or delay. Stop automatic execution when there is no demonstrated incremental benefit at an acceptable cost. Inconclusive evidence calls for the smallest resolving experiment, not more surface area.

## Dashboard contract

The native Runs dashboard should lead with per-flow evidence and the incremental comparison, retaining a drill-down to every skill-mediated invocation. A status/result filter and paginated chronology are operational views, not value counters. Legacy desktop/CLI receipts without skill invocation identity remain historical evidence and are not fabricated as invocations.

Benefit claims come from canonical graders and independent evaluation receipts, not agent-authored summaries. Display unassessed until adjudication/comparator evidence exists. Keep attempts, failures, unavailable data, limitations and fixture labels visible. Provide separate dimensions for observed runtime failures, verified acceptance outcomes, qualified performance outcomes and demonstrated incremental task benefit. These dimensions can overlap and must not be added together as unique wins.
