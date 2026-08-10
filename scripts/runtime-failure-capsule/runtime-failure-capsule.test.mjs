import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { capsuleFromExecution, capsuleFromReceipt, parseVitestSelection } from './capsule.mjs';
import { detectRuntimeLanes } from './detect.mjs';
import { parseUnifiedDiff, rankRelevantChanges } from './git-diff.mjs';
import { redactJsonValue, redactText } from './redact.mjs';
import { runClosedAdapter } from './runner.mjs';

test('redacts credentials, repository paths, environment values, and URL queries', () => {
  const result = redactText(
    'token=supersecret Authorization: Bearer abc123 /private/repo/src/a.ts https://x.test/a?q=secret ENV_SECRET_VALUE',
    { repositoryRoot: '/private/repo', environmentValues: ['ENV_SECRET_VALUE'] }
  );
  assert.equal(result.text.includes('supersecret'), false);
  assert.equal(result.text.includes('abc123'), false);
  assert.equal(result.text.includes('/private/repo'), false);
  assert.equal(result.text.includes('q=secret'), false);
  assert.equal(result.text.includes('ENV_SECRET_VALUE'), false);
  assert.ok(result.redaction_count >= 5);

  const json = redactJsonValue({ token: 'secret', nested: { message: 'password=hunter2' } });
  assert.deepEqual(json.value, {
    token: '<redacted>',
    nested: { message: 'password=<redacted>' },
  });
});

test('ranks changed frame intersections ahead of same-file proximity', () => {
  const changed = parseUnifiedDiff(
    ['diff --git a/src/a.ts b/src/a.ts', '+++ b/src/a.ts', '@@ -4 +4,2 @@', '+x', '+y'].join('\n')
  );
  const ranked = rankRelevantChanges(
    [
      { file: 'src/a.ts', line: 1 },
      { file: 'src/a.ts', line: 5 },
    ],
    changed
  );
  assert.equal(ranked[0].reason, 'changed_frame_intersection');
  assert.equal(ranked[0].line, 5);
  assert.equal(ranked[1].reason, 'same_changed_file_proximity');
});

test('distinguishes a skipped Vitest selection from an executed test', () => {
  assert.deepEqual(
    parseVitestSelection(
      JSON.stringify({ numTotalTests: 2, numPendingTests: 2, numTodoTests: 0, numFailedTests: 0 })
    ),
    { total_tests: 2, executed_tests: 0, failed_tests: 0 }
  );
  assert.equal(parseVitestSelection('not json'), null);
});

test('detects the power-law runtime lanes from bounded repository evidence', async (context) => {
  const root = await temporaryRoot(context);
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ devDependencies: { vitest: '1.0.0', '@playwright/test': '1.0.0' } })
  );
  await writeFile(join(root, 'vitest.config.ts'), 'export default {};\n');
  await writeFile(join(root, 'playwright.config.ts'), 'export default {};\n');
  await writeFile(join(root, 'wrangler.toml'), 'name = "fixture"\n');
  await writeFile(join(root, 'go.mod'), 'module example.test/capsule\n\ngo 1.22\n');
  await writeFile(join(root, 'capsule_test.go'), 'package capsule\n');

  const report = await detectRuntimeLanes(root);
  assert.deepEqual(
    report.lanes.map((lane) => lane.kind),
    ['node-test', 'vitest', 'browser', 'cloudflare-worker', 'go-test']
  );
  assert.deepEqual(report.lanes.find((lane) => lane.kind === 'cloudflare-worker').adapters, [
    'vitest',
  ]);
});

