import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { createAutocomplete } = await importTask('autocomplete.mjs');

const autocomplete = createAutocomplete();
let resolveOld;
let resolveNew;
const fetchSuggestions = (query) =>
  new Promise((resolve) => {
    if (query === 'old') resolveOld = resolve;
    else resolveNew = resolve;
  });
const oldRequest = autocomplete.search('old', fetchSuggestions);
const newRequest = autocomplete.search('new', fetchSuggestions);
resolveNew(['new-result']);
const newResult = await newRequest;
resolveOld(['old-result']);
const oldResult = await oldRequest;

const results = [
  {
    id: 'latest-result-retained',
    status: autocomplete.current()[0] === 'new-result' ? 'pass' : 'fail',
  },
  {
    id: 'caller-results-preserved',
    status: newResult[0] === 'new-result' && oldResult[0] === 'old-result' ? 'pass' : 'fail',
  },
  {
    id: 'current-state-readable',
    status: Array.isArray(autocomplete.current()) ? 'pass' : 'fail',
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
