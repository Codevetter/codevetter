import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runClosedAdapter } from './runner.mjs';

const CODEVETTER_ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('a materialized Node root can reuse an unchanged dependency repository', async (context) => {
  const baseline = await mkdtemp(join(tmpdir(), 'codevetter-dependency-root-'));
  context.after(() => rm(baseline, { recursive: true, force: true }));
  await mkdir(join(baseline, 'apps/desktop'), { recursive: true });
  await Promise.all([
    writeFile(
      join(baseline, 'apps/desktop/package.json'),
      '{"private":true,"type":"module","devDependencies":{"tsx":"*"}}\n'
    ),
    writeFile(
      join(baseline, 'apps/desktop/work.test.ts'),
      [
        "import assert from 'node:assert/strict';",
        "import test from 'node:test';",
        "test('runs baseline work', () => { const value: number = 2 + 2; assert.equal(value, 4); });",
        '',
      ].join('\n')
    ),
  ]);

  const execution = await runClosedAdapter({
    repositoryRoot: baseline,
    dependencyRepositoryRoot: CODEVETTER_ROOT,
    adapter: 'node-test',
    target: 'apps/desktop/work.test.ts',
    name: 'runs baseline work',
    timeoutMs: 10_000,
  });

  assert.equal(execution.status, 'exited', execution.operationalError);
  assert.equal(execution.exitCode, 0, execution.stderr);
  assert.equal(execution.command.executable_identity, 'local:node-test+tsx');
  assert.equal(execution.command.working_directory, 'apps/desktop');
  await assert.rejects(access(join(baseline, 'node_modules')), /ENOENT/);
});
