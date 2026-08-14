import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  armContinuousSourceProfile,
  establishQualifiedViteRuntime,
  hasLoadableNextEnvironmentFile,
  observeNextPreflight,
  ownedBrowserEnvironment,
  ownedRuntimeArguments,
} from './owned-vite-runtime.mjs';
import { validateOwnedViteRuntimeSummary } from './owned-vite-runtime-contracts.mjs';

test('owned Next runtime contains native trace output without process-lifetime categories', () => {
  const input = {
    family: 'next',
    flowDirectory: '/tmp/codevetter-owned-flow',
    launcher: '/tool/owned-next.mjs',
    runtimeModule: '/repo/next.js',
    packageRoot: '/repo',
    host: '127.0.0.1',
    port: 3000,
  };
  const args = ownedRuntimeArguments(input);
  assert.equal(args[0], '--trace-event-file-pattern=/tmp/codevetter-owned-flow/native-trace.json');
  assert.equal(
    args.some((arg) => arg.startsWith('--trace-event-categories')),
    false
  );
  assert.equal(ownedRuntimeArguments({ ...input, family: 'vite' })[0], input.launcher);
});

test('profiler-disabled runtime omits sampling while preserving bounded request evidence', () => {
  const base = {
    flowDirectory: '/tmp/codevetter-owned-flow',
    correlationId: 'owned-capture',
    repositoryRoot: '/repo',
  };
  const standard = ownedBrowserEnvironment('next', base);
  const lower = ownedBrowserEnvironment('next', {
    ...base,
    diagnosticProfile: 'profiler_disabled_runtime',
  });
  const gc = ownedBrowserEnvironment('next', {
    ...base,
    diagnosticProfile: 'gc_pressure_runtime',
  });
  const continuous = ownedBrowserEnvironment('next', {
    ...base,
    diagnosticProfile: 'continuous_source_runtime',
    diagnosticTarget: { ordinal: 2, method: 'POST', route: '/api/work' },
  });
  assert.equal(standard.CODEVETTER_FLOW_CPU, '1');
  assert.equal(Object.hasOwn(lower, 'CODEVETTER_FLOW_CPU'), false);
  assert.equal(Object.hasOwn(gc, 'CODEVETTER_FLOW_CPU'), false);
  assert.equal(gc.CODEVETTER_GC_PRESSURE, '1');
  assert.equal(continuous.CODEVETTER_CONTINUOUS_SOURCE, '1');
  assert.equal(continuous.CODEVETTER_CONTINUOUS_SOURCE_ORDINAL, '2');
  assert.equal(continuous.CODEVETTER_CONTINUOUS_SOURCE_METHOD, 'POST');
  assert.equal(continuous.CODEVETTER_CONTINUOUS_SOURCE_ROUTE, '/api/work');
  assert.equal(Object.hasOwn(continuous, 'CODEVETTER_FLOW_CPU'), false);
  for (const name of [
    'CODEVETTER_FLOW_STREAM',
    'CODEVETTER_FLOW_ASYNC',
    'CODEVETTER_NATIVE_ACTIVITY',
    'CODEVETTER_FLOW_CORRELATION_ID',
  ]) {
    assert.equal(lower[name], standard[name]);
    assert.equal(gc[name], standard[name]);
    assert.equal(continuous[name], standard[name]);
  }
  assert.throws(
    () => ownedBrowserEnvironment('next', { ...base, diagnosticProfile: 'caller-value' }),
    /invalid/
  );
  assert.throws(
    () =>
      ownedBrowserEnvironment('next', {
        ...base,
        diagnosticProfile: 'continuous_source_runtime',
        diagnosticTarget: { ordinal: 1, method: 'GET', route: 'https://production.example' },
      }),
    /target is invalid/
  );
});