for (const adapterCase of [
  {
    adapter: 'vitest',
    executable: 'node_modules/.pnpm/vitest@3.2.7_peer/node_modules/vitest/vitest.mjs',
    config: 'vitest.config.ts',
    manifestDependency: 'vitest',
    expectedLane: 'cloudflare-worker',
    extraFile: ['wrangler.toml', 'name = "fixture"\n'],
  },
  {
    adapter: 'playwright',
    executable: 'node_modules/@playwright/test/cli.js',
    config: 'playwright.config.ts',
    manifestDependency: '@playwright/test',
    expectedLane: 'browser',
  },
]) {
  test(`${adapterCase.adapter} adapter resolves a repository-contained nested runner`, async (context) => {
    const files = {
      'package.json': '{}\n',
      'apps/web/package.json': JSON.stringify({
        type: 'module',
        devDependencies: { [adapterCase.manifestDependency]: '1.0.0' },
      }),
      [`apps/web/${adapterCase.config}`]: 'export default {};\n',
      [`apps/web/${adapterCase.executable}`]: [
        "process.stdout.write([process.argv.join(' '), [process.cwd(), 'apps/web/source.js:1:1'].join('/')].join(' '));",
        'process.exitCode = 1;',
        '',
      ].join('\n'),
      'apps/web/source.js': 'export const value = 20;\n',
      'apps/web/source.test.js': 'export {};\n',
    };
    if (adapterCase.extraFile) files[adapterCase.extraFile[0]] = adapterCase.extraFile[1];
    const root = await gitFixture(context, files);
    await writeFile(join(root, 'apps/web/source.js'), 'export const value = undefined;\n');
    const execution = await runClosedAdapter({
      repositoryRoot: root,
      adapter: adapterCase.adapter,
      target: 'apps/web/source.test.js',
      name: 'nested failure',
      timeoutMs: 5_000,
    });
    const capsule = await capsuleFromExecution({
      repositoryRoot: root,
      adapter: adapterCase.adapter,
      execution,
    });
    assert.equal(capsule.verdict.status, 'failed');
    assert.equal(capsule.lane.kind, adapterCase.expectedLane);
    assert.ok(capsule.relevant_changes.length > 0, JSON.stringify(capsule));
    assert.equal(capsule.relevant_changes[0].file, 'apps/web/source.js');
    if (adapterCase.adapter === 'vitest') {
      assert.deepEqual(execution.command.arguments.slice(-2), [
        '--testNamePattern',
        '(?:^| )nested failure$',
      ]);
    }
  });
}

test('Vitest function coverage uses an owned report directory without making it public', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'node_modules/vitest/vitest.mjs': 'process.exitCode = 0;\n',
    'source.test.js': 'export {};\n',
  });
  const coverageDirectory = join(root, 'owned-coverage');
  await mkdir(coverageDirectory);
  const execution = await runClosedAdapter({
    repositoryRoot: root,
    adapter: 'vitest',
    target: 'source.test.js',
    name: 'nested result',
    timeoutMs: 5_000,
    coverageDirectory,
  });
  assert.ok(execution.command.arguments.includes('--coverage.reportsDirectory=<owned-temp>'));
  assert.equal(
    execution.command.arguments.some((argument) => argument.includes(coverageDirectory)),
    false
  );
  assert.equal(execution.environmentValues.includes(coverageDirectory), false);
});

test('Vitest profiling flags reach the test worker through Node execArgv', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'node_modules/vitest/vitest.mjs': 'console.log(JSON.stringify(process.execArgv));\n',
    'source.test.js': 'export {};\n',
  });
  const profileDirectory = join(root, 'owned-profile');
  await mkdir(profileDirectory);
  const execution = await runClosedAdapter({
    repositoryRoot: root,
    adapter: 'vitest',
    target: 'source.test.js',
    name: 'nested result',
    timeoutMs: 5_000,
    profileDirectory,
  });
  const execArgv = JSON.parse(execution.stdout.trim());

  assert.ok(execArgv.includes('--cpu-prof'));
  assert.ok(execArgv.includes(`--cpu-prof-dir=${profileDirectory}`));
  assert.equal(
    execution.command.arguments.some((argument) => argument.includes(profileDirectory)),
    false
  );
  assert.equal(execution.environmentValues.includes(profileDirectory), false);
});

test('missing local runner and escaping target fail closed', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
    'source.test.js': 'export {};\n',
  });
  const execution = await runClosedAdapter({
    repositoryRoot: root,
    adapter: 'vitest',
    target: 'source.test.js',
    timeoutMs: 5_000,
  });
  const capsule = await capsuleFromExecution({
    repositoryRoot: root,
    adapter: 'vitest',
    execution,
  });
  assert.equal(execution.status, 'operational_failure');
  assert.equal(capsule.verdict.status, 'no_confidence');
  await assert.rejects(
    runClosedAdapter({
      repositoryRoot: root,
      adapter: 'node-test',
      target: '../outside.test.js',
      timeoutMs: 5_000,
    }),
    /escapes repository/
  );
});

