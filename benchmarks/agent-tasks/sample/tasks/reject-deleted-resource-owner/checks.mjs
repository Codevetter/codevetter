import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { canEdit } = await importTask('edit-access.mjs');

const deletedOwner = canEdit('user-1', { ownerId: 'user-1', deleted: true });
const activeOwner = canEdit('user-1', { ownerId: 'user-1', deleted: false });
const nonOwner = canEdit('user-2', { ownerId: 'user-1', deleted: false });

const results = [
  { id: 'deleted-owner-denied', status: deletedOwner === false ? 'pass' : 'fail' },
  { id: 'active-owner-allowed', status: activeOwner === true ? 'pass' : 'fail' },
  { id: 'non-owner-denied', status: nonOwner === false ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results: results.sort((left, right) => left.id.localeCompare(right.id)),
  })
);