test('continuous source arm uses one private loopback request', async (context) => {
  let observed = null;
  const server = createServer((request, response) => {
    observed = {
      method: request.method,
      path: request.url,
      arm: request.headers['x-codevetter-continuous-source-arm'],
    };
    response.statusCode = 204;
    response.end();
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await armContinuousSourceProfile({
    baseUrl: `http://127.0.0.1:${address.port}`,
    captureId: 'continuous-capture',
    timeoutMs: 1_000,
  });
  assert.deepEqual(observed, {
    method: 'POST',
    path: '/.codevetter/continuous-source-arm',
    arm: 'continuous-capture',
  });
});

test('owned Next runtime uses a config-disabled attested lifecycle', async (context) => {
  const root = await fixtureRepository(context);
  const candidate = nextCandidate();
  let reachabilityChecks = 0;
  let spawnInput = null;
  let warmed = null;
  let stopCalls = 0;
  const runtime = await establishQualifiedViteRuntime(
    {
      repositoryRoot: root,
      candidateId: candidate.id,
      timeoutMs: 5_000,
      captureId: 'owned-next-capture',
    },
    {
      qualify: async () => qualification(candidate),
      resolveNext: async () => join(root, 'node_modules/next/dist/server/next.js'),
      reachable: async () => reachabilityChecks++ > 0,
      spawnProcess: (input) => {
        spawnInput = input;
        return {
          exited: () => false,
          stop: async () => {
            stopCalls += 1;
            return 'terminated';
          },
        };
      },
      attest: async () => ({ state: 'verified_by_declared_process' }),
      warmNext: async (input) => {
        warmed = input;
        return completedPreflight(120, 8);
      },
      now: clock(),
    }
  );

  assert.equal(runtime.ready, true);
  assert.equal(runtime.summary.family, 'next');
  assert.equal(runtime.summary.configuration, 'codevetter_config_disabled');
  assert.equal(runtime.summary.warmup, 'completed');
  assert.deepEqual(runtime.summary.preflight, completedPreflight(120, 8));
  assert.equal(runtime.summary.ownership, 'owned');
  assert.equal(spawnInput.family, 'next');
  assert.equal(spawnInput.packageRoot, root);
  assert.equal(spawnInput.correlationId, 'owned-next-capture');
  assert.equal(spawnInput.diagnosticProfile, 'standard');
  assert.ok(spawnInput.flowDirectory.includes('codevetter-browser-server-flow-'));
  assert.equal(warmed.path, '/');
  await writeFile(
    join(spawnInput.flowDirectory, 'flow-1.ndjson'),
    `${JSON.stringify({
      schema_version: 'codevetter-node-flow-event/v1',
      event: {
        id: 'event-1',
        kind: 'http_server',
        method: 'GET',
        route: '/api/items',
        status: 200,
        outcome: 'ok',
        parent_event_id: null,
        started_at_ms: 1,
        duration_ms: 2,
        correlation_id: 'owned-next-capture',
        correlation_ordinal: 1,
      },
    })}\n`
  );
  assert.equal(await runtime.prepareServerFlow(), 'terminated');
  assert.equal(await runtime.prepareServerFlow(), 'terminated');
  assert.equal(stopCalls, 1);
  assert.match(await readFile(join(spawnInput.flowDirectory, 'flow-1.ndjson'), 'utf8'), /event-1/);
  const serverFlow = await runtime.collectServerFlow();
  assert.equal(serverFlow.state, 'observed');
  assert.equal(serverFlow.events.length, 1);
  assert.deepEqual(serverFlow.events[0].source, {
    file: 'src/app/api/items/route.ts',
    line: 1,
    function: 'GET',
    provenance: 'static_unique_next_route',
  });
  assert.equal((await runtime.stop()).cleanup, 'terminated');
  assert.equal(stopCalls, 1);
  await assert.rejects(() => readFile(join(spawnInput.flowDirectory, 'flow-1.ndjson')), /ENOENT/);
});

test('owned Next runtime rejects loadable development environment files', async (context) => {
  const root = await fixtureRepository(context);
  await writeFile(join(root, '.env.local'), 'SHOULD_NOT_BE_READ=test\n');
  const candidate = nextCandidate();
  let spawned = false;
  const runtime = await establishQualifiedViteRuntime(
    { repositoryRoot: root, candidateId: candidate.id, timeoutMs: 5_000 },
    {
      qualify: async () => qualification(candidate),
      resolveNext: async () => join(root, 'node_modules/next/dist/server/next.js'),
      reachable: async () => false,
      spawnProcess: () => {
        spawned = true;
      },
    }
  );

  assert.equal(await hasLoadableNextEnvironmentFile(root), true);
  assert.equal(runtime.ready, false);
  assert.equal(runtime.summary.state, 'environment_blocked');
  assert.equal(spawned, false);
});

test('an attested existing Next listener remains unowned repository configuration', async (context) => {
  const root = await fixtureRepository(context);
  const candidate = nextCandidate();
  const runtime = await establishQualifiedViteRuntime(
    { repositoryRoot: root, candidateId: candidate.id, timeoutMs: 5_000 },
    {
      qualify: async () => qualification(candidate),
      reachable: async () => true,
      attest: async () => ({ state: 'verified_by_declared_process' }),
    }
  );

  assert.equal(runtime.ready, true);
  assert.equal(runtime.summary.configuration, 'repository_declared');
  assert.equal(runtime.summary.ownership, 'unowned');
  assert.equal(runtime.summary.preflight.state, 'unavailable');
  assert.equal((await runtime.collectServerFlow()).reason, 'existing_listener_unowned');
  assert.equal((await runtime.stop()).cleanup, 'not_owned');
});

test('profiler-disabled capture does not reuse an unowned listener', async (context) => {
  const root = await fixtureRepository(context);
  const candidate = nextCandidate();
  let attestations = 0;
  let spawnInput = null;
  const runtime = await establishQualifiedViteRuntime(
    {
      repositoryRoot: root,
      candidateId: candidate.id,
      timeoutMs: 5_000,
      captureId: 'lower-overhead-capture',
      diagnosticProfile: 'profiler_disabled_runtime',
    },
    {
      qualify: async () => qualification(candidate),
      resolveNext: async () => join(root, 'node_modules/next/dist/server/next.js'),
      reachable: async () => true,
      reserveAlternate: async () => ({
        baseUrl: 'http://127.0.0.1:43118',
        release: async () => {},
      }),
      spawnProcess: (input) => {
        spawnInput = input;
        return { exited: () => false, stop: async () => 'terminated' };
      },
      attest: async () => {
        attestations += 1;
        return { state: 'verified_by_declared_process' };
      },
      warmNext: async () => completedPreflight(90, 7),
      now: clock(),
    }
  );
  assert.equal(runtime.ready, true);
  assert.equal(runtime.summary.ownership, 'owned');
  assert.equal(runtime.baseUrl, 'http://127.0.0.1:43118');
  assert.equal(spawnInput.diagnosticProfile, 'profiler_disabled_runtime');
  assert.equal(attestations, 2);
  await runtime.stop();
});

test('an unrelated declared-port listener is preserved while an owned runtime uses an alternate loopback lease', async (context) => {
  const root = await fixtureRepository(context);
  const candidate = nextCandidate();
  let released = false;
  let spawned = false;
  let attestations = 0;
  const runtime = await establishQualifiedViteRuntime(
    { repositoryRoot: root, candidateId: candidate.id, timeoutMs: 5_000 },
    {
      qualify: async () => qualification(candidate),
      resolveNext: async () => join(root, 'node_modules/next/dist/server/next.js'),
      reachable: async () => true,
      reserveAlternate: async () => ({
        baseUrl: 'http://127.0.0.1:43117',
        release: async () => {
          released = true;
        },
      }),
      spawnProcess: (input) => {
        assert.equal(released, true);
        assert.equal(input.port, 43117);
        spawned = true;
        return { exited: () => false, stop: async () => 'terminated' };
      },
      attest: async () => ({
        state: attestations++ === 0 ? 'listener_mismatch' : 'verified_by_declared_process',
      }),
      warmNext: async ({ baseUrl }) =>
        baseUrl === 'http://127.0.0.1:43117' ? completedPreflight(90, 7) : failedPreflight(),
      now: clock(),
    }
  );

  assert.equal(runtime.ready, true);
  assert.equal(runtime.baseUrl, 'http://127.0.0.1:43117');
  assert.equal(runtime.summary.ownership, 'owned');
  assert.equal(spawned, true);
  assert.equal(attestations, 2);
  assert.equal((await runtime.stop()).cleanup, 'terminated');
});

test('Next preflight retains two body-free timing observations without response values', async (context) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.setHeader('x-private-token', 'secret-preflight-header');
    response.end('secret-preflight-body');
  });
  const baseUrl = await listenServer(context, server);
  const preflight = await observeNextPreflight({ baseUrl, path: '/', timeoutMs: 1_000 });

  assert.equal(requests, 2);
  assert.equal(preflight.state, 'completed');
  assert.equal(preflight.inventory.complete, true);
  assert.deepEqual(
    preflight.requests.map((request) => ({
      ordinal: request.ordinal,
      status: request.status_class,
    })),
    [
      { ordinal: 1, status: '2xx' },
      { ordinal: 2, status: '2xx' },
    ]
  );
  assert.doesNotMatch(JSON.stringify(preflight), /secret-preflight|localhost|127\.0\.0\.1/);
});

