import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { canRead } = await importTask('workspace-access.mjs');

const actor = {
  workspaceId: 'workspace-a',
  sharedIds: ['shared-1'],
};
const crossWorkspace = canRead(actor, {
  workspaceId: 'workspace-b',
  sharedId: 'shared-1',
});
const sameWorkspace = canRead(actor, {
  workspaceId: 'workspace-a',
  sharedId: 'shared-1',
});
const unknown = canRead(actor, {
  workspaceId: 'workspace-a',
  sharedId: 'shared-2',
});

const results = [
  {
    id: 'cross-workspace-share-denied',
    status: crossWorkspace === false ? 'pass' : 'fail',
  },
  {
    id: 'same-workspace-share-allowed',
    status: sameWorkspace === true ? 'pass' : 'fail',
  },
  { id: 'unknown-share-denied', status: unknown === false ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results: results.sort((left, right) => left.id.localeCompare(right.id)),
  })
);
