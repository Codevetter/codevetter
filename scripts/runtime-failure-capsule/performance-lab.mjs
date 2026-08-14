import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  LIMITS,
  assertProfileAdapter,
  boundedCount,
  boundedTimeout,
  repositoryRelative,
  validatePerformanceCapsule,
} from './contracts.mjs';
import { ensureCodeVetterEvidenceRoot } from './evidence-root.mjs';
import { createCleanBrowserExecution } from './clean-browser-execution.mjs';
import { reportPerformanceFlowCoverage } from './flow-coverage-report.mjs';
import { OPTIMIZATION_POLICY, verifyOptimizationCapsules } from './optimization-verification.mjs';
import { establishQualifiedViteRuntime } from './owned-vite-runtime.mjs';
import {
  captureQualifiedPlaywrightFlow,
  loadPlaywrightCaptureResult,
} from './playwright-capture.mjs';
import { acceptPerformanceContinuation } from './performance-lab-acceptance.mjs';
import { selectProfileExperimentFinding } from './profile-tool-diagnosis.mjs';
import {
  PERFORMANCE_LAB_LIMITS,
  PERFORMANCE_LAB_SCHEMA_VERSION,
  assertPerformanceLabId,
  assertPerformanceLabCorrectnessScope,
  assertPerformanceLabReceipt,
  boundedPerformanceCandidateExclusions,
  boundedPerformanceFindingExclusions,
  boundedPerformanceLabSteps,
  compactPerformanceLabSummary,
} from './performance-lab-contracts.mjs';
import { redactText } from './redact.mjs';
import { loadSupervisedRunResult, supervisePerformanceRun } from './supervision.mjs';

const LAB_DIRECTORY = '.codevetter/performance-labs';
let temporarySequence = 0;

