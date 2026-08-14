import { spawn } from 'node:child_process';
import { lstat, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { boundedTimeout, repositoryRelative } from './contracts.mjs';
import { resolveBrowserExecutionContext } from './clean-browser-execution.mjs';
import { ensureCodeVetterEvidenceRoot } from './evidence-root.mjs';
import { collectNodeFlowStreamEvents } from './flow-capture.mjs';
import { resolveNextRouteOwnership } from './next-route-ownership.mjs';
import { collectServerRequestCpuProfiles } from './server-request-cpu.mjs';
import { collectServerRequestWorkerCpuProfiles } from './server-request-worker-cpu.mjs';
import { collectServerRequestNativeActivity } from './server-request-native-activity.mjs';
import { collectServerRequestGcPressure } from './server-request-gc-pressure.mjs';
import { collectServerRequestContinuousSourceProfiles } from './server-request-continuous-source.mjs';
import {
  attestDeclaredLocalServer,
  declaredServerExpectation,
} from './local-server-attestation.mjs';
import {
  OWNED_VITE_RUNTIME_LIMITS,
  OWNED_VITE_RUNTIME_SCHEMA_VERSION,
  assertOwnedViteRuntimeSummary,
} from './owned-vite-runtime-contracts.mjs';
import {
  assertLoopbackBaseUrl,
  assertPlaywrightCaptureId,
  playwrightCandidateSafetyAllowsCapture,
  qualifiedPlaywrightDeclarationLine,
} from './playwright-capture-contracts.mjs';
import { qualifyRepository } from './qualification.mjs';
import { resolveLocalNextModule, resolveLocalViteModule } from './runner.mjs';

const OWNED_LAUNCHER = fileURLToPath(new URL('./owned-vite-server.mjs', import.meta.url));
const OWNED_NEXT_LAUNCHER = fileURLToPath(new URL('./owned-next-server.mjs', import.meta.url));
const NODE_FLOW_PRELOAD = fileURLToPath(new URL('./node-flow-preload.mjs', import.meta.url));
const NEXT_DEVELOPMENT_ENV_FILES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
]);

