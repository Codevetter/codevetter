import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { inspectDurableBrowserProbe } from './browser-probe-inspection.mjs';
import { BROWSER_SERVER_FLOW_PRESENTATION_PROFILES } from './browser-server-flow.mjs';
import { createCleanBrowserExecution } from './clean-browser-execution.mjs';
import { boundedTimeout, repositoryRelative } from './contracts.mjs';
import { ensureCodeVetterEvidenceRoot } from './evidence-root.mjs';
import { establishQualifiedViteRuntime } from './owned-vite-runtime.mjs';
import {
  captureQualifiedPlaywrightFlow,
  loadPlaywrightCaptureResult,
} from './playwright-capture.mjs';
import {
  PLAYWRIGHT_CAPTURE_LIMITS,
  assertPlaywrightCaptureId,
} from './playwright-capture-contracts.mjs';
import { qualifyRepository } from './qualification.mjs';
import { redactText } from './redact.mjs';
import { SERVER_REQUEST_RUNTIME_MECHANISMS } from './server-request-cpu.mjs';
import {
  assertLowOverheadRuntimeCorroboration,
  createLowOverheadRuntimeCorroboration,
} from './low-overhead-runtime.mjs';
import {
  assertServerRequestGcPressureSummary,
  createIncompleteGcPressureSummary,
  validServerRequestGcPressureSummary,
} from './server-request-gc-pressure.mjs';
import {
  assertContinuousSourceSummary,
  emptyContinuousSourceSummary,
} from './server-request-continuous-source.mjs';

export const BROWSER_PROBE_RECAPTURE_SCHEMA_VERSION = 'runtime-browser-probe-recapture/v5';
export const BROWSER_PROBE_RECAPTURE_LEGACY_SCHEMA_VERSIONS = Object.freeze([
  'runtime-browser-probe-recapture/v1',
  'runtime-browser-probe-recapture/v2',
  'runtime-browser-probe-recapture/v3',
  'runtime-browser-probe-recapture/v4',
]);
export const BROWSER_PROBE_RECAPTURE_LIMITS = Object.freeze({ receiptBytes: 64 * 1024 });

const PROBE_RUNS_DIRECTORY = '.codevetter/browser-probe-runs';
const INVENTORY_PROBE = 'complete_async_and_framework_inventories';
const RUNTIME_PROBE = 'inspect_main_thread_runtime';
const LOW_OVERHEAD_PROBE = 'repeat_with_lower_overhead_cpu_measurement';
const GC_PRESSURE_PROBE = 'inspect_gc_pressure';
const CONTINUOUS_SOURCE_PROBE = 'inspect_continuous_main_thread_source';
const SUPPORTED_PROBES = new Set([
  INVENTORY_PROBE,
  RUNTIME_PROBE,
  LOW_OVERHEAD_PROBE,
  GC_PRESSURE_PROBE,
  CONTINUOUS_SOURCE_PROBE,
]);
let temporarySequence = 0;