test('normalizes a failed browser receipt without upgrading its authority', async (context) => {
  const root = await gitFixture(context, {
    'src/checkout.ts': 'export const checkout = () => 20;\n',
    'receipt.json': JSON.stringify({ receipt_id: 'before', status: 'passed' }),
  });
  await writeFile(join(root, 'src/checkout.ts'), 'export const checkout = () => undefined;\n');
  await writeFile(
    join(root, 'receipt.json'),
    JSON.stringify({
      receipt_id: 'browser-1',
      status: 'failed',
      message: 'token=supersecret request failed',
      stack: `${root}/src/checkout.ts:1:31`,
      limitations: ['Browser console only.'],
    })
  );

  const capsule = await capsuleFromReceipt({
    repositoryRoot: root,
    kind: 'browser',
    receiptPath: 'receipt.json',
  });
  assert.equal(capsule.verdict.status, 'failed');
  assert.equal(capsule.verdict.authority, 'exact_diagnostic_scope_only');
  assert.equal(capsule.relevant_changes[0].reason, 'changed_frame_intersection');
  assert.equal(JSON.stringify(capsule).includes('supersecret'), false);
  assert.ok(capsule.capture.redaction_count > 0);
});

test('an incomplete Worker receipt remains no-confidence', async (context) => {
  const root = await gitFixture(context, {
    'package.json': '{}\n',
    'wrangler.toml': 'name = "fixture"\n',
    'receipt.json': JSON.stringify({ message: 'request failed' }),
  });
  const capsule = await capsuleFromReceipt({
    repositoryRoot: root,
    kind: 'worker',
    receiptPath: 'receipt.json',
  });
  assert.equal(capsule.verdict.status, 'no_confidence');
  assert.equal(capsule.observed.length, 0);
  assert.ok(capsule.limitations.some((value) => value.includes('explicit receipt identity')));
});

test('real Node adapter captures a changed failure frame and redacts output', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'source.js': 'export function checkout() {\n  return 20;\n}\n',
    'source.test.js': [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { checkout } from './source.js';",
      "test('checkout failure', () => assert.equal(checkout(), 20));",
      '',
    ].join('\n'),
  });
  await writeFile(
    join(root, 'source.js'),
    "export function checkout() {\n  throw new Error('token=supersecret');\n}\n"
  );

  const execution = await runClosedAdapter({
    repositoryRoot: root,
    adapter: 'node-test',
    target: 'source.test.js',
    name: 'checkout failure',
    timeoutMs: 5_000,
  });
  const capsule = await capsuleFromExecution({
    repositoryRoot: root,
    adapter: 'node-test',
    execution,
  });
  assert.equal(capsule.verdict.status, 'failed');
  assert.equal(capsule.relevant_changes[0].file, 'source.js');
  assert.equal(capsule.relevant_changes[0].reason, 'changed_frame_intersection');
  assert.equal(JSON.stringify(capsule).includes('supersecret'), false);
});

test('a clean Node diagnostic rerun is explicitly no-confidence', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'passing.test.js': [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('still passes', () => assert.equal(2 + 2, 4));",
      '',
    ].join('\n'),
  });
  const execution = await runClosedAdapter({
    repositoryRoot: root,
    adapter: 'node-test',
    target: 'passing.test.js',
    name: 'still passes',
    timeoutMs: 5_000,
  });
  const capsule = await capsuleFromExecution({
    repositoryRoot: root,
    adapter: 'node-test',
    execution,
  });
  assert.equal(capsule.verdict.status, 'no_confidence');
  assert.ok(capsule.limitations.some((value) => value.includes('did not reproduce')));
});

test('real Node adapter captures an asynchronous rejection', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'async-source.js': 'export async function checkout() {\n  return 20;\n}\n',
    'async-source.test.js': [
      "import test from 'node:test';",
      "import { checkout } from './async-source.js';",
      "test('async checkout', async () => checkout());",
      '',
    ].join('\n'),
  });
  await writeFile(
    join(root, 'async-source.js'),
    "export async function checkout() {\n  await Promise.resolve();\n  throw new Error('async failure');\n}\n"
  );
  const execution = await runClosedAdapter({
    repositoryRoot: root,
    adapter: 'node-test',
    target: 'async-source.test.js',
    name: 'async checkout',
    timeoutMs: 5_000,
  });
  const capsule = await capsuleFromExecution({
    repositoryRoot: root,
    adapter: 'node-test',
    execution,
  });
  assert.equal(capsule.verdict.status, 'failed');
  assert.equal(capsule.relevant_changes[0].file, 'async-source.js');
});

