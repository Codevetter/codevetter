#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_FIXTURE = 'benchmarks/structural-context/sample.json';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TASKS = 500;
const MAX_RUNS = 5_000;
const MAX_ITEMS = 1_000;
const MAX_TEXT = 2_000;
const HASH = /^[0-9a-f]{64}$/;
const REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RUN_STATUSES = new Set([
  'completed',
  'setup_failed',
  'agent_failed',
  'timed_out',
  'cancelled',
  'check_error',
  'cleanup_failure',
]);
const CHECK_STATUSES = new Set(['pass', 'fail', 'error', 'skipped']);
const GRAPH_TOOL_PREFIXES = ['graph_', 'structural_graph_'];

export const STRUCTURAL_CONTEXT_SCORER_VERSION = 'codevetter.structural-context.v1';

function parseArgs(argv) {
  const positional = argv.find((argument) => !argument.startsWith('--'));
  const formatArgument = argv.find((argument) => argument.startsWith('--format='));
  const outArgument = argv.find((argument) => argument.startsWith('--out='));
  return {
    fixture: positional ?? DEFAULT_FIXTURE,
    format: formatArgument?.slice('--format='.length) ?? 'text',
    out: outArgument?.slice('--out='.length) ?? null,
  };
}

function readManifest(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) throw new Error(`Experiment manifest is not a file: ${filePath}`);
  if (stat.size > MAX_BYTES) {
    throw new Error(`Experiment manifest exceeds ${MAX_BYTES} bytes: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function add(errors, condition, message) {
  if (!condition) errors.push(message);
}

function stringValue(errors, value, label, { hash = false, revision = false } = {}) {
  add(errors, typeof value === 'string' && value.trim().length > 0, `${label} is required`);
  if (typeof value === 'string') {
    add(errors, value.length <= MAX_TEXT, `${label} exceeds ${MAX_TEXT} characters`);
    if (hash) add(errors, HASH.test(value), `${label} must be a lowercase sha256`);
    if (revision) {
      add(errors, REVISION.test(value), `${label} must be a lowercase git or sha256 revision`);
    }
  }
}

function numberValue(errors, value, label, { integer = false, minimum = 0 } = {}) {
  add(errors, Number.isFinite(value), `${label} must be a finite number`);
  if (Number.isFinite(value)) {
    add(errors, value >= minimum, `${label} must be at least ${minimum}`);
    if (integer) add(errors, Number.isInteger(value), `${label} must be an integer`);
  }
}

function boundedStringArray(errors, value, label) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array when present`);
    return;
  }
  add(errors, value.length <= MAX_ITEMS, `${label} exceeds ${MAX_ITEMS} entries`);
  value.forEach((entry, index) => stringValue(errors, entry, `${label}[${index}]`));
}

function validatePolicy(errors, policy) {
  if (!isObject(policy)) {
    errors.push('experiment.qualification_policy must be an object');
    return;
  }
  numberValue(
    errors,
    policy.minimum_complete_pairs,
    'qualification_policy.minimum_complete_pairs',
    {
      integer: true,
      minimum: 1,
    }
  );
  numberValue(
    errors,
    policy.minimum_distinct_tasks,
    'qualification_policy.minimum_distinct_tasks',
    {
      integer: true,
      minimum: 1,
    }
  );
  numberValue(errors, policy.minimum_aa_pairs, 'qualification_policy.minimum_aa_pairs', {
    integer: true,
    minimum: 1,
  });
  numberValue(
    errors,
    policy.minimum_success_rate_delta,
    'qualification_policy.minimum_success_rate_delta'
  );
  numberValue(
    errors,
    policy.maximum_regression_delta,
    'qualification_policy.maximum_regression_delta'
  );
  numberValue(
    errors,
    policy.maximum_aa_discordance_rate,
    'qualification_policy.maximum_aa_discordance_rate'
  );
  if (Number.isFinite(policy.minimum_success_rate_delta)) {
    add(
      errors,
      policy.minimum_success_rate_delta <= 1,
      'qualification_policy.minimum_success_rate_delta must be at most 1'
    );
  }
  if (Number.isFinite(policy.maximum_aa_discordance_rate)) {
    add(
      errors,
      policy.maximum_aa_discordance_rate <= 1,
      'qualification_policy.maximum_aa_discordance_rate must be at most 1'
    );
  }
}

function validateTask(errors, task, index, taskIds) {
  const label = `tasks[${index}]`;
  if (!isObject(task)) {
    errors.push(`${label} must be an object`);
    return;
  }
  stringValue(errors, task.id, `${label}.id`);
  stringValue(errors, task.title, `${label}.title`);
  stringValue(errors, task.repository_revision, `${label}.repository_revision`, {
    revision: true,
  });
  stringValue(errors, task.task_packet_sha256, `${label}.task_packet_sha256`, { hash: true });
  stringValue(errors, task.acceptance_contract_sha256, `${label}.acceptance_contract_sha256`, {
    hash: true,
  });
  if (typeof task.id === 'string') {
    add(errors, !taskIds.has(task.id), `${label}.id duplicates ${task.id}`);
    taskIds.add(task.id);
  }
  if (!Array.isArray(task.required_checks) || task.required_checks.length === 0) {
    errors.push(`${label}.required_checks must be a non-empty array`);
  } else {
    add(
      errors,
      task.required_checks.length <= MAX_ITEMS,
      `${label}.required_checks exceeds ${MAX_ITEMS} entries`
    );
    const checkIds = new Set();
    task.required_checks.forEach((check, checkIndex) => {
      const checkLabel = `${label}.required_checks[${checkIndex}]`;
      if (!isObject(check)) {
        errors.push(`${checkLabel} must be an object`);
        return;
      }
      stringValue(errors, check.id, `${checkLabel}.id`);
      stringValue(errors, check.label, `${checkLabel}.label`);
      if (typeof check.id === 'string') {
        add(errors, !checkIds.has(check.id), `${checkLabel}.id duplicates ${check.id}`);
        checkIds.add(check.id);
      }
    });
  }
  boundedStringArray(errors, task.expected_verification, `${label}.expected_verification`);
}