export async function recaptureDurableBrowserProbe(
  repositoryRoot,
  input,
  {
    inspectProbe = inspectDurableBrowserProbe,
    qualify = qualifyRepository,
    establishRuntime = establishQualifiedViteRuntime,
    createBrowserExecution = createCleanBrowserExecution,
    captureBrowser = captureQualifiedPlaywrightFlow,
    loadCaptureResult = loadPlaywrightCaptureResult,
  } = {}
) {
  const requestedRoot = resolve(repositoryRoot);
  const root = await realpath(requestedRoot);
  const request = assertRecaptureInput(input);
  const sourceCaptureId = request.capture_id;
  const probe = request.probe;
  const recaptureId = request.recapture_id;
  const timeoutMs = request.timeout_ms;
  if (sourceCaptureId === recaptureId) throw new Error('browser probe recapture requires a new ID');
  if (request.source_recapture_id === recaptureId) {
    throw new Error('browser probe recapture cannot overwrite its upstream receipt');
  }

  const sourceReceiptPath = `.codevetter/playwright-runs/${sourceCaptureId}/receipt.json`;
  const sourceReceiptSha256 = await digestContainedFile(
    root,
    sourceReceiptPath,
    PLAYWRIGHT_CAPTURE_LIMITS.receiptBytes
  );
  const inspection = await inspectProbe(root, {
    capture_id: sourceCaptureId,
    probe,
    ...(request.source_recapture_id ? { source_recapture_id: request.source_recapture_id } : {}),
  });
  if (
    (await digestContainedFile(root, sourceReceiptPath, PLAYWRIGHT_CAPTURE_LIMITS.receiptBytes)) !==
    sourceReceiptSha256
  ) {
    throw new Error('browser probe source receipt changed during validation');
  }
  if (!SUPPORTED_PROBES.has(probe)) {
    throw new Error('browser probe is not executable by the local recapture operation');
  }
  await ensureCodeVetterEvidenceRoot(root);
  const store = await reserveProbeRun(root, recaptureId);
  const base = receiptBase({ recaptureId, inspection, timeoutMs, sourceReceiptSha256 });
  if (inspection.state === 'correctness_blocked') {
    return store.write({
      ...base,
      state: 'failed',
      new_capture: null,
      evidence: unavailableEvidence('not_executed', probe),
      runtime: null,
      failure: 'The upstream browser flow failed correctness; GC profiling was not executed.',
    });
  }
  if (inspection.state !== 'observed' || inspection.subject.current !== true) {
    return store.write({
      ...base,
      subject: { ...base.subject, current: false },
      state: 'stale',
      new_capture: null,
      evidence: unavailableEvidence('not_executed', probe),
      runtime: null,
      failure: null,
    });
  }

  const qualification = await qualify(root);
  if (
    qualification.subject?.repository_revision !== inspection.subject.repository_revision ||
    qualification.subject?.source_snapshot_sha256 !== inspection.subject.source_snapshot_sha256
  ) {
    return store.write({
      ...base,
      subject: { ...base.subject, current: false },
      state: 'stale',
      new_capture: null,
      evidence: unavailableEvidence('not_executed', probe),
      runtime: null,
      failure: null,
    });
  }
  const candidates = (qualification.flows ?? []).filter(
    (candidate) =>
      candidate.adapter === 'playwright' &&
      candidate.target === inspection.scope.target &&
      (candidate.name ?? null) === inspection.scope.name &&
      (candidate.browser_profile?.project_name ?? null) === inspection.scope.project
  );
  if (candidates.length !== 1) {
    return store.write({
      ...base,
      state: 'failed',
      new_capture: null,
      evidence: unavailableEvidence('not_executed', probe),
      runtime: null,
      failure: 'The durable browser scope no longer resolves one exact qualified flow.',
    });
  }

  let runtime = null;
  let capture = null;
  let captureResult = null;
  let cleanup = null;
  let cleanExecution = null;
  let operationalError = null;
  let runtimeUnavailableFailure = null;
  try {
    runtime = await establishRuntime({
      repositoryRoot: root,
      candidateId: candidates[0].id,
      timeoutMs,
      captureId: recaptureId,
      diagnosticProfile: diagnosticProfileForProbe(probe),
      diagnosticTarget:
        probe === CONTINUOUS_SOURCE_PROBE
          ? {
              ordinal: inspection.request.ordinal,
              method: inspection.request.method,
              route: inspection.request.route,
            }
          : null,
    });
    if (runtime.summary.state === 'environment_blocked' && qualification.subject.dirty === false) {
      cleanExecution = await createBrowserExecution({
        repositoryRoot: root,
        candidateId: candidates[0].id,
      });
      runtime = await establishRuntime({
        repositoryRoot: root,
        candidateId: candidates[0].id,
        timeoutMs,
        captureId: recaptureId,
        diagnosticProfile: diagnosticProfileForProbe(probe),
        diagnosticTarget:
          probe === CONTINUOUS_SOURCE_PROBE
            ? {
                ordinal: inspection.request.ordinal,
                method: inspection.request.method,
                route: inspection.request.route,
              }
            : null,
        executionContext: cleanExecution,
      });
    }
    if (!runtime.ready) {
      runtimeUnavailableFailure = `The owned browser runtime was not ready: ${runtime.summary.state}.`;
    } else if (
      [LOW_OVERHEAD_PROBE, GC_PRESSURE_PROBE, CONTINUOUS_SOURCE_PROBE].includes(probe) &&
      runtime.summary.ownership !== 'owned'
    ) {
      runtimeUnavailableFailure = 'The diagnostic browser runtime was not owned.';
    } else {
      if (probe === CONTINUOUS_SOURCE_PROBE) {
        if (typeof runtime.prepareDiagnostic !== 'function') {
          throw new Error('owned continuous-source runtime has no pre-flow arm operation');
        }
        await runtime.prepareDiagnostic();
      }
      capture = await captureBrowser({
        repositoryRoot: root,
        captureId: recaptureId,
        candidateId: candidates[0].id,
        timeoutMs,
        runtimeConfiguration: runtime.summary.configuration,
        runtimeBaseUrl: runtime.baseUrl,
        runtimePreflight: runtime.summary.preflight,
        serverPresentationProfile: presentationProfileForProbe(probe),
        prepareServerFlow: runtime.prepareServerFlow,
        loadServerFlow: runtime.collectServerFlow,
        executionContext: cleanExecution,
      });
      if (capture.result) captureResult = await loadCaptureResult(root, capture);
    }
  } catch (error) {
    operationalError = error;
  } finally {
    if (runtime?.ready) {
      try {
        cleanup = await runtime.stop();
      } catch {
        cleanup = { ...runtime.summary, cleanup: 'failed' };
      }
    }
    if (cleanExecution) {
      try {
        await cleanExecution.finalize();
      } catch (error) {
        operationalError ??= error;
      }
    }
  }

  const runtimeSummary = compactRuntime(cleanup ?? runtime?.summary ?? null);
  if (runtimeSummary?.cleanup === 'failed') {
    operationalError = operationalError ?? new Error('owned browser runtime cleanup failed');
  }
  if (runtimeUnavailableFailure && !operationalError) {
    return store.write({
      ...base,
      state: 'failed',
      new_capture: null,
      evidence: unavailableEvidence('not_executed', probe),
      runtime: runtimeSummary,
      failure: runtimeUnavailableFailure,
    });
  }
  if (operationalError) {
    const sanitized = redactText(operationalError.message ?? String(operationalError), {
      repositoryRoots: [root, requestedRoot],
      limit: 500,
    });
    return store.write({
      ...base,
      state: 'failed',
      new_capture: capture ? await captureReference(root, capture) : null,
      evidence: unavailableEvidence('operational_failure', probe),
      runtime: runtimeSummary,
      failure: sanitized.text || 'Browser probe recapture failed.',
    });
  }

  const evidence = evaluateEvidence(capture, captureResult, inspection, probe);
  const completed = ['evidence_completed', 'evidence_incomplete'].includes(evidence.outcome);
  return store.write({
    ...base,
    state: completed ? 'completed' : 'failed',
    new_capture: await captureReference(root, capture),
    evidence,
    runtime: runtimeSummary,
    failure: completed ? null : 'The recapture produced no compatible exact-request evidence.',
  });
}

