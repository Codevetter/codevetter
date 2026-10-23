import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Emulates absence of the optional compiler without changing the ordinary runtime.
test('missing optional compiler does not prevent import or ordinary no-coverage profiling', async (context) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codevetter-compiler-absent-')));
  context.after(() => rm(root, { recursive: true, force: true }));
  const hook = `import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'node:module' && context.parentURL?.endsWith('/source-execution-map.mjs')) {
    return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent("export * from 'node:module'; export const stripTypeScriptTypes = undefined;") };
  }
  return next(specifier, context);
}});`;
  await writeFile(join(root, 'compiler-absent.mjs'), hook);
  await writeFile(
    join(root, 'app.test.mjs'),
    "import test from 'node:test'; import assert from 'node:assert/strict'; test('ordinary',()=>assert.equal(2+2,4));"
  );
  const probe = `import assert from 'node:assert/strict';
import { mapCapturedSource } from ${JSON.stringify(new URL('./source-execution-map.mjs', import.meta.url).href)};
import { profileRepository } from ${JSON.stringify(new URL('./performance.mjs', import.meta.url).href)};
assert.deepEqual(mapCapturedSource({}), { reason: 'unsupported_map' });
const capsule = await profileRepository({ repositoryRoot: process.cwd(), adapter: 'node-test', target: 'app.test.mjs', name: 'ordinary', samples: 2, warmups: 0, timeoutMs: 5000 });
assert.equal(Object.hasOwn(capsule.observed, 'source_execution'), false);
assert.ok(capsule.observed.executions.length > 0);
assert.ok(capsule.observed.executions.every(run => run.exit_code === 0));
console.log('ordinary-no-coverage-pass');`;
  await writeFile(join(root, 'probe.mjs'), probe);
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'compiler absence fixture',
    ],
  ])
    execFileSync('git', args, { cwd: root });
  const output = execFileSync(
    process.execPath,
    ['--import', join(root, 'compiler-absent.mjs'), join(root, 'probe.mjs')],
    { cwd: root, encoding: 'utf8', timeout: 30000 }
  );
  assert.match(output, /ordinary-no-coverage-pass/);
});
