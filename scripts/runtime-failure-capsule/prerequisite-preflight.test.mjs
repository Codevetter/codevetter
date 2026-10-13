import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { preflightAdapter } from './runner.mjs';

test('preflight retains unavailable runners and never loads project or runner code', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-preflight-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'target.test.mjs'), 'throw new Error("project must not execute");');
  const input = { repositoryRoot: root, target: 'target.test.mjs', adapter: 'vitest' };
  assert.equal((await preflightAdapter(input)).status, 'unavailable');
  await mkdir(join(root, 'node_modules/vitest'), { recursive: true });
  await writeFile(join(root, 'node_modules/vitest/vitest.mjs'), 'throw new Error("runner must not execute");');
  assert.equal((await preflightAdapter(input)).status, 'ready');
  assert.equal((await preflightAdapter({ ...input, adapter: 'node-test' })).status, 'ready');
  assert.equal((await preflightAdapter({ ...input, target: 'missing.mjs' })).status, 'unavailable');
  assert.equal((await preflightAdapter({ ...input, adapter: 'unsupported' })).status, 'unavailable');
});
