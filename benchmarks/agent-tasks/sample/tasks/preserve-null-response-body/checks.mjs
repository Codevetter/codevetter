import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { responseBody } = await importTask('response-body.ts');

const object = { ok: true };
const explicitNull = responseBody(null);
const objectResult = responseBody(object);
const missing = responseBody(undefined);

const results = [
  { id: 'null-body-preserved', status: explicitNull === null ? 'pass' : 'fail' },
  { id: 'object-identity-preserved', status: objectResult === object ? 'pass' : 'fail' },
  {
    id: 'undefined-body-defaulted',
    status:
      typeof missing === 'object' && missing !== null && Object.keys(missing).length === 0
        ? 'pass'
        : 'fail',
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
