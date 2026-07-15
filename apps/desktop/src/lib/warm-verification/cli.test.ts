import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCli } from './cli';

describe('verify CLI change-set selection', () => {
  it('defaults changed verification to the complete worktree', () => {
    assert.deepEqual(parseCli(['changed']).changeSetRequest, { kind: 'worktree' });
  });

  it('preserves staged, commit, and range requests', () => {
    assert.deepEqual(parseCli(['changed', '--staged']).changeSetRequest, { kind: 'staged' });
    assert.deepEqual(parseCli(['changed', '--commit', 'HEAD~1']).changeSetRequest, {
      kind: 'commit',
      revision: 'HEAD~1',
    });
    assert.deepEqual(parseCli(['changed', '--range', 'main..HEAD']).changeSetRequest, {
      kind: 'range',
      revision: 'main..HEAD',
    });
  });

  it('rejects ambiguous or daemon-only change-set options', () => {
    assert.throws(() => parseCli(['changed', '--staged', '--commit', 'HEAD']));
    assert.throws(() => parseCli(['daemon', 'status', '--staged']));
    assert.throws(() => parseCli(['changed', '--commit']));
    assert.throws(() => parseCli(['changed', '--range']));
  });
});