function receiptBase({ recaptureId, inspection, timeoutMs, sourceReceiptSha256 }) {
  const probe = inspection.probe.name;
  return {
    schema_version: BROWSER_PROBE_RECAPTURE_SCHEMA_VERSION,
    recapture_id: recaptureId,
    subject: {
      repository_revision: inspection.subject.repository_revision,
      source_snapshot_sha256: inspection.subject.source_snapshot_sha256,
      current: inspection.subject.current,
    },
    source_capture: {
      capture_id: inspection.capture_id,
      receipt_sha256: sourceReceiptSha256,
      probe: inspection.probe.name,
      server_request_ordinal: inspection.request.ordinal,
      method: inspection.request.method,
      route: inspection.request.route,
    },
    upstream_recapture: inspection.upstream_recapture ?? null,
    scope: inspection.scope,
    policy: {
      timeout_ms: timeoutMs,
      presentation_profile: presentationProfileForProbe(probe),
      diagnostic_profile: diagnosticProfileForProbe(probe),
      remote_http_denied: true,
    },
    authority: {
      confidence: 'low',
      source_causal: false,
      edit_eligible: false,
      correctness_required: true,
    },
    provenance: 'durable_browser_probe_owned_local_recapture',
    limitations: [
      'Expanded evidence remains bounded and may still be incomplete.',
      'Local development runtime evidence does not establish production latency, scale, or impact.',
      'Evidence completion cannot override a failed browser assertion or authorize a source edit.',
    ],
  };
}

