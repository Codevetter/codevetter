import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import { LIMITS, assertFlowAdapter, boundedCount, boundedTimeout } from './contracts.mjs';
import { captureFlowRepository } from './flow.mjs';
import { verifyOptimizationCapsules } from './optimization-verification.mjs';

export async function createLocalFlowService(repositoryRoot) {
  const root = await realpath(resolve(repositoryRoot));
  const captures = new Map();
  let nextCapture = 1;

  function store(capsule) {
    const id = `capture-${nextCapture++}`;
    captures.set(id, capsule);
    while (captures.size > LIMITS.storedCaptures) captures.delete(captures.keys().next().value);
    return id;
  }

  function requireCapture(id) {
    const capsule = captures.get(id);
    if (!capsule) throw new Error('Unknown or expired capture identifier');
    return capsule;
  }

  return {
    async capture(input) {
      const adapter = assertFlowAdapter(input.adapter);
      const capsule = await captureFlowRepository({
        repositoryRoot: root,
        adapter,
        target: requiredString(input, 'target'),
        name: optionalString(input, 'name'),
        timeoutMs: boundedTimeout(input.timeout_ms),
        samples: boundedCount(input.samples, {
          name: 'samples',
          defaultValue: LIMITS.defaultSamples,
          minimum: LIMITS.minimumSamples,
          maximum: LIMITS.maximumSamples,
        }),
        warmups: boundedCount(input.warmups, {
          name: 'warmups',
          defaultValue: LIMITS.defaultWarmups,
          maximum: LIMITS.maximumWarmups,
        }),
      });
      const captureId = store(capsule);
      return {
        capture_id: captureId,
        root_flow_id: capsule.root_flow_id,
        verdict: capsule.verdict,
        diagnosis: capsule.diagnosis,
        flow_analysis: capsule.flow_analysis,
        function_analysis: capsule.function_analysis,
        tool_diagnosis: capsule.tool_diagnosis,
        detector_coverage_matrix: capsule.detector_coverage_matrix,
        coverage: capsule.coverage,
        capture: capsule.performance_capsule.capture,
        limitations: capsule.limitations,
      };
    },

    diagnose(input) {
      const capsule = requireCapture(requiredString(input, 'capture_id'));
      return {
        capture_id: input.capture_id,
        ...capsule.tool_diagnosis,
      };
    },

    inspectFinding(input) {
      const capsule = requireCapture(requiredString(input, 'capture_id'));
      const findingId = requiredString(input, 'finding_id');
      const finding = capsule.tool_diagnosis.findings.find(
        (candidate) => candidate.id === findingId
      );
      if (!finding) throw new Error('Unknown performance finding identifier');
      return {
        capture_id: input.capture_id,
        finding,
        evidence: capsule.flows.filter((flow) => finding.evidence_ids.includes(flow.id)),
        detector_coverage: capsule.tool_diagnosis.detector_coverage.find(
          (entry) => entry.detector === finding.detector
        ),
      };
    },

    inspect(input) {
      const capsule = requireCapture(requiredString(input, 'capture_id'));
      const flowId = optionalString(input, 'flow_id') ?? capsule.root_flow_id;
      const flow = capsule.flows.find((candidate) => candidate.id === flowId);
      if (!flow) throw new Error('Unknown flow identifier');
      return {
        capture_id: input.capture_id,
        flow,
        children: capsule.flows.filter((candidate) => candidate.parent_flow_id === flowId),
        relationships: capsule.relationships.filter(
          (relationship) =>
            relationship.from_flow_id === flowId || relationship.to_flow_id === flowId
        ),
        coverage: capsule.coverage,
        limitations: [...new Set([...capsule.limitations, ...flow.limitations])],
      };
    },

    explain(input) {
      const capsule = requireCapture(requiredString(input, 'capture_id'));
      return {
        capture_id: input.capture_id,
        root_flow_id: capsule.root_flow_id,
        diagnosis: capsule.diagnosis,
        flow_analysis: capsule.flow_analysis,
        function_analysis: capsule.function_analysis,
        tool_diagnosis: capsule.tool_diagnosis,
        observed: capsule.observed,
        inferred: capsule.inferred,
        unverified: capsule.unverified,
        next_action: capsule.next_action,
        profile_repeatability: capsule.performance_capsule.observed.profile_repeatability,
        limitations: capsule.limitations,
      };
    },

    verify(input) {
      const baseline = requireCapture(requiredString(input, 'baseline_capture_id'));
      const current = requireCapture(requiredString(input, 'current_capture_id'));
      const verification = verifyOptimizationCapsules(
        baseline.performance_capsule,
        current.performance_capsule
      );
      const functionFrequencyComparison = compareFunctionFrequency(baseline, current);
      return {
        ...compactVerification(verification),
        captures: {
          baseline: input.baseline_capture_id,
          current: input.current_capture_id,
        },
        function_frequency_comparison: functionFrequencyComparison,
        decisions: {
          ...verification.decisions,
          implementation_effect_confirmed: Boolean(
            functionFrequencyComparison && functionFrequencyComparison.delta < 0
          ),
          implementation_effect_basis: functionFrequencyComparison
            ? 'The exact workload re-executed the same named function with a directly comparable call count; coverage assigns no duration.'
            : 'The captures did not contain the same repeated-work candidate and function coverage anchor.',
        },
      };
    },

    get size() {
      return captures.size;
    },
  };
}

function compactVerification(verification) {
  return {
    schema_version: verification.schema_version,
    subject: verification.subject,
    adapter: verification.adapter,
    scope: verification.scope,
    observed: verification.observed,
    policy: verification.policy,
    limitations: verification.limitations,
    decisions: verification.decisions,
    verdict: verification.verdict,
  };
}

export function compareFunctionFrequency(baseline, current) {
  const candidate = baseline.function_analysis?.repeated_work_candidate;
  if (!candidate) return null;
  const currentEntry = current.performance_capsule.observed.function_coverage?.functions?.find(
    (entry) =>
      entry.file === candidate.file &&
      entry.function === candidate.function &&
      entry.start_line === candidate.start_line
  );
  if (!currentEntry) return null;
  return {
    function: candidate.function,
    file: candidate.file,
    start_line: candidate.start_line,
    baseline_call_count: candidate.call_count,
    current_call_count: currentEntry.call_count,
    delta: currentEntry.call_count - candidate.call_count,
    delta_percent:
      candidate.call_count > 0
        ? Math.round(
            ((currentEntry.call_count - candidate.call_count) / candidate.call_count) * 100_000
          ) / 1000
        : null,
    provenance: 'exact_scope_v8_function_coverage',
    duration_claimed: false,
  };
}

function requiredString(value, key) {
  if (typeof value?.[key] !== 'string' || value[key].trim() === '') {
    throw new Error(`Missing tool argument: ${key}`);
  }
  return value[key];
}

function optionalString(value, key) {
  if (value?.[key] === undefined || value[key] === null) return undefined;
  if (typeof value[key] !== 'string' || value[key].trim() === '') {
    throw new Error(`Invalid tool argument: ${key}`);
  }
  return value[key];
}
