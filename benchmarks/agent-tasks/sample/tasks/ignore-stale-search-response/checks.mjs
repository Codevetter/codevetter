import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { applySearchResponse } = await importTask('search-results.ts');

const state = { requestId: 2, query: 'current', items: ['current'] };
const stale = applySearchResponse(state, { requestId: 1, items: ['stale'] });
const current = applySearchResponse(state, { requestId: 2, items: ['fresh'] });

const results = [
  {
    id: 'stale-response-ignored',
    status: stale === state && stale.items[0] === 'current' ? 'pass' : 'fail',
  },
  {
    id: 'current-response-applied',
    status: current.items[0] === 'fresh' ? 'pass' : 'fail',
  },
  { id: 'active-query-preserved', status: current.query === 'current' ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results: results.sort((left, right) => left.id.localeCompare(right.id)),
  })
);
