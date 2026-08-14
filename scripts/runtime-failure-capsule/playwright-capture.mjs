import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import {
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { boundedTimeout, repositoryRelative } from './contracts.mjs';
import { resolveBrowserExecutionContext } from './clean-browser-execution.mjs';
import { ensureCodeVetterEvidenceRoot } from './evidence-root.mjs';
import {
  BROWSER_MAIN_THREAD_LIMITS,
  BROWSER_MAIN_THREAD_TRACE_BUFFER_KIB,
  BROWSER_MAIN_THREAD_TRACE_CATEGORIES,
} from './browser-main-thread-import.mjs';
import { createLocalBrowserSourceMapLoader } from './browser-source-map.mjs';
import { BROWSER_SERVER_FLOW_PRESENTATION_PROFILES } from './browser-server-flow.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import {
  attestDeclaredLocalServer,
  unavailableLocalServerAttestation,
} from './local-server-attestation.mjs';
import {
  PLAYWRIGHT_CAPTURE_LIMITS,
  PLAYWRIGHT_CAPTURE_SCHEMA_VERSION,
  assertLoopbackBaseUrl,
  assertPlaywrightCaptureId,
  assertPlaywrightCaptureReceipt,
  compactPlaywrightDiagnosis,
  playwrightCandidateSafetyAllowsCapture,
  qualifiedPlaywrightDeclarationLine,
} from './playwright-capture-contracts.mjs';
import {
  PLAYWRIGHT_MEMORY_REPEATS,
  collectSamePagePlaywrightMemory,
  collectRepeatedPlaywrightMemory,
  playwrightMemoryEnvironment,
  supportsRepeatedPlaywrightMemory,
  unavailableRepeatedPlaywrightMemory,
  unavailableSamePagePlaywrightMemory,
} from './playwright-memory.mjs';
import {
  attributePlaywrightReactComponents,
  collectPlaywrightReactEvidence,
  findDeclaredReactAuthority,
  playwrightReactEnvironment,
  unavailablePlaywrightReactEvidence,
} from './playwright-react.mjs';
import { diagnosePlaywrightTraceSource } from './playwright-trace-import.mjs';
import { extractPlaywrightTraceZip } from './playwright-trace-zip.mjs';
import { qualifyRepository } from './qualification.mjs';
import { redactText } from './redact.mjs';
import { minimalEnvironment, resolveLocalPlaywrightCli, runOwnedProcess } from './runner.mjs';

const RUNS_DIRECTORY = '.codevetter/playwright-runs';
let temporarySequence = 0;

