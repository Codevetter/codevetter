import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { withQuery } = await importTask('route-state.mjs');

const output = withQuery({ query: 'old', page: 3, filter: 'open' }, 'new');

const results = [
  {
    id: 'route-fields-preserved',
    status: output.page === 3 && output.filter === 'open' ? 'pass' : 'fail',
  },
  { id: 'new-query-applied', status: output.query === 'new' ? 'pass' : 'fail' },
  {
    id: 'route-state-remains-plain',
    status: Object.getPrototypeOf(output) === Object.prototype ? 'pass' : 'fail',
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
