import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  createPlan,
  createReceipt,
  loadConfig,
  planIdentity,
  redactText,
  resolveGitChange,
  schedulePlan,
  executeLane,
  validatePlan,
  validateReceipt,
} from './core.mjs';

const hash = 'a'.repeat(64);
const resources = (overrides = {}) => ({
  cpuSlots: 0,
  memoryMb: 1,
  browserContexts: 0,
  originTokens: 0,
  ...overrides,
});

test('contract validation rejects malformed and incomplete passing evidence', () => {
  assert.deepEqual(validatePlan({}), [
    'unsupported schemaVersion',
    'invalid change mode',
    'invalid change identity',
    'invalid changed paths',
    'invalid profile',
    'invalid lanes',
    'missing explanations',
  ]);
  assert.ok(
    validateReceipt({
      schemaVersion: '1.0.0',
      planIdentity: hash,
      verdict: 'passed',
      complete: false,
      lanes: [],
    }).includes('incomplete receipt cannot pass')
  );
});

test('redaction removes common credentials and bounds output', () => {
  assert.equal(redactText('token=hello password:world'), 'token=[REDACTED] password:[REDACTED]');
  assert.ok(Buffer.byteLength(redactText('x'.repeat(400_000))) <= 256 * 1024);
});

test('plan identity is stable across object key order and changes with nested content', () => {
  const a = { schemaVersion: '1.0.0', change: { identity: hash, paths: ['a'] } };
  const b = { change: { paths: ['a'], identity: hash }, schemaVersion: '1.0.0' };
  assert.equal(planIdentity(a), planIdentity(b));
  assert.equal(planIdentity({ ...a, createdAt: 'one' }), planIdentity({ ...a, createdAt: 'two' }));
  assert.notEqual(planIdentity(a), planIdentity({ ...b, change: { ...b.change, paths: ['b'] } }));
});

test('authoritative frontend mapping stays focused and explains omissions', async () => {
  const config = await loadConfig();
  const plan = createPlan({
    config,
    change: {
      mode: 'worktree',
      revision: 'head',
      identity: hash,
      paths: ['apps/desktop/src/pages/Home.tsx'],
    },
  });
  assert.equal(plan.focused, true);
  assert.deepEqual(
    plan.lanes.map((lane) => lane.id),
    ['typecheck', 'lint', 'browser-ui']
  );
  assert.ok(plan.omissions.some((entry) => entry.lane === 'rust-lib'));
  assert.deepEqual(validatePlan(plan), []);
});

test('shared, unmatched, and stale impact evidence widen to exhaustive fallback', async () => {
  const config = await loadConfig();
  for (const input of [
    { paths: ['pnpm-lock.yaml'], hints: [] },
    { paths: ['unknown/file.xyz'], hints: [] },
    {
      paths: ['apps/desktop/src/pages/Home.tsx'],
      hints: [{ state: 'stale', sourceIdentity: hash, laneId: 'rust-lib' }],
    },
  ]) {
    const plan = createPlan({
      config,
      change: { mode: 'worktree', revision: 'head', identity: hash, paths: input.paths },
      hints: input.hints,
    });
    assert.equal(plan.focused, false);
    const selected = new Set(plan.lanes.map((lane) => lane.id));
    assert.ok(config.fallbackLanes.every((laneId) => selected.has(laneId)));
  }
});

test('current additive impact evidence can add but never remove work', async () => {
  const config = await loadConfig();
  const plan = createPlan({
    config,
    change: {
      mode: 'worktree',
      revision: 'head',
      identity: hash,
      paths: ['apps/desktop/src/pages/Home.tsx'],
    },
    hints: [{ state: 'current', sourceIdentity: hash, laneId: 'rust-lib', source: 'graph' }],
  });
  assert.ok(plan.lanes.some((lane) => lane.id === 'rust-lib'));
  assert.ok(plan.lanes.some((lane) => lane.id === 'browser-ui'));
});