export async function captureQualifiedPlaywrightFlow({
  repositoryRoot,
  captureId,
  candidateId,
  timeoutMs,
  runtimeConfiguration = null,
  runtimeBaseUrl = null,
  runtimePreflight = null,
  executionContext = null,
  serverPresentationProfile = BROWSER_SERVER_FLOW_PRESENTATION_PROFILES.ordinary,
  attestServer = attestDeclaredLocalServer,
  prepareServerFlow = null,
  loadServerFlow = null,
}) {
  const authorityRoot = await realpath(resolve(repositoryRoot));
  const browserExecution = await resolveBrowserExecutionContext(authorityRoot, executionContext);
  const root = browserExecution.executionRoot;
  const evidenceRoot = browserExecution.evidenceRoot;
  await ensureCodeVetterEvidenceRoot(evidenceRoot);
  const safeCaptureId = assertPlaywrightCaptureId(captureId);
  const timeout = boundedTimeout(timeoutMs);
  if (
    !Object.values(BROWSER_SERVER_FLOW_PRESENTATION_PROFILES).includes(serverPresentationProfile)
  ) {
    throw new Error('browser server presentation profile is invalid');
  }
  if (
    runtimeConfiguration !== null &&
    !['codevetter_config_disabled', 'repository_declared'].includes(runtimeConfiguration)
  ) {
    throw new Error('browser runtime configuration is invalid');
  }
  const qualification = browserExecution.qualification ?? (await qualifyRepository(authorityRoot));
  const candidate = qualification.flows.find((flow) => flow.id === candidateId);
  const declaredBaseUrl = qualifiedBrowserBaseUrl(candidate);
  const baseUrl = effectiveRuntimeBaseUrl({
    declaredBaseUrl,
    runtimeBaseUrl,
    runtimeConfiguration,
  });
  const declarationLine = qualifiedPlaywrightDeclarationLine(candidate);
  if (
    !candidate ||
    candidate.adapter !== 'playwright' ||
    !candidate.name ||
    !baseUrl ||
    declarationLine === null
  ) {
    throw new Error('candidate is not an exact statically qualified local Playwright flow');
  }
  const browserProfile = await resolveOwnedBrowserProfile(root, candidate);
  const reactAuthority = await findDeclaredReactAuthority(root, candidate.target);
  const git = await inspectGitDiff(authorityRoot);
  if (
    git.repository_revision !== qualification.subject.repository_revision ||
    git.source_snapshot_sha256 !== qualification.subject.source_snapshot_sha256
  ) {
    throw new Error('browser capture source changed after qualification');
  }
  const directory = await reserveCaptureDirectory(evidenceRoot, safeCaptureId);
  const startedAt = new Date().toISOString();
  const scope = {
    adapter: 'playwright',
    candidate_id: candidate.id,
    target: candidate.target,
    name: candidate.name,
    base_url: baseUrl,
    browser_profile: browserProfile.evidence,
  };
  const policy = {
    timeout_ms: timeout,
    workers: 1,
    retries: 0,
    remote_http_denied: true,
    server_identity: 'unverified',
    runtime_configuration: runtimeConfiguration,
  };
  let serverAttestation = unavailableLocalServerAttestation(candidate);
  const finish = async ({
    state,
    execution,
    diagnosis = null,
    result = null,
    failure = null,
    limitations = [],
  }) => {
    if (!(await sourceSnapshotUnchanged(authorityRoot, git))) {
      state = 'failed';
      diagnosis = null;
      result = null;
      failure = 'Repository source snapshot changed during browser capture.';
      limitations = [
        ...limitations,
        'No browser conclusion is authorized from the changed snapshot.',
      ];
    }
    const receipt = assertPlaywrightCaptureReceipt({
      schema_version: PLAYWRIGHT_CAPTURE_SCHEMA_VERSION,
      capture_id: safeCaptureId,
      state,
      subject: {
        repository_revision: git.repository_revision,
        source_snapshot_sha256: git.source_snapshot_sha256,
        dirty: git.dirty,
      },
      ...(browserExecution.provenance ? { execution_source: browserExecution.provenance } : {}),
      scope,
      policy,
      lifecycle: { started_at: startedAt, completed_at: new Date().toISOString() },
      execution,
      server_attestation: serverAttestation,
      diagnosis,
      result,
      failure,
      limitations: [
        'The capture covers one exact local Chromium flow against an already-running loopback server.',
        'Reachability does not prove the already-running server is the repository-intended runtime.',
        'Repository Playwright configuration and webServer commands were not evaluated.',
        'Local browser timing does not establish production network, rendering, or user impact.',
        ...(baseUrl !== declaredBaseUrl
          ? [
              'The CodeVetter-owned runtime used an ephemeral loopback port because the declared port was occupied by an unrelated listener.',
            ]
          : []),
        ...(browserProfile.evidence.browser_binary === 'system_chrome'
          ? [
              'The repository Playwright browser revision was unavailable, so the capture used locally installed system Chrome.',
            ]
          : []),
        ...limitations,
      ],
    });
    await writeAtomicJson(
      join(directory, 'receipt.json'),
      receipt,
      PLAYWRIGHT_CAPTURE_LIMITS.receiptBytes
    );
    return receipt;
  };

  try {
    serverAttestation = await attestServer({
      repositoryRoot: root,
      baseUrl,
      candidate,
    });
    if (serverAttestation.state === 'verified_by_declared_process') {
      policy.server_identity = 'verified_by_declared_process';
    }
  } catch {
    serverAttestation = unavailableLocalServerAttestation(candidate);
  }

  if (!(await loopbackServerReachable(baseUrl))) {
    return finish({
      state: 'local_server_required',
      execution: emptyExecution('not_started'),
      failure: 'The statically qualified loopback origin is not currently listening.',
    });
  }

  const temporary = await mkdtemp(join(tmpdir(), 'codevetter-playwright-'));
  let denialProxy = null;
  try {
    denialProxy = await startDenialProxy();
    const outputDirectory = join(temporary, 'output');
    await mkdir(outputDirectory);
    const mainThreadTracePath = join(temporary, 'chromium-main-thread.json');
    const configPath = join(temporary, 'codevetter.config.mjs');
    await writeFile(
      configPath,
      ownedConfigSource({
        root,
        outputDirectory,
        baseUrl,
        proxyUrl: denialProxy.url,
        testTimeoutMs: playwrightTestTimeout(timeout),
        mainThreadTracePath,
        traceDurationSeconds: browserTraceDurationSeconds(timeout),
        browserProfile,
        captureHeader: safeCaptureId,
      }),
      {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      }
    );
    const executable = await resolveLocalPlaywrightCli(
      browserExecution.dependencyRoot,
      candidate.target
    );
    const executionDeadline = Date.now() + timeout;
    const execution = await runOwnedProcess({
      program: process.execPath,
      args: exactPlaywrightArgs({ executable, candidate, declarationLine, configPath }),
      cwd: root,
      environment: minimalEnvironment(),
      timeoutMs: timeout,
      measureMemory: true,
    });
    const executionSummary = summarizeExecution(execution);
    if (execution.status !== 'exited' || execution.exitCode !== 0 || execution.truncated) {
      const serverFlow = await prepareAndLoadServerFlow(prepareServerFlow, loadServerFlow);
      if (!(await sourceSnapshotUnchanged(authorityRoot, git))) {
        return finish({
          state: 'failed',
          execution: executionSummary,
          failure: 'Repository source snapshot changed during browser execution.',
          limitations: ['No browser conclusion is authorized from the changed snapshot.'],
        });
      }
      let persisted = null;
      const limitations = [];
      try {
        persisted = await persistTraceDiagnosis({
          root,
          directory,
          outputDirectory,
          captureId: safeCaptureId,
          candidate,
          baseUrl,
          mainThreadTracePath,
          serverIdentity: policy.server_identity,
          browserMemory: browserMemoryObservation(executionSummary.memory),
          repeatedMemory: null,
          samePageMemory: null,
          reactCommits: null,
          runtimeConfiguration,
          serverFlow,
          runtimePreflight,
          serverPresentationProfile,
        });
      } catch (error) {
        const reason = redactText(error?.message ?? String(error), {
          repositoryRoots: [root, temporary, relative(root, temporary)],
          limit: 500,
        }).text;
        limitations.push(
          `The failed execution produced no usable trace within the bounded normalized evidence contract: ${reason}`
        );
      }
      return finish({
        state: 'failed',
        execution: executionSummary,
        diagnosis: persisted?.diagnosis ?? null,
        result: persisted?.result ?? null,
        failure: compactPlaywrightFailure(root, execution, { temporaryRoot: temporary }),
        limitations,
      });
    }
    let reactCommits = null;
    if (reactAuthority) {
      const remainingReactMs = Math.max(0, executionDeadline - Date.now());
      reactCommits =
        remainingReactMs >= 100
          ? await captureReactCommits({
              root,
              temporary,
              executable,
              candidate,
              declarationLine,
              baseUrl,
              proxyUrl: denialProxy.url,
              timeout: remainingReactMs,
              browserProfile,
              authority: reactAuthority,
            })
          : unavailablePlaywrightReactEvidence(
              reactAuthority,
              'The exact capture exhausted its execution deadline before the React diagnostic pass.'
            );
    }
    let repeatedMemory = null;
    let samePageMemory = null;
    if (supportsRepeatedPlaywrightMemory(candidate)) {
      const exactDeclarationCount = qualification.flows.filter(
        (flow) =>
          flow.adapter === 'playwright' &&
          flow.target === candidate.target &&
          flow.name === candidate.name &&
          (flow.browser_profile?.project_name ?? null) ===
            (candidate.browser_profile?.project_name ?? null)
      ).length;
      const remainingMemoryMs = Math.max(0, executionDeadline - Date.now());
      repeatedMemory =
        remainingMemoryMs >= 100
          ? await captureRepeatedMemory({
              root,
              temporary,
              executable,
              candidate,
              declarationLine,
              baseUrl,
              proxyUrl: denialProxy.url,
              timeout: remainingMemoryMs,
              browserProfile,
            })
          : unavailableRepeatedPlaywrightMemory(
              'The exact capture exhausted its execution deadline before the repeated memory pass.'
            );
      const remainingSamePageMs = Math.max(0, executionDeadline - Date.now());
      samePageMemory =
        exactDeclarationCount !== 1
          ? unavailableSamePagePlaywrightMemory(
              'The exact test name is not unique within its qualified source file.'
            )
          : remainingSamePageMs >= 100
            ? await captureSamePageMemory({
                root,
                temporary,
                executable,
                candidate,
                declarationLine,
                baseUrl,
                proxyUrl: denialProxy.url,
                timeout: remainingSamePageMs,
                browserProfile,
              })
            : unavailableSamePagePlaywrightMemory(
                'The exact capture exhausted its execution deadline before the same-page memory pass.'
              );
    }
    const serverFlow = await prepareAndLoadServerFlow(prepareServerFlow, loadServerFlow);
    if (!(await sourceSnapshotUnchanged(authorityRoot, git))) {
      return finish({
        state: 'failed',
        execution: executionSummary,
        failure: 'Repository source snapshot changed during browser execution.',
        limitations: ['No browser conclusion is authorized from the changed snapshot.'],
      });
    }
    const persisted = await persistTraceDiagnosis({
      root,
      directory,
      outputDirectory,
      captureId: safeCaptureId,
      candidate,
      baseUrl,
      mainThreadTracePath,
      serverIdentity: policy.server_identity,
      browserMemory: browserMemoryObservation(executionSummary.memory),
      repeatedMemory,
      samePageMemory,
      reactCommits,
      runtimeConfiguration,
      serverFlow,
      runtimePreflight,
      serverPresentationProfile,
    });
    return finish({
      state: 'succeeded',
      execution: executionSummary,
      diagnosis: persisted.diagnosis,
      result: persisted.result,
      limitations: [
        ...(reactCommits?.limitations ?? []),
        ...(repeatedMemory?.limitations ?? []),
        ...(samePageMemory?.limitations ?? []),
      ],
    });
  } catch (error) {
    const sanitized = redactText(error?.message ?? String(error), {
      repositoryRoots: [authorityRoot, root],
      limit: 2_000,
    });
    return finish({
      state: 'failed',
      execution: emptyExecution('operational_failure'),
      failure: sanitized.text,
    });
  } finally {
    await denialProxy?.close();
    await rm(temporary, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    }).catch(() => {});
  }
}

