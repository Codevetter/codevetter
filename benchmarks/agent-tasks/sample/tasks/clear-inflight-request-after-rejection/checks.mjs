import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { loadOnce } = await importTask('request-cache.mjs');

let calls = 0;
let rejectFirst;
const firstLoader = () => {
  calls += 1;
  return new Promise((_resolve, reject) => {
    rejectFirst = reject;
  });
};
const first = loadOnce('profile', firstLoader);
const shared = loadOnce('profile', firstLoader);
rejectFirst(new Error('temporary'));
let observedFailure;
await first.catch((error) => {
  observedFailure = error;
});
await shared.catch(() => {});
await Promise.resolve();
let retry;
try {
  retry = await loadOnce('profile', async () => {
    calls += 1;
    return 'recovered';
  });
} catch {}

const results = [
  {
    id: 'rejected-request-cleared',
    status: calls === 2 && retry === 'recovered' ? 'pass' : 'fail',
  },
  { id: 'pending-request-shared', status: first === shared ? 'pass' : 'fail' },
  {
    id: 'original-failure-preserved',
    status: observedFailure?.message === 'temporary' ? 'pass' : 'fail',
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
