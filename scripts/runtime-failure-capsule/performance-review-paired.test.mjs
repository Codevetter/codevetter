import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { cleanSourceSnapshotSha256, inspectGitDiff } from './git-diff.mjs';
import { retainPerformanceReviewHistory } from './performance-review-history.mjs';
import { materializeCleanGitIncumbent } from './performance-review-incumbent.mjs';
import {
  attemptAutomaticPerformanceReviewPair,
  classifyPairingChanges,
} from './performance-review-paired.mjs';
import { profileRepository } from './performance.mjs';

const execute = promisify(execFile);
const SOURCE = 'src/work.mjs';
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

test('revision-incompatible history and unrelated changes cannot synthesize an incumbent', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-auto-pair-guard-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const revision = 'a'.repeat(40);
  const current = {
    repository_revision: revision,
    source_snapshot_sha256: 'd'.repeat(64),
    changed_files: [SOURCE],
  };
  let materialized = false;
  const baseDependencies = {
    inspectSnapshot: async () => current,
    loadFlowContract: async () => contract(),
    loadHistoryRecord: async () => ({
      subject: {
        repository_revision: 'b'.repeat(40),
        source_snapshot_sha256: cleanSourceSnapshotSha256('b'.repeat(40)),
      },
      capsule: {
        subject: {
          repository_revision: 'b'.repeat(40),
          source_snapshot_sha256: cleanSourceSnapshotSha256('b'.repeat(40)),
          dirty: true,
        },
      },
    }),
    materializeIncumbent: async () => {
      materialized = true;
      throw new Error('must not materialize');
    },
  };
  const incompatible = await attemptAutomaticPerformanceReviewPair(input(root, current), {
    ...baseDependencies,
  });
  assert.equal(incompatible.status, 'no_confidence');
  assert.equal(incompatible.reason, 'predecessor_revision_incompatible');
  assert.equal(materialized, false);

  const unrelated = await attemptAutomaticPerformanceReviewPair(
    input(root, { ...current, changed_files: [SOURCE, 'docs/note.md'] }),
    {
      ...baseDependencies,
      inspectSnapshot: async () => ({ ...current, changed_files: [SOURCE, 'docs/note.md'] }),
      loadHistoryRecord: async () => ({
        subject: {
          repository_revision: revision,
          source_snapshot_sha256: cleanSourceSnapshotSha256(revision),
        },
        capsule: {
          subject: {
            repository_revision: revision,
            source_snapshot_sha256: cleanSourceSnapshotSha256(revision),
            dirty: true,
          },
        },
      }),
    }
  );
  assert.equal(unrelated.reason, 'review_change_not_sealed_to_owned_sources');
  assert.deepEqual(unrelated.observed.change_classification, {
    owned_source_files: [SOURCE],
    evaluator_files: [],
    unrelated_files: ['docs/note.md'],
  });
  assert.equal(unrelated.inferred.next_action.kind, 'isolate_owned_source_change');
  assert.equal(unrelated.inferred.next_action.automated, false);
  assert.equal(unrelated.inferred.next_action.repository_mutation_performed, false);
  assert.equal(materialized, false);

  const evaluator = await attemptAutomaticPerformanceReviewPair(
    input(root, {
      ...current,
      changed_files: [SOURCE, 'codevetter.performance.json', PERFORMANCE.target],
    }),
    {
      ...baseDependencies,
      inspectSnapshot: async () => ({
        ...current,
        changed_files: [SOURCE, 'codevetter.performance.json', PERFORMANCE.target],
      }),
      loadHistoryRecord: async () => ({
        subject: {
          repository_revision: revision,
          source_snapshot_sha256: cleanSourceSnapshotSha256(revision),
        },
        capsule: {
          subject: {
            repository_revision: revision,
            source_snapshot_sha256: cleanSourceSnapshotSha256(revision),
            dirty: true,
          },
        },
      }),
    }
  );
  assert.deepEqual(evaluator.observed.change_classification, {
    owned_source_files: [SOURCE],
    evaluator_files: ['codevetter.performance.json', PERFORMANCE.target],
    unrelated_files: [],
  });
  assert.equal(evaluator.inferred.next_action.kind, 'establish_evaluator_baseline');
  assert.equal(materialized, false);
});

