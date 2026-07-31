import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { normalizedLimit } = await importTask('pagination-options.ts');

const zero = normalizedLimit(0, 25);
const positive = normalizedLimit(10, 25);
const missing = normalizedLimit(null, 25);

const results = [
  { id: 'zero-limit-preserved', status: zero === 0 ? 'pass' : 'fail' },
  { id: 'positive-limit-preserved', status: positive === 10 ? 'pass' : 'fail' },
  { id: 'null-limit-falls-back', status: missing === 25 ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results: results.sort((left, right) => left.id.localeCompare(right.id)),
  })
);