export async function establishQualifiedViteRuntime(
  {
    repositoryRoot,
    candidateId,
    timeoutMs,
    captureId = null,
    diagnosticProfile = 'standard',
    diagnosticTarget = null,
    executionContext = null,
  },
  {
    qualify = qualifyRepository,
    attest = attestDeclaredLocalServer,
    resolveVite = resolveLocalViteModule,
    resolveNext = resolveLocalNextModule,
    spawnProcess = spawnOwnedViteProcess,
    reachable = loopbackReachable,
    reserveAlternate = reserveAlternateLoopbackOrigin,
    warmNext = observeNextPreflight,
    armContinuousSource = armContinuousSourceProfile,
    now = () => Date.now(),
  } = {}
) {
  if (
    ![
      'standard',
      'profiler_disabled_runtime',
      'gc_pressure_runtime',
      'continuous_source_runtime',
    ].includes(diagnosticProfile)
  ) {
    throw new Error('owned browser diagnostic profile is invalid');
  }
  const continuousTarget =
    diagnosticProfile === 'continuous_source_runtime'
      ? assertContinuousDiagnosticTarget(diagnosticTarget)
      : null;
  if (diagnosticProfile !== 'continuous_source_runtime' && diagnosticTarget !== null) {
    throw new Error('owned browser diagnostic target is not accepted for this profile');
  }
  const authorityRoot = await realpath(resolve(repositoryRoot));
  const execution = await resolveBrowserExecutionContext(authorityRoot, executionContext);
  const root = execution.executionRoot;
  const safeCaptureId = captureId === null ? null : assertPlaywrightCaptureId(captureId);
  const timeout = boundedTimeout(timeoutMs);
  const qualification = execution.qualification ?? (await qualify(authorityRoot));
  const candidate = (qualification.flows ?? []).find((flow) => flow.id === candidateId);
  const declaredBaseUrl = candidateBaseUrl(candidate);
  const expectation = declaredServerExpectation(candidate);
  const reusableFamily = ['vite', 'next'].includes(expectation?.family) ? expectation.family : null;
  if (
    !candidate ||
    candidate.adapter !== 'playwright' ||
    !candidate.name ||
    !playwrightCandidateSafetyAllowsCapture(candidate) ||
    qualifiedPlaywrightDeclarationLine(candidate) === null ||
    !declaredBaseUrl ||
    !reusableFamily
  ) {
    return terminalHandle(summary({ state: 'unsupported', family: reusableFamily }));
  }

  let baseUrl = declaredBaseUrl;
  let alternateLease = null;
  if (await reachable(declaredBaseUrl)) {
    const existing = await safeAttest(attest, {
      repositoryRoot: root,
      baseUrl: declaredBaseUrl,
      candidate,
    });
    if (existing.state === 'verified_by_declared_process' && diagnosticProfile === 'standard') {
      return terminalHandle(
        summary({
          state: 'reused_attested',
          ownership: 'unowned',
          family: reusableFamily,
          configuration: 'repository_declared',
          preflight: preflightEvidence(
            reusableFamily === 'next' ? 'unavailable' : 'not_applicable'
          ),
          attestationState: existing.state,
          cleanup: 'not_owned',
        }),
        true,
        declaredBaseUrl
      );
    }
    try {
      alternateLease = await reserveAlternate(declaredBaseUrl);
      baseUrl = alternateLease?.baseUrl ?? null;
    } catch {
      baseUrl = null;
    }
    if (!baseUrl) {
      return terminalHandle(
        summary({
          state: 'blocked_listener',
          family: reusableFamily,
          attestationState: existing.state,
        })
      );
    }
  }

  let viteModule;
  let nextModule;
  let packageRoot;
  try {
    packageRoot = await containedPackageRoot(root, candidate.package_scope);
    if (reusableFamily === 'vite') {
      viteModule = await resolveVite(execution.dependencyRoot, candidate.target);
    } else {
      nextModule = await resolveNext(execution.dependencyRoot, candidate.target);
    }
  } catch {
    await releaseAlternateLease(alternateLease);
    return terminalHandle(summary({ state: 'unsupported', family: reusableFamily }));
  }
  if (reusableFamily === 'next') {
    let environmentBlocked = true;
    try {
      environmentBlocked = await hasLoadableNextEnvironmentFile(packageRoot);
    } catch {
      // File-name inspection is a required fail-closed boundary.
    }
    if (environmentBlocked) {
      await releaseAlternateLease(alternateLease);
      return terminalHandle(summary({ state: 'environment_blocked', family: 'next' }));
    }
    try {
      await ensureCodeVetterEvidenceRoot(packageRoot);
    } catch {
      await releaseAlternateLease(alternateLease);
      return terminalHandle(summary({ state: 'startup_failed', family: 'next' }));
    }
  }

  const url = new URL(baseUrl);
  const host = normalizedOwnedHost(url.hostname);
  const port = url.port ? Number(url.port) : 80;
  if (!host) {
    await releaseAlternateLease(alternateLease);
    return terminalHandle(summary({ state: 'unsupported', family: reusableFamily }));
  }
  const startedAt = now();
  let flowDirectory = null;
  if (reusableFamily === 'next' && safeCaptureId) {
    try {
      flowDirectory = await mkdtemp(`${tmpdir()}/codevetter-browser-server-flow-`);
    } catch {
      await releaseAlternateLease(alternateLease);
      return terminalHandle(summary({ state: 'startup_failed', family: 'next' }));
    }
  }
  let processHandle;
  try {
    await releaseAlternateLease(alternateLease);
    alternateLease = null;
    processHandle = spawnProcess({
      family: reusableFamily,
      viteModule,
      nextModule,
      packageRoot,
      host,
      port,
      flowDirectory,
      correlationId: safeCaptureId,
      repositoryRoot: root,
      diagnosticProfile,
      diagnosticTarget: continuousTarget,
    });
  } catch {
    await releaseAlternateLease(alternateLease);
    await removeFlowDirectory(flowDirectory);
    return terminalHandle(
      summary({
        state: 'startup_failed',
        family: reusableFamily,
        startupMs: elapsed(startedAt, now),
      })
    );
  }
  const ready = await waitForReady({
    baseUrl,
    processHandle,
    reachable,
    deadlineMs: Math.min(timeout, OWNED_VITE_RUNTIME_LIMITS.readinessMs),
    startedAt,
    now,
  });
  if (!ready) {
    const cleanup = await stopAndRemove(processHandle, flowDirectory);
    return terminalHandle(
      summary({
        state: 'startup_failed',
        ownership: 'owned',
        family: reusableFamily,
        startupMs: elapsed(startedAt, now),
        cleanup,
      })
    );
  }
  const attestation = await safeAttest(attest, { repositoryRoot: root, baseUrl, candidate });
  if (attestation.state !== 'verified_by_declared_process') {
    const cleanup = await stopAndRemove(processHandle, flowDirectory);
    return terminalHandle(
      summary({
        state: 'attestation_failed',
        ownership: 'owned',
        family: reusableFamily,
        startupMs: elapsed(startedAt, now),
        attestationState: attestation.state,
        cleanup,
      })
    );
  }

  let warmup = 'not_applicable';
  let preflight = preflightEvidence('not_applicable');
  if (reusableFamily === 'next') {
    const path = candidateWarmupPath(candidate);
    warmup = path ? 'failed' : 'unavailable';
    preflight = preflightEvidence(path ? 'failed' : 'unavailable');
    if (path) {
      const observedPreflight = await warmNext({
        baseUrl,
        path,
        timeoutMs: Math.min(
          Math.max(0, timeout - elapsed(startedAt, now)),
          OWNED_VITE_RUNTIME_LIMITS.preflightMs
        ),
        now,
      });
      try {
        preflight = assertOwnedViteRuntimeSummary(
          summary({
            state: 'owned_attested',
            ownership: 'owned',
            family: 'next',
            configuration: 'codevetter_config_disabled',
            warmup: observedPreflight?.state === 'completed' ? 'completed' : 'failed',
            preflight: observedPreflight,
            startupMs: elapsed(startedAt, now),
            attestationState: attestation.state,
          })
        ).preflight;
      } catch {
        preflight = preflightEvidence('failed');
      }
      if (preflight.state === 'completed') warmup = 'completed';
    }
    if (path && warmup !== 'completed') {
      const cleanup = await stopAndRemove(processHandle, flowDirectory);
      return terminalHandle(
        summary({
          state: 'startup_failed',
          ownership: 'owned',
          family: 'next',
          configuration: 'codevetter_config_disabled',
          warmup,
          preflight,
          startupMs: elapsed(startedAt, now),
          attestationState: attestation.state,
          cleanup,
        })
      );
    }
  }

  const initial = summary({
    state: 'owned_attested',
    ownership: 'owned',
    family: reusableFamily,
    configuration: 'codevetter_config_disabled',
    warmup,
    preflight,
    startupMs: elapsed(startedAt, now),
    attestationState: attestation.state,
    cleanup: 'pending',
  });
  let sealed = null;
  let removed = null;
  return {
    ready: true,
    baseUrl,
    summary: initial,
    async prepareDiagnostic() {
      if (diagnosticProfile !== 'continuous_source_runtime') return 'not_required';
      await armContinuousSource({
        baseUrl,
        captureId: safeCaptureId,
        timeoutMs: Math.min(timeout, OWNED_VITE_RUNTIME_LIMITS.preflightMs),
      });
      return 'continuous_source_armed';
    },
    async prepareServerFlow() {
      if (!sealed) sealed = processHandle.stop();
      return sealed;
    },
    async collectServerFlow() {
      if (reusableFamily === 'vite') return unavailableServerFlow('frontend_only_vite');
      if (!flowDirectory || !safeCaptureId) {
        return unavailableServerFlow('capture_identity_unavailable');
      }
      const evidence = await collectNodeFlowStreamEvents(flowDirectory, {
        correlationId: safeCaptureId,
      });
      if (evidence.state !== 'observed') return evidence;
      const serverEvents = evidence.events.filter((event) => event.kind === 'http_server');
      const [
        ownership,
        cpuProfiles,
        workerCpuProfiles,
        nativeActivity,
        gcPressure,
        continuousSource,
      ] = await Promise.all([
        resolveNextRouteOwnership(packageRoot, serverEvents),
        collectServerRequestCpuProfiles(flowDirectory, {
          repositoryRoot: root,
          eventIds: serverEvents.map((event) => event.event_id),
        }),
        collectServerRequestWorkerCpuProfiles(flowDirectory, {
          repositoryRoot: root,
          eventIds: serverEvents.map((event) => event.event_id),
        }),
        collectServerRequestNativeActivity(flowDirectory, {
          eventIds: serverEvents.map((event) => event.event_id),
        }),
        collectServerRequestGcPressure(flowDirectory, {
          repositoryRoot: root,
          eventIds: serverEvents.map((event) => event.event_id),
        }),
        collectServerRequestContinuousSourceProfiles(flowDirectory, {
          repositoryRoot: root,
          requests: serverEvents,
        }),
      ]);
      let index = 0;
      return {
        ...evidence,
        events: evidence.events.map((event) =>
          event.kind === 'http_server'
            ? {
                ...event,
                source: ownership[index++] ?? event.source,
                cpu: cpuProfiles.get(event.event_id) ?? null,
                worker_cpu: workerCpuProfiles.get(event.event_id) ?? null,
                native_activity: nativeActivity.get(event.event_id) ?? null,
                gc_pressure: gcPressure.get(event.event_id) ?? null,
                continuous_source: continuousSource.get(event.event_id) ?? null,
              }
            : event
        ),
      };
    },
    async stop() {
      const processCleanup = await this.prepareServerFlow();
      if (!removed) removed = removeFlowDirectory(flowDirectory);
      const artifactCleanup = await removed;
      const cleanup =
        processCleanup === 'failed' || artifactCleanup === 'failed' ? 'failed' : processCleanup;
      return assertOwnedViteRuntimeSummary({ ...initial, cleanup });
    },
  };
}

