import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);
const moduleUrl = pathToFileURL(join(workspace, 'access.ts'));
moduleUrl.searchParams.set('qualification', `${phase}-${attempt}`);
const { canAccess } = await import(moduleUrl.href);

const crossTenant = canAccess(
  { id: 'user-1', tenantId: 'tenant-a', role: 'member' },
  { ownerId: 'user-1', tenantId: 'tenant-b' }
);
const sameTenantOwner = canAccess(
  { id: 'user-1', tenantId: 'tenant-a', role: 'member' },
  { ownerId: 'user-1', tenantId: 'tenant-a' }
);
const sameTenantAdmin = canAccess(
  { id: 'admin-1', tenantId: 'tenant-a', role: 'admin' },
  { ownerId: 'user-2', tenantId: 'tenant-a' }
);

const results = [
  { id: 'cross-tenant-owner-denied', status: crossTenant === false ? 'pass' : 'fail' },
  { id: 'same-tenant-admin-allowed', status: sameTenantAdmin === true ? 'pass' : 'fail' },
  { id: 'same-tenant-owner-allowed', status: sameTenantOwner === true ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results,
  })
);