test('Next preflight follows bounded query-free same-origin redirects and fails closed otherwise', async (context) => {
  let redirectedRequests = 0;
  const redirect = createServer((request, response) => {
    redirectedRequests += 1;
    if (request.url === '/') {
      response.writeHead(302, { location: '/public-destination' });
      response.end();
    } else {
      response.end('bounded destination');
    }
  });
  const redirectUrl = await listenServer(context, redirect);
  const redirected = await observeNextPreflight({
    baseUrl: redirectUrl,
    path: '/',
    timeoutMs: 1_000,
  });
  assert.equal(redirectedRequests, 4);
  assert.equal(redirected.state, 'completed');
  assert.equal(redirected.inventory.complete, true);
  assert.deepEqual(
    redirected.requests.map((request) => request.status_class),
    ['2xx', '2xx']
  );

  const crossOrigin = createServer((_request, response) => {
    response.writeHead(302, { location: 'https://example.invalid/private' });
    response.end();
  });
  const crossOriginUrl = await listenServer(context, crossOrigin);
  const blockedRedirect = await observeNextPreflight({
    baseUrl: crossOriginUrl,
    path: '/',
    timeoutMs: 1_000,
  });
  assert.equal(blockedRedirect.state, 'failed');
  assert.equal(blockedRedirect.requests[0].status_class, '3xx');

  const hanging = createServer(() => {});
  const hangingUrl = await listenServer(context, hanging);
  const timedOut = await observeNextPreflight({ baseUrl: hangingUrl, path: '/', timeoutMs: 20 });
  assert.equal(timedOut.state, 'failed');
  assert.equal(timedOut.requests.length, 0);
  assert.equal(timedOut.inventory.complete, false);
});

