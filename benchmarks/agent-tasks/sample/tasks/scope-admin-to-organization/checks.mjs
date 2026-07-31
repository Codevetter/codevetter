import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { canManage } = await importTask('organization-access.ts');

const crossOrganization = canManage(
  { organizationId: 'org-a', role: 'admin' },
  { organizationId: 'org-b' }
);
const sameOrganization = canManage(
  { organizationId: 'org-a', role: 'admin' },
  { organizationId: 'org-a' }
);
const member = canManage({ organizationId: 'org-a', role: 'member' }, { organizationId: 'org-a' });

const results = [
  {
    id: 'cross-organization-admin-denied',
    status: crossOrganization === false ? 'pass' : 'fail',
  },
  {
    id: 'same-organization-admin-allowed',
    status: sameOrganization === true ? 'pass' : 'fail',
  },
  { id: 'member-remains-denied', status: member === false ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results: results.sort((left, right) => left.id.localeCompare(right.id)),
  })
);
