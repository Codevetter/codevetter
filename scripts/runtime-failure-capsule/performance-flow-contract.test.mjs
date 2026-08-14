import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertPerformanceFlowScope,
  contractOwnsReviewBinding,
  PERFORMANCE_FLOW_CONTRACT_FILE,
  assertPerformanceFlowContract,
  loadPerformanceFlowContract,
  resolvePerformanceFlowBinding,
  resolveSourceOwnedPerformanceBindings,
} from './performance-flow-contract.mjs';

test('loads one bounded exact performance-to-correctness binding', async (context) => {
  const root = await temporaryRoot(context);
  await writeFile(join(root, PERFORMANCE_FLOW_CONTRACT_FILE), JSON.stringify(contract()));

  const loaded = await loadPerformanceFlowContract(root);

  assert.equal(loaded.present, true);
  assert.match(loaded.manifest_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    resolvePerformanceFlowBinding(loaded, contract().flows[0].performance)?.correctness,
    contract().flows[0].correctness
  );
  assert.equal(
    resolvePerformanceFlowBinding(loaded, {
      ...contract().flows[0].performance,
      name: 'another workload',
    }),
    null
  );
  assert.equal(
    resolveSourceOwnedPerformanceBindings(loaded, ['src/work.ts'])[0]?.correctness.name,
    'preserves work output'
  );
  assert.deepEqual(resolveSourceOwnedPerformanceBindings(loaded, ['src/unrelated.ts']), []);
});

test('an absent contract remains an explicit unconfigured state', async (context) => {
  const root = await temporaryRoot(context);
  assert.deepEqual(await loadPerformanceFlowContract(root), {
    present: false,
    manifest_sha256: null,
    bindings: [],
  });
});

test('review authority requires source, performance, and correctness from one binding', async (context) => {
  const root = await temporaryRoot(context);
  await writeFile(join(root, PERFORMANCE_FLOW_CONTRACT_FILE), JSON.stringify(contract()));
  const loaded = await loadPerformanceFlowContract(root);
  const binding = contract().flows[0];

  assert.equal(
    contractOwnsReviewBinding(loaded, {
      source: 'src/work.ts',
      performanceScope: assertPerformanceFlowScope(binding.performance),
      correctnessScope: binding.correctness,
    }),
    true
  );
  assert.equal(
    contractOwnsReviewBinding(loaded, {
      source: 'src/unrelated.ts',
      performanceScope: binding.performance,
      correctnessScope: binding.correctness,
    }),
    false
  );
  assert.throws(
    () => assertPerformanceFlowScope({ ...binding.performance, target: '../escape.test.ts' }),
    /invalid performance flow scope/
  );
});

test('duplicate, escaping, unknown, and non-exact bindings are rejected', () => {
  const duplicate = contract();
  duplicate.flows.push(structuredClone(duplicate.flows[0]));
  assert.throws(() => assertPerformanceFlowContract(duplicate), /duplicated/);

  const escaping = contract();
  escaping.flows[0].correctness.target = '../escape.test.ts';
  assert.throws(() => assertPerformanceFlowContract(escaping), /contained relative path/);

  const unknown = contract();
  unknown.flows[0].command = 'pnpm test';
  assert.throws(() => assertPerformanceFlowContract(unknown), /unknown field/);

  const inexact = contract();
  inexact.flows[0].performance.name = null;
  assert.throws(() => assertPerformanceFlowContract(inexact), /exact workload/);

  const duplicateSource = contract();
  duplicateSource.flows[0].sources.push('src/work.ts');
  assert.throws(() => assertPerformanceFlowContract(duplicateSource), /duplicate file/);

  const globSource = contract();
  globSource.flows[0].sources = ['../src/*.ts'];
  assert.throws(() => assertPerformanceFlowContract(globSource), /exact relative files/);
});

test('a symlink contract is rejected before its target is read', async (context) => {
  const root = await temporaryRoot(context);
  const target = join(root, 'manifest-target.json');
  await writeFile(target, JSON.stringify(contract()));
  await symlink(target, join(root, PERFORMANCE_FLOW_CONTRACT_FILE));
  await assert.rejects(() => loadPerformanceFlowContract(root), /regular non-symlink file/);
});

function contract() {
  return {
    schema_version: 'codevetter-performance-flows/v1',
    flows: [
      {
        sources: ['src/work.ts'],
        performance: {
          adapter: 'vitest',
          target: 'src/work.performance.test.ts',
          name: 'scales with input size',
        },
        correctness: {
          adapter: 'vitest',
          target: 'src/work.test.ts',
          name: 'preserves work output',
        },
      },
    ],
  };
}

async function temporaryRoot(context) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-flow-contract-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
