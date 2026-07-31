import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { loadQuery } = await importTask('query-caller.mjs');
const { createAdapter } = await importTask('query-adapter.mjs');

const calls = [];
const expected = { items: ['result'] };
const adapter = createAdapter({
  async get(path, options) {
    calls.push([path, options]);
    return expected;
  },
});
const response = await loadQuery(adapter, '  term  ');
await loadQuery(adapter, 'ready');

const results = [
  {
    id: 'query-normalized-once',
    status: calls[0][1].query === 'term' ? 'pass' : 'fail',
  },
  {
    id: 'search-path-and-response-preserved',
    status: calls[0][0] === '/search' && response === expected ? 'pass' : 'fail',
  },
  {
    id: 'normalized-query-preserved',
    status: calls[1][1].query === 'ready' ? 'pass' : 'fail',
  },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results: results.sort((left, right) => left.id.localeCompare(right.id)),
  })
);