test('shell-free Git resolution includes tracked and untracked worktree paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cv-verify-'));
  git(root, ['init']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  await writeFile(join(root, 'tracked.ts'), 'one\n');
  git(root, ['add', 'tracked.ts']);
  git(root, ['commit', '-m', 'initial']);
  await writeFile(join(root, 'tracked.ts'), 'two\n');
  await writeFile(join(root, 'new.ts'), 'new\n');
  const change = resolveGitChange(root);
  assert.deepEqual(change.paths, ['new.ts', 'tracked.ts']);
  assert.match(change.identity, /^[a-f0-9]{64}$/);
  await writeFile(join(root, 'new.ts'), 'changed\n');
  assert.notEqual(resolveGitChange(root).identity, change.identity);
  git(root, ['add', 'tracked.ts']);
  assert.deepEqual(resolveGitChange(root, { staged: true }).paths, ['tracked.ts']);
  const initial = gitOutput(root, ['rev-parse', 'HEAD']).trim();
  git(root, ['add', 'new.ts']);
  git(root, ['commit', '-m', 'second']);
  const current = gitOutput(root, ['rev-parse', 'HEAD']).trim();
  assert.deepEqual(resolveGitChange(root, { commit: current }).paths, ['new.ts', 'tracked.ts']);
  assert.deepEqual(resolveGitChange(root, { range: `${initial}..${current}` }).paths, [
    'new.ts',
    'tracked.ts',
  ]);
  assert.throws(() => resolveGitChange(root, { commit: '--help' }), /Invalid commit/);
});

test('resource scheduler overlaps independent waits but serializes CPU and exclusive state', async () => {
  const events = [];
  const plan = {
    lanes: [
      { id: 'a', resources: resources({ browserContexts: 1, originTokens: 1 }) },
      { id: 'b', resources: resources({ browserContexts: 1, originTokens: 1 }) },
      { id: 'c', resources: resources({ cpuSlots: 1, exclusiveState: 'cargo' }) },
      { id: 'd', resources: resources({ cpuSlots: 1, exclusiveState: 'cargo' }) },
    ],
  };
  const results = await schedulePlan(
    plan,
    { maxConcurrent: 2, cpuSlots: 1, memoryMb: 4, browserContexts: 2, originTokens: 2 },
    async (lane) => {
      events.push(`start:${lane.id}`);
      await new Promise((resolve) => setTimeout(resolve, 15));
      events.push(`end:${lane.id}`);
      return { id: lane.id, status: 'passed', wallMs: 15, cpuMs: 0, peakRssBytes: 0, output: '' };
    }
  );
  assert.deepEqual(
    results.map((result) => result.id),
    ['a', 'b', 'c', 'd']
  );
  assert.ok(events.indexOf('start:b') < events.indexOf('end:a'));
  assert.ok(events.indexOf('start:d') > events.indexOf('end:c'));
});

test('scheduler releases resources after cancellation and subprocess output is redacted', async () => {
  const controller = new AbortController();
  const plan = { lanes: [{ id: 'wait', resources: resources({ cpuSlots: 1 }) }] };
  const pending = schedulePlan(
    plan,
    { maxConcurrent: 1, cpuSlots: 1, memoryMb: 2, browserContexts: 0, originTokens: 0 },
    async (_lane, { signal }) => {
      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    controller.signal
  );
  setTimeout(() => controller.abort(new Error('stop')), 5);
  const cancelled = await pending;
  assert.equal(cancelled[0].status, 'failed');

  const lane = {
    id: 'child',
    command: [process.execPath, '-e', "process.stdout.write('token=hello')"],
    resources: resources(),
  };
  const result = await executeLane(lane, { cwd: process.cwd() });
  assert.equal(result.status, 'passed');
  assert.equal(result.output, 'token=[REDACTED]');
});

test('planned and executed receipts preserve stable verdict meaning', () => {
  const plan = { identity: hash, lanes: [{ id: 'one' }] };
  assert.equal(
    createReceipt(
      plan,
      [
        {
          id: 'one',
          status: 'not_run',
          wallMs: 0,
          queueMs: 0,
          cpuMs: 0,
          peakRssBytes: 0,
          output: '',
        },
      ],
      'planned'
    ).verdict,
    'planned'
  );
  assert.equal(
    createReceipt(plan, [
      {
        id: 'one',
        status: 'failed',
        wallMs: 1,
        queueMs: 0,
        cpuMs: 1,
        peakRssBytes: 1,
        output: 'no',
      },
    ]).verdict,
    'failed'
  );
});

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function gitOutput(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