export function spawnOwnedViteProcess({
  family = 'vite',
  viteModule,
  nextModule,
  packageRoot,
  host,
  port,
  flowDirectory = null,
  correlationId = null,
  repositoryRoot = null,
  diagnosticProfile = 'standard',
  diagnosticTarget = null,
}) {
  if (!['vite', 'next'].includes(family)) throw new Error('unsupported owned server family');
  const launcher = family === 'next' ? OWNED_NEXT_LAUNCHER : OWNED_LAUNCHER;
  const runtimeModule = family === 'next' ? nextModule : viteModule;
  const child = spawn(
    process.execPath,
    ownedRuntimeArguments({
      family,
      flowDirectory,
      launcher,
      runtimeModule,
      packageRoot,
      host,
      port,
    }),
    {
      cwd: packageRoot,
      env: ownedBrowserEnvironment(family, {
        flowDirectory,
        correlationId,
        repositoryRoot,
        diagnosticProfile,
        diagnosticTarget,
      }),
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const output = boundedDiscarder();
  child.stdout.on('data', output);
  child.stderr.on('data', output);
  let closed = false;
  let closeResolve;
  const close = new Promise((resolvePromise) => {
    closeResolve = resolvePromise;
  });
  child.once('error', () => {
    closed = true;
    closeResolve();
  });
  child.once('close', () => {
    closed = true;
    closeResolve();
  });
  return {
    exited: () => closed,
    async stop() {
      if (closed) return 'already_exited';
      terminate(child, 'SIGTERM');
      if (await settlesWithin(close, OWNED_VITE_RUNTIME_LIMITS.gracefulCleanupMs)) {
        return 'terminated';
      }
      terminate(child, 'SIGKILL');
      return (await settlesWithin(close, OWNED_VITE_RUNTIME_LIMITS.forceCleanupMs))
        ? 'force_terminated'
        : 'failed';
    },
  };
}

export function ownedRuntimeArguments({
  family,
  flowDirectory,
  launcher,
  runtimeModule,
  packageRoot,
  host,
  port,
}) {
  const traceArguments =
    family === 'next' && flowDirectory
      ? [`--trace-event-file-pattern=${resolve(flowDirectory, 'native-trace.json')}`]
      : [];
  return [
    ...traceArguments,
    launcher,
    runtimeModule,
    packageRoot,
    host,
    String(port),
    `--codevetter-server-family=${family}`,
  ];
}

function terminalHandle(value, ready = false, baseUrl = null) {
  return {
    ready,
    baseUrl,
    summary: value,
    collectServerFlow: async () => unavailableServerFlow(reasonForRuntime(value)),
    stop: async () => value,
  };
}

export async function reserveAlternateLoopbackOrigin(baseUrl) {
  const original = new URL(assertLoopbackBaseUrl(baseUrl));
  const host = normalizedOwnedHost(original.hostname);
  if (!host) return null;
  const server = createServer();
  let released = false;
  try {
    await new Promise((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen({ host, port: 0, exclusive: true }, resolvePromise);
    });
    const address = server.address();
    if (!address || typeof address === 'string' || !Number.isInteger(address.port)) {
      await closeReservation(server);
      return null;
    }
    const effective = new URL(original.href);
    effective.port = String(address.port);
    return {
      baseUrl: effective.href.replace(/\/$/, ''),
      async release() {
        if (released) return;
        released = true;
        await closeReservation(server);
      },
    };
  } catch {
    await closeReservation(server);
    return null;
  }
}

async function releaseAlternateLease(lease) {
  try {
    await lease?.release();
  } catch {
    // A failed release is followed by a bounded startup/attestation failure.
  }
}

function closeReservation(server) {
  return new Promise((resolvePromise) => {
    if (!server.listening) return resolvePromise();
    server.close(() => resolvePromise());
  });
}

function summary({
  state,
  ownership = 'none',
  family = null,
  configuration = null,
  warmup = 'not_applicable',
  preflight = preflightEvidence('not_applicable'),
  startupMs = 0,
  attestationState = null,
  cleanup = ownership === 'none' ? 'not_started' : 'pending',
}) {
  return assertOwnedViteRuntimeSummary({
    schema_version: OWNED_VITE_RUNTIME_SCHEMA_VERSION,
    state,
    ownership,
    family,
    configuration,
    warmup,
    preflight,
    startup_ms: Math.min(OWNED_VITE_RUNTIME_LIMITS.startupMs, Math.max(0, startupMs)),
    attestation_state: attestationState,
    cleanup,
  });
}

async function containedPackageRoot(root, packageScope) {
  if (typeof packageScope !== 'string') throw new Error('package scope is missing');
  const lexical = resolve(root, packageScope);
  if (lexical !== root && repositoryRelative(root, lexical) === null) {
    throw new Error('package scope escapes');
  }
  const resolved = await realpath(lexical);
  if (resolved !== root && repositoryRelative(root, resolved) === null) {
    throw new Error('package scope symlink escapes');
  }
  const metadata = await lstat(resolved);
  if (!metadata.isDirectory()) throw new Error('package scope is not a directory');
  return resolved;
}

function candidateBaseUrl(candidate) {
  const values = (candidate?.signals ?? []).filter(
    (signal) => signal.kind === 'loopback_browser_base_url'
  );
  if (values.length !== 1) return null;
  try {
    return assertLoopbackBaseUrl(values[0].evidence);
  } catch {
    return null;
  }
}

function candidateWarmupPath(candidate) {
  const values = (candidate?.signals ?? []).filter(
    (signal) => signal.kind === 'declared_browser_warmup_path'
  );
  const path = values.length === 1 ? values[0].evidence : null;
  return typeof path === 'string' && /^\/(?!\/)[^?#\r\n]{0,500}$/.test(path) ? path : null;
}

function normalizedOwnedHost(hostname) {
  if (hostname === '127.0.0.1' || hostname === 'localhost') return '127.0.0.1';
  if (hostname === '[::1]' || hostname === '::1') return '::1';
  return null;
}

async function waitForReady({ baseUrl, processHandle, reachable, deadlineMs, startedAt, now }) {
  while (elapsed(startedAt, now) < deadlineMs) {
    if (processHandle.exited()) return false;
    if (await reachable(baseUrl)) return true;
    await delay(40);
  }
  return false;
}

async function safeAttest(attest, input) {
  try {
    return await attest(input);
  } catch {
    return { state: 'inspection_unavailable' };
  }
}

export async function loopbackReachable(baseUrl) {
  const url = new URL(assertLoopbackBaseUrl(baseUrl));
  const port = url.port ? Number(url.port) : 80;
  const host = normalizedOwnedHost(url.hostname);
  if (!host) return false;
  return new Promise((resolvePromise) => {
    const socket = connect({ host, port });
    const finish = (value) => {
      socket.destroy();
      resolvePromise(value);
    };
    socket.setTimeout(200, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export async function observeNextPreflight({ baseUrl, path, timeoutMs, now = () => Date.now() }) {
  const origin = new URL(assertLoopbackBaseUrl(baseUrl));
  if (typeof path !== 'string' || !/^\/(?!\/)[^?#\r\n]{0,500}$/.test(path)) {
    return preflightEvidence('unavailable');
  }
  const target = new URL(path, origin);
  if (target.origin !== origin.origin || target.search || target.hash) {
    return preflightEvidence('unavailable');
  }
  const startedAt = now();
  const deadlineMs = Math.min(OWNED_VITE_RUNTIME_LIMITS.preflightMs, Math.max(1, timeoutMs));
  const requests = [];
  for (let ordinal = 1; ordinal <= OWNED_VITE_RUNTIME_LIMITS.preflightRequests; ordinal += 1) {
    const elapsedMs = Math.max(0, now() - startedAt);
    const remainingMs = Math.max(0, deadlineMs - elapsedMs);
    if (remainingMs < 1) return preflightEvidence('failed', requests);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);
    const requestStartedAt = now();
    try {
      const response = await fetchBoundedPreflightRedirects(target, origin, controller.signal);
      const durationMs = Math.min(
        OWNED_VITE_RUNTIME_LIMITS.preflightMs,
        Math.max(0, Math.round(now() - requestStartedAt))
      );
      await response.body?.cancel();
      requests.push({
        ordinal,
        duration_ms: durationMs,
        status_class: `${Math.floor(response.status / 100)}xx`,
      });
      if (
        response.status < 100 ||
        response.status > 599 ||
        Math.floor(response.status / 100) === 3
      ) {
        return preflightEvidence('failed', requests);
      }
    } catch {
      return preflightEvidence('failed', requests);
    } finally {
      clearTimeout(timeout);
    }
  }
  return preflightEvidence('completed', requests);
}

async function fetchBoundedPreflightRedirects(initialTarget, origin, signal) {
  let target = initialTarget;
  const visited = new Set();
  for (
    let redirects = 0;
    redirects <= OWNED_VITE_RUNTIME_LIMITS.preflightRedirects;
    redirects += 1
  ) {
    const identity = target.href;
    if (visited.has(identity)) throw new Error('Next preflight redirect cycle');
    visited.add(identity);
    const response = await fetch(target, { method: 'GET', redirect: 'manual', signal });
    if (response.status < 300 || response.status > 399) return response;
    if (redirects === OWNED_VITE_RUNTIME_LIMITS.preflightRedirects) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    const redirected = new URL(location, target);
    if (
      redirected.origin !== origin.origin ||
      redirected.username ||
      redirected.password ||
      redirected.search ||
      redirected.hash
    ) {
      return response;
    }
    await response.body?.cancel();
    target = redirected;
  }
  throw new Error('Next preflight redirect bound is invalid');
}

export const warmNextPath = observeNextPreflight;

export async function armContinuousSourceProfile({ baseUrl, captureId, timeoutMs }) {
  const origin = new URL(assertLoopbackBaseUrl(baseUrl));
  const safeCaptureId = assertPlaywrightCaptureId(captureId);
  const response = await fetch(new URL('/.codevetter/continuous-source-arm', origin), {
    method: 'POST',
    headers: { 'x-codevetter-continuous-source-arm': safeCaptureId },
    redirect: 'error',
    signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, 10_000))),
  });
  await response.body?.cancel();
  if (response.status !== 204) {
    throw new Error('owned continuous-source profiler could not be armed');
  }
}

function preflightEvidence(state, requests = []) {
  const retained = requests.slice(0, OWNED_VITE_RUNTIME_LIMITS.preflightRequests);
  return {
    state,
    inventory: {
      total: retained.length,
      retained: retained.length,
      complete:
        state === 'completed' && retained.length === OWNED_VITE_RUNTIME_LIMITS.preflightRequests,
    },
    requests: retained,
  };
}

export function ownedBrowserEnvironment(
  family,
  {
    flowDirectory = null,
    correlationId = null,
    repositoryRoot = null,
    diagnosticProfile = 'standard',
    diagnosticTarget = null,
  } = {}
) {
  if (
    !['standard', 'profiler_disabled_runtime', 'gc_pressure_runtime'].includes(diagnosticProfile) &&
    diagnosticProfile !== 'continuous_source_runtime'
  ) {
    throw new Error('owned browser diagnostic profile is invalid');
  }
  const environment = { CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
  for (const name of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT']) {
    if (typeof process.env[name] === 'string') environment[name] = process.env[name];
  }
  if (family === 'next') {
    environment.NODE_ENV = 'development';
    environment.NEXT_TELEMETRY_DISABLED = '1';
    if (flowDirectory && correlationId && repositoryRoot) {
      environment.NODE_OPTIONS = `--import=${pathToFileURL(NODE_FLOW_PRELOAD).href}`;
      environment.CODEVETTER_FLOW_DIRECTORY = flowDirectory;
      environment.CODEVETTER_REPOSITORY_ROOT = repositoryRoot;
      environment.CODEVETTER_FLOW_STREAM = '1';
      if (diagnosticProfile === 'standard') environment.CODEVETTER_FLOW_CPU = '1';
      if (diagnosticProfile === 'gc_pressure_runtime') environment.CODEVETTER_GC_PRESSURE = '1';
      if (diagnosticProfile === 'continuous_source_runtime') {
        const target = assertContinuousDiagnosticTarget(diagnosticTarget);
        environment.CODEVETTER_CONTINUOUS_SOURCE = '1';
        environment.CODEVETTER_CONTINUOUS_SOURCE_ORDINAL = String(target.ordinal);
        environment.CODEVETTER_CONTINUOUS_SOURCE_METHOD = target.method;
        environment.CODEVETTER_CONTINUOUS_SOURCE_ROUTE = target.route;
      }
      environment.CODEVETTER_FLOW_ASYNC = '1';
      environment.CODEVETTER_NATIVE_ACTIVITY = '1';
      environment.CODEVETTER_FLOW_CORRELATION_ID = correlationId;
      environment.NEXT_OTEL_PERFORMANCE_PREFIX = 'codevetter-next-phase';
    }
  }
  return environment;
}

function assertContinuousDiagnosticTarget(value) {
  if (
    !value ||
    Object.keys(value).length !== 3 ||
    !Number.isSafeInteger(value.ordinal) ||
    value.ordinal < 1 ||
    !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(value.method) ||
    typeof value.route !== 'string' ||
    !value.route.startsWith('/') ||
    value.route.includes('?') ||
    value.route.length > 256
  ) {
    throw new Error('owned browser continuous-source target is invalid');
  }
  return { ordinal: value.ordinal, method: value.method, route: value.route };
}

async function stopAndRemove(processHandle, flowDirectory) {
  const processCleanup = await processHandle.stop();
  const artifactCleanup = await removeFlowDirectory(flowDirectory);
  return processCleanup === 'failed' || artifactCleanup === 'failed' ? 'failed' : processCleanup;
}

async function removeFlowDirectory(flowDirectory) {
  if (!flowDirectory) return 'not_started';
  try {
    await rm(flowDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    return 'removed';
  } catch {
    return 'failed';
  }
}

function unavailableServerFlow(reason) {
  return {
    schema_version: 'runtime-node-flow-stream/v1',
    state: 'unavailable',
    files: 0,
    bytes: 0,
    events: [],
    complete: false,
    truncated: false,
    reason,
  };
}

function reasonForRuntime(value) {
  if (value.state === 'environment_blocked') return 'environment_blocked';
  if (value.state === 'reused_attested') return 'existing_listener_unowned';
  if (value.family === 'vite') return 'frontend_only_vite';
  if (value.ownership !== 'owned') return 'runtime_not_owned';
  return 'unsupported_runtime';
}

export async function hasLoadableNextEnvironmentFile(packageRoot) {
  const entries = await readdir(packageRoot);
  return entries.some((entry) => NEXT_DEVELOPMENT_ENV_FILES.has(entry));
}

function boundedDiscarder() {
  let retained = 0;
  return (chunk) => {
    retained = Math.min(OWNED_VITE_RUNTIME_LIMITS.outputBytes, retained + Buffer.byteLength(chunk));
  };
}

function terminate(child, signal) {
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The process already exited.
  }
}

async function settlesWithin(promise, timeoutMs) {
  return Promise.race([promise.then(() => true), delay(timeoutMs).then(() => false)]);
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function elapsed(startedAt, now) {
  return Math.min(OWNED_VITE_RUNTIME_LIMITS.startupMs, Math.max(0, now() - startedAt));
}