test('runtime preflight contract rejects extra values, bounds, and inconsistent completion', () => {
  const valid = {
    schema_version: 'runtime-local-browser-server/v3',
    state: 'owned_attested',
    ownership: 'owned',
    family: 'next',
    configuration: 'codevetter_config_disabled',
    warmup: 'completed',
    preflight: completedPreflight(100, 20),
    startup_ms: 100,
    attestation_state: 'verified_by_declared_process',
    cleanup: 'pending',
  };
  assert.deepEqual(validateOwnedViteRuntimeSummary(valid), []);
  assert.match(
    validateOwnedViteRuntimeSummary({
      ...valid,
      preflight: { ...valid.preflight, private_path: '/secret' },
    }).join('; '),
    /unknown field/
  );
  assert.match(
    validateOwnedViteRuntimeSummary({
      ...valid,
      preflight: {
        state: 'completed',
        inventory: { total: 1, retained: 1, complete: true },
        requests: valid.preflight.requests.slice(0, 1),
      },
    }).join('; '),
    /complete request inventory/
  );
});

test('owned Vite and unowned Next runtimes never gain completed preflight authority', async (context) => {
  const root = await fixtureRepository(context);
  const candidate = nextCandidate();
  candidate.signals = candidate.signals.map((signal) =>
    signal.kind === 'declared_browser_server_family' ? { ...signal, evidence: 'vite' } : signal
  );
  let reachabilityChecks = 0;
  let preflightCalled = false;
  const runtime = await establishQualifiedViteRuntime(
    { repositoryRoot: root, candidateId: candidate.id, timeoutMs: 5_000 },
    {
      qualify: async () => qualification(candidate),
      resolveVite: async () => join(root, 'node_modules/vite/dist/node/index.js'),
      reachable: async () => reachabilityChecks++ > 0,
      spawnProcess: () => ({ exited: () => false, stop: async () => 'terminated' }),
      attest: async () => ({ state: 'verified_by_declared_process' }),
      warmNext: async () => {
        preflightCalled = true;
        return completedPreflight(100, 10);
      },
      now: clock(),
    }
  );

  assert.equal(runtime.ready, true);
  assert.equal(runtime.summary.family, 'vite');
  assert.equal(runtime.summary.preflight.state, 'not_applicable');
  assert.equal(preflightCalled, false);
  assert.equal((await runtime.stop()).cleanup, 'terminated');
});

