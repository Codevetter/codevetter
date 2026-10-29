// Consistency checks for the opt-in jsdom study, not authentication or a speed verdict.
export function studyRuntimeErrors(result, modules) {
  return {
    unhandled_errors: result.unhandledErrors.map((error) => error.message),
    module_errors: modules.flatMap((mod) => mod.errors().map((error) => error.message)),
  };
}

export function studyTestReceipt(test) {
  const result = test.result();
  const meta = test.meta();
  return {
    name: test.fullName,
    state: result.state,
    assertions: meta.studyAssertions ?? null,
    run_id: meta.studyRunId ?? null,
    worker_rss_bytes: meta.studyRss ?? null,
    worker_pid: meta.studyPid ?? null,
    errors: (result.errors ?? []).map((error) => error.message),
  };
}

export function qualifyJsdomSelection(row, expected) {
  if (
    row.cancelled ||
    row.collected_only ||
    row.unhandled_errors?.length !== 0 ||
    row.module_errors?.length !== 0 ||
    !row.run_id ||
    !expected.source_identity ||
    !expected.environment ||
    !Array.isArray(row.tests) ||
    !expected.names?.length
  )
    return false;
  const executed = row.tests.filter((test) => test.state !== 'skipped');
  if (executed.length !== expected.names.length) return false;
  if (new Set(executed.map((test) => test.name)).size !== executed.length) return false;
  if (row.source_identity !== expected.source_identity || row.environment !== expected.environment)
    return false;
  return (
    executed.every(
      (test) =>
        expected.names.includes(test.name) &&
        test.state === 'passed' &&
        test.run_id === row.run_id &&
        Number.isInteger(test.assertions) &&
        test.assertions >= 0 &&
        test.errors?.length === 0
    ) && executed.reduce((total, test) => total + test.assertions, 0) > 0
  );
}

export function assertionVector(row) {
  return row.tests
    .filter((test) => test.state !== 'skipped')
    .map((test) => [test.name, test.assertions])
    .sort(([left], [right]) => left.localeCompare(right));
}

export function qualifyLifecycleStudy(report, sourceIdentity) {
  const lifecycle = report.lifecycle;
  if (
    !lifecycle ||
    lifecycle.pairs?.length !== 5 ||
    lifecycle.orphaned?.length !== 0 ||
    lifecycle.default_adoption_qualified !== false
  )
    return false;
  if (!qualifyPreparationInvalidations(lifecycle.warm_preparation_invalidations)) return false;
  if (
    report.expected_names?.length !== 23 ||
    report.assertion_vector?.reduce((sum, [, count]) => sum + count, 0) !== 82
  )
    return false;
  const expected = {
    names: report.expected_names,
    source_identity: sourceIdentity,
    environment: 'node',
  };
  const runs = new Set();
  for (const [index, pair] of lifecycle.pairs.entries()) {
    if (
      pair.pair !== index ||
      JSON.stringify(pair.order) !== JSON.stringify(index % 2 ? ['warm', 'cold'] : ['cold', 'warm'])
    )
      return false;
    for (const arm of ['cold', 'warm']) {
      const row = pair[arm];
      if (!qualifyLifecycleArm(row, expected, report.assertion_vector, `${arm}:${index}`, runs))
        return false;
      runs.add(row.run_id);
    }
    if (pair.cold.orphaned?.length !== 0) return false;
  }
  const warmTotal =
    lifecycle.setup_ms +
    lifecycle.close_ms +
    lifecycle.pairs.reduce((sum, pair) => sum + pair.warm.process_total_ms, 0);
  const coldTotal = lifecycle.pairs.reduce((sum, pair) => sum + pair.cold.process_total_ms, 0);
  return (
    [
      lifecycle.setup_ms,
      lifecycle.close_ms,
      lifecycle.warm_total_ms,
      lifecycle.cold_total_ms,
    ].every((value) => Number.isFinite(value) && value > 0) &&
    Math.abs(warmTotal - lifecycle.warm_total_ms) < 0.000001 &&
    Math.abs(coldTotal - lifecycle.cold_total_ms) < 0.000001
  );
}

function qualifyLifecycleArm(row, expected, vector, label, runs) {
  if (!row || !qualifyJsdomSelection(row, expected)) return false;
  if (JSON.stringify(assertionVector(row)) !== JSON.stringify(vector)) return false;
  if (row.label !== label || runs.has(row.run_id)) return false;
  const memory = row.memory;
  if (!memory?.processes?.some((item) => item.pid === memory.controller_pid)) return false;
  const descendants = memory.processes.filter((item) => item.pid !== memory.controller_pid).length;
  if (
    !row.tests.every(
      (test) =>
        Number.isInteger(test.worker_pid) &&
        memory.processes.some(
          (item) => item.pid === test.worker_pid && item.pid !== memory.controller_pid
        )
    )
  )
    return false;
  return (
    row.process_total_ms > 0 &&
    Number.isFinite(row.process_total_ms) &&
    row.memory?.samples >= 2 &&
    row.memory?.maximum_sampled_tree_rss_bytes > 0 &&
    descendants > 0
  );
}

function qualifyPreparationInvalidations(rows) {
  const paths = ['src/lib/bucket-list-insights.ts', 'vitest.config.ts', 'pnpm-lock.yaml'];
  return (
    Array.isArray(rows) &&
    rows.length === 3 &&
    new Set(rows.map((row) => row.path)).size === 3 &&
    rows.every(
      (row) =>
        paths.includes(row.path) &&
        row.stale_rejected === true &&
        row.capture_run_identity_unchanged === true
    )
  );
}
