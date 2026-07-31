import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);
const moduleUrl = pathToFileURL(join(workspace, 'profiles.ts'));
moduleUrl.searchParams.set('qualification', `${phase}-${attempt}`);
const { loadProfile } = await import(moduleUrl.href);

let calls = 0;
const fetchProfile = async (id) => {
  calls += 1;
  return { id };
};
const [first, second] = await Promise.all([
  loadProfile('profile-1', fetchProfile),
  loadProfile('profile-1', fetchProfile),
]);
const concurrentCalls = calls;
await Promise.resolve();
const third = await loadProfile('profile-1', fetchProfile);

const results = [
  { id: 'concurrent-load-shared', status: concurrentCalls === 1 ? 'pass' : 'fail' },
  {
    id: 'profile-value-preserved',
    status:
      first?.id === 'profile-1' && second?.id === 'profile-1' && third?.id === 'profile-1'
        ? 'pass'
        : 'fail',
  },
  {
    id: 'settled-load-restarts',
    status: calls === concurrentCalls + 1 ? 'pass' : 'fail',
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