function evaluateEvidence(capture, result, inspection, probe) {
  if (!capture || !result) return unavailableEvidence('operational_failure', probe);
  const requests = (result.server?.requests ?? []).filter(
    (request) =>
      request.ordinal === inspection.request.ordinal &&
      request.method === inspection.request.method &&
      request.route === inspection.request.route
  );
  if (requests.length !== 1) return unavailableEvidence('evidence_incomplete', probe);
  const request = requests[0];
  if (probe === RUNTIME_PROBE) {
    const runtime = request.cpu?.runtime_mechanisms;
    const complete = runtime?.complete === true && runtime.precommit?.complete === true;
    return {
      outcome: complete ? 'evidence_completed' : 'evidence_incomplete',
      correctness: capture.state === 'succeeded' ? 'passed' : 'failed',
      server_request_ordinal: request.ordinal,
      async_inventory: null,
      framework_inventory: null,
      runtime_mechanism_inventory: compactRuntimeInventory(runtime),
      low_overhead_runtime: null,
      gc_pressure: null,
      continuous_source: null,
    };
  }
  if (probe === LOW_OVERHEAD_PROBE) {
    const corroboration = createLowOverheadRuntimeCorroboration(request, {
      profilerDisabled: true,
    });
    return {
      outcome: corroboration.complete ? 'evidence_completed' : 'evidence_incomplete',
      correctness: capture.state === 'succeeded' ? 'passed' : 'failed',
      server_request_ordinal: request.ordinal,
      async_inventory: null,
      framework_inventory: null,
      runtime_mechanism_inventory: null,
      low_overhead_runtime: corroboration,
      gc_pressure: null,
      continuous_source: null,
    };
  }
  if (probe === GC_PRESSURE_PROBE) {
    const pressure = validServerRequestGcPressureSummary(request.gc_pressure)
      ? request.gc_pressure
      : createIncompleteGcPressureSummary('unavailable');
    const compatibleBoundary =
      pressure?.complete === true &&
      request.response_timing?.complete === true &&
      Math.abs(
        pressure.interval.response_commit_offset_ms - request.response_timing.commit_offset_ms
      ) <= 5;
    const complete = compatibleBoundary && pressure.complete === true;
    return {
      outcome: complete ? 'evidence_completed' : 'evidence_incomplete',
      correctness: capture.state === 'succeeded' ? 'passed' : 'failed',
      server_request_ordinal: request.ordinal,
      async_inventory: null,
      framework_inventory: null,
      runtime_mechanism_inventory: null,
      low_overhead_runtime: null,
      gc_pressure: assertServerRequestGcPressureSummary(pressure),
      continuous_source: null,
    };
  }
  if (probe === CONTINUOUS_SOURCE_PROBE) {
    const source = request.continuous_source
      ? assertContinuousSourceSummary(request.continuous_source)
      : emptyContinuousSourceSummary('incomplete', 'profile_unavailable', {
          ordinal: request.ordinal,
          method: request.method,
          route: request.route,
        });
    return {
      outcome: source.complete ? 'evidence_completed' : 'evidence_incomplete',
      correctness: capture.state === 'succeeded' ? 'passed' : 'failed',
      server_request_ordinal: request.ordinal,
      async_inventory: null,
      framework_inventory: null,
      runtime_mechanism_inventory: null,
      low_overhead_runtime: null,
      gc_pressure: null,
      continuous_source: source,
    };
  }
  const asyncInventory = request.async_resource_inventory;
  const frameworkInventory = request.framework_phase_inventory;
  const complete = asyncInventory?.complete === true && frameworkInventory?.complete === true;
  return {
    outcome: complete ? 'evidence_completed' : 'evidence_incomplete',
    correctness: capture.state === 'succeeded' ? 'passed' : 'failed',
    server_request_ordinal: request.ordinal,
    async_inventory: compactInventory(asyncInventory),
    framework_inventory: compactInventory(frameworkInventory),
    runtime_mechanism_inventory: null,
    low_overhead_runtime: null,
    gc_pressure: null,
    continuous_source: null,
  };
}

function unavailableEvidence(outcome, _probe) {
  return {
    outcome,
    correctness: 'unknown',
    server_request_ordinal: null,
    async_inventory: null,
    framework_inventory: null,
    runtime_mechanism_inventory: null,
    low_overhead_runtime: null,
    gc_pressure: null,
    continuous_source: null,
  };
}

function compactRuntimeInventory(value) {
  if (!value) return null;
  return {
    state: value.state,
    total_samples: value.precommit.total_samples,
    sampled_time_ms: value.precommit.sampled_time_ms,
    mechanisms: value.precommit.mechanisms,
    complete: value.complete && value.precommit.complete,
  };
}

function presentationProfileForProbe(probe) {
  if (probe === LOW_OVERHEAD_PROBE) {
    return BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.profilerDisabledRuntime;
  }
  if (probe === GC_PRESSURE_PROBE) {
    return BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.gcPressureRuntime;
  }
  if (probe === CONTINUOUS_SOURCE_PROBE) {
    return BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.continuousSourceRuntime;
  }
  return probe === RUNTIME_PROBE
    ? BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.runtimeMechanisms
    : BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.expandedAsyncFramework;
}

function diagnosticProfileForProbe(probe) {
  if (probe === LOW_OVERHEAD_PROBE) return 'profiler_disabled_runtime';
  if (probe === GC_PRESSURE_PROBE) return 'gc_pressure_runtime';
  if (probe === CONTINUOUS_SOURCE_PROBE) return 'continuous_source_runtime';
  return 'standard';
}

function compactInventory(value) {
  if (!value) return null;
  return { total: value.total, retained: value.retained, complete: value.complete };
}

async function captureReference(root, capture) {
  const receiptPath = `.codevetter/playwright-runs/${capture.capture_id}/receipt.json`;
  return {
    capture_id: capture.capture_id,
    state: capture.state,
    receipt_path: receiptPath,
    receipt_sha256: await digestContainedFile(
      root,
      receiptPath,
      PLAYWRIGHT_CAPTURE_LIMITS.receiptBytes
    ),
    result_path: capture.result?.path ?? null,
    result_sha256: capture.result?.sha256 ?? null,
  };
}

function compactRuntime(value) {
  if (!value) return null;
  return {
    state: value.state,
    ownership: value.ownership ?? null,
    family: value.family ?? null,
    configuration: value.configuration ?? null,
    cleanup: value.cleanup ?? null,
  };
}

