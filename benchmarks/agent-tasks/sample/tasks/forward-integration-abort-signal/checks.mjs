import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);
const moduleUrl = pathToFileURL(join(workspace, 'issue-client.ts'));
moduleUrl.searchParams.set('qualification', `${phase}-${attempt}`);
const { fetchIssue } = await import(moduleUrl.href);

const controller = new AbortController();
const expected = { id: 42 };
let capturedPath;
let capturedOptions;
const client = {
  async get(path, options) {
    capturedPath = path;
    capturedOptions = options;
    return expected;
  },
};
const response = await fetchIssue(client, 42, controller.signal);

const results = [
  {
    id: 'abort-signal-forwarded',
    status: capturedOptions?.signal === controller.signal ? 'pass' : 'fail',
  },
  { id: 'issue-path-preserved', status: capturedPath === '/issues/42' ? 'pass' : 'fail' },
  { id: 'response-preserved', status: response === expected ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results,
  })
);