test('owned Next write guard suppresses framework metadata writes only', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-next-write-guard-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'next-env.d.ts'), 'original-env\n');
  await writeFile(join(root, 'tsconfig.json'), '{"original":true}\n');
  const guard = fileURLToPath(new URL('./owned-next-write-guard.mjs', import.meta.url));
  const source = [
    `import { installOwnedNextWriteGuard } from ${JSON.stringify(pathToFileURL(guard).href)};`,
    "import fs from 'node:fs';",
    "import { join } from 'node:path';",
    `const root = ${JSON.stringify(root)};`,
    'installOwnedNextWriteGuard(root);',
    "await fs.promises.writeFile(join(root, 'next-env.d.ts'), 'mutated-env\\n');",
    "fs.writeFileSync(join(root, 'tsconfig.json'), '{\"mutated\":true}\\n');",
    "await fs.promises.writeFile(join(root, 'allowed.txt'), 'allowed\\n');",
  ].join('\n');
  await runChild(source);

  assert.equal(await readFile(join(root, 'next-env.d.ts'), 'utf8'), 'original-env\n');
  assert.equal(await readFile(join(root, 'tsconfig.json'), 'utf8'), '{"original":true}\n');
  assert.equal(await readFile(join(root, 'allowed.txt'), 'utf8'), 'allowed\n');
});

async function fixtureRepository(context) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-owned-next-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'e2e'), { recursive: true });
  await mkdir(join(root, 'src/app/api/items'), { recursive: true });
  await writeFile(join(root, 'e2e/home.spec.ts'), 'test("loads home", async () => {})\n');
  await writeFile(join(root, 'src/app/api/items/route.ts'), 'export async function GET() {}\n');
  return realpath(root);
}

function nextCandidate() {
  return {
    id: 'next-home',
    adapter: 'playwright',
    package_scope: '.',
    target: 'e2e/home.spec.ts',
    name: 'loads home',
    signals: [
      { kind: 'loopback_browser_base_url', evidence: 'http://127.0.0.1:3000' },
      { kind: 'declared_browser_server_family', evidence: 'next' },
      { kind: 'declared_browser_server_command_sha256', evidence: 'a'.repeat(64) },
      { kind: 'declared_browser_warmup_path', evidence: '/' },
    ],
    safety_flags: [{ kind: 'browser_signal', evidence: 'e2e/home.spec.ts' }],
    evidence: [{ kind: 'literal_test_declaration', file: 'e2e/home.spec.ts', line: 1 }],
  };
}

function qualification(candidate) {
  return {
    subject: { repository_revision: 'a'.repeat(40), dirty: false },
    flows: [candidate],
  };
}

function clock() {
  let now = 0;
  return () => (now += 10);
}

function completedPreflight(firstDurationMs, secondDurationMs) {
  return {
    state: 'completed',
    inventory: { total: 2, retained: 2, complete: true },
    requests: [
      { ordinal: 1, duration_ms: firstDurationMs, status_class: '2xx' },
      { ordinal: 2, duration_ms: secondDurationMs, status_class: '2xx' },
    ],
  };
}

function failedPreflight() {
  return {
    state: 'failed',
    inventory: { total: 0, retained: 0, complete: false },
    requests: [],
  };
}

function listenServer(context, server) {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      context.after(() => new Promise((resolveClose) => server.close(() => resolveClose())));
      const address = server.address();
      resolvePromise(`http://127.0.0.1:${address.port}`);
    });
  });
}

function runChild(source) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      env: {
        CI: '1',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        ...Object.fromEntries(
          ['PATH', 'TMPDIR', 'TMP', 'TEMP'].flatMap((name) =>
            typeof process.env[name] === 'string' ? [[name, process.env[name]]] : []
          )
        ),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`write guard failed: ${stderr.slice(0, 500)}`))
    );
  });
}
