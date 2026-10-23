import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, validatePerformanceCapsule } from './contracts.mjs';
import { createPerformanceCapsule, loadPerformanceCapsule } from './performance.mjs';
import { emptyFunctionCoverage } from './function-coverage.mjs';
import { SOURCE_EXECUTION_SCHEMA, SOURCE_EXECUTION_SCOPE } from './source-execution-contract.mjs';
import { attachSourceExecution } from './source-execution-transport.mjs';

function observation() {
  const sha = 'a'.repeat(64);
  return {
    schema_version: SOURCE_EXECUTION_SCHEMA,
    scope: SOURCE_EXECUTION_SCOPE,
    recommendation_qualified: false,
    limitations: [],
    snapshots: Array.from({ length: 16 }, (_, file) => ({
      file: `src/app${file}.ts`,
      capture_id: sha,
      source_sha256: sha,
      generated_sha256: sha,
      map_sha256: sha,
      anchors: Array.from({ length: 32 }, (_, index) => ({
        line: index + 1,
        column: 1,
        generated_start: index,
        generated_end: index + 1,
        status: 'executed_in_snapshot',
        count: 1,
      })),
    })),
  };
}

function assemble(root, sourceExecution = null) {
  return createPerformanceCapsule({
    root,
    git: {
      repository_revision: 'a'.repeat(40),
      diff_identity: 'HEAD..worktree',
      dirty: false,
      changed_lines: new Map(),
    },
    adapter: 'node-test',
    target: 'app.test.mjs',
    name: 'selected',
    samples: 2,
    warmups: 0,
    executions: [],
    profileEvidence: {
      kind: 'v8_cpu_profile',
      profile_files: 0,
      profile_bytes: 0,
      profile_samples: 0,
      hotspots: [],
      truncated: false,
      redaction_count: 0,
      limitations: [],
    },
    functionCoverage: {
      ...emptyFunctionCoverage(),
      limitations: ['boundary fixture '.repeat(7500)],
    },
    sourceExecution,
  });
}

test('assembly fits optional observations to the whole compact capsule and baseline loader', async (context) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codevetter-snapshot-budget-')));
  context.after(() => rm(root, { recursive: true, force: true }));
  const baseline = assemble(root);
  const candidate = assemble(root, observation());
  assert.ok(Buffer.byteLength(JSON.stringify(baseline)) < LIMITS.receiptBytes);
  const encoded = `${JSON.stringify(candidate)}\n`;
  assert.ok(Buffer.byteLength(encoded) <= LIMITS.receiptBytes);
  assert.ok(Buffer.byteLength(encoded) < 512 * 1024);
  assert.deepEqual(validatePerformanceCapsule(candidate), []);
  assert.deepEqual(candidate.verdict, baseline.verdict);
  assert.deepEqual(candidate.observed.function_coverage, baseline.observed.function_coverage);
  assert.ok(candidate.observed.source_execution.limitations.includes('capture_bound_exceeded'));
  assert.ok(candidate.observed.source_execution.snapshots.length < 16);
  await writeFile(join(root, 'baseline.json'), encoded);
  assert.deepEqual(await loadPerformanceCapsule(root, 'baseline.json'), candidate);
  await assertCliTransport(root, encoded);
});

async function assertCliTransport(root, encoded) {
  const performance = new URL('./performance.mjs', import.meta.url).href;
  const capsulePath = join(root, 'baseline.json');
  const hook = join(root, 'transport-hook.mjs');
  // Inject only the already assembled boundary capsule; exercise the real CLI serializer.
  const replacement = `export * from ${JSON.stringify(`${performance}?transport-original`)};
import { readFileSync } from 'node:fs';
export async function profileRepository() { return JSON.parse(readFileSync(${JSON.stringify(capsulePath)}, 'utf8')); }`;
  await writeFile(
    hook,
    `import { registerHooks } from 'node:module';
registerHooks({ load(url, context, next) {
  if (url === ${JSON.stringify(performance)}) return { format: 'module', shortCircuit: true, source: ${JSON.stringify(replacement)} };
  return next(url, context);
} });`
  );
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      hook,
      fileURLToPath(new URL('./cli.mjs', import.meta.url)),
      'profile',
      '--repo',
      root,
      '--adapter',
      'node-test',
      '--target',
      'app.test.mjs',
      '--json',
    ],
    { encoding: 'utf8', maxBuffer: 512 * 1024 }
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, encoded);
}

test('no remaining optional budget leaves core evidence unchanged and default output absent', () => {
  const core = {
    observed: { executions: [] },
    limitations: [],
    verdict: { status: 'no_confidence' },
  };
  const original = structuredClone(core);
  const budget = Buffer.byteLength(JSON.stringify(core)) + 1;
  attachSourceExecution(core, observation(), budget);
  assert.deepEqual(core, original);
  attachSourceExecution(core, null, budget);
  assert.deepEqual(core, original);
});