export async function runAutonomousPerformanceLab(
  {
    repositoryRoot,
    labId,
    maxSteps,
    warmups,
    timeoutMs,
    excludedFindingIds,
    excludedCandidateKeys,
    continueFrom,
    incumbentRepository,
    correctnessScope,
  },
  {
    reportCoverage = reportPerformanceFlowCoverage,
    supervise = supervisePerformanceRun,
    loadMeasurement = loadSupervisedRunResult,
    captureBrowser = captureQualifiedPlaywrightFlow,
    loadBrowserDiagnosis = loadPlaywrightCaptureResult,
    establishBrowserRuntime = establishQualifiedViteRuntime,
    createBrowserExecution = createCleanBrowserExecution,
    store: providedStore,
    verifyScreen = verifyOptimizationCapsules,
    acceptContinuation = acceptPerformanceContinuation,
    now = () => new Date().toISOString(),
  } = {}
) {
  const root = await realpath(resolve(repositoryRoot));
  const safeLabId = assertPerformanceLabId(labId);
  const acceptanceRequested = incumbentRepository !== undefined || correctnessScope !== undefined;
  if (acceptanceRequested && !incumbentRepository) {
    throw new Error('acceptance requires incumbent_repository');
  }
  if (acceptanceRequested && !continueFrom) {
    throw new Error('acceptance requires a continuation predecessor');
  }
  const explicitCorrectnessScope = correctnessScope
    ? assertPerformanceLabCorrectnessScope(correctnessScope)
    : null;
  const policy = {
    max_steps: boundedPerformanceLabSteps(maxSteps),
    samples: OPTIMIZATION_POLICY.shipping_minimum_samples,
    warmups: boundedCount(warmups, {
      name: 'warmups',
      defaultValue: LIMITS.defaultWarmups,
      maximum: LIMITS.maximumWarmups,
    }),
    timeout_ms: boundedTimeout(timeoutMs),
    excluded_finding_ids: boundedPerformanceFindingExclusions(excludedFindingIds),
    excluded_candidate_keys: boundedPerformanceCandidateExclusions(excludedCandidateKeys),
  };
  const store = providedStore ?? (await createPerformanceLabStore(root));
  const continuation = continueFrom
    ? await loadContinuation({
        root,
        labId: safeLabId,
        predecessorLabId: continueFrom,
        store,
        loadMeasurement,
      })
    : null;
  const refreshCoverage = () =>
    reportCoverage(root, {
      excludedFindingIds: policy.excluded_finding_ids,
      excludedCandidateKeys: policy.excluded_candidate_keys,
    });
  await store.reserve(safeLabId);
  const startedAt = now();
  let coverage = null;
  let receipt = {
    schema_version: PERFORMANCE_LAB_SCHEMA_VERSION,
    lab_id: safeLabId,
    state: 'running',
    subject: { repository_revision: null, source_snapshot_sha256: null, dirty: null },
    policy,
    lifecycle: { started_at: startedAt, completed_at: null },
    initial_summary: null,
    final_summary: null,
    steps: [],
    continuation: continuation?.receipt ?? null,
    screening: null,
    acceptance: null,
    stop: null,
    limitations: [
      'The laboratory automates exact local measurements, high-signal existing-test screens, and source-candidate recording; it never edits source.',
      ...(continuation && !acceptanceRequested
        ? [
            'Continuation is a sequential local screen; it does not run project-wide correctness or independently paired measurements and cannot authorize shipping.',
          ]
        : []),
      ...(acceptanceRequested
        ? [
            'Acceptance uses only the caller-supplied local incumbent and an exact explicit or flow-owned correctness scope; CodeVetter does not create, install, or edit either checkout.',
          ]
        : []),
    ],
  };

  const finish = async (state, stop, additionalLimitations = []) => {
    receipt = {
      ...receipt,
      state,
      lifecycle: { ...receipt.lifecycle, completed_at: now() },
      final_summary: coverage ? compactPerformanceLabSummary(coverage.summary) : null,
      stop,
      limitations: [...new Set([...receipt.limitations, ...additionalLimitations])],
    };
    assertPerformanceLabReceipt(receipt);
    await store.write(receipt);
    return receipt;
  };

  try {
    coverage = await refreshCoverage();
    receipt = {
      ...receipt,
      subject: coverage.subject,
      initial_summary: compactPerformanceLabSummary(coverage.summary),
      final_summary: compactPerformanceLabSummary(coverage.summary),
    };
    assertPerformanceLabReceipt(receipt);
    await store.write(receipt);

    let continuationAction = null;
    let acceptanceCorrectnessScope = explicitCorrectnessScope;
    let correctnessBinding = explicitCorrectnessScope ? { source: 'cli' } : null;
    if (continuation) {
      if (
        coverage.subject.source_snapshot_sha256 ===
        continuation.receipt.baseline_subject.source_snapshot_sha256
      ) {
        return finish('stopped', {
          kind: 'source_edit_not_observed',
          reason: 'The repository source snapshot still matches the predecessor candidate.',
          next_action_kind: 'edit_source_candidate',
        });
      }
      continuationAction = actionForContinuation(
        coverage,
        continuation.baseline.performance_capsule
      );
      if (!continuationAction) {
        return finish('stopped', {
          kind: 'continuation_flow_unavailable',
          reason:
            'The predecessor exact flow is absent, unsafe, browser-only, or no longer profile-capable.',
          next_action_kind: coverage.next_action.kind,
        });
      }
      if (acceptanceRequested) {
        const flowBinding = continuationAction.correctness_binding;
        if (
          explicitCorrectnessScope &&
          flowBinding &&
          !sameCorrectnessScope(explicitCorrectnessScope, flowBinding.scope)
        ) {
          return finish('stopped', {
            kind: 'correctness_binding_conflict',
            reason: 'The explicit correctness scope conflicts with the exact flow binding.',
            next_action_kind: 'align_correctness_binding',
          });
        }
        if (!acceptanceCorrectnessScope && flowBinding) {
          acceptanceCorrectnessScope = flowBinding.scope;
        }
        if (flowBinding) {
          correctnessBinding = {
            source: 'repository_manifest',
            manifest_sha256: flowBinding.manifest_sha256,
          };
        }
        if (!acceptanceCorrectnessScope) {
          return finish('stopped', {
            kind: 'correctness_binding_required',
            reason: 'The exact continuation flow has no correctness binding.',
            next_action_kind: 'declare_flow_correctness',
          });
        }
      }
    }

    if (
      coverage.summary.discovery_truncated &&
      ![
        'measure_unmeasured_flow',
        'screen_existing_flow',
        'capture_local_browser_flow',
        'inspect_profile_candidate',
        'inspect_failed_browser_diagnosis',
      ].includes(coverage.next_action.kind)
    ) {
      return finish('stopped', {
        kind: 'truncated_inventory',
        reason: 'The bounded inventory is incomplete, so autonomous execution is withheld.',
        next_action_kind: coverage.next_action.kind,
      });
    }

    for (let index = 1; index <= policy.max_steps; index += 1) {
      const snapshotStop = snapshotBoundary(
        receipt.subject,
        coverage.subject,
        coverage.next_action
      );
      if (snapshotStop) return finish('stopped', snapshotStop);
      if (
        coverage.summary.discovery_truncated &&
        ![
          'measure_unmeasured_flow',
          'screen_existing_flow',
          'capture_local_browser_flow',
          'inspect_profile_candidate',
          'inspect_failed_browser_diagnosis',
        ].includes(coverage.next_action.kind)
      ) {
        return finish('stopped', {
          kind: 'truncated_inventory',
          reason: 'The bounded inventory became incomplete, so autonomous execution is withheld.',
          next_action_kind: coverage.next_action.kind,
        });
      }

      const action = continuationAction ?? coverage.next_action;
      if (['measure_unmeasured_flow', 'screen_existing_flow'].includes(action.kind)) {
        const safetyStop = unsafeMeasurementBoundary(coverage, action);
        if (safetyStop) return finish('stopped', safetyStop);
        const scope = normalizeActionScope(action.scope);
        const runId = `${safeLabId}-s${index}`;
        const result = await supervise({
          repositoryRoot: root,
          runId,
          adapter: assertProfileAdapter(scope.adapter),
          target: scope.target,
          name: scope.name ?? undefined,
          samples: policy.samples,
          warmups: policy.warmups,
          timeoutMs: policy.timeout_ms,
        });
        const step = {
          index,
          action:
            action.kind === 'screen_existing_flow'
              ? 'screen_performance_flow'
              : 'measure_performance_flow',
          coverage_action: action.kind,
          scope,
          run_id: runId,
          capture_id: null,
          result: result.state,
          experiment_id: null,
          diagnosis: null,
          runtime: null,
        };
        receipt.steps.push(step);
        await store.write(assertPerformanceLabReceipt(receipt));
        if (result.state !== 'succeeded') {
          return finish('failed', {
            kind: 'measurement_failed',
            reason: `Supervised measurement ${runId} ended in state ${result.state}.`,
            next_action_kind: action.kind,
          });
        }
        if (continuationAction) {
          const current = await loadMeasurement(root, runId);
          const screening = verifyScreen(
            continuation.baseline.performance_capsule,
            current.result?.performance_capsule,
            {},
            continuation.receipt.candidate.kind.includes('allocation')
              ? { nodeAllocationSource: continuation.receipt.candidate.source }
              : {}
          );
          receipt.screening = screening;
          step.result = `screened_${screening.verdict.status}`;
          step.diagnosis = compactScreening(screening);
          await store.write(assertPerformanceLabReceipt(receipt));
          if (acceptanceRequested && screeningReadyForAcceptance(screening)) {
            const acceptance = await acceptContinuation({
              repositoryRoot: root,
              incumbentRepository,
              baselineSubject: continuation.receipt.baseline_subject,
              currentSubject: receipt.subject,
              performanceScope: scope,
              candidate: continuation.receipt.candidate,
              correctnessScope: acceptanceCorrectnessScope,
              correctnessBinding,
              samples: policy.samples,
              warmups: policy.warmups,
              timeoutMs: policy.timeout_ms,
            });
            let pairedEvidence = null;
            if (acceptance.paired) {
              if (typeof store.writeArtifact !== 'function') {
                throw new Error('performance laboratory store cannot persist paired evidence');
              }
              pairedEvidence = await store.writeArtifact(
                safeLabId,
                'paired-verification',
                acceptance.paired
              );
            }
            receipt.acceptance = compactAcceptance(acceptance, pairedEvidence);
            await store.write(assertPerformanceLabReceipt(receipt));
            const terminal = terminalForAcceptance(receipt.acceptance);
            return finish(terminal.state, terminal.stop);
          }
          return finish('stopped', terminalForScreening(screening));
        }
        coverage = await refreshCoverage();
        continue;
      }

      if (action.kind === 'inspect_profile_candidate') {
        const { result } = await loadMeasurement(root, action.run_id);
        const eligibleFindings =
          result?.tool_diagnosis?.findings?.filter(
            (candidate) => candidate.eligible_for_experiment
          ) ?? [];
        const finding = selectProfileExperimentFinding(result, {
          excludedFindingIds: policy.excluded_finding_ids,
          excludedCandidateKeys: policy.excluded_candidate_keys,
        });
        if (!finding) {
          if (
            eligibleFindings.length > 0 &&
            eligibleFindings.every(
              (candidate) =>
                policy.excluded_finding_ids.includes(candidate.id) ||
                policy.excluded_candidate_keys.includes(candidate.candidate_key)
            )
          ) {
            return finish('completed', {
              kind: 'candidate_exclusions_exhausted',
              reason:
                'Every eligible source candidate in the durable diagnosis was excluded by the caller.',
              next_action_kind: action.kind,
              run_id: action.run_id,
            });
          }
          return finish('failed', {
            kind: 'candidate_evidence_missing',
            reason: 'The durable profile no longer contains its qualified source candidate.',
            next_action_kind: action.kind,
          });
        }
        receipt.steps.push({
          index,
          action: 'inspect_profile_candidate',
          coverage_action: action.kind,
          scope: normalizeActionScope(action.scope),
          run_id: action.run_id,
          capture_id: null,
          result: 'candidate_ready',
          experiment_id: null,
          diagnosis: compactCandidate(finding),
          runtime: null,
        });
        await store.write(assertPerformanceLabReceipt(receipt));
        return finish('stopped', {
          kind: 'source_edit_required',
          reason: 'The durable measurement identified one source-bounded candidate.',
          next_action_kind: action.kind,
          run_id: action.run_id,
          candidate: compactCandidate(finding),
        });
      }

      if (action.kind === 'inspect_failed_browser_diagnosis') {
        const selected = coverage.flows.find((flow) => flow.id === action.candidate_id);
        const capture = selected?.diagnosed_browser_capture;
        if (!capture || capture.capture_id !== action.capture_id) {
          return finish('failed', {
            kind: 'browser_diagnosis_missing',
            reason: 'The selected durable failed-browser diagnosis is absent from coverage.',
            next_action_kind: action.kind,
          });
        }
        await loadBrowserDiagnosis(root, capture);
        receipt.steps.push({
          index,
          action: 'inspect_failed_browser_diagnosis',
          coverage_action: action.kind,
          scope: normalizeActionScope(action.scope, { allowPlaywright: true }),
          run_id: null,
          capture_id: capture.capture_id,
          result: 'failure_diagnosed',
          experiment_id: null,
          diagnosis: capture.diagnosis,
          runtime: null,
        });
        await store.write(assertPerformanceLabReceipt(receipt));
        return finish(
          'stopped',
          {
            kind: 'failed_flow_diagnosed',
            reason:
              'The durable browser evidence explains the failed flow and selects the next observation; correctness remains failed.',
            next_action_kind: action.kind,
            capture_id: capture.capture_id,
            next_probe: capture.diagnosis.next_probe ?? null,
          },
          [
            'A failed-flow diagnosis selects another observation only; it cannot authorize an optimization or establish correctness.',
          ]
        );
      }

      if (action.kind === 'capture_local_browser_flow') {
        const scope = normalizeActionScope(action.scope, { allowPlaywright: true });
        const captureId = `${safeLabId}-s${index}`;
        let cleanExecution = null;
        let runtime = await establishBrowserRuntime({
          repositoryRoot: root,
          candidateId: action.candidate_id,
          timeoutMs: policy.timeout_ms,
          captureId,
        });
        let cleanFallbackCleanupError = null;
        if (runtime.summary.state === 'environment_blocked' && coverage.subject.dirty === false) {
          try {
            cleanExecution = await createBrowserExecution({
              repositoryRoot: root,
              candidateId: action.candidate_id,
            });
            runtime = await establishBrowserRuntime({
              repositoryRoot: root,
              candidateId: action.candidate_id,
              timeoutMs: policy.timeout_ms,
              captureId,
              executionContext: cleanExecution,
            });
            receipt.limitations = [
              ...new Set([
                ...receipt.limitations,
                'The owned browser runtime executed an exact clean Git snapshot with verified reused local dependencies; this is not a hermetic package install.',
              ]),
            ];
          } catch {
            if (cleanExecution) {
              try {
                await cleanExecution.finalize();
              } catch (error) {
                cleanFallbackCleanupError = error;
              }
            }
            cleanExecution = null;
            receipt.limitations = [
              ...new Set([
                ...receipt.limitations,
                'Clean-snapshot browser fallback was unavailable because its source, dependency, or cleanup safety contract was not satisfied.',
              ]),
            ];
          }
        }
        if (cleanFallbackCleanupError) throw cleanFallbackCleanupError;
        if (runtime.summary.configuration === 'codevetter_config_disabled') {
          receipt.limitations = [
            ...new Set([
              ...receipt.limitations,
              'The owned Next development runtime disables repository Next configuration and does not establish production-build equivalence.',
              ...(runtime.summary.warmup === 'unavailable'
                ? [
                    'No static query-free GET warmup path was available; first-route compilation may affect this capture.',
                  ]
                : []),
            ]),
          ];
        }
        if (!runtime.ready) {
          const snapshot = cleanExecution ? await cleanExecution.finalize() : null;
          receipt.steps.push({
            index,
            action: 'capture_playwright_flow',
            coverage_action: action.kind,
            scope,
            run_id: null,
            capture_id: captureId,
            result: runtime.summary.state,
            experiment_id: null,
            diagnosis: null,
            runtime: runtime.summary,
            ...(snapshot ? { execution_source: snapshot } : {}),
          });
          await store.write(assertPerformanceLabReceipt(receipt));
          return finish('stopped', terminalForBrowserRuntime(runtime.summary, action.kind));
        }
        let result;
        let runtimeSummary;
        let snapshot = null;
        let captureError = null;
        try {
          result = await captureBrowser({
            repositoryRoot: root,
            captureId,
            candidateId: action.candidate_id,
            timeoutMs: policy.timeout_ms,
            runtimeConfiguration: runtime.summary.configuration,
            runtimeBaseUrl: runtime.baseUrl,
            runtimePreflight: runtime.summary.preflight,
            prepareServerFlow: runtime.prepareServerFlow,
            loadServerFlow: runtime.collectServerFlow,
            executionContext: cleanExecution,
          });
        } catch (error) {
          captureError = error;
        } finally {
          runtimeSummary = await stopBrowserRuntime(runtime);
          if (cleanExecution) {
            try {
              snapshot = await cleanExecution.finalize();
            } catch (error) {
              captureError ??= error;
            }
          }
        }
        receipt.steps.push({
          index,
          action: 'capture_playwright_flow',
          coverage_action: action.kind,
          scope,
          run_id: null,
          capture_id: captureId,
          result: captureError ? 'capture_threw' : (result?.state ?? 'capture_threw'),
          experiment_id: null,
          diagnosis: captureError ? null : (result?.diagnosis ?? null),
          runtime: runtimeSummary,
          ...(snapshot ? { execution_source: snapshot } : {}),
        });
        await store.write(assertPerformanceLabReceipt(receipt));
        if (runtimeSummary.cleanup === 'failed') {
          return finish('failed', {
            kind: 'browser_server_cleanup_failed',
            reason: 'The owned local browser runtime did not terminate within the cleanup bound.',
            next_action_kind: action.kind,
          });
        }
        if (captureError) throw captureError;
        if (result.state === 'local_server_required') {
          return finish('stopped', {
            kind: 'local_server_required',
            reason:
              'The qualified loopback application must already be running for browser capture.',
            next_action_kind: action.kind,
          });
        }
        if (result.state !== 'succeeded') {
          coverage = await refreshCoverage();
          continue;
        }
        if ((result.diagnosis?.eligible_experiment_findings ?? 0) > 0) {
          return finish('stopped', {
            kind: 'source_edit_required',
            reason: 'The exact browser capture identified a source-bounded candidate.',
            next_action_kind: action.kind,
            capture_id: captureId,
            result: result.result,
          });
        }
        coverage = await refreshCoverage();
        continue;
      }

      return finish(...terminalForCoverage(coverage));
    }

    if (isSafeAutomaticAction(coverage.next_action.kind)) {
      return finish('stopped', {
        kind: 'step_budget_exhausted',
        reason: `The laboratory reached its ${policy.max_steps}-step execution bound.`,
        next_action_kind: coverage.next_action.kind,
      });
    }
    return finish(...terminalForCoverage(coverage));
  } catch (error) {
    const sanitized = redactText(error?.message ?? String(error), {
      repositoryRoot: root,
      limit: PERFORMANCE_LAB_LIMITS.text,
    });
    return finish(
      'failed',
      {
        kind: 'operational_failure',
        reason: sanitized.text || 'The laboratory failed without bounded error evidence.',
        next_action_kind: coverage?.next_action?.kind ?? null,
      },
      ['The failed step did not authorize source mutation or another execution mechanism.']
    );
  }
}

