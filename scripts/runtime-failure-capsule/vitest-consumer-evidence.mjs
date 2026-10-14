// Local study consistency, not authentication of external reports or a speed verdict.
export function qualifyConsumerSelection(row, expected) {
  if (
    row.cancelled ||
    row.collected_only ||
    row.unhandled_errors?.length !== 0 ||
    row.module_errors?.length !== 0
  )
    return false;
  for (const key of ['source_sha256', 'test_sha256', 'environment', 'config_sha256', 'lock_sha256'])
    if (!expected[key] || row[key] !== expected[key]) return false;
  if (JSON.stringify(row.selection) !== JSON.stringify(expected.selection)) return false;
  if (!row.run_id || !Array.isArray(row.tests) || !expected.names?.length) return false;
  const executed = row.tests.filter((test) => test.state !== 'skipped');
  if (executed.length !== expected.names.length) return false;
  if (new Set(executed.map((test) => test.name)).size !== executed.length) return false;
  return executed.every(
    (test) =>
      expected.names.includes(test.name) &&
      test.state === 'passed' &&
      Number.isInteger(test.assertions) &&
      test.assertions > 0 &&
      test.run_id === row.run_id &&
      test.errors?.length === 0
  );
}

export const routeTestNames = [
  ...['/app', '/privacy', '/library', '/login', '/extension'].map(
    (path) => `Reader SPA route boundary > keeps ${path} on the application shell`
  ),
  ...[
    '/',
    '/faq',
    '/changelog',
    '/developer-portal',
    '/.well-known/mcp.json',
    '/oauth2/authorize',
    '/api',
    '/unknown',
    '/reader/one',
    '/rss',
    '/board',
    '/memory',
    '/sample',
  ].map((path) => `Reader SPA route boundary > does not disguise ${path} as an application route`),
];
