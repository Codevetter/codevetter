import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { resolvedPage } = await importTask('pagination.ts');

const first = resolvedPage(0, 4);
const positive = resolvedPage(3, 4);
const missing = resolvedPage(null, 4);

const results = [
  { id: 'zero-page-preserved', status: first === 0 ? 'pass' : 'fail' },
  { id: 'positive-page-preserved', status: positive === 3 ? 'pass' : 'fail' },
  { id: 'missing-page-falls-back', status: missing === 4 ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results: results.sort((left, right) => left.id.localeCompare(right.id)),
  })
);
