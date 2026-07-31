import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { persistValue } = await importTask('transaction.ts');

const calls = [];
let finishCommit;
const transaction = {
  async write(value) {
    calls.push(['write', value]);
  },
  commit() {
    calls.push(['commit']);
    return new Promise((resolve) => {
      finishCommit = resolve;
    });
  },
};
let settled = false;
const pending = persistValue(transaction, 'value-1').then((result) => {
  settled = true;
  return result;
});
await Promise.resolve();
await Promise.resolve();
const settledBeforeCommit = settled;
finishCommit();
const result = await pending;

const results = [
  {
    id: 'commit-completes-before-success',
    status: settledBeforeCommit === false ? 'pass' : 'fail',
  },
  {
    id: 'write-order-preserved',
    status:
      JSON.stringify(calls) === JSON.stringify([['write', 'value-1'], ['commit']])
        ? 'pass'
        : 'fail',
  },
  { id: 'commit-result-preserved', status: result.committed === true ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results: results.sort((left, right) => left.id.localeCompare(right.id)),
  })
);
