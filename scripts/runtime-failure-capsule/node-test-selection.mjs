export const NODE_SELECTION_PREFIX = 'CODEVETTER_NODE_TEST_SELECTION=';
export const NODE_SELECTION_SCHEMA = 'codevetter.node-test-selection/v1';
const COUNTS = ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo'];

export function parseNodeTestSelection(output, scope) {
  if (!scope || typeof scope.target !== 'string') return null;
  const lines = String(output).trimEnd().split('\n');
  const records = lines.filter((line) => line.startsWith(NODE_SELECTION_PREFIX));
  if (records.length !== 1 || records[0] !== lines.at(-1) || records[0].length > 8192) return null;
  let report;
  try {
    report = JSON.parse(records[0].slice(NODE_SELECTION_PREFIX.length));
  } catch {
    return null;
  }
  if (
    report?.schema_version !== NODE_SELECTION_SCHEMA ||
    report.complete !== true ||
    report.name !== (scope.name ?? null) ||
    report.target !== scope.target ||
    typeof report.success !== 'boolean' ||
    !validCounts(report.counts) ||
    !validCounts(report.observed) ||
    !validCounts(report.matched) ||
    !COUNTS.every((key) => report.counts[key] === report.observed[key]) ||
    !COUNTS.every((key) => report.matched[key] <= report.counts[key])
  )
    return null;
  return {
    ...report,
    total_tests: report.counts.tests,
    executed_tests: report.counts.passed + report.counts.failed,
    failed_tests: report.counts.failed,
  };
}

export function nodeTestSelectionExecuted(selection, name, { allowFailed = false } = {}) {
  if (!selection || selection.name !== (name ?? null) || selection.complete !== true) return false;
  if (selection.counts.cancelled > 0) return false;
  const selected = selection.matched;
  if (name && selected.tests !== 1) return false;
  if (selected.cancelled > 0 || selected.skipped > 0 || selected.todo > 0) {
    // An unnamed file can contain intentionally skipped cases, but still needs
    // a completed body. A named selection must identify one completed case.
    if (name) return false;
  }
  if (allowFailed) return selected.passed + selected.failed > 0;
  return (
    selection.success &&
    selection.counts.failed === 0 &&
    selection.counts.cancelled === 0 &&
    selected.failed === 0 &&
    selected.passed > 0
  );
}

function validCounts(counts) {
  return (
    counts &&
    COUNTS.every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0) &&
    counts.tests === COUNTS.slice(1).reduce((total, key) => total + counts[key], 0)
  );
}
