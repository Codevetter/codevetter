import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);
const moduleUrl = pathToFileURL(join(workspace, 'scroll-state.ts'));
moduleUrl.searchParams.set('qualification', `${phase}-${attempt}`);
const { restoredScrollY } = await import(moduleUrl.href);

const zero = restoredScrollY({ y: 0 }, 120);
const positive = restoredScrollY({ y: 48 }, 120);
const missing = restoredScrollY({ y: null }, 120);

const results = [
  { id: 'zero-position-restored', status: zero === 0 ? 'pass' : 'fail' },
  { id: 'missing-position-falls-back', status: missing === 120 ? 'pass' : 'fail' },
  { id: 'positive-position-restored', status: positive === 48 ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results,
  })
);
