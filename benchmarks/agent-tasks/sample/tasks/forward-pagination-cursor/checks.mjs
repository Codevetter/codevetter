import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { listNext } = await importTask('list-client.ts');

let captured;
const expected = { items: ['next'] };
const client = {
  async list(options) {
    captured = options;
    return expected;
  },
};
const result = await listNext(client, 25, 'cursor-2');

const results = [
  {
    id: 'pagination-cursor-forwarded',
    status: captured.cursor === 'cursor-2' ? 'pass' : 'fail',
  },
  { id: 'pagination-limit-preserved', status: captured.limit === 25 ? 'pass' : 'fail' },
  { id: 'list-response-preserved', status: result === expected ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results: results.sort((left, right) => left.id.localeCompare(right.id)),
  })
);
