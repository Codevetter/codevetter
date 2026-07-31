import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { proxyResponse } = await importTask('proxy-response.mjs');

const body = { error: 'rate-limited' };
const output = proxyResponse({
  status: 429,
  headers: { 'content-type': 'application/json', 'retry-after': '30' },
  body,
});

const results = [
  {
    id: 'retry-after-preserved',
    status: output.headers['retry-after'] === '30' ? 'pass' : 'fail',
  },
  {
    id: 'status-and-content-type-preserved',
    status:
      output.status === 429 && output.headers['content-type'] === 'application/json'
        ? 'pass'
        : 'fail',
  },
  { id: 'response-body-preserved', status: output.body === body ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results: results.sort((left, right) => left.id.localeCompare(right.id)),
  })
);
