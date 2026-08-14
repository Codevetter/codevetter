import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import { normalizeCorrectnessExecution } from './campaign.mjs';
import { assessChangeCost } from './change-cost.mjs';
import { validateOptimizationVerification } from './contracts.mjs';
import { inspectGitDiff } from './git-diff.mjs';
import { verifyPairedRepositories } from './paired-verification.mjs';
import { loadPerformanceFlowContract } from './performance-flow-contract.mjs';
import { runClosedAdapter } from './runner.mjs';

export async function acceptPerformanceContinuation(
  {
    repositoryRoot,
    incumbentRepository,
    baselineSubject,
    currentSubject,
    performanceScope,
    candidate,
    correctnessScope,
    correctnessBinding,
    samples,
    warmups,
    timeoutMs,
  },
  {
    inspectSnapshot = inspectGitDiff,
    runAdapter = runClosedAdapter,
    verifyPaired = verifyPairedRepositories,
    validatePaired = validateOptimizationVerification,
    loadFlowContract = loadPerformanceFlowContract,
  } = {}
) {
  const currentRoot = await realpath(resolve(repositoryRoot));
  const incumbentRoot = await realpath(resolve(incumbentRepository));
  if (currentRoot === incumbentRoot) {
    return noConfidence('The incumbent and current repositories must be distinct.');
  }
  if (correctnessBinding?.source === 'repository_manifest') {
    let contracts;
    try {
      contracts = await Promise.all([
        loadFlowContract(incumbentRoot),
        loadFlowContract(currentRoot),
      ]);
    } catch {
      return noConfidence('The performance-flow correctness contract was unavailable.');
    }
    if (
      !contracts[0].present ||
      !contracts[1].present ||
      contracts[0].manifest_sha256 !== correctnessBinding.manifest_sha256 ||
      contracts[1].manifest_sha256 !== correctnessBinding.manifest_sha256
    ) {
      return noConfidence(
        'The incumbent and current performance-flow correctness contracts do not match.'
      );
    }
  }

  const [initialIncumbent, initialCurrent] = await Promise.all([
    inspectSnapshot(incumbentRoot),
    inspectSnapshot(currentRoot),
  ]);
  if (!sameSubject(initialIncumbent, baselineSubject)) {
    return noConfidence('The incumbent does not match the predecessor source snapshot.');
  }
  if (!sameSubject(initialCurrent, currentSubject)) {
    return noConfidence('The current checkout changed before acceptance began.');
  }
  const changeCost = assessChangeCost(initialCurrent.change_cost, {
    allowedFiles: [candidate.source.file],
  });
  if (changeCost.violations.includes('incomplete')) {
    return noConfidence(
      'The candidate change cost could not be established.',
      null,
      null,
      changeCost
    );
  }
  if (changeCost.violations.length > 0) {
    return rejected(
      `The candidate exceeded its change-cost budget: ${changeCost.violations.join(', ')}.`,
      null,
      null,
      changeCost
    );
  }

  const scope = { ...correctnessScope, timeout_ms: timeoutMs };
  const [incumbentCorrectness, currentCorrectness] = await Promise.all([
    runCorrectness(incumbentRoot, scope, 'incumbent', runAdapter),
    runCorrectness(currentRoot, scope, 'candidate', runAdapter),
  ]);
  const correctness = {
    scope: correctnessScope,
    binding: correctnessBinding,
    incumbent: incumbentCorrectness,
    current: currentCorrectness,
  };
  const correctnessSnapshots = await Promise.all([
    inspectSnapshot(incumbentRoot),
    inspectSnapshot(currentRoot),
  ]);
  if (
    !sameSubject(correctnessSnapshots[0], initialIncumbent) ||
    !sameSubject(correctnessSnapshots[1], initialCurrent)
  ) {
    return noConfidence(
      'A checkout changed during correctness execution.',
      correctness,
      null,
      changeCost
    );
  }
  if (incumbentCorrectness.status !== 'passed') {
    return noConfidence(
      'The incumbent correctness scope did not pass exactly once.',
      correctness,
      null,
      changeCost
    );
  }
  if (currentCorrectness.status === 'failed') {
    return rejected('The candidate correctness scope failed.', correctness, null, changeCost);
  }
  if (currentCorrectness.status !== 'passed') {
    return noConfidence(
      'The candidate correctness scope did not pass exactly once.',
      correctness,
      null,
      changeCost
    );
  }

  let paired;
  try {
    paired = await verifyPaired({
      baselineRepositoryRoot: incumbentRoot,
      currentRepositoryRoot: currentRoot,
      adapter: performanceScope.adapter,
      target: performanceScope.target,
      name: performanceScope.name ?? undefined,
      timeoutMs,
      samples,
      warmups,
      nodeAllocationSource: candidate.kind.includes('allocation') ? candidate.source : undefined,
    });
  } catch {
    return noConfidence(
      'Paired performance verification was operationally unavailable.',
      correctness,
      null,
      changeCost
    );
  }
  if (
    validatePaired(paired).length > 0 ||
    paired.evidence_mode !== 'paired_interleaved' ||
    paired.workload_identity?.algorithm !== 'sha256' ||
    !/^[0-9a-f]{64}$/.test(paired.workload_identity?.digest ?? '')
  ) {
    return noConfidence(
      'Paired performance evidence was incomplete.',
      correctness,
      paired,
      changeCost
    );
  }
  const finalSnapshots = await Promise.all([
    inspectSnapshot(incumbentRoot),
    inspectSnapshot(currentRoot),
  ]);
  if (
    !sameSubject(finalSnapshots[0], initialIncumbent) ||
    !sameSubject(finalSnapshots[1], initialCurrent)
  ) {
    return noConfidence(
      'A checkout changed during paired verification.',
      correctness,
      paired,
      changeCost
    );
  }
  if (paired.decisions.shipping_recommended === true) {
    return accepted(
      'Correctness passed and paired performance evidence recommends shipping.',
      correctness,
      paired,
      changeCost
    );
  }
  if (paired.verdict.status === 'rejected') {
    return rejected(
      'Paired performance evidence rejected the candidate.',
      correctness,
      paired,
      changeCost
    );
  }
  return noConfidence(
    'Paired evidence did not authorize shipping the candidate.',
    correctness,
    paired,
    changeCost
  );
}

async function runCorrectness(root, scope, role, runAdapter) {
  try {
    const execution = await runAdapter({
      repositoryRoot: root,
      adapter: scope.adapter,
      target: scope.target,
      name: scope.name,
      timeoutMs: scope.timeout_ms,
    });
    return normalizeCorrectnessExecution(scope, execution, role);
  } catch {
    return {
      role,
      scope: { adapter: scope.adapter, target: scope.target, name: scope.name },
      status: 'crash',
      exit_code: null,
      duration_ms: 0,
      selection: null,
      limitation: 'Correctness execution was operationally unavailable.',
    };
  }
}

function sameSubject(left, right) {
  return (
    left?.repository_revision === right?.repository_revision &&
    left?.source_snapshot_sha256 === right?.source_snapshot_sha256
  );
}

function accepted(reason, correctness, paired, changeCost) {
  return outcome('accepted', reason, correctness, paired, changeCost);
}

function rejected(reason, correctness = null, paired = null, changeCost = null) {
  return outcome('rejected', reason, correctness, paired, changeCost);
}

function noConfidence(reason, correctness = null, paired = null, changeCost = null) {
  return outcome('no_confidence', reason, correctness, paired, changeCost);
}

function outcome(status, reason, correctness, paired, changeCost) {
  return { verdict: { status, reason }, correctness, paired, change_cost: changeCost };
}
