import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { isRetryCount } = await importTask('retry-count.mjs');

const nan = isRetryCount(Number.NaN);
const zero = isRetryCount(0);
const positive = isRetryCount(3);
const text = isRetryCount('3');

const results = [
  { id: 'nan-rejected', status: nan === false ? 'pass' : 'fail' },
  {
    id: 'integer-counts-accepted',
    status: zero === true && positive === true ? 'pass' : 'fail',
  },
  { id: 'text-count-rejected', status: text === false ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results: results.sort((left, right) => left.id.localeCompare(right.id)),
  })
);
