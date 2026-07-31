import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { fetchReport } = await importTask('request-client.mjs');

let capturedPath;
let capturedOptions;
const expected = { id: 'report-7' };
const client = {
  async get(path, options) {
    capturedPath = path;
    capturedOptions = options;
    return expected;
  },
};
const result = await fetchReport(client, 'report-7', 1500);

const results = [
  {
    id: 'request-timeout-forwarded',
    status: capturedOptions?.timeoutMs === 1500 ? 'pass' : 'fail',
  },
  {
    id: 'report-path-preserved',
    status: capturedPath === '/reports/report-7' ? 'pass' : 'fail',
  },
  { id: 'report-response-preserved', status: result === expected ? 'pass' : 'fail' },
];

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results: results.sort((left, right) => left.id.localeCompare(right.id)),
  })
);
