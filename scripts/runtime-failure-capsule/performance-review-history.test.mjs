import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  loadPerformanceReviewHistoryRecord,
  retainPerformanceReviewHistory,
} from './performance-review-history.mjs';

const PERFORMANCE = {
  adapter: 'node-test',
  target: 'src/work.performance.test.mjs',
  name: 'measures work',
};
const CORRECTNESS = {
  adapter: 'node-test',
  target: 'src/work.test.mjs',
  name: 'does work',
};
const MANIFEST_SHA256 = 'c'.repeat(64);

test('records one immutable baseline and does not compare or overwrite the same snapshot', async (context) => {
  const root = await fixture(context);
  let comparisons = 0;
  const dependencies = {
    now: () => '2026-08-13T10:00:00.000Z',
    inspectSnapshot: async () => capsule('b').subject,
    compareCapsules: () => {
      comparisons += 1;
      return verification('inconclusive');
    },
  };

  const first = await retainPerformanceReviewHistory(input(root, capsule('b')), dependencies);
  const repeated = await retainPerformanceReviewHistory(input(root, capsule('b')), dependencies);

  assert.equal(first.persistence.status, 'recorded');
  assert.equal(first.predecessor, null);
  assert.equal(repeated.persistence.status, 'already_recorded');
  assert.equal(repeated.predecessor, null);
  assert.equal(comparisons, 0);
  assert.equal((await historyFiles(root)).length, 1);
  const loaded = await loadPerformanceReviewHistoryRecord(root, first.persistence.current);
  assert.equal(loaded.capsule_sha256, first.persistence.current.capsule_sha256);
  await assert.rejects(
    loadPerformanceReviewHistoryRecord(root, {
      ...first.persistence.current,
      capsule_sha256: 'e'.repeat(64),
    }),
    /reference differs/
  );
});

test('screens a distinct compatible snapshot but cannot recommend shipping', async (context) => {
  const root = await fixture(context);
  await retainPerformanceReviewHistory(input(root, capsule('b', [0.5, 6, 25])), {
    now: () => '2026-08-13T10:00:00.000Z',
    inspectSnapshot: async () => capsule('b').subject,
  });

  const result = await retainPerformanceReviewHistory(input(root, capsule('d', [0.4, 4, 12])), {
    now: () => '2026-08-13T11:00:00.000Z',
    inspectSnapshot: async () => capsule('d').subject,
  });

  assert.equal(result.persistence.status, 'recorded');
  assert.equal(result.predecessor.source_snapshot_sha256, 'b'.repeat(64));
  assert.equal(result.screening.evidence_mode, 'sequential_historical');
  assert.equal(result.screening.verdict.status, 'confirmed');
  assert.equal(result.screening.decisions.shipping_recommended, false);
  assert.equal(result.screening.next_action, 'run_interleaved_paired_verification');
  assert.match(result.unverified.join(' '), /does not establish causation/);
});

test('target content drift starts a new history instead of comparing unlike workloads', async (context) => {
  const root = await fixture(context);
  await retainPerformanceReviewHistory(input(root, capsule('b')), {
    inspectSnapshot: async () => capsule('b').subject,
  });
  await writeFile(join(root, PERFORMANCE.target), 'test("measures changed work", () => {});\n');

  const result = await retainPerformanceReviewHistory(input(root, capsule('d')), {
    inspectSnapshot: async () => capsule('d').subject,
  });

  assert.equal(result.predecessor, null);
  assert.equal(result.screening, null);
  assert.equal((await historyFiles(root)).length, 2);
});

test('tampered history is excluded and cannot become a comparison baseline', async (context) => {
  const root = await fixture(context);
  await retainPerformanceReviewHistory(input(root, capsule('b')), {
    inspectSnapshot: async () => capsule('b').subject,
  });
  const [name] = await historyFiles(root);
  const path = join(root, '.codevetter/performance-review-history', name);
  const record = JSON.parse(await readFile(path, 'utf8'));
  record.capsule.observed.wall_time_ms.median = 1;
  await writeFile(path, `${JSON.stringify(record)}\n`);

  const result = await retainPerformanceReviewHistory(input(root, capsule('d')), {
    inspectSnapshot: async () => capsule('d').subject,
  });

  assert.equal(result.predecessor, null);
  assert.equal(result.screening, null);
  assert.equal(result.diagnostics.invalid_records, 1);
});

