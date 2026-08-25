import assert from 'node:assert/strict';
import { test } from 'node:test';

import { freeMemoryMb, guardMemory } from './probe-candidates.mjs';

test('unknown memory fails closed instead of disabling the guard', () => {
  const free = freeMemoryMb({
    exec: () => {
      throw new Error('unsupported');
    },
  });

  assert.equal(free, null);
  assert.deepEqual(guardMemory({ minFreeMb: 2048, freeMemory: () => free }), {
    free_mb: null,
    ok: false,
    minimum_mb: 2048,
  });
});

test('an explicit zero threshold bypasses the memory guard for hermetic tests', () => {
  assert.deepEqual(
    guardMemory({
      minFreeMb: 0,
      freeMemory: () => {
        throw new Error('must not be called');
      },
    }),
    { free_mb: null, ok: true, minimum_mb: 0 }
  );
});
