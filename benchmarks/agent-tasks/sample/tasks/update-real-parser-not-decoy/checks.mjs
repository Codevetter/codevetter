import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function importTask(path) {
  const url = pathToFileURL(join(workspace, path));
  url.searchParams.set('qualification', `${phase}-${attempt}`);
  return import(url.href);
}

const { parseLimit } = await importTask('config-parser.ts');

const zero = parseLimit('0', 25);
const positive = parseLimit('12', 25);
const invalid = parseLimit('invalid', 25);
const decoy = await readFile(join(workspace, 'config-preview.ts'), 'utf8');
const expectedDecoy =
  'export function previewLimit(value: string, fallback: number): string {\n  return String(Number(value) || fallback);\n}\n';

const results = [
  { id: 'zero-config-value-preserved', status: zero === 0 ? 'pass' : 'fail' },
  {
    id: 'parser-fallback-preserved',
    status: positive === 12 && invalid === 25 ? 'pass' : 'fail',
  },
  {
    id: 'lookalike-decoy-unchanged',
    status: decoy === expectedDecoy ? 'pass' : 'fail',
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