async function reserveProbeRun(root, recaptureId) {
  const parent = resolve(root, PROBE_RUNS_DIRECTORY);
  const directory = resolve(parent, recaptureId);
  if (repositoryRelative(root, directory) === null) throw new Error('browser probe run escapes');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await mkdir(directory, { recursive: false, mode: 0o700 });
  return {
    async write(receipt) {
      const sourceReceiptPath = `.codevetter/playwright-runs/${receipt.source_capture.capture_id}/receipt.json`;
      const currentSourceReceiptSha256 = await digestContainedFile(
        root,
        sourceReceiptPath,
        PLAYWRIGHT_CAPTURE_LIMITS.receiptBytes
      );
      if (currentSourceReceiptSha256 !== receipt.source_capture.receipt_sha256) {
        throw new Error('browser probe source receipt changed during recapture');
      }
      if (receipt.upstream_recapture) {
        const currentUpstreamSha256 = await digestContainedFile(
          root,
          `.codevetter/browser-probe-runs/${receipt.upstream_recapture.recapture_id}/receipt.json`,
          BROWSER_PROBE_RECAPTURE_LIMITS.receiptBytes
        );
        if (currentUpstreamSha256 !== receipt.upstream_recapture.receipt_sha256) {
          throw new Error('upstream probe receipt changed during recapture');
        }
      }
      const completeReceipt = receipt;
      const serialized = `${JSON.stringify(assertBrowserProbeRecapture(completeReceipt))}\n`;
      if (Buffer.byteLength(serialized) > BROWSER_PROBE_RECAPTURE_LIMITS.receiptBytes) {
        throw new Error('browser probe receipt exceeds bound');
      }
      const temporary = resolve(directory, `.receipt-${process.pid}-${temporarySequence++}.tmp`);
      const destination = resolve(directory, 'receipt.json');
      await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(temporary, destination);
      return completeReceipt;
    },
  };
}

async function digestContainedFile(root, relativePath, maximumBytes) {
  const path = resolve(root, relativePath);
  if (repositoryRelative(root, path) === null) throw new Error('browser probe artifact escapes');
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximumBytes) {
    throw new Error('browser probe artifact is unsafe');
  }
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertBrowserProbeRecapture(value) {
  const schema = value?.schema_version;
  const legacyV1 = schema === 'runtime-browser-probe-recapture/v1';
  const legacyV2 = schema === 'runtime-browser-probe-recapture/v2';
  const legacyV3 = schema === 'runtime-browser-probe-recapture/v3';
  const legacyV4 = schema === 'runtime-browser-probe-recapture/v4';
  const hasUpstreamRecapture = legacyV4 || schema === BROWSER_PROBE_RECAPTURE_SCHEMA_VERSION;
  if (
    !closed(value, [
      'schema_version',
      'recapture_id',
      'state',
      'subject',
      'source_capture',
      ...(hasUpstreamRecapture ? ['upstream_recapture'] : []),
      'scope',
      'policy',
      'new_capture',
      'evidence',
      'runtime',
      'authority',
      'failure',
      'provenance',
      'limitations',
    ]) ||
    ![
      BROWSER_PROBE_RECAPTURE_SCHEMA_VERSION,
      ...BROWSER_PROBE_RECAPTURE_LEGACY_SCHEMA_VERSIONS,
    ].includes(value.schema_version) ||
    !safeCaptureId(value.recapture_id) ||
    !['completed', 'stale', 'failed'].includes(value.state) ||
    !validSubject(value.subject) ||
    !validSourceCapture(value.source_capture, legacyV1, legacyV2, legacyV3, legacyV4) ||
    (hasUpstreamRecapture &&
      !validUpstreamRecapture(value.upstream_recapture, value.source_capture)) ||
    (value.state === 'completed' &&
      (value.upstream_recapture ?? null) !== null &&
      value.upstream_recapture?.correctness !== 'passed') ||
    !validScope(value.scope) ||
    !validPolicy(value.policy, value.source_capture?.probe, schema) ||
    !validCaptureReference(value.new_capture) ||
    !validEvidence(value.evidence, value.source_capture?.probe, schema) ||
    !validRuntime(value.runtime) ||
    !validAuthority(value.authority) ||
    (value.state === 'stale') !== (value.subject.current === false) ||
    (value.state === 'completed' && value.new_capture === null) ||
    (value.state === 'completed' &&
      !['evidence_completed', 'evidence_incomplete'].includes(value.evidence.outcome)) ||
    (value.new_capture !== null && value.new_capture.capture_id !== value.recapture_id) ||
    !consistentEvidence(value.evidence, value.source_capture?.probe, schema) ||
    (value.failure !== null && (typeof value.failure !== 'string' || value.failure.length > 500)) ||
    value.provenance !== 'durable_browser_probe_owned_local_recapture' ||
    !Array.isArray(value.limitations) ||
    value.limitations.some((item) => typeof item !== 'string')
  ) {
    throw new Error('browser probe recapture receipt is invalid');
  }
  return value;
}