test('snapshot mutation during target binding stops before persistence', async (context) => {
  const root = await fixture(context);
  let inspections = 0;

  await assert.rejects(
    retainPerformanceReviewHistory(input(root, capsule('b')), {
      inspectSnapshot: async () => {
        inspections += 1;
        return inspections === 1 ? capsule('b').subject : capsule('d').subject;
      },
    }),
    /snapshot changed during target binding/
  );
  await assert.rejects(historyFiles(root), /ENOENT/);
});

test('a full bounded inventory keeps current profiling usable without another write', async (context) => {
  const root = await fixture(context);
  const directory = join(root, '.codevetter/performance-review-history');
  await mkdir(directory, { recursive: true });
  await Promise.all(
    Array.from({ length: 64 }, (_, index) =>
      writeFile(
        join(directory, `${index.toString(16).padStart(64, '0')}-${'e'.repeat(64)}.json`),
        '{}\n'
      )
    )
  );

  const result = await retainPerformanceReviewHistory(input(root, capsule('b')), {
    inspectSnapshot: async () => capsule('b').subject,
  });

  assert.equal(result.persistence.status, 'storage_full');
  assert.equal(result.predecessor, null);
  assert.equal(result.diagnostics.invalid_records, 64);
  assert.equal((await historyFiles(root)).length, 64);
});

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-review-history-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  await Promise.all([
    writeFile(join(root, PERFORMANCE.target), 'test("measures work", () => {});\n'),
    writeFile(join(root, CORRECTNESS.target), 'test("does work", () => {});\n'),
  ]);
  return root;
}

function input(repositoryRoot, performanceCapsule) {
  return {
    repositoryRoot,
    source: 'src/work.mjs',
    performanceScope: PERFORMANCE,
    correctnessScope: CORRECTNESS,
    manifestSha256: MANIFEST_SHA256,
    capsule: performanceCapsule,
  };
}

function capsule(snapshotCharacter, values = [0.5, 6, 25]) {
  return {
    schema_version: 'runtime-performance-capsule/v1',
    subject: {
      repository_revision: 'a'.repeat(40),
      source_snapshot_sha256: snapshotCharacter.repeat(64),
      dirty: true,
      platform: process.platform,
      architecture: process.arch,
      node_version: process.version,
      go_version: null,
    },
    adapter: {
      kind: PERFORMANCE.adapter,
      executable_identity: 'node:test',
      arguments: ['--test', PERFORMANCE.target, '--test-name-pattern', PERFORMANCE.name],
      working_directory: '.',
    },
    scope: { target: PERFORMANCE.target, name: PERFORMANCE.name },
    sample_policy: { samples: 2, warmups: 0 },
    observed: {
      executions: [],
      wall_time_ms: distribution(100),
      peak_rss_bytes: emptyDistribution(),
      hotspots: [],
      go_benchmarks: [],
      vitest_tests: [],
      vitest_execution_share: null,
      console_metrics: values.map((value, index) => ({
        kind: 'console_benchmark_metrics',
        metrics: [{ name: `size${[1_000, 10_000, 35_000][index]}`, value, unit: 'ms/op' }],
        provenance: 'unprofiled_measurement_execution_median',
      })),
      profile_runs: [],
      heap_profile_runs: [],
    },
    findings: [],
    relationships: [],
    unverified: [],
    comparison: null,
    limitations: [],
    capture: {},
    verdict: { status: 'profiled', reason: 'Profiled exact flow.' },
  };
}

function verification(status) {
  return {
    observed: [],
    verdict: { status, reason: 'Synthetic unit boundary.' },
    decisions: {
      mechanically_confirmed: false,
      materially_useful: false,
      shipping_recommended: false,
      basis: 'Unit boundary.',
    },
  };
}

function distribution(median) {
  return { count: 2, min: median, median, p95: median, max: median, spread_percent: 0 };
}

function emptyDistribution() {
  return { count: 0, min: null, median: null, p95: null, max: null, spread_percent: null };
}

async function historyFiles(root) {
  return readdir(join(root, '.codevetter/performance-review-history'));
}
