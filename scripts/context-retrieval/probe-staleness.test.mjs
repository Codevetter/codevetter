import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classify, OUTCOMES, runForSignal } from './probe-staleness.mjs';

test('nonzero query exits survive into staleness classification', () => {
  const result = runForSignal('/bin/sh', ['-c', 'echo "index is stale" >&2; exit 2']);

  assert.equal(result.exitCode, 2);
  assert.match(result.output, /index is stale/);
  assert.equal(
    classify({
      ...result,
      deletedPath: 'src/deleted.ts',
      holdsIndex: true,
    }),
    OUTCOMES.WARNED
  );
});

test('missing query commands remain unavailable', () => {
  const result = runForSignal('/definitely/missing/codevetter-command', []);
  assert.deepEqual(result, { output: null, exitCode: null });
  assert.equal(
    classify({ ...result, deletedPath: 'src/deleted.ts', holdsIndex: true }),
    OUTCOMES.UNAVAILABLE
  );
});