function validSubject(value) {
  return (
    closed(value, ['repository_revision', 'source_snapshot_sha256', 'current']) &&
    typeof value.repository_revision === 'string' &&
    /^[0-9a-f]{64}$/.test(value.source_snapshot_sha256) &&
    typeof value.current === 'boolean'
  );
}

function validSourceCapture(value, legacyV1, legacyV2, legacyV3, legacyV4) {
  return (
    closed(value, [
      'capture_id',
      'receipt_sha256',
      'probe',
      'server_request_ordinal',
      'method',
      'route',
    ]) &&
    safeCaptureId(value.capture_id) &&
    /^[0-9a-f]{64}$/.test(value.receipt_sha256) &&
    (legacyV1
      ? value.probe === INVENTORY_PROBE
      : legacyV2
        ? [INVENTORY_PROBE, RUNTIME_PROBE].includes(value.probe)
        : legacyV3
          ? [INVENTORY_PROBE, RUNTIME_PROBE, LOW_OVERHEAD_PROBE].includes(value.probe)
          : legacyV4
            ? [INVENTORY_PROBE, RUNTIME_PROBE, LOW_OVERHEAD_PROBE, GC_PRESSURE_PROBE].includes(
                value.probe
              )
            : SUPPORTED_PROBES.has(value.probe)) &&
    Number.isSafeInteger(value.server_request_ordinal) &&
    value.server_request_ordinal > 0 &&
    typeof value.method === 'string' &&
    typeof value.route === 'string' &&
    value.route.startsWith('/')
  );
}

function validScope(value) {
  return (
    closed(value, ['target', 'name', 'project']) &&
    typeof value.target === 'string' &&
    nullableString(value.name) &&
    nullableString(value.project)
  );
}

function validUpstreamRecapture(value, sourceCapture) {
  if (value === null) {
    return ![GC_PRESSURE_PROBE, CONTINUOUS_SOURCE_PROBE].includes(sourceCapture?.probe);
  }
  const expectedSourceProbe =
    sourceCapture?.probe === LOW_OVERHEAD_PROBE
      ? RUNTIME_PROBE
      : sourceCapture?.probe === GC_PRESSURE_PROBE
        ? LOW_OVERHEAD_PROBE
        : sourceCapture?.probe === CONTINUOUS_SOURCE_PROBE
          ? LOW_OVERHEAD_PROBE
          : null;
  return (
    expectedSourceProbe !== null &&
    closed(value, [
      'recapture_id',
      'receipt_sha256',
      'source_probe',
      'classification',
      'next_probe',
      'server_request_ordinal',
      'correctness',
    ]) &&
    safeCaptureId(value.recapture_id) &&
    /^[0-9a-f]{64}$/.test(value.receipt_sha256) &&
    value.source_probe === expectedSourceProbe &&
    typeof value.classification === 'string' &&
    value.next_probe === sourceCapture.probe &&
    value.server_request_ordinal === sourceCapture.server_request_ordinal &&
    ['passed', 'failed'].includes(value.correctness)
  );
}

function validPolicy(value, probe, schema) {
  const legacyV1 = schema === 'runtime-browser-probe-recapture/v1';
  const hasDiagnosticProfile = [
    'runtime-browser-probe-recapture/v3',
    'runtime-browser-probe-recapture/v4',
    BROWSER_PROBE_RECAPTURE_SCHEMA_VERSION,
  ].includes(schema);
  return (
    closed(value, [
      'timeout_ms',
      'presentation_profile',
      'remote_http_denied',
      ...(hasDiagnosticProfile ? ['diagnostic_profile'] : []),
    ]) &&
    Number.isSafeInteger(value.timeout_ms) &&
    value.presentation_profile ===
      (legacyV1
        ? BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.expandedAsyncFramework
        : presentationProfileForProbe(probe)) &&
    value.remote_http_denied === true &&
    (!hasDiagnosticProfile || value.diagnostic_profile === diagnosticProfileForProbe(probe))
  );
}

function validCaptureReference(value) {
  if (value === null) return true;
  return (
    closed(value, [
      'capture_id',
      'state',
      'receipt_path',
      'receipt_sha256',
      'result_path',
      'result_sha256',
    ]) &&
    safeCaptureId(value.capture_id) &&
    ['succeeded', 'failed', 'local_server_required'].includes(value.state) &&
    typeof value.receipt_path === 'string' &&
    /^[0-9a-f]{64}$/.test(value.receipt_sha256) &&
    nullableString(value.result_path) &&
    (value.result_sha256 === null || /^[0-9a-f]{64}$/.test(value.result_sha256))
  );
}