async function stopBrowserRuntime(runtime) {
  try {
    return await runtime.stop();
  } catch {
    return { ...runtime.summary, cleanup: 'failed' };
  }
}

function terminalForBrowserRuntime(runtime, nextActionKind) {
  const terminal = {
    unsupported: [
      'browser_server_unsupported',
      'The selected browser flow has no supported owned runtime or attested existing server.',
    ],
    blocked_listener: [
      'browser_server_blocked',
      'The declared loopback origin is occupied by a listener that could not be attested.',
    ],
    startup_failed: [
      'browser_server_start_failed',
      'The repository-owned browser runtime did not become ready within its bound.',
    ],
    attestation_failed: [
      'browser_server_attestation_failed',
      'The started browser runtime could not be attested to the repository and declared family.',
    ],
    environment_blocked: [
      'browser_server_environment_blocked',
      'The selected Next package contains a loadable development environment file, so CodeVetter did not start it.',
    ],
  }[runtime.state] ?? [
    'browser_server_unsupported',
    'The selected browser runtime returned an unsupported state.',
  ];
  return { kind: terminal[0], reason: terminal[1], next_action_kind: nextActionKind };
}

async function loadContinuation({ root, labId, predecessorLabId, store, loadMeasurement }) {
  const safePredecessor = assertPerformanceLabId(predecessorLabId);
  if (safePredecessor === labId) throw new Error('continuation requires a new laboratory ID');
  if (typeof store.read !== 'function') {
    throw new Error('performance laboratory store cannot read a continuation receipt');
  }
  const predecessor = await store.read(safePredecessor);
  assertContinuationPredecessor(predecessor.receipt, safePredecessor);
  const baseline = await loadMeasurement(root, predecessor.receipt.stop.run_id);
  const capsuleErrors = validatePerformanceCapsule(baseline.result?.performance_capsule);
  if (capsuleErrors.length > 0) {
    throw new Error(`continuation baseline capsule is invalid: ${capsuleErrors.join(', ')}`);
  }
  return {
    baseline: baseline.result,
    receipt: {
      predecessor_lab_id: safePredecessor,
      predecessor_receipt_sha256: predecessor.sha256,
      baseline_run_id: predecessor.receipt.stop.run_id,
      baseline_subject: predecessor.receipt.subject,
      candidate: predecessor.receipt.stop.candidate,
    },
  };
}