test('a timed-out Node diagnostic is terminated and returns no-confidence', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'timeout.test.js': [
      "import test from 'node:test';",
      "test('never finishes', async () => new Promise(() => {}));",
      '',
    ].join('\n'),
  });
  const execution = await runClosedAdapter({
    repositoryRoot: root,
    adapter: 'node-test',
    target: 'timeout.test.js',
    name: 'never finishes',
    timeoutMs: 200,
  });
  const capsule = await capsuleFromExecution({
    repositoryRoot: root,
    adapter: 'node-test',
    execution,
  });
  assert.equal(execution.status, 'timeout');
  assert.equal(capsule.verdict.status, 'no_confidence');
});

const goAvailable = spawnSync('go', ['version'], { stdio: 'ignore' }).status === 0;
test('real Go adapter captures a changed panic frame and redacts output', {
  skip: !goAvailable,
}, async (context) => {
  const root = await gitFixture(context, {
    'go.mod': 'module example.test/capsule\n\ngo 1.22\n',
    'price.go': 'package capsule\n\nfunc Checkout() int {\n\treturn 20\n}\n',
    'price_test.go': [
      'package capsule',
      '',
      'import "testing"',
      '',
      'func TestCheckout(t *testing.T) {',
      '\tif Checkout() != 20 { t.Fatal("wrong checkout") }',
      '}',
      '',
    ].join('\n'),
  });
  await writeFile(
    join(root, 'price.go'),
    'package capsule\n\nfunc Checkout() int {\n\tpanic("token=supersecret")\n}\n'
  );
  const execution = await runClosedAdapter({
    repositoryRoot: root,
    adapter: 'go-test',
    target: 'price_test.go',
    name: 'TestCheckout',
    timeoutMs: 10_000,
  });
  const capsule = await capsuleFromExecution({
    repositoryRoot: root,
    adapter: 'go-test',
    execution,
  });
  assert.equal(capsule.verdict.status, 'failed');
  assert.equal(capsule.relevant_changes[0].file, 'price.go');
  assert.equal(capsule.relevant_changes[0].reason, 'changed_frame_intersection');
  assert.equal(JSON.stringify(capsule).includes('supersecret'), false);
});

test('CLI emits one JSON document and stable detection, failure, and no-confidence exits', async (context) => {
  const root = await gitFixture(context, {
    'package.json': JSON.stringify({ type: 'module' }),
    'source.js': 'export function checkout() {\n  return 20;\n}\n',
    'source.test.js': [
      "import test from 'node:test';",
      "import { checkout } from './source.js';",
      "test('checkout failure', () => checkout());",
      '',
    ].join('\n'),
  });
  const cli = join(import.meta.dirname, 'cli.mjs');
  const detection = await commandCapture(process.execPath, [
    cli,
    'detect',
    '--repo',
    root,
    '--json',
  ]);
  assert.equal(detection.code, 0);
  assert.equal(detection.stdout.trim().split('\n').length, 1);
  assert.equal(JSON.parse(detection.stdout).schema_version, 'runtime-lane-detection/v1');

  const clean = await commandCapture(process.execPath, [
    cli,
    'run',
    '--repo',
    root,
    '--adapter',
    'node-test',
    '--target',
    'source.test.js',
    '--name',
    'checkout failure',
    '--json',
  ]);
  assert.equal(clean.code, 2);
  assert.equal(JSON.parse(clean.stdout).verdict.status, 'no_confidence');

  await writeFile(
    join(root, 'source.js'),
    "export function checkout() {\n  throw new Error('checkout failed');\n}\n"
  );
  const failed = await commandCapture(process.execPath, [
    cli,
    'run',
    '--repo',
    root,
    '--adapter',
    'node-test',
    '--target',
    'source.test.js',
    '--name',
    'checkout failure',
    '--json',
  ]);
  assert.equal(failed.code, 1);
  assert.equal(failed.stdout.trim().split('\n').length, 1);
  assert.equal(JSON.parse(failed.stdout).verdict.status, 'failed');
});

async function temporaryRoot(context) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-capsule-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function gitFixture(context, files) {
  const root = await temporaryRoot(context);
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  await command('git', ['init', '-q'], root);
  await command('git', ['add', '.'], root);
  await command(
    'git',
    [
      '-c',
      'user.name=CodeVetter Test',
      '-c',
      'user.email=codevetter@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'fixture baseline',
    ],
    root
  );
  return root;
}

function command(program, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${program} failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

function commandCapture(program, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}