function validEvidence(value, probe, schema) {
  const legacyV1 = schema === 'runtime-browser-probe-recapture/v1';
  const legacyV2 = schema === 'runtime-browser-probe-recapture/v2';
  const legacyV3 = schema === 'runtime-browser-probe-recapture/v3';
  const current = schema === BROWSER_PROBE_RECAPTURE_SCHEMA_VERSION;
  const observed = ['evidence_completed', 'evidence_incomplete'].includes(value?.outcome);
  const fields = [
    'outcome',
    'correctness',
    'server_request_ordinal',
    'async_inventory',
    'framework_inventory',
    ...(legacyV1 ? [] : ['runtime_mechanism_inventory']),
    ...(legacyV1 || legacyV2 ? [] : ['low_overhead_runtime']),
    ...(legacyV1 || legacyV2 || legacyV3 ? [] : ['gc_pressure']),
    ...(current ? ['continuous_source'] : []),
  ];
  return (
    closed(value, fields) &&
    ['evidence_completed', 'evidence_incomplete', 'not_executed', 'operational_failure'].includes(
      value.outcome
    ) &&
    ['passed', 'failed', 'unknown'].includes(value.correctness) &&
    (value.server_request_ordinal === null ||
      (Number.isSafeInteger(value.server_request_ordinal) && value.server_request_ordinal > 0)) &&
    validInventory(value.async_inventory) &&
    validInventory(value.framework_inventory) &&
    (legacyV1 || validRuntimeInventory(value.runtime_mechanism_inventory)) &&
    (legacyV1 || legacyV2 || validLowOverheadRuntime(value.low_overhead_runtime)) &&
    (legacyV1 || legacyV2 || legacyV3 || validGcPressure(value.gc_pressure)) &&
    (!current || validContinuousSource(value.continuous_source)) &&
    (legacyV1 ||
      (probe === RUNTIME_PROBE
        ? value.async_inventory === null &&
          value.framework_inventory === null &&
          (legacyV2 || value.low_overhead_runtime === null) &&
          (legacyV2 || legacyV3 || value.gc_pressure === null) &&
          (!current || value.continuous_source === null)
        : probe === LOW_OVERHEAD_PROBE
          ? value.async_inventory === null &&
            value.framework_inventory === null &&
            value.runtime_mechanism_inventory === null &&
            value.low_overhead_runtime !== null &&
            (legacyV3 || value.gc_pressure === null) &&
            (!current || value.continuous_source === null)
          : probe === GC_PRESSURE_PROBE
            ? value.async_inventory === null &&
              value.framework_inventory === null &&
              value.runtime_mechanism_inventory === null &&
              value.low_overhead_runtime === null &&
              (observed ? value.gc_pressure !== null : value.gc_pressure === null) &&
              (!current || value.continuous_source === null)
            : probe === CONTINUOUS_SOURCE_PROBE
              ? current &&
                value.async_inventory === null &&
                value.framework_inventory === null &&
                value.runtime_mechanism_inventory === null &&
                value.low_overhead_runtime === null &&
                value.gc_pressure === null &&
                (observed ? value.continuous_source !== null : value.continuous_source === null)
              : value.runtime_mechanism_inventory === null &&
                (legacyV2 || value.low_overhead_runtime === null) &&
                (legacyV2 || legacyV3 || value.gc_pressure === null) &&
                (!current || value.continuous_source === null)))
  );
}

function consistentEvidence(value, probe, schema) {
  const legacyV1 = schema === 'runtime-browser-probe-recapture/v1';
  const legacyV2 = schema === 'runtime-browser-probe-recapture/v2';
  const legacyV3 = schema === 'runtime-browser-probe-recapture/v3';
  const current = schema === BROWSER_PROBE_RECAPTURE_SCHEMA_VERSION;
  const observed = ['evidence_completed', 'evidence_incomplete'].includes(value.outcome);
  const requiredEvidence =
    !legacyV1 && probe === RUNTIME_PROBE
      ? value.runtime_mechanism_inventory !== null
      : !legacyV1 && !legacyV2 && probe === LOW_OVERHEAD_PROBE
        ? value.low_overhead_runtime !== null
        : !legacyV1 && !legacyV2 && !legacyV3 && probe === GC_PRESSURE_PROBE
          ? value.gc_pressure !== null
          : current && probe === CONTINUOUS_SOURCE_PROBE
            ? value.continuous_source !== null
            : value.async_inventory !== null && value.framework_inventory !== null;
  const noEvidence =
    value.async_inventory === null &&
    value.framework_inventory === null &&
    (legacyV1 || value.runtime_mechanism_inventory === null) &&
    (legacyV1 || legacyV2 || value.low_overhead_runtime === null) &&
    (legacyV1 || legacyV2 || legacyV3 || value.gc_pressure === null) &&
    (!current || value.continuous_source === null);
  return observed
    ? ['passed', 'failed'].includes(value.correctness) &&
        value.server_request_ordinal !== null &&
        requiredEvidence
    : value.correctness === 'unknown' && value.server_request_ordinal === null && noEvidence;
}

