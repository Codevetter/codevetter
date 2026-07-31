import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { nextQuery } = await importTask('search-state.mjs');

const cleared = nextQuery('', 'previous');
const missing = nextQuery(null, 'previous');
const entered = nextQuery('new', 'previous');

const results = [
  { id: 'empty-query-preserved', status: cleared === '' ? 'pass' : 'fail' },
  { id: 'missing-query-falls-back', status: missing === 'previous' ? 'pass' : 'fail' },
  { id: 'entered-query-preserved', status: entered === 'new' ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results: results.sort((left, right) => left.id.localeCompare(right.id)),
  })
);
