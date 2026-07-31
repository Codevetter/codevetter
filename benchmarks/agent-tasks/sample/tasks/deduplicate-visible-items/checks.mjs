import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { uniqueVisibleItems } = await importTask('visible-items.mjs');

const first = { id: 'a', label: 'first' };
const duplicate = { id: 'a', label: 'duplicate' };
const second = { id: 'b', label: 'second' };
const output = uniqueVisibleItems([first, duplicate, second]);

const results = [
  {
    id: 'duplicate-identifiers-removed',
    status: output.length === 2 && output[0].id !== output[1].id ? 'pass' : 'fail',
  },
  {
    id: 'first-record-preserved',
    status: output[0] === first ? 'pass' : 'fail',
  },
  {
    id: 'original-item-identity-preserved',
    status: output.includes(first) && output.includes(second) ? 'pass' : 'fail',
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
