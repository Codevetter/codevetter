import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [workspace] = process.argv.slice(2);
const transformerPath = join(workspace, 'transformer.mjs');
const before = await readFile(transformerPath, 'utf8');
const after = before.replace('input.enabled || true', 'input.enabled ?? true');

if (after === before) {
  process.stderr.write('Expected synthetic defect was not present.\n');
  process.exitCode = 2;
} else {
  await writeFile(transformerPath, after);
  process.stdout.write(`FIXTURE_TOKEN=${process.env.FIXTURE_TOKEN}\nSynthetic repair complete.\n`);
}
