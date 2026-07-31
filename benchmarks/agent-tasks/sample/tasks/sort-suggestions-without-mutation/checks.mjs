import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);
const moduleUrl = pathToFileURL(join(workspace, 'suggestions.mjs'));
moduleUrl.searchParams.set('qualification', `${phase}-${attempt}`);
const { sortSuggestions } = await import(moduleUrl.href);

const low = { id: 'low', score: 1 };
const high = { id: 'high', score: 9 };
const input = [low, high];
const output = sortSuggestions(input);

const results = [
  {
    id: 'input-order-preserved',
    status: input[0] === low && input[1] === high ? 'pass' : 'fail',
  },
  {
    id: 'descending-order-preserved',
    status: output[0] === high && output[1] === low ? 'pass' : 'fail',
  },
  {
    id: 'suggestion-identity-preserved',
    status: output.includes(low) && output.includes(high) ? 'pass' : 'fail',
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