export function effectiveRuntimeBaseUrl({ declaredBaseUrl, runtimeBaseUrl, runtimeConfiguration }) {
  if (runtimeBaseUrl === null) return declaredBaseUrl;
  if (runtimeConfiguration !== 'codevetter_config_disabled') {
    throw new Error(
      'an alternate browser origin requires a CodeVetter-owned disabled configuration'
    );
  }
  const declared = new URL(assertLoopbackBaseUrl(declaredBaseUrl));
  const effective = new URL(assertLoopbackBaseUrl(runtimeBaseUrl));
  if (
    declared.protocol !== effective.protocol ||
    declared.hostname !== effective.hostname ||
    declared.pathname !== effective.pathname ||
    declared.search !== effective.search ||
    declared.hash !== effective.hash
  ) {
    throw new Error('alternate browser origin may change only the loopback port');
  }
  return effective.href.replace(/\/$/, '');
}

async function sourceSnapshotUnchanged(root, initial) {
  try {
    const current = await inspectGitDiff(root);
    return (
      current.repository_revision === initial.repository_revision &&
      current.source_snapshot_sha256 === initial.source_snapshot_sha256
    );
  } catch {
    return false;
  }
}

async function persistTraceDiagnosis({
  root,
  directory,
  outputDirectory,
  captureId,
  candidate,
  baseUrl,
  mainThreadTracePath,
  serverIdentity,
  browserMemory,
  repeatedMemory,
  samePageMemory,
  reactCommits,
  runtimeConfiguration,
  serverFlow,
  runtimePreflight,
  serverPresentationProfile,
}) {
  const tracePath = await findTraceZip(outputDirectory);
  const trace = extractPlaywrightTraceZip(await readFile(tracePath));
  const mainThreadTraceSource = await readOptionalMainThreadTrace(mainThreadTracePath);
  const diagnosis = await diagnosePlaywrightTraceSource(root, trace, {
    target: candidate.target,
    name: candidate.name,
    expectedHttpStatuses: candidate.signals
      .filter((signal) => signal.kind === 'declared_expected_http_status')
      .map((signal) => signal.evidence),
    mainThreadTraceSource,
    serverIdentity,
    sourceMapLoader: createLocalBrowserSourceMapLoader({ baseUrl }),
    browserMemory,
    repeatedMemory,
    samePageMemory,
    reactCommits,
    runtimeConfiguration,
    serverFlow,
    runtimePreflight,
    serverPresentationProfile,
    preflightRoute: qualifiedPreflightRoute(candidate),
  });
  const resultPath = join(directory, 'result.json');
  const serialized = `${JSON.stringify(diagnosis)}\n`;
  if (Buffer.byteLength(serialized) > PLAYWRIGHT_CAPTURE_LIMITS.resultBytes) {
    throw new Error('normalized Playwright result exceeds bound');
  }
  await writeFile(resultPath, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return {
    diagnosis: compactPlaywrightDiagnosis(diagnosis),
    result: {
      path: `${RUNS_DIRECTORY}/${captureId}/result.json`,
      sha256: createHash('sha256').update(serialized).digest('hex'),
      bytes: Buffer.byteLength(serialized),
    },
  };
}

function qualifiedPreflightRoute(candidate) {
  const values = (candidate?.signals ?? []).filter(
    (signal) => signal.kind === 'declared_browser_warmup_path'
  );
  const route = values.length === 1 ? values[0].evidence : null;
  return typeof route === 'string' && /^\/(?!\/)[^?#\r\n]{0,256}$/.test(route) ? route : null;
}

async function captureReactCommits({
  root,
  temporary,
  executable,
  candidate,
  declarationLine,
  baseUrl,
  proxyUrl,
  timeout,
  browserProfile,
  authority,
}) {
  const sampleDirectory = join(temporary, 'react-commit-samples');
  const outputDirectory = join(temporary, 'react-commit-output');
  await mkdir(sampleDirectory);
  await mkdir(outputDirectory);
  const configPath = join(temporary, 'codevetter.react.config.mjs');
  await writeFile(
    configPath,
    ownedConfigSource({
      root,
      outputDirectory,
      baseUrl,
      proxyUrl,
      testTimeoutMs: playwrightTestTimeout(timeout),
      browserProfile,
    }),
    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
  );
  const execution = await runOwnedProcess({
    program: process.execPath,
    args: exactPlaywrightArgs({ executable, candidate, declarationLine, configPath }),
    cwd: root,
    environment: {
      ...minimalEnvironment(),
      ...playwrightReactEnvironment({
        repositoryRoot: root,
        target: candidate.target,
        outputDirectory: sampleDirectory,
      }),
    },
    timeoutMs: timeout,
  });
  const evidence = await attributePlaywrightReactComponents(
    root,
    await collectPlaywrightReactEvidence(sampleDirectory, authority, {
      componentLimit: 64,
    })
  );
  if (execution.status === 'exited' && execution.exitCode === 0 && !execution.truncated) {
    return evidence;
  }
  return unavailablePlaywrightReactEvidence(
    authority,
    boundedMemoryLimitation(
      'The separate React diagnostic execution did not complete successfully',
      compactPlaywrightFailure(root, execution, { temporaryRoot: temporary })
    )
  );
}

async function captureRepeatedMemory({
  root,
  temporary,
  executable,
  candidate,
  declarationLine,
  baseUrl,
  proxyUrl,
  timeout,
  browserProfile,
}) {
  const sampleDirectory = join(temporary, 'memory-samples');
  const outputDirectory = join(temporary, 'memory-output');
  await mkdir(sampleDirectory);
  await mkdir(outputDirectory);
  const configPath = join(temporary, 'codevetter.memory.config.mjs');
  await writeFile(
    configPath,
    ownedConfigSource({
      root,
      outputDirectory,
      baseUrl,
      proxyUrl,
      testTimeoutMs: Math.max(
        100,
        Math.floor(playwrightTestTimeout(timeout) / PLAYWRIGHT_MEMORY_REPEATS)
      ),
      browserProfile,
    }),
    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
  );
  const environment = {
    ...minimalEnvironment(),
    ...playwrightMemoryEnvironment({
      repositoryRoot: root,
      target: candidate.target,
      outputDirectory: sampleDirectory,
      mode: 'fresh_contexts',
    }),
  };
  const execution = await runOwnedProcess({
    program: process.execPath,
    args: exactPlaywrightArgs({
      executable,
      candidate,
      declarationLine,
      configPath,
      repeats: PLAYWRIGHT_MEMORY_REPEATS,
    }),
    cwd: root,
    environment,
    timeoutMs: timeout,
  });
  const evidence = await collectRepeatedPlaywrightMemory(sampleDirectory);
  if (execution.status === 'exited' && execution.exitCode === 0 && !execution.truncated) {
    return evidence;
  }
  return {
    ...evidence,
    state: 'unavailable',
    summary: null,
    limitations: [
      ...evidence.limitations,
      boundedMemoryLimitation(
        'The separate repeated browser-memory execution did not complete successfully',
        compactPlaywrightFailure(root, execution, { temporaryRoot: temporary })
      ),
    ],
  };
}

async function captureSamePageMemory({
  root,
  temporary,
  executable,
  candidate,
  declarationLine,
  baseUrl,
  proxyUrl,
  timeout,
  browserProfile,
}) {
  const sampleDirectory = join(temporary, 'same-page-memory-samples');
  const outputDirectory = join(temporary, 'same-page-memory-output');
  await mkdir(sampleDirectory);
  await mkdir(outputDirectory);
  const configPath = join(temporary, 'codevetter.same-page-memory.config.mjs');
  await writeFile(
    configPath,
    ownedConfigSource({
      root,
      outputDirectory,
      baseUrl,
      proxyUrl,
      testTimeoutMs: playwrightTestTimeout(timeout),
      testMatch: candidate.target,
      browserProfile,
    }),
    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
  );
  const execution = await runOwnedProcess({
    program: process.execPath,
    args: exactPlaywrightArgs({
      executable,
      candidate,
      declarationLine,
      configPath,
      includeFileFilter: false,
    }),
    cwd: root,
    environment: {
      ...minimalEnvironment(),
      ...playwrightMemoryEnvironment({
        repositoryRoot: root,
        target: candidate.target,
        outputDirectory: sampleDirectory,
        mode: 'same_page',
        testName: candidate.name,
      }),
    },
    timeoutMs: timeout,
  });
  const evidence = await collectSamePagePlaywrightMemory(sampleDirectory);
  if (execution.status === 'exited' && execution.exitCode === 0 && !execution.truncated) {
    return evidence;
  }
  return {
    ...evidence,
    state: 'unavailable',
    trend: null,
    limitations: [
      ...evidence.limitations,
      boundedMemoryLimitation(
        'The same-page browser-memory execution did not complete successfully',
        compactPlaywrightFailure(root, execution, { temporaryRoot: temporary })
      ),
    ],
  };
}

function boundedMemoryLimitation(label, failure) {
  return `${label}: ${failure}`.slice(0, 500);
}

function exactPlaywrightArgs({
  executable,
  candidate,
  declarationLine,
  configPath,
  repeats = 1,
  includeFileFilter = true,
}) {
  return [
    executable,
    'test',
    ...(includeFileFilter ? [`${candidate.target}:${declarationLine}`] : []),
    '--config',
    configPath,
    '--project=codevetter-chromium',
    '--workers=1',
    '--retries=0',
    ...(repeats > 1 ? [`--repeat-each=${repeats}`] : []),
    '--grep',
    `(?:^|\\s)${escapeRegExp(candidate.name)}$`,
  ];
}

async function readOptionalMainThreadTrace(path) {
  try {
    const metadata = await stat(path);
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > BROWSER_MAIN_THREAD_LIMITS.traceBytes
    ) {
      return null;
    }
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function listPlaywrightCaptureEvidence(repositoryRoot) {
  const root = await realpath(resolve(repositoryRoot));
  const directory = resolve(root, RUNS_DIRECTORY);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const evidence = [];
  for (const entry of entries
    .filter((item) => item.isDirectory())
    .slice(0, PLAYWRIGHT_CAPTURE_LIMITS.receipts)) {
    try {
      const receipt = assertPlaywrightCaptureReceipt(
        JSON.parse(await readFile(join(directory, entry.name, 'receipt.json'), 'utf8'))
      );
      evidence.push(receipt);
    } catch {
      // Invalid or incomplete capture directories never count as evidence.
    }
  }
  return evidence.toSorted(
    (left, right) =>
      left.lifecycle.completed_at.localeCompare(right.lifecycle.completed_at) ||
      left.capture_id.localeCompare(right.capture_id)
  );
}

export async function loadPlaywrightCaptureResult(repositoryRoot, receipt) {
  const root = await realpath(resolve(repositoryRoot));
  const validated = assertPlaywrightCaptureReceipt(receipt);
  if (!validated.result) throw new Error('Playwright capture has no normalized result');
  const path = resolve(root, validated.result.path);
  if (repositoryRelative(root, path) === null) {
    throw new Error('Playwright capture result escapes repository');
  }
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== validated.result.bytes ||
    metadata.size > PLAYWRIGHT_CAPTURE_LIMITS.resultBytes
  ) {
    throw new Error('Playwright capture result integrity check failed');
  }
  const bytes = await readFile(path);
  if (
    bytes.byteLength !== validated.result.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== validated.result.sha256
  ) {
    throw new Error('Playwright capture result integrity check failed');
  }
  const result = JSON.parse(bytes);
  const diagnosis = compactPlaywrightDiagnosis(result);
  if (JSON.stringify(diagnosis) !== JSON.stringify(validated.diagnosis)) {
    throw new Error('Playwright capture diagnosis does not match normalized result');
  }
  return result;
}

export function qualifiedBrowserBaseUrl(candidate) {
  if (!playwrightCandidateSafetyAllowsCapture(candidate)) return null;
  const signals = candidate.signals ?? [];
  const origins = signals.filter((signal) => signal.kind === 'loopback_browser_base_url');
  if (origins.length !== 1) return null;
  try {
    return assertLoopbackBaseUrl(origins[0].evidence);
  } catch {
    return null;
  }
}

async function reserveCaptureDirectory(root, captureId) {
  const parent = resolve(root, RUNS_DIRECTORY);
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  if (repositoryRelative(root, realParent) === null) {
    throw new Error('Playwright capture directory escapes repository');
  }
  const directory = resolve(realParent, captureId);
  await mkdir(directory, { recursive: false });
  const realDirectory = await realpath(directory);
  if (repositoryRelative(realParent, realDirectory) === null) {
    throw new Error('Playwright capture receipt escapes repository');
  }
  return realDirectory;
}

async function loopbackServerReachable(baseUrl) {
  const url = new URL(assertLoopbackBaseUrl(baseUrl));
  const port = url.port ? Number(url.port) : 80;
  return new Promise((resolvePromise) => {
    const socket = connect({ host: url.hostname.replace(/^\[(.*)\]$/, '$1'), port });
    const finish = (value) => {
      socket.destroy();
      resolvePromise(value);
    };
    socket.setTimeout(PLAYWRIGHT_CAPTURE_LIMITS.serverProbeMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export function ownedConfigSource({
  root,
  outputDirectory,
  baseUrl,
  proxyUrl,
  testTimeoutMs,
  mainThreadTracePath = null,
  traceDurationSeconds = null,
  testMatch = null,
  browserProfile,
  captureHeader = null,
}) {
  const use = {
    ...browserProfile.use,
    browserName: 'chromium',
    headless: true,
    baseURL: baseUrl,
    trace: mainThreadTracePath ? 'on' : 'off',
    serviceWorkers: 'block',
    proxy: {
      server: proxyUrl,
      bypass: 'localhost,127.0.0.1,[::1]',
    },
    ...(captureHeader ? { extraHTTPHeaders: { 'x-codevetter-capture': captureHeader } } : {}),
  };
  if (mainThreadTracePath) {
    use.launchOptions = {
      args: browserMainThreadTraceArguments({
        path: mainThreadTracePath,
        durationSeconds: traceDurationSeconds,
      }),
    };
  }
  return `export default ${JSON.stringify({
    testDir: root,
    ...(testMatch === null ? {} : { testMatch }),
    outputDir: outputDirectory,
    timeout: testTimeoutMs,
    fullyParallel: false,
    forbidOnly: true,
    retries: 0,
    workers: 1,
    reporter: [['list']],
    projects: [
      {
        name: 'codevetter-chromium',
        use,
      },
    ],
  })};\n`;
}

async function safelyLoadServerFlow(loadServerFlow) {
  if (typeof loadServerFlow !== 'function') {
    return { state: 'unavailable', reason: 'not_supplied', events: [], complete: false };
  }
  try {
    return await loadServerFlow();
  } catch {
    return {
      state: 'unavailable',
      reason: 'artifact_directory_unavailable',
      events: [],
      complete: false,
    };
  }
}

async function safelyPrepareServerFlow(prepareServerFlow) {
  if (typeof prepareServerFlow !== 'function') return;
  try {
    await prepareServerFlow();
  } catch {
    // The bounded loader decides whether flushed server evidence is usable.
  }
}

export async function prepareAndLoadServerFlow(prepareServerFlow, loadServerFlow) {
  await safelyPrepareServerFlow(prepareServerFlow);
  return safelyLoadServerFlow(loadServerFlow);
}

async function resolveOwnedBrowserProfile(root, candidate) {
  const declared = candidate.browser_profile ?? null;
  if (!declared) {
    const use = {
      viewport: { width: 1_280, height: 720 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    };
    return withOwnedBrowserBinary(root, candidate, {
      use,
      evidence: compactOwnedBrowserProfile({
        projectName: null,
        deviceName: null,
        use,
        provenance: 'codevetter_generic_desktop',
      }),
    });
  }
  let use;
  if (declared.device_name) {
    const descriptor = await loadInstalledDeviceDescriptor(
      root,
      candidate.target,
      declared.device_name
    );
    use = boundedDeviceUse(descriptor);
    if (declared.viewport) use.viewport = boundedViewport(declared.viewport);
    if (declared.device_scale_factor !== null) {
      use.deviceScaleFactor = boundedScale(declared.device_scale_factor);
    }
    if (declared.is_mobile !== null) use.isMobile = declared.is_mobile === true;
    if (declared.has_touch !== null) use.hasTouch = declared.has_touch === true;
  } else {
    use = {
      viewport: boundedViewport(declared.viewport),
      deviceScaleFactor: boundedScale(declared.device_scale_factor),
      isMobile: declared.is_mobile === true,
      hasTouch: declared.has_touch === true,
    };
  }
  return withOwnedBrowserBinary(root, candidate, {
    use,
    evidence: compactOwnedBrowserProfile({
      projectName: declared.project_name,
      deviceName: declared.device_name,
      use,
      provenance: declared.provenance,
    }),
  });
}

async function withOwnedBrowserBinary(root, candidate, profile) {
  const targetDirectory = await realpath(dirname(resolve(root, candidate.target)));
  if (repositoryRelative(root, targetDirectory) === null) {
    throw new Error('declared Playwright target escapes repository');
  }
  const managed = await runOwnedProcess({
    program: process.execPath,
    args: [
      '-e',
      "const value=require('@playwright/test').chromium.executablePath();process.stdout.write(value);",
    ],
    cwd: targetDirectory,
    environment: minimalEnvironment(),
    timeoutMs: 5_000,
  });
  let managedAvailable = false;
  if (managed.status === 'exited' && managed.exitCode === 0 && !managed.truncated) {
    try {
      const metadata = await stat(managed.stdout.trim());
      managedAvailable = metadata.isFile();
    } catch {
      // A declared Playwright browser path without a file is unavailable.
    }
  }
  if (managedAvailable) {
    return {
      ...profile,
      evidence: { ...profile.evidence, browser_binary: 'playwright_managed' },
    };
  }
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  try {
    const metadata = await stat(systemChrome);
    if (!metadata.isFile()) throw new Error('not a file');
  } catch {
    throw new Error('no local Chromium browser executable is available');
  }
  return {
    use: { ...profile.use, channel: 'chrome' },
    evidence: { ...profile.evidence, browser_binary: 'system_chrome' },
  };
}

async function loadInstalledDeviceDescriptor(root, target, deviceName) {
  const targetDirectory = await realpath(dirname(resolve(root, target)));
  if (repositoryRelative(root, targetDirectory) === null) {
    throw new Error('declared Playwright target escapes repository');
  }
  const execution = await runOwnedProcess({
    program: process.execPath,
    args: [
      '-e',
      "const descriptor=require('@playwright/test').devices[process.argv[1]];if(!descriptor)process.exit(2);process.stdout.write(JSON.stringify(descriptor));",
      deviceName,
    ],
    cwd: targetDirectory,
    environment: minimalEnvironment(),
    timeoutMs: 5_000,
  });
  if (execution.status !== 'exited' || execution.exitCode !== 0 || execution.truncated) {
    throw new Error('declared Playwright device is unavailable locally');
  }
  try {
    return JSON.parse(execution.stdout);
  } catch {
    throw new Error('declared Playwright device descriptor is invalid');
  }
}

function boundedDeviceUse(descriptor) {
  const use = {
    viewport: boundedViewport(descriptor.viewport),
    deviceScaleFactor: boundedScale(descriptor.deviceScaleFactor),
    isMobile: descriptor.isMobile === true,
    hasTouch: descriptor.hasTouch === true,
  };
  if (descriptor.screen) use.screen = boundedViewport(descriptor.screen);
  if (typeof descriptor.userAgent === 'string' && descriptor.userAgent.length <= 1_000) {
    use.userAgent = descriptor.userAgent;
  }
  return use;
}

function boundedViewport(value) {
  if (
    !value ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    value.width < 200 ||
    value.width > 4_096 ||
    value.height < 200 ||
    value.height > 4_096
  ) {
    throw new Error('browser profile viewport is invalid');
  }
  return { width: value.width, height: value.height };
}

function boundedScale(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.25 || value > 8) {
    throw new Error('browser profile device scale is invalid');
  }
  return value;
}

function compactOwnedBrowserProfile({ projectName, deviceName, use, provenance }) {
  return {
    project_name: projectName,
    device_name: deviceName,
    viewport: use.viewport,
    device_scale_factor: use.deviceScaleFactor,
    is_mobile: use.isMobile,
    has_touch: use.hasTouch,
    provenance,
  };
}

export function browserMainThreadTraceArguments({ path, durationSeconds }) {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    !Number.isInteger(durationSeconds) ||
    durationSeconds < 1 ||
    durationSeconds > 120
  ) {
    throw new Error('browser main-thread trace launch boundary is invalid');
  }
  const categories = BROWSER_MAIN_THREAD_TRACE_CATEGORIES.join(',');
  return [
    `--trace-startup=${categories}`,
    '--trace-startup-format=json',
    `--trace-startup-file=${path}`,
    `--trace-startup-duration=${durationSeconds}`,
    '--trace-startup-record-mode=record-until-full',
    `--default-trace-buffer-size-limit-in-kb=${BROWSER_MAIN_THREAD_TRACE_BUFFER_KIB}`,
  ];
}

export function browserTraceDurationSeconds(captureTimeoutMs) {
  return Math.min(120, Math.max(1, Math.ceil(boundedTimeout(captureTimeoutMs) / 1_000)));
}

export function playwrightTestTimeout(captureTimeoutMs) {
  const timeout = boundedTimeout(captureTimeoutMs);
  // The process deadline includes runner startup, browser launch, reporter output,
  // trace finalization, and worker shutdown. Keep those phases outside the test
  // budget so a timed-out test can still leave diagnostic evidence behind.
  return Math.min(timeout, Math.max(100, Math.floor(timeout * 0.6)));
}

async function startDenialProxy() {
  const server = createServer((_request, response) => {
    response.writeHead(403, { connection: 'close', 'content-type': 'text/plain' });
    response.end('CodeVetter remote browser traffic denied');
  });
  server.on('connect', (_request, socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('owned browser denial proxy did not bind a loopback port');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolvePromise) => {
        server.close(() => resolvePromise());
        server.closeAllConnections?.();
      }),
  };
}

async function findTraceZip(root) {
  const queue = [{ directory: root, depth: 0 }];
  let considered = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of await readdir(current.directory, { withFileTypes: true })) {
      considered += 1;
      if (considered > PLAYWRIGHT_CAPTURE_LIMITS.zipEntries) {
        throw new Error('Playwright output inventory exceeds bound');
      }
      const path = join(current.directory, entry.name);
      if (entry.isDirectory() && current.depth < 6) {
        queue.push({ directory: path, depth: current.depth + 1 });
      } else if (entry.isFile() && entry.name === 'trace.zip') {
        const metadata = await stat(path);
        if (metadata.size > PLAYWRIGHT_CAPTURE_LIMITS.zipBytes) {
          throw new Error('Playwright trace ZIP exceeds bound');
        }
        return path;
      }
    }
  }
  throw new Error('Playwright execution produced no bounded trace ZIP');
}

function summarizeExecution(execution) {
  return {
    status: execution.status,
    exit_code: execution.exitCode,
    duration_ms: Math.max(0, Math.round(execution.durationMs)),
    stdout_bytes: execution.stdoutBytes,
    stderr_bytes: execution.stderrBytes,
    truncated: execution.truncated,
    memory: execution.memory ?? null,
  };
}

function emptyExecution(status) {
  return {
    status,
    exit_code: null,
    duration_ms: 0,
    stdout_bytes: 0,
    stderr_bytes: 0,
    truncated: false,
    memory: null,
  };
}

function browserMemoryObservation(memory) {
  if (!memory) return null;
  return {
    peak_process_tree_rss_bytes: memory.peak_rss_bytes,
    samples: memory.samples,
    interval_ms: memory.interval_ms,
    provenance: memory.provenance,
  };
}

export function compactPlaywrightFailure(root, execution, { temporaryRoot = null } = {}) {
  const source =
    execution.operationalError ||
    execution.stdout.trim() ||
    execution.stderr.trim() ||
    execution.status;
  return redactText(source, {
    repositoryRoot: root,
    repositoryRoots: temporaryRoot ? [temporaryRoot, relative(root, temporaryRoot)] : [],
    limit: 2_000,
  }).text;
}

async function writeAtomicJson(path, value, limit) {
  const serialized = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(serialized) > limit)
    throw new Error('browser capture receipt exceeds bound');
  temporarySequence += 1;
  const temporary = join(dirname(path), `.receipt-${process.pid}-${temporarySequence}.tmp`);
  await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
