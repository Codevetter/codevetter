import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { SourceMap, stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { planPerformanceExecution } from './execution-governance.mjs';
import { preflightAdapter, runClosedAdapter } from './runner.mjs';
import { qualifySourceExecution, sourceDigest } from './source-execution.mjs';
import { captureSource, typedSource } from './source-execution-fixture.mjs';

export async function sourceExecutionExperiment() {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-source-execution-'));
  try {
    return await executeStudy(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function executeStudy(root) {
  const generated = stripTypeScriptTypes(typedSource, {
    mode: 'transform',
    sourceMap: true,
    sourceUrl: 'fixture.ts',
  });
  const encoded = generated.split('base64,').at(-1).trim();
  const map = JSON.parse(Buffer.from(encoded, 'base64'));
  // Node's transformer omits sourcesContent. Bind the supplied compiler input
  // explicitly; both this completed map and emitted bytes are hashed separately.
  map.sourcesContent = [typedSource];
  const files = {
    'fixture.ts': typedSource,
    'generated.mjs': generated,
    'capture.mjs': captureSource,
    'missing.test.ts': "throw Error('must not load');",
  };
  for (const [name, contents] of Object.entries(files)) await writeFile(join(root, name), contents);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'synthetic fixture',
    ],
    { cwd: root }
  );
  const reports = [];
  const witnesses = [];
  for (const mode of [0, 1]) {
    const expected = {
      source_sha256: sourceDigest(typedSource),
      generated_sha256: sourceDigest(generated),
      map_sha256: sourceDigest(JSON.stringify(map)),
      compiler: `node:stripTypeScriptTypes/transform:${process.version}`,
      runtime: process.version,
      node_binary_sha256: sourceDigest(await readFile(process.execPath)),
      selection_sha256: sourceDigest(JSON.stringify({ input: [3, 1, 2], mode })),
      run_id: randomUUID(),
      mode,
    };
    await writeFile(join(root, 'identity.json'), JSON.stringify(expected));
    const scope = {
      repositoryRoot: root,
      adapter: 'node-script',
      target: 'capture.mjs',
      timeoutMs: 5000,
    };
    const plan = await planPerformanceExecution(scope);
    assert.equal(plan.decision.status, 'admitted');
    const execution = await runClosedAdapter({ ...scope, executionPlan: plan });
    assert.equal(execution.exitCode, 0, execution.stderr);
    const capture = JSON.parse(execution.stdout);
    const results = ['values.sort', 'values.slice'].map((token) => {
      const start = generated.indexOf(token);
      const before = generated.slice(0, start).split('\n');
      const anchor = new SourceMap(map).findEntry(before.length - 1, before.at(-1).length);
      const span = {
        start,
        end: start + token.length,
        original_line: anchor.originalLine,
        original_column: anchor.originalColumn,
      };
      // Assert against known original coordinates, not only the mapper itself.
      assert.equal(anchor.originalLine, token.endsWith('sort') ? 3 : 5);
      assert.equal(anchor.originalColumn, token.endsWith('sort') ? 11 : 9);
      const input = { source: typedSource, generated, map, expected, capture, span };
      witnesses.push(input);
      return { token, ...qualifySourceExecution(input) };
    });
    assert.deepEqual(
      results.map((row) => row.status),
      mode === 0 ? ['not_executed', 'executed'] : ['executed', 'not_executed']
    );
    reports.push({
      mode,
      plan_id: plan.plan_id,
      enforcement: plan.enforcement,
      capture,
      results,
      elapsed_ms: null,
    });
  }
  const prerequisite = await preflightAdapter({
    repositoryRoot: root,
    adapter: 'vitest',
    target: 'missing.test.ts',
  });
  assert.equal(prerequisite.status, 'unavailable');
  return {
    schema_version: 'codevetter.source-execution-study/v1',
    published_prerequisite: '0e8be1686ed11ad5bfc0e97b41f4fe4f49842144',
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
    },
    implementation_sha256: Object.fromEntries(
      await Promise.all(
        [
          'source-execution.mjs',
          'source-execution-experiment.mjs',
          'source-execution-fixture.mjs',
          'runner.mjs',
          'execution-governance.mjs',
        ].map(async (name) => [name, sourceDigest(await readFile(new URL(name, import.meta.url)))])
      )
    ),
    fixture_sha256: Object.fromEntries(
      Object.entries(files).map(([name, value]) => [name, sourceDigest(value)])
    ),
    reports,
    witnesses,
    vitest_environment: {
      status: 'blocked',
      prerequisite,
      executed_tests: 0,
      reason:
        'Vitest/jsdom are neither installed nor declared repository dependencies; no substitute runner or dependency added.',
    },
    limitations: [
      'Bounded synthetic TypeScript transform and exact-span execution only.',
      'No timing comparison, CPU attribution, recommendation, native or production qualification.',
      'The Node transformer is experimental; its exact runtime version is part of identity.',
      'Local consistency checks do not authenticate externally supplied evidence.',
      'Representative Vitest/jsdom and repository-owned warm-verifier qualification remain blocked.',
    ],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { witnesses, ...report } = await sourceExecutionExperiment();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
