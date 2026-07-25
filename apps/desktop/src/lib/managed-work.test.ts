import assert from 'node:assert/strict';
import test from 'node:test';

import {
  intentClosureEvidenceLabel,
  managedRunCanRecover,
  managedRunStatusLabel,
} from './managed-work';

const run = {
  id: 'managed-run:1',
  workItemId: 'task-1',
  provider: 'codex' as const,
  profileId: 'profile-1',
  profilePath: '/Users/example/.codex',
  repoPath: '/repo',
  baseRevision: 'abc',
  worktreePath: '/tmp/worktree',
  worktreeBranch: 'codevetter/managed-1',
  ownerToken: 'owner-1',
  ports: [],
  terminalId: null,
  providerSessionId: null,
  processId: null,
  processStartedAt: null,
  state: 'disconnected',
  currentCheckpointId: null,
  changeIdentity: 'change-1',
  disconnectedReason: 'provider process ended',
  createdAt: '2026-07-25T00:00:00Z',
  updatedAt: '2026-07-25T00:00:00Z',
};

test('only planned and disconnected managed runs offer recovery', () => {
  assert.equal(managedRunCanRecover(run), true);
  assert.equal(managedRunCanRecover({ ...run, state: 'running' }), false);
});

test('managed status names the disconnected recovery reason', () => {
  assert.equal(managedRunStatusLabel(run), 'Disconnected · provider process ended');
  assert.equal(
    managedRunStatusLabel({
      ...run,
      state: 'checking',
      disconnectedReason: null,
      currentCheckpointId: 'checkpoint-1',
    }),
    'Check running'
  );
});

test('intent closure presentation never hides stale evidence', () => {
  const receipt = {
    id: 'closure-1',
    workItemId: 'task-1',
    goalVersion: 1,
    goalText: 'Finish the work',
    acceptanceCriteria: ['Checks pass'],
    provider: 'codex',
    sessionId: null,
    managedRunId: run.id,
    changeIdentity: 'change-1',
    reviewId: null,
    verificationRunId: null,
    disposition: 'satisfied' as const,
    reason: 'Checks passed',
    stale: true,
    staleReason: 'change advanced',
    createdAt: '2026-07-25T00:00:00Z',
  };
  assert.equal(intentClosureEvidenceLabel(receipt), 'satisfied · stale after the change advanced');
});
