import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const [workspace, taskId, acceptanceSha256, phase, attempt] = process.argv.slice(2);

async function listFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, path)));
    } else if (entry.isFile()) {
      files.push(relative(root, path));
    }
  }
  return files.sort();
}

const moduleUrl = pathToFileURL(join(workspace, 'transformer.mjs'));
moduleUrl.searchParams.set('qualification', `${phase}-${attempt}`);
const { transform } = await import(moduleUrl.href);
const input = { enabled: false, label: 'Keep the explicit false value' };
const output = transform(input);
const files = await listFiles(workspace);

process.stdout.write(
  JSON.stringify({
    schema_version: 'codevetter.agent-task-check-result.v1',
    task_id: taskId,
    acceptance_contract_sha256: acceptanceSha256,
    results: [
      {
        id: 'explicit-false-preserved',
        status: output.enabled === false ? 'pass' : 'fail',
      },
      {
        id: 'label-preserved',
        status: output.label === input.label ? 'pass' : 'fail',
      },
      {
        id: 'public-inputs-only',
        status:
          JSON.stringify(files) === JSON.stringify(['TASK.md', 'transformer.mjs'])
            ? 'pass'
            : 'fail',
      },
    ],
  })
);
