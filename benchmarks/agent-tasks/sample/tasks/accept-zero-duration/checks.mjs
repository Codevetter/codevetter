import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { isDuration } = await importTask('duration.ts');

const zero = isDuration(0);
const positive = isDuration(250);
const negative = isDuration(-1);
const text = isDuration('0');

const results = [
  { id: 'zero-duration-accepted', status: zero === true ? 'pass' : 'fail' },
  { id: 'positive-duration-accepted', status: positive === true ? 'pass' : 'fail' },
  {
    id: 'invalid-durations-rejected',
    status: negative === false && text === false ? 'pass' : 'fail',
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