function assertContinuationPredecessor(receipt, labId) {
  if (receipt?.schema_version === PERFORMANCE_LAB_SCHEMA_VERSION) {
    assertPerformanceLabReceipt(receipt);
  } else if (
    ![
      'runtime-performance-lab-run/v3',
      'runtime-performance-lab-run/v4',
      'runtime-performance-lab-run/v5',
    ].includes(receipt?.schema_version)
  ) {
    throw new Error('continuation predecessor schema is unsupported');
  }
  if (
    receipt?.lab_id !== labId ||
    receipt?.state !== 'stopped' ||
    receipt?.stop?.kind !== 'source_edit_required' ||
    typeof receipt.stop.run_id !== 'string' ||
    !receipt.stop.candidate?.source ||
    !/^[0-9a-f]{64}$/.test(receipt.subject?.source_snapshot_sha256 ?? '')
  ) {
    throw new Error('continuation predecessor is not a source-edit candidate receipt');
  }
}

export async function createPerformanceLabStore(repositoryRoot) {
  const root = await realpath(resolve(repositoryRoot));
  await ensureCodeVetterEvidenceRoot(root);
  const lexicalDirectory = resolve(root, LAB_DIRECTORY);
  await mkdir(lexicalDirectory, { recursive: true });
  const directory = await realpath(lexicalDirectory);
  if (repositoryRelative(root, directory) === null) {
    throw new Error('performance laboratory directory escapes repository');
  }
  const locations = new Map();
  return {
    async read(labId) {
      const safeLabId = assertPerformanceLabId(labId);
      const labDirectory = await realpath(resolve(directory, safeLabId));
      if (repositoryRelative(directory, labDirectory) === null) {
        throw new Error('performance laboratory receipt escapes repository');
      }
      const receiptPath = await realpath(resolve(labDirectory, 'receipt.json'));
      if (repositoryRelative(labDirectory, receiptPath) === null) {
        throw new Error('performance laboratory receipt escapes its run directory');
      }
      const source = await readFile(receiptPath, 'utf8');
      if (Buffer.byteLength(source) > PERFORMANCE_LAB_LIMITS.receiptBytes) {
        throw new Error('performance laboratory receipt exceeds bound');
      }
      return {
        receipt: JSON.parse(source),
        sha256: createHash('sha256').update(source).digest('hex'),
      };
    },
    async reserve(labId) {
      const safeLabId = assertPerformanceLabId(labId);
      const labDirectory = resolve(directory, safeLabId);
      await mkdir(labDirectory, { recursive: false });
      const resolved = await realpath(labDirectory);
      if (repositoryRelative(directory, resolved) === null) {
        throw new Error('performance laboratory receipt escapes repository');
      }
      const historyDirectory = resolve(resolved, 'history');
      await mkdir(historyDirectory, { recursive: false });
      locations.set(safeLabId, { directory: resolved, historyDirectory, writes: 0 });
    },
    async write(receipt) {
      assertPerformanceLabReceipt(receipt);
      const location = locations.get(receipt.lab_id);
      if (!location) throw new Error('performance laboratory ID is not reserved');
      if (location.writes >= PERFORMANCE_LAB_LIMITS.receipts) {
        throw new Error('performance laboratory receipt history exceeds bound');
      }
      const serialized = `${JSON.stringify(receipt)}\n`;
      if (Buffer.byteLength(serialized) > PERFORMANCE_LAB_LIMITS.receiptBytes) {
        throw new Error('performance laboratory receipt exceeds bound');
      }
      location.writes += 1;
      const historyPath = join(
        location.historyDirectory,
        `${String(location.writes).padStart(3, '0')}-${receipt.state}.json`
      );
      await writeFile(historyPath, serialized, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      temporarySequence += 1;
      const temporary = join(
        location.directory,
        `.receipt-${process.pid}-${temporarySequence}.tmp`
      );
      const destination = join(location.directory, 'receipt.json');
      await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(temporary, destination);
    },
    async writeArtifact(labId, name, value) {
      const safeLabId = assertPerformanceLabId(labId);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
        throw new Error('performance laboratory artifact name is invalid');
      }
      const location = locations.get(safeLabId);
      if (!location) throw new Error('performance laboratory ID is not reserved');
      const serialized = `${JSON.stringify(value)}\n`;
      const bytes = Buffer.byteLength(serialized);
      if (bytes < 1 || bytes > PERFORMANCE_LAB_LIMITS.evidenceBytes) {
        throw new Error('performance laboratory artifact exceeds bound');
      }
      const destination = join(location.directory, `${name}.json`);
      await writeFile(destination, serialized, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      return {
        path: repositoryRelative(root, destination),
        sha256: createHash('sha256').update(serialized).digest('hex'),
        bytes,
      };
    },
  };
}

function snapshotBoundary(initial, current, nextAction) {
  if (
    current.repository_revision !== initial.repository_revision ||
    current.source_snapshot_sha256 !== initial.source_snapshot_sha256
  ) {
    return {
      kind: 'snapshot_changed',
      reason:
        'The repository revision or bounded source snapshot changed while the laboratory was running.',
      next_action_kind: nextAction.kind,
    };
  }
  return null;
}

function terminalForCoverage(coverage) {
  if (coverage.summary.discovery_truncated) {
    return [
      'stopped',
      {
        kind: 'truncated_inventory',
        reason: 'The bounded inventory is incomplete, so autonomous execution is withheld.',
        next_action_kind: coverage.next_action.kind,
      },
    ];
  }
  if (coverage.next_action.kind === 'candidate_exclusions_exhausted') {
    return [
      'completed',
      {
        kind: 'candidate_exclusions_exhausted',
        reason:
          'Every eligible source candidate was excluded and no other safe automatic flow remains.',
        next_action_kind: coverage.next_action.kind,
      },
    ];
  }
  return [
    'completed',
    {
      kind: 'safe_actions_exhausted',
      reason: `No safe automatic laboratory action remains; next action is ${coverage.next_action.kind}.`,
      next_action_kind: coverage.next_action.kind,
    },
  ];
}

function actionForContinuation(coverage, baseline) {
  if (baseline.adapter?.kind === 'playwright') return null;
  const flow = coverage.flows?.find(
    (candidate) =>
      candidate.adapter === baseline.adapter?.kind &&
      candidate.target === baseline.scope?.target &&
      (candidate.name ?? null) === (baseline.scope?.name ?? null)
  );
  if (!flow?.profile_capable || !flow.safe_to_execute) return null;
  const kind = flow.direct_measurement
    ? 'measure_unmeasured_flow'
    : flow.screening_eligible
      ? 'screen_existing_flow'
      : null;
  if (!kind) return null;
  return {
    kind,
    candidate_id: flow.id,
    scope: {
      adapter: flow.adapter,
      target: flow.target,
      name: flow.name ?? null,
    },
    correctness_binding: flow.correctness_binding ?? null,
  };
}

function sameCorrectnessScope(left, right) {
  return (
    left?.adapter === right?.adapter && left?.target === right?.target && left?.name === right?.name
  );
}

function terminalForScreening(screening) {
  const summary = compactScreening(screening);
  if (screening.verdict.status === 'rejected') {
    return {
      kind: 'candidate_rejected',
      reason: 'The sequential exact-flow screen found a material regression.',
      next_action_kind: 'revise_or_revert_source_candidate',
      screening: summary,
    };
  }
  if (screening.verdict.status === 'no_confidence') {
    return {
      kind: 'verification_no_confidence',
      reason: 'The predecessor and current exact-flow evidence could not support a comparison.',
      next_action_kind: 'inspect_screening_limitations',
      screening: summary,
    };
  }
  if (screening.verdict.status === 'confirmed' && screening.decisions.materially_useful === true) {
    return {
      kind: 'paired_verification_required',
      reason:
        'The sequential screen found a material improvement; paired measurement and project correctness are still required before shipping.',
      next_action_kind: 'verify_paired_optimization',
      screening: summary,
    };
  }
  return {
    kind: 'candidate_not_material',
    reason: 'The sequential screen did not confirm a material improvement.',
    next_action_kind: 'revise_or_exclude_source_candidate',
    screening: summary,
  };
}

function screeningReadyForAcceptance(screening) {
  return (
    screening?.verdict?.status === 'confirmed' && screening?.decisions?.materially_useful === true
  );
}

function compactAcceptance(acceptance, pairedEvidence) {
  return {
    change_cost: acceptance.change_cost,
    correctness: acceptance.correctness,
    paired_verification: acceptance.paired
      ? {
          evidence: pairedEvidence,
          summary: {
            subject: acceptance.paired.subject,
            adapter: acceptance.paired.adapter,
            scope: acceptance.paired.scope,
            observed: acceptance.paired.observed,
            limitations: acceptance.paired.limitations,
            decisions: acceptance.paired.decisions,
            verdict: acceptance.paired.verdict,
            evidence_mode: acceptance.paired.evidence_mode,
            workload_identity: acceptance.paired.workload_identity,
          },
        }
      : null,
    verdict: acceptance.verdict,
  };
}

function terminalForAcceptance(acceptance) {
  if (acceptance.verdict.status === 'accepted') {
    return {
      state: 'completed',
      stop: {
        kind: 'candidate_accepted',
        reason: acceptance.verdict.reason,
        next_action_kind: 'retain_source_candidate',
      },
    };
  }
  if (acceptance.verdict.status === 'rejected') {
    return {
      state: 'stopped',
      stop: {
        kind: 'candidate_rejected',
        reason: acceptance.verdict.reason,
        next_action_kind: 'revise_or_revert_source_candidate',
      },
    };
  }
  return {
    state: 'stopped',
    stop: {
      kind: 'acceptance_no_confidence',
      reason: acceptance.verdict.reason,
      next_action_kind: 'inspect_acceptance_limitations',
    },
  };
}

function compactScreening(screening) {
  return {
    verdict: screening.verdict,
    decisions: screening.decisions,
    observed_kinds: screening.observed.map((observation) => observation.kind),
  };
}

function normalizeActionScope(value, { allowPlaywright = false } = {}) {
  if (!value || typeof value.target !== 'string') {
    throw new Error('coverage next action is missing an exact workload scope');
  }
  const scope = {
    adapter:
      allowPlaywright && value.adapter === 'playwright'
        ? 'playwright'
        : assertProfileAdapter(value.adapter),
    target: value.target,
    name: value.name ?? null,
  };
  return typeof value.project === 'string' ? { ...scope, project: value.project } : scope;
}

function unsafeMeasurementBoundary(coverage, action) {
  if (!Array.isArray(coverage.flows)) return null;
  const selected = coverage.flows.find((flow) => flow.id === action.candidate_id);
  if (selected?.safe_to_execute === true) return null;
  return {
    kind: 'unsafe_flow',
    reason: selected
      ? 'The selected flow carries a qualification safety flag and cannot run autonomously.'
      : 'The selected flow is absent from the authoritative coverage inventory.',
    next_action_kind: action.kind,
  };
}

function isSafeAutomaticAction(kind) {
  return [
    'measure_unmeasured_flow',
    'screen_existing_flow',
    'capture_local_browser_flow',
    'inspect_profile_candidate',
    'inspect_failed_browser_diagnosis',
  ].includes(kind);
}

function compactCandidate(finding) {
  return {
    id: finding.id,
    ...(finding.candidate_key ? { candidate_key: finding.candidate_key } : {}),
    kind: finding.kind,
    source: finding.source,
    observed: finding.observed,
    inference: finding.inference,
    unverified: finding.unverified,
    expected_effect: finding.expected_effect,
    verification: finding.verification,
  };
}
