import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { activeSelection } = await importTask('selection.ts');

const selection = { id: 'item-1', label: 'Selected' };
const active = activeSelection(selection);
const empty = activeSelection(null);

const results = [
  {
    id: 'selection-identity-preserved',
    status: active === selection ? 'pass' : 'fail',
  },
  {
    id: 'selection-fields-preserved',
    status: active?.id === 'item-1' && active?.label === 'Selected' ? 'pass' : 'fail',
  },
  { id: 'null-selection-preserved', status: empty === null ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results: results.sort((left, right) => left.id.localeCompare(right.id)),
  })
);
