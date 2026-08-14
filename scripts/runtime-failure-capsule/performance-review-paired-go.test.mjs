import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { inspectGitDiff } from './git-diff.mjs';
import { attemptAutomaticPerformanceReviewPair } from './performance-review-paired.mjs';

const SOURCE = 'work.go';
const PERFORMANCE = { adapter: 'go-bench', target: 'work_test.go', name: 'BenchmarkWork' };
const CORRECTNESS = { adapter: 'go-test', target: 'work_test.go', name: 'TestWork' };
const execute = promisify(execFile);

test('automatic clean-incumbent pairing executes a real Go correctness and performance flow', {
  skip: process.env.CODEVETTER_SKIP_GO_PROFILE === '1',
}, async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-auto-pair-go-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const incumbentRoot = join(root, 'incumbent');
  const currentRoot = join(root, 'current');
  await Promise.all([goFixture(incumbentRoot, 20_000), goFixture(currentRoot, 20_000)]);
  await execute('git', ['init', '--initial-branch=main'], { cwd: currentRoot });
  await execute('git', ['add', '.'], { cwd: currentRoot });
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
    { cwd: currentRoot }
  );
  const cleanSubject = await inspectGitDiff(currentRoot);
  await writeFile(join(currentRoot, SOURCE), workSource(2_000));
  const currentSubject = await inspectGitDiff(currentRoot);
  const revision = currentSubject.repository_revision;
  const cleanSnapshot = cleanSubject.source_snapshot_sha256;
  let disposed = false;
  const result = await attemptAutomaticPerformanceReviewPair(
    {
      repositoryRoot: currentRoot,
      source: SOURCE,
      ownedSources: [SOURCE],
      performanceScope: PERFORMANCE,
      correctnessScope: CORRECTNESS,
      manifestSha256: 'c'.repeat(64),
      expectedSubject: currentSubject,
      history: {
        predecessor: {
          binding_key: 'e'.repeat(64),
          repository_revision: revision,
          source_snapshot_sha256: cleanSnapshot,
          capsule_sha256: 'f'.repeat(64),
        },
        screening: { next_action: 'run_interleaved_paired_verification' },
      },
    },
    {
      inspectSnapshot: async () => inspectGitDiff(currentRoot),
      loadFlowContract: async () => ({
        present: true,
        manifest_sha256: 'c'.repeat(64),
        bindings: [{ sources: [SOURCE], performance: PERFORMANCE, correctness: CORRECTNESS }],
      }),
      loadHistoryRecord: async () => ({
        subject: { repository_revision: revision, source_snapshot_sha256: cleanSnapshot },
        capsule: {
          subject: {
            repository_revision: revision,
            source_snapshot_sha256: cleanSnapshot,
            dirty: false,
          },
        },
      }),
      materializeIncumbent: async () => ({
        root: incumbentRoot,
        assertUnchanged: async () => {},
        async dispose() {
          disposed = true;
        },
      }),
    }
  );

  assert.equal(result.status, 'accepted', JSON.stringify(result));
  assert.equal(result.observed.paired.evidence_mode, 'paired_interleaved');
  assert.equal(result.observed.paired.samples, 10);
  assert.equal(result.inferred.decisions.shipping_recommended, true);
  assert.equal(disposed, true);
});

async function goFixture(root, loops) {
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(join(root, 'go.mod'), 'module example.com/autopair\n\ngo 1.25\n'),
    writeFile(
      join(root, 'codevetter.performance.json'),
      `${JSON.stringify({
        schema_version: 'codevetter-performance-flows/v1',
        flows: [{ sources: [SOURCE], performance: PERFORMANCE, correctness: CORRECTNESS }],
      })}\n`
    ),
    writeFile(join(root, SOURCE), workSource(loops)),
    writeFile(
      join(root, PERFORMANCE.target),
      [
        'package autopair',
        '',
        'import "testing"',
        '',
        'func TestWork(t *testing.T) { if Work(1) < 0 { t.Fatal("invalid") } }',
        'func BenchmarkWork(b *testing.B) { for index := 0; index < b.N; index++ { Work(index) } }',
        '',
      ].join('\n')
    ),
  ]);
}

function workSource(loops) {
  return `package autopair\n\nfunc Work(value int) int {\n\tresult := 0\n\tfor index := 0; index < ${loops}; index++ { result += (value + index) % 7 }\n\treturn result\n}\n`;
}