function validateRun(errors, run, index, tasks) {
  const label = `runs[${index}]`;
  if (!isObject(run)) {
    errors.push(`${label} must be an object`);
    return;
  }
  stringValue(errors, run.pair_id, `${label}.pair_id`);
  add(
    errors,
    run.comparison === 'ab' || run.comparison === 'aa',
    `${label}.comparison must be ab|aa`
  );
  const allowedArms = run.comparison === 'ab' ? ['control', 'treatment'] : ['a', 'b'];
  add(errors, allowedArms.includes(run.arm), `${label}.arm must be ${allowedArms.join('|')}`);
  stringValue(errors, run.task_id, `${label}.task_id`);
  numberValue(errors, run.trial_index, `${label}.trial_index`, { integer: true, minimum: 1 });
  add(
    errors,
    run.execution_order === 1 || run.execution_order === 2,
    `${label}.execution_order must be 1|2`
  );

  const task = tasks.get(run.task_id);
  add(errors, Boolean(task), `${label}.task_id references an unknown task`);
  if (!isObject(run.identities)) {
    errors.push(`${label}.identities must be an object`);
  } else {
    stringValue(
      errors,
      run.identities.repository_revision,
      `${label}.identities.repository_revision`,
      { revision: true }
    );
    stringValue(
      errors,
      run.identities.task_packet_sha256,
      `${label}.identities.task_packet_sha256`,
      { hash: true }
    );
    stringValue(
      errors,
      run.identities.acceptance_contract_sha256,
      `${label}.identities.acceptance_contract_sha256`,
      { hash: true }
    );
    stringValue(errors, run.identities.agent, `${label}.identities.agent`);
    stringValue(errors, run.identities.model, `${label}.identities.model`);
    stringValue(
      errors,
      run.identities.configuration_sha256,
      `${label}.identities.configuration_sha256`,
      { hash: true }
    );
    stringValue(
      errors,
      run.identities.environment_sha256,
      `${label}.identities.environment_sha256`,
      { hash: true }
    );
    if (task) {
      add(
        errors,
        run.identities.repository_revision === task.repository_revision,
        `${label}.identities.repository_revision does not match task`
      );
      add(
        errors,
        run.identities.task_packet_sha256 === task.task_packet_sha256,
        `${label}.identities.task_packet_sha256 does not match task`
      );
      add(
        errors,
        run.identities.acceptance_contract_sha256 === task.acceptance_contract_sha256,
        `${label}.identities.acceptance_contract_sha256 does not match task`
      );
    }
  }

  if (!isObject(run.context)) {
    errors.push(`${label}.context must be an object`);
  } else {
    add(
      errors,
      typeof run.context.structural_context_enabled === 'boolean',
      `${label}.context.structural_context_enabled must be boolean`
    );
    stringValue(errors, run.context.policy_identity, `${label}.context.policy_identity`);
    boundedStringArray(
      errors,
      run.context.allowed_graph_tools,
      `${label}.context.allowed_graph_tools`
    );
    if (run.context.graph !== null && run.context.graph !== undefined) {
      if (!isObject(run.context.graph)) {
        errors.push(`${label}.context.graph must be an object or null`);
      } else {
        stringValue(errors, run.context.graph.engine_id, `${label}.context.graph.engine_id`);
        stringValue(
          errors,
          run.context.graph.engine_version,
          `${label}.context.graph.engine_version`
        );
        stringValue(errors, run.context.graph.snapshot_id, `${label}.context.graph.snapshot_id`);
        stringValue(
          errors,
          run.context.graph.indexed_revision,
          `${label}.context.graph.indexed_revision`,
          { revision: true }
        );
      }
    }
  }

  if (!isObject(run.outcome)) {
    errors.push(`${label}.outcome must be an object`);
  } else {
    add(errors, RUN_STATUSES.has(run.outcome.status), `${label}.outcome.status is invalid`);
    numberValue(errors, run.outcome.regression_count, `${label}.outcome.regression_count`, {
      integer: true,
    });
    if (!Array.isArray(run.outcome.checks)) {
      errors.push(`${label}.outcome.checks must be an array`);
    } else {
      add(
        errors,
        run.outcome.checks.length <= MAX_ITEMS,
        `${label}.outcome.checks exceeds ${MAX_ITEMS} entries`
      );
      const required = new Set(task?.required_checks?.map((check) => check.id) ?? []);
      const seen = new Set();
      run.outcome.checks.forEach((check, checkIndex) => {
        const checkLabel = `${label}.outcome.checks[${checkIndex}]`;
        if (!isObject(check)) {
          errors.push(`${checkLabel} must be an object`);
          return;
        }
        stringValue(errors, check.id, `${checkLabel}.id`);
        add(errors, CHECK_STATUSES.has(check.status), `${checkLabel}.status is invalid`);
        if (typeof check.id === 'string') {
          add(errors, required.has(check.id), `${checkLabel}.id is not a required task check`);
          add(errors, !seen.has(check.id), `${checkLabel}.id duplicates ${check.id}`);
          seen.add(check.id);
        }
      });
    }
  }

  if (run.diagnostics !== undefined) {
    if (!isObject(run.diagnostics)) {
      errors.push(`${label}.diagnostics must be an object when present`);
    } else {
      for (const field of [
        'input_tokens',
        'output_tokens',
        'cached_input_tokens',
        'reasoning_tokens',
        'tool_result_tokens',
        'tool_calls_total',
        'tool_call_mean_ms',
        'tool_elapsed_ms',
        'model_elapsed_ms',
        'elapsed_ms',
        'run_elapsed_ms',
        'peak_rss_bytes',
        'cpu_time_ms',
        'cost_usd',
      ]) {
        if (run.diagnostics[field] !== undefined && run.diagnostics[field] !== null) {
          numberValue(errors, run.diagnostics[field], `${label}.diagnostics.${field}`);
        }
      }
      for (const field of [
        'verification_selected',
        'files_inspected',
        'files_modified',
        'tool_calls',
      ]) {
        boundedStringArray(errors, run.diagnostics[field], `${label}.diagnostics.${field}`);
      }
      if (run.diagnostics.decision_trace !== undefined) {
        if (!Array.isArray(run.diagnostics.decision_trace)) {
          errors.push(`${label}.diagnostics.decision_trace must be an array`);
        } else {
          add(
            errors,
            run.diagnostics.decision_trace.length <= 100,
            `${label}.diagnostics.decision_trace exceeds 100 entries`
          );
          run.diagnostics.decision_trace.forEach((entry, traceIndex) => {
            const traceLabel = `${label}.diagnostics.decision_trace[${traceIndex}]`;
            if (!isObject(entry)) {
              errors.push(`${traceLabel} must be an object`);
              return;
            }
            stringValue(errors, entry.tool, `${traceLabel}.tool`);
            stringValue(errors, entry.query, `${traceLabel}.query`);
            stringValue(errors, entry.summary, `${traceLabel}.summary`);
            boundedStringArray(errors, entry.source_paths, `${traceLabel}.source_paths`);
          });
        }
      }
    }
  }
}

