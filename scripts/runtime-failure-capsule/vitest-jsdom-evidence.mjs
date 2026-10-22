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