test('changed-file classification is closed and rejects unsafe or duplicate inventory', () => {
  assert.deepEqual(classifyPairingChanges([SOURCE], [SOURCE], PERFORMANCE, CORRECTNESS), {
    owned_source_files: [SOURCE],
    evaluator_files: [],
    unrelated_files: [],
    eligible: true,
  });
  assert.throws(
    () => classifyPairingChanges([SOURCE, SOURCE], [SOURCE], PERFORMANCE, CORRECTNESS),
    /contains duplicates/
  );
  assert.throws(
    () => classifyPairingChanges(['../escape'], [SOURCE], PERFORMANCE, CORRECTNESS),
    /path is unsafe/
  );
});

test('a clean predecessor reaches accepted paired evidence once and then reuses it', async (context) => {
  const root = await repositoryFixture(context);
  const manifest = JSON.parse(
    await import('node:fs/promises').then(({ readFile }) =>
      readFile(join(root, 'codevetter.performance.json'), 'utf8')
    )
  );
  assert.equal(manifest.flows.length, 1);
  const baselineSubject = await inspectGitDiff(root);
  const baselineCapsule = await profileRepository({
    repositoryRoot: root,
    adapter: PERFORMANCE.adapter,
    target: PERFORMANCE.target,
    name: PERFORMANCE.name,
    timeoutMs: 5_000,
    samples: 2,
    warmups: 0,
  });
  const { createHash } = await import('node:crypto');
  const { readFile } = await import('node:fs/promises');
  const manifestSha256 = createHash('sha256')
    .update(await readFile(join(root, 'codevetter.performance.json')))
    .digest('hex');
  await retainPerformanceReviewHistory({
    repositoryRoot: root,
    source: SOURCE,
    performanceScope: PERFORMANCE,
    correctnessScope: CORRECTNESS,
    manifestSha256,
    capsule: baselineCapsule,
  });
  assert.equal(baselineSubject.dirty, false);

  await writeFile(
    join(root, SOURCE),
    "import { scale } from 'fixture-scale';\nexport function work(size) { let value = 0; for (let index = 0; index < size * scale(200); index += 1) value += index % 7; return value >= 0; }\n"
  );
  const currentSubject = await inspectGitDiff(root);
  const currentCapsule = await profileRepository({
    repositoryRoot: root,
    adapter: PERFORMANCE.adapter,
    target: PERFORMANCE.target,
    name: PERFORMANCE.name,
    timeoutMs: 5_000,
    samples: 2,
    warmups: 0,
  });
  const history = await retainPerformanceReviewHistory({
    repositoryRoot: root,
    source: SOURCE,
    performanceScope: PERFORMANCE,
    correctnessScope: CORRECTNESS,
    manifestSha256,
    capsule: currentCapsule,
  });
  assert.equal(history.screening.next_action, 'run_interleaved_paired_verification');

  let disposed = false;
  const result = await attemptAutomaticPerformanceReviewPair(
    {
      repositoryRoot: root,
      source: SOURCE,
      ownedSources: [SOURCE],
      performanceScope: PERFORMANCE,
      correctnessScope: CORRECTNESS,
      manifestSha256,
      expectedSubject: currentSubject,
      history,
    },
    {
      materializeIncumbent: async (...arguments_) => {
        const incumbent = await materializeCleanGitIncumbent(...arguments_);
        return {
          ...incumbent,
          async dispose() {
            disposed = true;
            await incumbent.dispose();
          },
        };
      },
    }
  );

  assert.equal(result.status, 'accepted', JSON.stringify(result));
  assert.equal(result.observed.paired.evidence_mode, 'paired_interleaved');
  assert.equal(result.observed.paired.samples, 10);
  assert.equal(result.inferred.decisions.shipping_recommended, true);
  assert.match(result.observed.artifact.path, /^\.codevetter\/performance-review-pairs\//);
  assert.equal(disposed, true);

  const reused = await attemptAutomaticPerformanceReviewPair(
    {
      repositoryRoot: root,
      source: SOURCE,
      ownedSources: [SOURCE],
      performanceScope: PERFORMANCE,
      correctnessScope: CORRECTNESS,
      manifestSha256,
      expectedSubject: currentSubject,
      history,
    },
    {
      materializeIncumbent: async () => {
        throw new Error('reused pair must not materialize');
      },
    }
  );
  assert.equal(reused.status, 'accepted');
  assert.equal(reused.observed.reused, true);
  assert.equal(reused.observed.artifact.sha256, result.observed.artifact.sha256);

  const artifactPath = join(root, result.observed.artifact.path);
  const tampered = JSON.parse(await readFile(artifactPath, 'utf8'));
  tampered.result.reason = 'tampered';
  await writeFile(artifactPath, `${JSON.stringify(tampered)}\n`);
  await assert.rejects(
    attemptAutomaticPerformanceReviewPair({
      repositoryRoot: root,
      source: SOURCE,
      ownedSources: [SOURCE],
      performanceScope: PERFORMANCE,
      correctnessScope: CORRECTNESS,
      manifestSha256,
      expectedSubject: currentSubject,
      history,
    }),
    /payload digest differs/
  );
});

function input(repositoryRoot, expectedSubject) {
  return {
    repositoryRoot,
    source: SOURCE,
    ownedSources: [SOURCE],
    performanceScope: PERFORMANCE,
    correctnessScope: CORRECTNESS,
    manifestSha256: 'c'.repeat(64),
    expectedSubject,
    history: {
      predecessor: {
        binding_key: 'e'.repeat(64),
        repository_revision: expectedSubject.repository_revision,
        source_snapshot_sha256: cleanSourceSnapshotSha256(expectedSubject.repository_revision),
        capsule_sha256: 'f'.repeat(64),
      },
      screening: { next_action: 'run_interleaved_paired_verification' },
    },
  };
}

function contract() {
  return {
    present: true,
    manifest_sha256: 'c'.repeat(64),
    bindings: [
      {
        sources: [SOURCE],
        performance: PERFORMANCE,
        correctness: CORRECTNESS,
      },
    ],
  };
}

async function repositoryFixture(context) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-auto-pair-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  await execute('git', ['init', '--initial-branch=main'], { cwd: root });
  await Promise.all([
    writeFile(join(root, '.gitignore'), 'node_modules/\n.codevetter/\n'),
    writeFile(
      join(root, 'package.json'),
      '{"private":true,"type":"module","dependencies":{"fixture-scale":"1.0.0"}}\n'
    ),
    writeFile(
      join(root, 'codevetter.performance.json'),
      `${JSON.stringify({
        schema_version: 'codevetter-performance-flows/v1',
        flows: [
          {
            sources: [SOURCE],
            performance: PERFORMANCE,
            correctness: CORRECTNESS,
          },
        ],
      })}\n`
    ),
    writeFile(
      join(root, SOURCE),
      "import { scale } from 'fixture-scale';\nexport function work(size) { let value = 0; for (let index = 0; index < size * scale(2000); index += 1) value += index % 7; return value >= 0; }\n"
    ),
    writeFile(
      join(root, CORRECTNESS.target),
      [
        "import assert from 'node:assert/strict';",
        "import test from 'node:test';",
        "import { work } from './work.mjs';",
        "test('does work', () => assert.equal(work(10), true));",
        '',
      ].join('\n')
    ),
    writeFile(
      join(root, PERFORMANCE.target),
      [
        "import assert from 'node:assert/strict';",
        "import { performance } from 'node:perf_hooks';",
        "import test from 'node:test';",
        "import { work } from './work.mjs';",
        "test('measures work', () => {",
        '  const metrics = [];',
        '  for (const size of [100, 500, 1000]) {',
        '    const started = performance.now();',
        '    for (let iteration = 0; iteration < 4; iteration += 1) work(size);',
        "    metrics.push('size' + size + '=' + (performance.now() - started) / 4 + 'ms/op');",
        '  }',
        "  console.log('[benchmark] ' + metrics.join(' '));",
        '  assert.equal(work(1), true);',
        '});',
        '',
      ].join('\n')
    ),
  ]);
  await execute('git', ['add', '.'], { cwd: root });
  await execute(
    'git',
    [
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=CodeVetter Test',
      '-c',
      'user.email=codevetter@example.invalid',
      'commit',
      '-m',
      'fixture',
    ],
    { cwd: root }
  );
  await mkdir(join(root, 'node_modules', 'fixture-scale'), { recursive: true });
  await Promise.all([
    writeFile(
      join(root, 'node_modules', 'fixture-scale', 'package.json'),
      '{"name":"fixture-scale","version":"1.0.0","type":"module","exports":"./index.mjs"}\n'
    ),
    writeFile(
      join(root, 'node_modules', 'fixture-scale', 'index.mjs'),
      'export function scale(value) { return value; }\n'
    ),
  ]);
  return root;
}
