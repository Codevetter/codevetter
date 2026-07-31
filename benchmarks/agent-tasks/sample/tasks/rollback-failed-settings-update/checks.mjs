import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { updateSettings } = await importTask('settings-transaction.mjs');

const failureCalls = [];
const failure = new Error('commit failed');
let observedFailure;
try {
  await updateSettings(
    {
      async write() {
        failureCalls.push('write');
      },
      async commit() {
        failureCalls.push('commit');
        throw failure;
      },
      async rollback() {
        failureCalls.push('rollback');
      },
    },
    { theme: 'dark' }
  );
} catch (error) {
  observedFailure = error;
}
let successRollbacks = 0;
const success = await updateSettings(
  {
    async write() {},
    async commit() {},
    async rollback() {
      successRollbacks += 1;
    },
  },
  { theme: 'light' }
);

const results = [
  {
    id: 'failed-commit-rolled-back',
    status:
      JSON.stringify(failureCalls) === JSON.stringify(['write', 'commit', 'rollback'])
        ? 'pass'
        : 'fail',
  },
  { id: 'original-failure-preserved', status: observedFailure === failure ? 'pass' : 'fail' },
  {
    id: 'successful-update-preserved',
    status: success.saved === true && successRollbacks === 0 ? 'pass' : 'fail',
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