export function validateManifest(data) {
  const errors = [];
  if (!isObject(data)) return ['manifest must be an object'];
  add(errors, data.schema_version === 1, 'schema_version must be 1');
  if (!isObject(data.experiment)) {
    errors.push('experiment must be an object');
  } else {
    stringValue(errors, data.experiment.id, 'experiment.id');
    stringValue(errors, data.experiment.title, 'experiment.title');
    add(
      errors,
      data.experiment.evidence_kind === 'synthetic' || data.experiment.evidence_kind === 'real',
      'experiment.evidence_kind must be synthetic|real'
    );
    boundedStringArray(errors, data.experiment.limitations, 'experiment.limitations');
    validatePolicy(errors, data.experiment.qualification_policy);
  }
  if (!Array.isArray(data.tasks) || data.tasks.length === 0) {
    errors.push('tasks must be a non-empty array');
  } else {
    add(errors, data.tasks.length <= MAX_TASKS, `tasks exceeds ${MAX_TASKS} entries`);
  }
  const taskIds = new Set();
  (data.tasks ?? []).forEach((task, index) => validateTask(errors, task, index, taskIds));
  if (!Array.isArray(data.runs) || data.runs.length === 0) {
    errors.push('runs must be a non-empty array');
  } else {
    add(errors, data.runs.length <= MAX_RUNS, `runs exceeds ${MAX_RUNS} entries`);
  }
  const tasks = new Map((data.tasks ?? []).map((task) => [task.id, task]));
  (data.runs ?? []).forEach((run, index) => validateRun(errors, run, index, tasks));
  return errors;
}

function sameIdentity(left, right) {
  const fields = [
    'repository_revision',
    'task_packet_sha256',
    'acceptance_contract_sha256',
    'agent',
    'model',
    'configuration_sha256',
    'environment_sha256',
  ];
  return fields.every((field) => left.identities[field] === right.identities[field]);
}

function graphCalls(run) {
  const calls = run.diagnostics?.tool_calls ?? [];
  const declared = new Set(run.context.allowed_graph_tools ?? []);
  return calls.filter(
    (call) =>
      declared.has(call) ||
      GRAPH_TOOL_PREFIXES.some((prefix) => call.toLowerCase().startsWith(prefix))
  );
}

function validateAbIsolation(control, treatment, task) {
  const reasons = [];
  if (control.context.structural_context_enabled)
    reasons.push('control enabled structural context');
  if (control.context.graph !== null && control.context.graph !== undefined) {
    reasons.push('control retained graph identity');
  }
  if (graphCalls(control).length) reasons.push('control invoked a graph tool');
  if (!treatment.context.structural_context_enabled)
    reasons.push('treatment disabled structural context');
  if (!isObject(treatment.context.graph)) reasons.push('treatment omitted graph identity');
  if (
    treatment.context.graph?.indexed_revision &&
    treatment.context.graph.indexed_revision !== task.repository_revision
  ) {
    reasons.push('treatment graph snapshot is stale');
  }
  return reasons;
}

function validateAaIsolation(left, right) {
  const reasons = [];
  if (left.context.structural_context_enabled !== right.context.structural_context_enabled) {
    reasons.push('A/A arms use different structural-context enablement');
  }
  if (left.context.policy_identity !== right.context.policy_identity) {
    reasons.push('A/A arms use different context policies');
  }
  const leftGraph = left.context.graph ? JSON.stringify(left.context.graph) : null;
  const rightGraph = right.context.graph ? JSON.stringify(right.context.graph) : null;
  if (leftGraph !== rightGraph) reasons.push('A/A arms use different graph identities');
  const leftTools = [...new Set(left.context.allowed_graph_tools ?? [])].sort();
  const rightTools = [...new Set(right.context.allowed_graph_tools ?? [])].sort();
  if (JSON.stringify(leftTools) !== JSON.stringify(rightTools)) {
    reasons.push('A/A arms allow different graph tools');
  }
  return reasons;
}

function normalizeRun(run, task) {
  const observed = new Map(run.outcome.checks.map((check) => [check.id, check.status]));
  const checks = task.required_checks.map((check) => ({
    id: check.id,
    label: check.label,
    status: observed.get(check.id) ?? 'missing',
  }));
  const passed = checks.filter((check) => check.status === 'pass').length;
  const missing = checks.filter((check) => check.status === 'missing').map((check) => check.id);
  const regressions = run.outcome.regression_count;
  const success =
    run.outcome.status === 'completed' &&
    missing.length === 0 &&
    passed === checks.length &&
    regressions === 0;
  let outcome = run.outcome.status;
  if (run.outcome.status === 'completed') {
    if (missing.length) outcome = 'incomplete_checks';
    else if (regressions > 0) outcome = 'regression';
    else if (!success) outcome = 'check_failure';
    else outcome = 'success';
  }
  return {
    arm: run.arm,
    execution_order: run.execution_order,
    outcome,
    success,
    checks,
    passed_checks: passed,
    total_checks: checks.length,
    regression_count: regressions,
    diagnostics: run.diagnostics ?? {},
  };
}

