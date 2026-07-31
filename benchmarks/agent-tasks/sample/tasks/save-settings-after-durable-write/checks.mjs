import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);
const moduleUrl = pathToFileURL(join(workspace, 'settings.mjs'));
moduleUrl.searchParams.set('qualification', `${phase}-${attempt}`);
const { saveSettings } = await import(moduleUrl.href);

let resolveWrite;
const calls = [];
const store = {
  set(key, value) {
    calls.push([key, value]);
    return new Promise((resolve) => {
      resolveWrite = resolve;
    });
  },
};
let settled = false;
const pending = saveSettings(store, 'theme', { mode: 'dark' }).then((value) => {
  settled = true;
  return value;
});
await Promise.resolve();
const settledBeforeWrite = settled;
resolveWrite();
const result = await pending;

const results = [
  {
    id: 'write-completes-before-return',
    status: settledBeforeWrite === false ? 'pass' : 'fail',
  },
  {
    id: 'storage-arguments-preserved',
    status:
      calls.length === 1 && calls[0][0] === 'theme' && calls[0][1]?.mode === 'dark'
        ? 'pass'
        : 'fail',
  },
  {
    id: 'success-result-preserved',
    status: result?.saved === true ? 'pass' : 'fail',
  },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results,
  })
);
