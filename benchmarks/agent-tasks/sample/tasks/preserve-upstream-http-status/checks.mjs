import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);
const moduleUrl = pathToFileURL(join(workspace, 'response.mjs'));
moduleUrl.searchParams.set('qualification', `${phase}-${attempt}`);
const { normalizeResponse } = await import(moduleUrl.href);

const headers = { 'content-type': 'application/json' };
const body = { error: 'invalid' };
const output = normalizeResponse({ status: 422, headers, body });

const results = [
  { id: 'error-status-preserved', status: output.status === 422 ? 'pass' : 'fail' },
  { id: 'body-preserved', status: output.body === body ? 'pass' : 'fail' },
  { id: 'headers-preserved', status: output.headers === headers ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results,
  })
);