function buildPairs(data) {
  const tasks = new Map(data.tasks.map((task) => [task.id, task]));
  const groups = new Map();
  for (const run of data.runs) {
    const key = `${run.comparison}:${run.pair_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }

  const valid = { ab: [], aa: [] };
  const invalid = [];
  for (const key of [...groups.keys()].sort()) {
    const runs = groups.get(key);
    const comparison = runs[0].comparison;
    const arms = comparison === 'ab' ? ['control', 'treatment'] : ['a', 'b'];
    const reasons = [];
    if (runs.some((run) => run.comparison !== comparison)) {
      reasons.push('pair mixes comparison types');
    }
    const byArm = new Map();
    for (const run of runs) {
      if (byArm.has(run.arm)) reasons.push(`duplicate ${run.arm} arm`);
      else byArm.set(run.arm, run);
    }
    for (const arm of arms) {
      if (!byArm.has(arm)) reasons.push(`missing ${arm} arm`);
    }
    if (runs.length !== 2) reasons.push(`expected 2 runs, received ${runs.length}`);

    const left = byArm.get(arms[0]);
    const right = byArm.get(arms[1]);
    if (left && right) {
      if (left.task_id !== right.task_id) reasons.push('arms use different tasks');
      if (left.trial_index !== right.trial_index) reasons.push('arms use different trial indexes');
      if (!sameIdentity(left, right)) reasons.push('arms use different common identities');
      if (left.execution_order === right.execution_order) {
        reasons.push('arms use the same execution order');
      }
      const task = tasks.get(left.task_id);
      reasons.push(
        ...(comparison === 'ab'
          ? validateAbIsolation(left, right, task)
          : validateAaIsolation(left, right))
      );
    }

    if (reasons.length) {
      invalid.push({
        pair_id: runs[0].pair_id,
        comparison,
        reasons: [...new Set(reasons)].sort(),
      });
      continue;
    }

    const task = tasks.get(left.task_id);
    valid[comparison].push({
      pair_id: left.pair_id,
      task_id: task.id,
      task_title: task.title,
      trial_index: left.trial_index,
      first_arm: left.execution_order === 1 ? left.arm : right.arm,
      [arms[0]]: normalizeRun(left, task),
      [arms[1]]: normalizeRun(right, task),
    });
  }
  return { valid, invalid };
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value) {
  return value === null ? null : Math.round(value * 1_000_000) / 1_000_000;
}

function rate(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function pairOutcome(left, right) {
  if (left.success && !right.success) return 'left_win';
  if (!left.success && right.success) return 'right_win';
  return left.success ? 'tie_pass' : 'tie_fail';
}

function diagnosticValue(run, metric) {
  const diagnostics = run.diagnostics;
  if (metric === 'files_inspected') return diagnostics.files_inspected?.length ?? null;
  if (metric === 'files_modified') return diagnostics.files_modified?.length ?? null;
  if (metric === 'verification_selected') return diagnostics.verification_selected?.length ?? null;
  if (metric === 'tool_calls') return diagnostics.tool_calls?.length ?? null;
  return Number.isFinite(diagnostics[metric]) ? diagnostics[metric] : null;
}

function pairedDiagnostic(pairs, leftArm, rightArm, metric) {
  const rows = pairs
    .map((pair) => ({
      left: diagnosticValue(pair[leftArm], metric),
      right: diagnosticValue(pair[rightArm], metric),
    }))
    .filter((row) => row.left !== null && row.right !== null);
  const left = rows.map((row) => row.left);
  const right = rows.map((row) => row.right);
  return {
    paired_count: rows.length,
    total_pairs: pairs.length,
    [leftArm]: round(mean(left)),
    [rightArm]: round(mean(right)),
    delta: rows.length ? round(mean(right.map((value, index) => value - left[index]))) : null,
  };
}

function summarizeAb(pairs) {
  const controlSuccess = pairs.filter((pair) => pair.control.success).length;
  const treatmentSuccess = pairs.filter((pair) => pair.treatment.success).length;
  const outcomes = { treatment_wins: 0, control_wins: 0, tie_pass: 0, tie_fail: 0 };
  let controlPassed = 0;
  let treatmentPassed = 0;
  let totalChecks = 0;
  let controlRegressions = 0;
  let treatmentRegressions = 0;
  let treatmentFirst = 0;

  const rows = pairs.map((pair) => {
    const outcome = pairOutcome(pair.control, pair.treatment);
    if (outcome === 'right_win') outcomes.treatment_wins += 1;
    else if (outcome === 'left_win') outcomes.control_wins += 1;
    else outcomes[outcome] += 1;
    controlPassed += pair.control.passed_checks;
    treatmentPassed += pair.treatment.passed_checks;
    totalChecks += pair.control.total_checks;
    controlRegressions += pair.control.regression_count;
    treatmentRegressions += pair.treatment.regression_count;
    if (pair.first_arm === 'treatment') treatmentFirst += 1;
    const checkDeltas = pair.treatment.checks.flatMap((check, index) => {
      const control = pair.control.checks[index];
      return check.status === control.status
        ? []
        : [
            {
              id: check.id,
              label: check.label,
              control: control.status,
              treatment: check.status,
            },
          ];
    });
    return {
      pair_id: pair.pair_id,
      task_id: pair.task_id,
      task_title: pair.task_title,
      trial_index: pair.trial_index,
      first_arm: pair.first_arm,
      outcome:
        outcome === 'right_win'
          ? 'treatment_win'
          : outcome === 'left_win'
            ? 'control_win'
            : outcome,
      control: pair.control,
      treatment: pair.treatment,
      check_deltas: checkDeltas,
      decision_trace: pair.treatment.diagnostics.decision_trace ?? [],
    };
  });

  const metrics = {};
  for (const metric of [
    'verification_selected',
    'files_inspected',
    'files_modified',
    'tool_calls',
    'input_tokens',
    'output_tokens',
    'cached_input_tokens',
    'reasoning_tokens',
    'tool_result_tokens',
    'tool_calls_total',
    'tool_call_mean_ms',
    'tool_elapsed_ms',
    'model_elapsed_ms',
    'elapsed_ms',
    'run_elapsed_ms',
    'peak_rss_bytes',
    'cpu_time_ms',
    'cost_usd',
  ]) {
    metrics[metric] = pairedDiagnostic(pairs, 'control', 'treatment', metric);
  }
  return {
    complete_pairs: pairs.length,
    distinct_tasks: new Set(pairs.map((pair) => pair.task_id)).size,
    control_successes: controlSuccess,
    treatment_successes: treatmentSuccess,
    control_success_rate: round(rate(controlSuccess, pairs.length)),
    treatment_success_rate: round(rate(treatmentSuccess, pairs.length)),
    success_rate_delta: round(rate(treatmentSuccess - controlSuccess, pairs.length)),
    control_check_pass_rate: round(rate(controlPassed, totalChecks)),
    treatment_check_pass_rate: round(rate(treatmentPassed, totalChecks)),
    check_pass_rate_delta: round(rate(treatmentPassed - controlPassed, totalChecks)),
    control_regressions: controlRegressions,
    treatment_regressions: treatmentRegressions,
    regression_delta: treatmentRegressions - controlRegressions,
    execution_order: {
      treatment_first: treatmentFirst,
      control_first: pairs.length - treatmentFirst,
    },
    ...outcomes,
    diagnostics: metrics,
    pairs: rows,
  };
}

function summarizeAa(pairs) {
  const discordant = pairs.filter((pair) => pair.a.success !== pair.b.success).length;
  return {
    complete_pairs: pairs.length,
    discordant_pairs: discordant,
    discordance_rate: round(rate(discordant, pairs.length)),
    pairs: pairs.map((pair) => ({
      pair_id: pair.pair_id,
      task_id: pair.task_id,
      trial_index: pair.trial_index,
      a: pair.a.outcome,
      b: pair.b.outcome,
      discordant: pair.a.success !== pair.b.success,
    })),
  };
}

function qualify(experiment, ab, aa, invalidPairs) {
  const policy = experiment.qualification_policy;
  const evidenceGates = [
    {
      id: 'real_evidence',
      pass: experiment.evidence_kind === 'real',
      detail:
        experiment.evidence_kind === 'real'
          ? 'Receipts are declared real.'
          : 'Synthetic fixtures cannot establish product value.',
    },
    {
      id: 'complete_pairs',
      pass: ab.complete_pairs >= policy.minimum_complete_pairs,
      detail: `${ab.complete_pairs}/${policy.minimum_complete_pairs} complete A/B pairs`,
    },
    {
      id: 'distinct_tasks',
      pass: ab.distinct_tasks >= policy.minimum_distinct_tasks,
      detail: `${ab.distinct_tasks}/${policy.minimum_distinct_tasks} distinct tasks`,
    },
    {
      id: 'aa_pairs',
      pass: aa.complete_pairs >= policy.minimum_aa_pairs,
      detail: `${aa.complete_pairs}/${policy.minimum_aa_pairs} complete A/A pairs`,
    },
    {
      id: 'aa_noise',
      pass: aa.complete_pairs > 0 && aa.discordance_rate <= policy.maximum_aa_discordance_rate,
      detail: `${percent(aa.discordance_rate)} discordance; maximum ${percent(
        policy.maximum_aa_discordance_rate
      )}`,
    },
    {
      id: 'pair_integrity',
      pass: invalidPairs.length === 0,
      detail: `${invalidPairs.length} invalid or contaminated pairs`,
    },
  ];
  const effectGates = [
    {
      id: 'success_improvement',
      pass: ab.success_rate_delta >= policy.minimum_success_rate_delta,
      detail: `${signedPercent(ab.success_rate_delta)}; minimum ${signedPercent(
        policy.minimum_success_rate_delta
      )}`,
    },
    {
      id: 'regression_control',
      pass: ab.regression_delta <= policy.maximum_regression_delta,
      detail: `${signed(ab.regression_delta)} regressions; maximum ${signed(
        policy.maximum_regression_delta
      )}`,
    },
  ];
  const evidenceQualified = evidenceGates.every((gate) => gate.pass);
  const improvementQualified = effectGates.every((gate) => gate.pass);
  const state = !evidenceQualified
    ? 'unqualified'
    : improvementQualified
      ? 'qualified_improvement'
      : 'qualified_no_improvement';
  const claim =
    state === 'qualified_improvement'
      ? 'Structural context improved task success under this exact policy and evidence set.'
      : state === 'qualified_no_improvement'
        ? 'The experiment is qualified, but it does not establish the required improvement.'
        : experiment.evidence_kind === 'synthetic'
          ? 'Synthetic contract fixture only. No real structural-context value claim is authorized.'
          : 'Evidence requirements are incomplete. A structural-context value claim is not authorized.';
  return { state, claim, evidence_gates: evidenceGates, effect_gates: effectGates };
}

export function scoreManifest(data, fixture = DEFAULT_FIXTURE) {
  const { valid, invalid } = buildPairs(data);
  const ab = summarizeAb(valid.ab);
  const aa = summarizeAa(valid.aa);
  const qualification = qualify(data.experiment, ab, aa, invalid);
  return {
    schema_version: 1,
    experiment: {
      id: data.experiment.id,
      title: data.experiment.title,
      evidence_kind: data.experiment.evidence_kind,
      qualification_policy: data.experiment.qualification_policy,
    },
    source_fixture: fixture,
    qualification,
    ab,
    aa,
    invalid_pairs: invalid,
    limitations: data.experiment.limitations ?? [],
  };
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function percent(value) {
  return `${Math.round((value ?? 0) * 1_000) / 10}%`;
}

function signedPercent(value) {
  const rendered = percent(value);
  return value > 0 ? `+${rendered}` : rendered;
}

function renderText(scorecard) {
  const { experiment, qualification, ab, aa, invalid_pairs: invalid } = scorecard;
  return [
    experiment.title,
    '='.repeat(experiment.title.length),
    `Qualification: ${qualification.state}`,
    qualification.claim,
    '',
    `A/B pairs: ${ab.complete_pairs} complete · ${invalid.filter((pair) => pair.comparison === 'ab').length} invalid`,
    `Task success: treatment ${ab.treatment_successes}/${ab.complete_pairs} (${percent(
      ab.treatment_success_rate
    )}) · control ${ab.control_successes}/${ab.complete_pairs} (${percent(
      ab.control_success_rate
    )}) · delta ${signedPercent(ab.success_rate_delta)}`,
    `Paired outcomes: ${ab.treatment_wins} treatment wins · ${ab.control_wins} control wins · ${ab.tie_pass + ab.tie_fail} ties`,
    `Regressions: treatment ${ab.treatment_regressions} · control ${ab.control_regressions} · delta ${signed(
      ab.regression_delta
    )}`,
    `A/A noise: ${aa.discordant_pairs}/${aa.complete_pairs} discordant (${percent(
      aa.discordance_rate
    )})`,
    '',
    'Qualification gates:',
    ...[...qualification.evidence_gates, ...qualification.effect_gates].map(
      (gate) => `- ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id}: ${gate.detail}`
    ),
    '',
    'Tasks:',
    ...ab.pairs.map(
      (pair) =>
        `- ${pair.task_id} trial ${pair.trial_index}: ${pair.outcome} · control=${pair.control.outcome} · treatment=${pair.treatment.outcome}`
    ),
    '',
  ].join('\n');
}

function escapeMarkdown(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function renderMarkdown(scorecard) {
  const { experiment, qualification, ab, aa, invalid_pairs: invalid, limitations } = scorecard;
  const lines = [
    `# ${experiment.title}`,
    '',
    `> **${qualification.state.replaceAll('_', ' ')}:** ${qualification.claim}`,
    '',
    '## Paired outcome',
    '',
    `- Complete A/B pairs: **${ab.complete_pairs}**`,
    `- Treatment success: **${ab.treatment_successes}/${ab.complete_pairs} (${percent(
      ab.treatment_success_rate
    )})**`,
    `- Control success: **${ab.control_successes}/${ab.complete_pairs} (${percent(
      ab.control_success_rate
    )})**`,
    `- Success delta: **${signedPercent(ab.success_rate_delta)}**`,
    `- Treatment wins / control wins / ties: **${ab.treatment_wins} / ${ab.control_wins} / ${
      ab.tie_pass + ab.tie_fail
    }**`,
    `- Regression delta: **${signed(ab.regression_delta)}**`,
    '',
    '## A/A noise',
    '',
    `Discordant pairs: **${aa.discordant_pairs}/${aa.complete_pairs} (${percent(
      aa.discordance_rate
    )})**`,
    '',
    '## Qualification',
    '',
    '| Gate | Result | Detail |',
    '|---|---|---|',
    ...[...qualification.evidence_gates, ...qualification.effect_gates].map(
      (gate) => `| ${gate.id} | ${gate.pass ? 'PASS' : 'FAIL'} | ${escapeMarkdown(gate.detail)} |`
    ),
    '',
    '## Task pairs',
    '',
    '| Task | Trial | Outcome | Control | Treatment | Changed checks |',
    '|---|---:|---|---|---|---|',
    ...ab.pairs.map(
      (pair) =>
        `| ${escapeMarkdown(pair.task_title)} | ${pair.trial_index} | ${pair.outcome} | ${
          pair.control.outcome
        } | ${pair.treatment.outcome} | ${
          pair.check_deltas.map((check) => check.id).join(', ') || '-'
        } |`
    ),
  ];
  if (invalid.length) {
    lines.push(
      '',
      '## Invalid pairs',
      '',
      ...invalid.map((pair) => `- \`${pair.pair_id}\`: ${pair.reasons.join('; ')}`)
    );
  }
  if (limitations.length) {
    lines.push('', '## Limitations', '', ...limitations.map((limitation) => `- ${limitation}`));
  }
  return `${lines.join('\n')}\n`;
}

