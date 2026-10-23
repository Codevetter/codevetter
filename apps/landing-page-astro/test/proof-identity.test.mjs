import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('published worked proof stays bound to the exact corpus task', async () => {
  const receipt = JSON.parse(
    await readFile(
      new URL('../public/examples/explicit-false-qualification.json', import.meta.url),
      'utf8'
    )
  );
  const manifest = await readFile(
    new URL(
      '../../../benchmarks/agent-tasks/sample/tasks/preserve-explicit-false/task.json',
      import.meta.url
    )
  );
  assert.equal(receipt.manifest_sha256, createHash('sha256').update(manifest).digest('hex'));
  assert.equal(receipt.qualified, true);
  assert.deepEqual(
    receipt.baseline.attempts.map((a) => a.outcome),
    ['intended_failure', 'intended_failure']
  );
  assert.deepEqual(
    receipt.known_good.attempts.map((a) => a.outcome),
    ['pass', 'pass']
  );
  assert.equal(receipt.cleanup.status, 'complete');
});