function validLowOverheadRuntime(value) {
  if (value === null) return true;
  try {
    assertLowOverheadRuntimeCorroboration(value);
    return true;
  } catch {
    return false;
  }
}

function validGcPressure(value) {
  return value === null || validServerRequestGcPressureSummary(value);
}

function validContinuousSource(value) {
  if (value === null) return true;
  try {
    assertContinuousSourceSummary(value);
    return true;
  } catch {
    return false;
  }
}

function validRuntimeInventory(value) {
  if (value === null) return true;
  return (
    closed(value, ['state', 'total_samples', 'sampled_time_ms', 'mechanisms', 'complete']) &&
    ['observed', 'insufficient', 'incomplete'].includes(value.state) &&
    Number.isSafeInteger(value.total_samples) &&
    value.total_samples >= 0 &&
    Number.isFinite(value.sampled_time_ms) &&
    value.sampled_time_ms >= 0 &&
    Array.isArray(value.mechanisms) &&
    value.mechanisms.length <= 12 &&
    value.mechanisms.every(
      (entry) =>
        closed(entry, ['mechanism', 'samples', 'self_time_ms', 'runtime_sample_share']) &&
        SERVER_REQUEST_RUNTIME_MECHANISMS.includes(entry.mechanism) &&
        Number.isSafeInteger(entry.samples) &&
        entry.samples > 0 &&
        Number.isFinite(entry.self_time_ms) &&
        entry.self_time_ms >= 0 &&
        Number.isFinite(entry.runtime_sample_share) &&
        entry.runtime_sample_share >= 0 &&
        entry.runtime_sample_share <= 1
    ) &&
    value.mechanisms.reduce((total, entry) => total + entry.samples, 0) === value.total_samples &&
    Math.abs(
      value.mechanisms.reduce((total, entry) => total + entry.self_time_ms, 0) -
        value.sampled_time_ms
    ) <= 0.01 &&
    typeof value.complete === 'boolean'
  );
}

function validInventory(value) {
  if (value === null) return true;
  return (
    closed(value, ['total', 'retained', 'complete']) &&
    Number.isSafeInteger(value.total) &&
    value.total >= 0 &&
    Number.isSafeInteger(value.retained) &&
    value.retained >= 0 &&
    value.retained <= value.total &&
    typeof value.complete === 'boolean' &&
    (!value.complete || value.total === value.retained)
  );
}

function validRuntime(value) {
  if (value === null) return true;
  return (
    closed(value, ['state', 'ownership', 'family', 'configuration', 'cleanup']) &&
    typeof value.state === 'string' &&
    nullableString(value.ownership) &&
    nullableString(value.family) &&
    nullableString(value.configuration) &&
    nullableString(value.cleanup)
  );
}

function validAuthority(value) {
  return (
    closed(value, ['confidence', 'source_causal', 'edit_eligible', 'correctness_required']) &&
    value.confidence === 'low' &&
    value.source_causal === false &&
    value.edit_eligible === false &&
    value.correctness_required === true
  );
}

function requiredString(value, key) {
  if (typeof value?.[key] !== 'string' || value[key].trim() === '') {
    throw new Error(`missing browser probe recapture argument: ${key}`);
  }
  return value[key];
}

function assertRecaptureInput(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) =>
        !['capture_id', 'probe', 'recapture_id', 'source_recapture_id', 'timeout_ms'].includes(key)
    )
  ) {
    throw new Error('browser probe recapture input is invalid');
  }
  const probe = requiredString(value, 'probe');
  if (!SUPPORTED_PROBES.has(probe)) {
    throw new Error('browser probe is not executable by the local recapture operation');
  }
  const sourceRecaptureId =
    value.source_recapture_id === undefined
      ? null
      : assertPlaywrightCaptureId(requiredString(value, 'source_recapture_id'));
  if ([GC_PRESSURE_PROBE, CONTINUOUS_SOURCE_PROBE].includes(probe) && sourceRecaptureId === null) {
    throw new Error(
      'chained diagnostic recapture requires exactly one upstream recapture identity'
    );
  }
  if (
    sourceRecaptureId !== null &&
    ![LOW_OVERHEAD_PROBE, GC_PRESSURE_PROBE, CONTINUOUS_SOURCE_PROBE].includes(probe)
  ) {
    throw new Error('browser probe does not accept an upstream recapture identity');
  }
  return {
    capture_id: assertPlaywrightCaptureId(requiredString(value, 'capture_id')),
    probe,
    recapture_id: assertPlaywrightCaptureId(requiredString(value, 'recapture_id')),
    source_recapture_id: sourceRecaptureId,
    timeout_ms: boundedTimeout(value.timeout_ms),
  };
}

function safeCaptureId(value) {
  try {
    assertPlaywrightCaptureId(value);
    return true;
  } catch {
    return false;
  }
}

function nullableString(value) {
  return value === null || typeof value === 'string';
}

function closed(value, fields) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}