function html(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function outcomeLabel(outcome) {
  return outcome.replaceAll('_', ' ');
}

function renderDiagnosticRows(diagnostics) {
  const labels = {
    verification_selected: 'Verification selections',
    files_inspected: 'Files inspected',
    files_modified: 'Files modified',
    tool_calls: 'Tool calls',
    input_tokens: 'Input tokens',
    output_tokens: 'Output tokens',
    elapsed_ms: 'Elapsed time (ms)',
    cost_usd: 'Cost (USD)',
  };
  return Object.entries(diagnostics)
    .map(([key, metric]) => {
      const available = metric.delta !== null;
      return `<tr><th scope="row">${html(labels[key] ?? key)}</th><td data-label="Control">${
        available ? html(metric.control) : '<span class="missing">not captured</span>'
      }</td><td data-label="Treatment">${
        available ? html(metric.treatment) : '<span class="missing">not captured</span>'
      }</td><td data-label="Delta">${
        available ? html(signed(metric.delta)) : '—'
      }</td><td data-label="Coverage">${metric.paired_count}/${metric.total_pairs}</td></tr>`;
    })
    .join('');
}

function renderTrace(trace) {
  if (!trace.length) return '<p class="missing">No graph decision trace was captured.</p>';
  return `<ol class="trace">${trace
    .map(
      (entry) =>
        `<li><div><code>${html(entry.tool)}</code><strong>${html(entry.query)}</strong></div><p>${html(
          entry.summary
        )}</p><small>${html(entry.source_paths?.join(' · ') || 'No source paths recorded')}</small></li>`
    )
    .join('')}</ol>`;
}

function renderPair(pair) {
  const changedChecks = pair.check_deltas.length
    ? `<ul class="checks">${pair.check_deltas
        .map(
          (check) =>
            `<li><span>${html(check.label)}</span><span>control: ${html(
              check.control
            )}</span><span>treatment: ${html(check.treatment)}</span></li>`
        )
        .join('')}</ul>`
    : '<p class="missing">No check outcome changed between arms.</p>';
  return `<article class="pair" data-outcome="${html(pair.outcome)}">
    <header>
      <div><span class="pair-index">trial ${pair.trial_index}</span><h3>${html(pair.task_title)}</h3></div>
      <span class="outcome-label">${html(outcomeLabel(pair.outcome))}</span>
    </header>
    <div class="arms" aria-label="Control and treatment outcomes">
      <div><span>without structural context</span><strong>${html(
        outcomeLabel(pair.control.outcome)
      )}</strong><small>${
        pair.control.passed_checks
      }/${pair.control.total_checks} checks</small></div>
      <div class="arrow" aria-hidden="true">→</div>
      <div><span>with structural context</span><strong>${html(
        outcomeLabel(pair.treatment.outcome)
      )}</strong><small>${
        pair.treatment.passed_checks
      }/${pair.treatment.total_checks} checks</small></div>
    </div>
    <div class="pair-details">
      <div><h4>Changed checks</h4>${changedChecks}</div>
      <details><summary>Agent decision trace</summary>${renderTrace(pair.decision_trace)}</details>
    </div>
  </article>`;
}

export function renderHtml(scorecard) {
  const { experiment, qualification, ab, aa, invalid_pairs: invalid, limitations } = scorecard;
  const gates = [...qualification.evidence_gates, ...qualification.effect_gates];
  const embedded = JSON.stringify(scorecard).replaceAll('<', '\\u003c');
  const ties = ab.tie_pass + ab.tie_fail;
  const outcomeComparison =
    ab.complete_pairs === 0
      ? '<div class="empty-outcome"><strong>No valid A/B pairs</strong><p>The comparison is withheld until at least one exact, uncontaminated pair is available.</p></div>'
      : `<div class="corridor">
      <div class="arm"><span class="arm-label">without structural context</span><strong>${percent(
        ab.control_success_rate
      )}</strong><small>${ab.control_successes}/${ab.complete_pairs} successful runs</small></div>
      <div class="versus"><span>VS</span></div>
      <div class="arm"><span class="arm-label">with structural context</span><strong>${percent(
        ab.treatment_success_rate
      )}</strong><small>${ab.treatment_successes}/${ab.complete_pairs} successful runs</small></div>
    </div>
    <div class="delta-line"><span><strong>${signedPercent(
      ab.success_rate_delta
    )}</strong> success delta</span><span><strong>${ab.treatment_wins}</strong> treatment wins</span><span><strong>${ab.control_wins}</strong> control wins</span><span><strong>${ties}</strong> ties</span><span><strong>${signed(
      ab.regression_delta
    )}</strong> regression delta</span></div>
    <p class="claim-tether"><strong>${html(
      outcomeLabel(qualification.state)
    )}</strong> · ${html(experiment.evidence_kind)} receipts · ${html(qualification.claim)}</p>`;
  return `<!doctype html>
<!--
THESIS: Show whether structural context changed executable outcomes; refuse the generic metric-card dashboard.
OWN-WORLD: CodeVetter ink surfaces, warm amber evidence accents, cyan graph traces, exact counts, and hairline structure.
STORY: Read qualification first, compare paired outcomes, inspect changed checks and graph decisions, then verify noise and limitations.
FIRST VIEWPORT: Claim boundary at top; one wide treatment/control outcome corridor beneath it; no navigation or decorative hero.
FORM: A compact evidence brief in the established CodeVetter visual language, shaped directly for a bounded local report.
-->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=">
<title>${html(experiment.title)}</title>
<style>
:root{color-scheme:dark;--canvas:#060708;--surface:#0c0d0f;--raised:#111316;--elevated:#17191d;--text:#f4f4f5;--secondary:#b4b4bc;--muted:#92929d;--line:rgba(255,255,255,.095);--line-strong:rgba(255,255,255,.18);--amber:#f3ad3d;--amber-soft:rgba(243,173,61,.11);--cyan:#67e8f9;--cyan-soft:rgba(103,232,249,.09);--ok:#4ade80;--danger:#fb7185;--radius:14px;--sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,sans-serif;--display:"SF Pro Display",-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;--mono:"SFMono-Regular",ui-monospace,Menlo,Monaco,Consolas,monospace}
*{box-sizing:border-box}
html{background:var(--canvas)}
body{margin:0;background:radial-gradient(880px 520px at 10% -8%,rgba(243,173,61,.075),transparent 62%),var(--canvas);color:var(--text);font:15px/1.55 var(--sans);letter-spacing:-.006em}
main{width:min(1120px,calc(100% - 40px));margin:0 auto;padding:54px 0 88px}
h1,h2,h3,h4,p{margin-top:0}h1,h2,h3{font-family:var(--display);letter-spacing:-.026em}h1{max-width:18ch;margin:.4rem 0 .7rem;font-size:clamp(2.1rem,5.4vw,4.5rem);line-height:.98;font-weight:650}h2{font-size:1.35rem;margin-bottom:.4rem}h3{font-size:1.03rem;margin:0}h4{font-size:.8rem;color:var(--secondary);margin-bottom:.7rem}
a{color:var(--cyan)}code,.mono{font-family:var(--mono)}
.topline{display:flex;align-items:center;justify-content:space-between;gap:20px;color:var(--secondary);font-size:.78rem}.brand{color:var(--amber);font-weight:700}.identity{font-family:var(--mono);overflow-wrap:anywhere}
.intro{padding:34px 0 30px;border-bottom:1px solid var(--line)}.intro-copy{max-width:62ch;color:var(--secondary);font-size:1rem}
.qualification{margin-top:24px;display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:start;padding:18px 20px;border:1px solid var(--line-strong);border-radius:var(--radius);background:linear-gradient(90deg,var(--amber-soft),transparent 62%),var(--surface)}.qualification .state{display:inline-flex;align-items:center;min-height:28px;padding:0 10px;border:1px solid rgba(243,173,61,.38);border-radius:999px;background:rgba(243,173,61,.08);color:var(--amber);font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.045em}.qualification p{max-width:72ch;margin:2px 0 0;color:var(--text);font-weight:560}
.corridor{display:grid;grid-template-columns:1fr auto 1fr;gap:22px;align-items:stretch;margin:34px 0 0}.arm{min-width:0;padding:24px 0}.arm:first-child{text-align:right}.arm-label{display:block;color:var(--secondary);font-size:.78rem}.arm strong{display:block;margin:.2rem 0;font:650 clamp(2.6rem,6vw,5.4rem)/.95 var(--display);letter-spacing:-.055em}.arm small{color:var(--muted)}.versus{display:grid;place-items:center;width:1px;background:var(--line);position:relative}.versus span{position:absolute;padding:7px;background:var(--canvas);color:var(--muted);font:700 .68rem var(--mono);letter-spacing:.06em}
.delta-line{display:flex;flex-wrap:wrap;gap:18px;margin-top:4px;padding:16px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);color:var(--secondary)}.delta-line strong{color:var(--text)}
section{margin-top:52px}.section-head{display:flex;justify-content:space-between;align-items:end;gap:20px;margin-bottom:18px}.section-head p{max-width:62ch;margin:0;color:var(--muted)}
.pair-list{display:grid;gap:12px}.pair{border:1px solid var(--line);border-radius:var(--radius);background:linear-gradient(180deg,rgba(255,255,255,.016),transparent 44%),var(--surface);overflow:hidden}.pair>header{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:16px 18px;border-bottom:1px solid var(--line)}.pair-index{display:block;color:var(--muted);font:600 .75rem/1.45 var(--mono);text-transform:uppercase;letter-spacing:.06em}.outcome-label{flex:none;color:var(--amber);font-size:.75rem;font-weight:700}.pair[data-outcome="control_win"] .outcome-label{color:var(--danger)}.pair[data-outcome^="tie"] .outcome-label{color:var(--secondary)}
.arms{display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:center;padding:17px 18px;background:rgba(255,255,255,.012)}.arms>div:not(.arrow){display:grid;gap:2px}.arms span,.arms small{color:var(--muted);font-size:.75rem}.arms strong{font-size:.9rem}.arrow{color:var(--cyan);font-size:1.1rem}
.pair-details{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;padding:18px}.checks{display:grid;gap:7px;list-style:none;padding:0;margin:0}.checks li{display:grid;grid-template-columns:1fr auto auto;gap:10px;color:var(--secondary);font-size:.75rem}.checks li span:first-child{color:var(--text)}details{border-top:1px solid var(--line)}summary{display:flex;align-items:center;gap:7px;min-height:44px;cursor:pointer;color:var(--cyan);font-weight:650;font-size:.78rem;list-style:none}summary::-webkit-details-marker{display:none}summary::before{content:"▸";font-size:.72rem}details[open] summary::before{content:"▾"}.trace{display:grid;gap:10px;margin:3px 0 0;padding:0 0 10px;list-style:none}.trace li{padding:11px 12px;background:var(--cyan-soft);border-radius:10px}.trace li div{display:flex;gap:9px;align-items:center}.trace code{color:var(--cyan);font-size:.75rem}.trace strong{font-size:.78rem}.trace p{margin:5px 0;color:var(--secondary);font-size:.75rem}.trace small{color:var(--muted);font-family:var(--mono);font-size:.75rem;line-height:1.5;overflow-wrap:anywhere}
.evidence-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);gap:28px}.gates{list-style:none;padding:0;margin:0;border-top:1px solid var(--line)}.gates li{display:grid;grid-template-columns:54px minmax(120px,.65fr) 1fr;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);font-size:.78rem}.gate-pass{color:var(--ok);font-weight:750}.gate-fail{color:var(--danger);font-weight:750}.gates span:last-child{color:var(--muted)}
.noise{padding:20px;border:1px solid var(--line);border-radius:var(--radius);background:var(--raised)}.noise strong{display:block;font:650 2.6rem/1 var(--display);letter-spacing:-.04em}.noise p{margin:10px 0 0;color:var(--secondary);font-size:.83rem}
.table-wrap{border-top:1px solid var(--line)}table{width:100%;border-collapse:collapse;min-width:700px;font-size:.76rem}caption{text-align:left;padding:0 0 12px;color:var(--muted)}th,td{padding:11px 10px;border-bottom:1px solid var(--line);text-align:right}th:first-child,td:first-child{text-align:left}thead th{color:var(--muted);font-weight:600}tbody th{color:var(--secondary);font-weight:560}.missing{color:var(--muted)}
.limits{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding-top:18px;border-top:1px solid var(--line)}.limits ul{margin:0;padding-left:18px;color:var(--secondary)}.limits li+li{margin-top:8px}.invalid{color:var(--danger)}
.empty-outcome{margin-top:24px;padding:24px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}.empty-outcome strong{font-size:1rem}.empty-outcome p{margin:.35rem 0 0;color:var(--secondary)}.claim-tether{margin:12px 0 0;color:var(--secondary);font-size:.78rem}.claim-tether strong{color:var(--amber);text-transform:uppercase;letter-spacing:.045em}.closing-verdict{margin-top:24px;padding:18px 20px;border-left:2px solid var(--amber);background:var(--amber-soft)}.closing-verdict strong{display:block;margin-bottom:4px;color:var(--amber);font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}.closing-verdict p{margin:0;color:var(--text);font-weight:560}
footer{margin-top:56px;padding-top:18px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:18px;color:var(--muted);font-size:.75rem}
:focus-visible{outline:2px solid var(--amber);outline-offset:3px}
@media(max-width:800px){main{width:min(100% - 28px,1120px);padding-top:28px}.topline,.section-head,footer{align-items:flex-start;flex-direction:column}.qualification{grid-template-columns:1fr}.corridor{gap:14px}.arm{padding:20px 0}.pair-details,.evidence-grid,.limits{grid-template-columns:1fr}.checks li{grid-template-columns:1fr}.checks li span:not(:first-child){font-family:var(--mono)}}
@media(max-width:600px){table{display:block;min-width:0}thead{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}tbody{display:grid;gap:10px}tbody tr{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);border-radius:10px;background:var(--surface);overflow:hidden}tbody th{grid-column:1/-1;padding:12px;border-bottom:1px solid var(--line);color:var(--text)}tbody td{display:grid;grid-template-columns:1fr auto;gap:8px;padding:9px 12px;text-align:right;border:0}tbody td::before{content:attr(data-label);color:var(--muted);text-align:left}caption{display:block;padding:0 0 14px}}
@media(max-width:460px){h1{font-size:2.35rem}.corridor{grid-template-columns:1fr}.arm:first-child{text-align:left}.versus{width:100%;height:1px}.arm{padding:10px 0}.delta-line{display:grid;grid-template-columns:1fr 1fr}.arms{grid-template-columns:1fr}.arms .arrow{transform:rotate(90deg);justify-self:start}.pair>header{align-items:flex-start;flex-direction:column}.gates li{grid-template-columns:48px 1fr}.gates li span:last-child{grid-column:2}.qualification{padding:16px}.pair-details{padding:15px}}
@media print{body{background:#fff;color:#111}.qualification,.pair,.noise,.empty-outcome{background:#fff;border-color:#ccc}.intro,.delta-line,.gates li,th,td,footer{border-color:#ddd}.intro-copy,.section-head p,.arm-label,.arm small,.gates span:last-child,.noise p,.limits ul,.missing{color:#444}.arm strong,h1,h2,h3,h4,.checks li span:first-child{color:#111}.outcome-label,.brand,.state,.claim-tether strong,.closing-verdict strong{color:#7b4a00!important}.gate-pass{color:#166534!important}.gate-fail{color:#9f1239!important}.trace li{background:#eef8fa}.trace code,summary{color:#075985}}
</style>
</head>
<body>
<main>
  <div class="topline"><span class="brand">CodeVetter · structural context evaluation</span><span class="identity">${html(
    experiment.id
  )}</span></div>
  <header class="intro">
    <h1>Does the graph help the agent ship better?</h1>
    <p class="intro-copy">The same tasks and agent identity, paired with and without CodeVetter structural context. Executable hidden checks decide success; activity metrics only explain the path.</p>
    <div class="qualification">
      <span class="state">${html(outcomeLabel(qualification.state))}</span>
      <p>${html(qualification.claim)}</p>
    </div>
  </header>

  <section aria-labelledby="outcome-title">
    <div class="section-head"><div><h2 id="outcome-title">Paired outcome</h2><p>${ab.complete_pairs} complete A/B pairs across ${ab.distinct_tasks} tasks.</p></div><p>Success means every required hidden check passed with no recorded regression.</p></div>
    ${outcomeComparison}
  </section>

  <section aria-labelledby="pairs-title">
    <div class="section-head"><div><h2 id="pairs-title">What changed task by task</h2><p>Open a decision trace to see which graph question oriented the treatment arm and which source paths it returned.</p></div></div>
    <div class="pair-list">${ab.pairs.map(renderPair).join('')}</div>
  </section>

  <section class="evidence-grid" aria-labelledby="quality-title">
    <div><div class="section-head"><div><h2 id="quality-title">Can this result be trusted?</h2><p>Qualification is policy-driven. Favorable synthetic numbers still fail the real-evidence gate.</p></div></div>
      <ul class="gates">${gates
        .map(
          (gate) =>
            `<li><span class="${gate.pass ? 'gate-pass' : 'gate-fail'}">${
              gate.pass ? 'PASS' : 'FAIL'
            }</span><strong>${html(gate.id.replaceAll('_', ' '))}</strong><span>${html(
              gate.detail
            )}</span></li>`
        )
        .join('')}</ul></div>
    <aside class="noise" aria-label="A/A noise"><span class="arm-label">A/A discordance</span><strong>${percent(
      aa.discordance_rate
    )}</strong><p>${aa.discordant_pairs} of ${aa.complete_pairs} equivalent pairs disagreed. High disagreement means agent randomness can hide or mimic the graph effect.</p></aside>
  </section>

  <section aria-labelledby="diagnostics-title">
    <div class="section-head"><div><h2 id="diagnostics-title">Activity diagnostics</h2><p>Secondary signals describe cost and search behavior. They never substitute for task success, and missing values remain missing.</p></div></div>
    <div class="table-wrap"><table><caption>Means use only pairs where both arms captured the metric. A negative delta means less activity, not necessarily a better result.</caption><thead><tr><th scope="col">Metric</th><th scope="col">Control</th><th scope="col">Treatment</th><th scope="col">Delta</th><th scope="col">Coverage</th></tr></thead><tbody>${renderDiagnosticRows(
      ab.diagnostics
    )}</tbody></table></div>
  </section>

  <section aria-labelledby="limits-title">
    <div class="section-head"><div><h2 id="limits-title">Boundaries</h2><p>What this artifact does not prove.</p></div></div>
    <div class="limits"><div><h3>Declared limitations</h3><ul>${
      limitations.map((limitation) => `<li>${html(limitation)}</li>`).join('') ||
      '<li>No limitations were declared.</li>'
    }</ul></div><div><h3>Invalid or contaminated pairs</h3>${
      invalid.length
        ? `<ul class="invalid">${invalid
            .map((pair) => `<li>${html(pair.pair_id)}: ${html(pair.reasons.join('; '))}</li>`)
            .join('')}</ul>`
        : '<p class="missing">None detected.</p>'
    }</div></div>
    <div class="closing-verdict"><strong>Authorized claim</strong><p>${html(
      qualification.claim
    )}</p></div>
  </section>

  <footer><span>Local, read-only report · schema v${scorecard.schema_version}</span><span>${html(
    scorecard.source_fixture
  )}</span></footer>
</main>
<script type="application/json" id="codevetter-scorecard">${embedded}</script>
</body>
</html>`;
}

function writeOutput(outPath, content) {
  const absolute = path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

export function run(argv) {
  const args = parseArgs(argv);
  if (!['text', 'json', 'markdown', 'html'].includes(args.format)) {
    throw new Error('--format must be one of: text, json, markdown, html');
  }
  const data = readManifest(args.fixture);
  const errors = validateManifest(data);
  if (errors.length) {
    throw new Error(
      `Invalid structural-context experiment:\n${errors.map((error) => `- ${error}`).join('\n')}`
    );
  }
  const scorecard = scoreManifest(data, args.fixture);
  const rendered =
    args.format === 'json'
      ? `${JSON.stringify(scorecard, null, 2)}\n`
      : args.format === 'markdown'
        ? renderMarkdown(scorecard)
        : args.format === 'html'
          ? renderHtml(scorecard)
          : renderText(scorecard);
  if (args.out) writeOutput(args.out, rendered);
  else process.stdout.write(rendered);
  return scorecard;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
