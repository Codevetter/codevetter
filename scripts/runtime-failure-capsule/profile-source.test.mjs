import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { diagnosePerformanceRepository } from './performance-diagnosis.mjs';
import { profileRepository } from './performance.mjs';
import { qualifyProfileSources } from './profile-source.mjs';
import { appendSourceIdentity } from './node-profile-source-preload.mjs';
import { LIMITS } from './contracts.mjs';

function commitFixture(root) {
  const commands = [
    ['init', '-q'],
    ['add', '.'],
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'fixture',
    ],
  ];
  for (const args of commands) execFileSync('git', args, { cwd: root });
}

for (const mode of ['transformed', 'esm', 'cjs']) {
  const transformed = mode === 'transformed';
  test(`production CPU evidence ${transformed ? 'omits transformed' : `retains plain ${mode}`} source coordinates`, async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'codevetter-profile-source-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'src'));
    const extension = transformed ? 'ts' : mode === 'cjs' ? 'cjs' : 'mjs';
    const source = [
      transformed ? 'enum Mode { Bounded, Full }' : 'const Mode = { Bounded: 0, Full: 1 };',
      `${mode === 'cjs' ? '' : 'export '}function choose(mode${transformed ? ': Mode' : ''}) {`,
      '  debugger;',
      '  if (mode === Mode.Full) {',
      '    const end = performance.now() + 120;',
      '    let count = 0;',
      '    while (performance.now() < end) count++;',
      '    return count > 0;',
      '  }',
      '  return false;',
      '}',
      mode === 'cjs' ? 'module.exports = { choose };' : '',
    ].join('\n');
    await writeFile(join(root, `src/app.${extension}`), source);
    await writeFile(
      join(root, 'app.test.mjs'),
      `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
registerHooks({ load(url, context, next) {
  if (url.endsWith('/src/app.ts')) return {
    shortCircuit: true, format: 'module',
    source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), {
      mode: 'transform', sourceMap: true, sourceUrl: url,
    }),
  };
  return next(url, context);
}});
const loaded = await import('./src/app.${extension}');
const choose = loaded.choose ?? loaded.default.choose;
test('full branch', () => assert.equal(choose(1), true));
`
    );
    commitFixture(root);
    const capsule = await profileRepository({
      repositoryRoot: root,
      adapter: 'node-test',
      target: 'app.test.mjs',
      name: 'full branch',
      timeoutMs: 5000,
      samples: 2,
      warmups: 0,
      captureFlow: true,
    });
    assert.equal(capsule.verdict.status, 'profiled', JSON.stringify(capsule.limitations));
    assert.ok(capsule.observed.executions.every((entry) => entry.exit_code === 0));
    const application = capsule.observed.hotspots.filter((entry) => entry.role === 'application');
    const diagnosis = await diagnosePerformanceRepository(capsule, root);
    if (transformed) {
      assert.deepEqual(application, []);
      assert.ok(capsule.limitations.some((value) => /executed.*source.*identity/i.test(value)));
      assert.equal(diagnosis.diagnosis.kind, 'insufficient_source_evidence');
      assert.deepEqual(capsule.observed.function_coverage.functions, []);
    } else {
      assert.ok(application.some((entry) => entry.function === 'choose' && entry.line === 2));
      assert.equal(diagnosis.diagnosis.kind, 'application_cpu_hotspot');
      assert.ok(
        capsule.observed.function_coverage.functions.some((entry) => entry.function === 'choose')
      );
    }
  });
}

test('source identity rejects missing, cross-isolate, mismatched script and stale source evidence', async (context) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codevetter-profile-identity-')));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = 'function actual() { return true; }';
  const path = join(root, 'app.mjs');
  await writeFile(path, source);
  const url = pathToFileURL(path).href;
  const name = 'CPU.20261023.120000.123.0.001.cpuprofile';
  const document = { nodes: [{ id: 1, callFrame: { scriptId: '7', url, lineNumber: 0 } }] };
  const identity = {
    schema_version: 1,
    process_id: 123,
    thread_id: 0,
    sources: [{ script_id: '7', url, sha256: createHash('sha256').update(source).digest('hex') }],
  };
  const inspect = () => qualifyProfileSources(document, name, root, root);
  assert.equal((await inspect()).document.nodes[0].callFrame.url, '');
  for (const patch of [
    { process_id: 456 },
    { thread_id: 1 },
    { sources: [{ ...identity.sources[0], script_id: '8' }] },
    { sources: [{ ...identity.sources[0], sha256: '0'.repeat(64) }] },
    { sources: [{ ...identity.sources[0], url: `${url}.different` }] },
  ]) {
    await writeFile(join(root, 'source-123-0.json'), JSON.stringify({ ...identity, ...patch }));
    assert.equal((await inspect()).document.nodes[0].callFrame.url, '');
  }
  await writeFile(join(root, 'source-123-0.json'), JSON.stringify(identity));
  assert.equal((await inspect()).document.nodes[0].callFrame.url, url);
  await writeFile(path, `${source}\n// changed after execution`);
  assert.equal((await inspect()).document.nodes[0].callFrame.url, '');
  if (process.platform !== 'win32') {
    await writeFile(path, source);
    await rename(join(root, 'source-123-0.json'), join(root, 'linked-identity.json'));
    await symlink(join(root, 'linked-identity.json'), join(root, 'source-123-0.json'));
    assert.equal((await inspect()).document.nodes[0].callFrame.url, '');
  }
});

test('serialized identity bounds retain earlier admitted scripts and disclose truncation', async (context) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codevetter-profile-bound-')));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = 'function actual() { return true; }';
  const path = join(root, 'app.mjs');
  await writeFile(path, source);
  const identity = {
    schema_version: 1,
    process_id: 123,
    thread_id: 0,
    sources: [],
    truncated: false,
  };
  const first = {
    script_id: '1',
    url: pathToFileURL(path).href,
    sha256: createHash('sha256').update(source).digest('hex'),
  };
  assert.equal(appendSourceIdentity(identity, first), true);
  for (let index = 2; index <= LIMITS.scanFiles; index++) {
    if (
      !appendSourceIdentity(identity, {
        script_id: String(index),
        url: `file:///repo/${'deep/'.repeat(1000)}app.mjs`,
        sha256: 'b'.repeat(64),
      })
    )
      break;
  }
  assert.equal(identity.truncated, true);
  assert.ok(identity.sources.length > 1 && identity.sources.length < LIMITS.scanFiles);
  assert.deepEqual(identity.sources[0], first);
  assert.ok(Buffer.byteLength(JSON.stringify(identity)) <= LIMITS.receiptBytes);
  await writeFile(join(root, 'source-123-0.json'), JSON.stringify(identity));
  const qualified = await qualifyProfileSources(
    { nodes: [{ id: 1, callFrame: { scriptId: '1', url: first.url, lineNumber: 0 } }] },
    'CPU.20261023.120000.123.0.001.cpuprofile',
    root,
    root
  );
  assert.equal(qualified.document.nodes[0].callFrame.url, first.url);
  assert.equal(qualified.truncated, true);
});
