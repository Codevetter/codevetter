import {
  PERFORMANCE_FINDINGS_SCHEMA_VERSION,
  assertPerformanceFindingsReport,
  candidateIdentity,
  createFinding,
} from './performance-findings-contracts.mjs';

export const ALLOCATION_EXPERIMENT_MINIMUM_DIRECT_SHARE = 0.1;
export const ALLOCATION_PATTERN_MINIMUM_DIRECT_SHARE = 0.05;

export function diagnoseProfileToolFinding(report) {
  const rawHotspot = report?.observed?.find((entry) => entry.kind === 'repository_cpu_hotspot');
  const capsuleFinding = report?.performance_capsule?.findings?.find(
    (entry) => entry.kind === 'application_hotspot_candidate'
  );
  const directCpuFinding =
    capsuleFinding?.basis !== 'repository_owned_go_cpu_cumulative_path' &&
    capsuleFinding?.self_time_ms > 0 &&
    capsuleFinding?.sample_share > 0
      ? capsuleFinding
      : null;
  const hotspot =
    rawHotspot && directCpuFinding
      ? {
          ...rawHotspot,
          self_time_ms: directCpuFinding.self_time_ms,
          sample_share: directCpuFinding.sample_share,
        }
      : null;
  const repeatable =
    report?.performance_capsule?.observed?.profile_repeatability?.qualified === true ||
    (report?.adapter?.kind === 'go-bench' && Boolean(directCpuFinding));
  const source = normalizeSource(hotspot?.source);
  const allocationPaths =
    report?.observed?.filter((entry) => entry.kind === 'repository_allocation_path') ?? [];
  const benchmark = report?.observed?.find((entry) => entry.kind === 'go_benchmark_measurement');
  const allocationReady = allocationPaths.some(
    (allocationPath) =>
      normalizeSource(allocationPath?.source, 'source_mapped_allocation_profile') &&
      Number.isFinite(benchmark?.allocs_per_op?.median) &&
      Number.isFinite(benchmark?.bytes_per_op?.median)
  );
  const objectAllocationProfile = allocationPaths.some(
    (allocationPath) =>
      allocationPath?.profile_kind === 'go_alloc_objects' ||
      Number.isFinite(allocationPath?.cumulative_profile_objects)
  );
  const heapAllocationPaths =
    report?.observed?.filter((entry) => entry.kind === 'repository_heap_allocation_source') ?? [];
  const heapAllocationFindings =
    report?.performance_capsule?.findings?.filter(
      (entry) => entry.kind === 'node_allocation_candidate'
    ) ?? [];
  const heapAllocationPairs = heapAllocationFindings
    .map((finding) => ({
      finding,
      path: heapAllocationPaths.find(
        (path) =>
          path.source?.file === finding.source?.file &&
          path.source?.function === finding.source?.function
      ),
    }))
    .filter(
      ({ finding, path }) =>
        normalizeSource(path?.source, 'v8_sampling_heap_profile') &&
        finding.sampled_bytes > 0 &&
        Array.isArray(finding.per_run_sampled_bytes) &&
        finding.per_run_sampled_bytes.length === 2
    );
  const heapAllocationReady = heapAllocationPairs.length > 0;
  const detectorCoverage = [
    {
      detector: 'repeatable_application_cpu_hotspot',
      status: hotspot
        ? 'ran'
        : rawHotspot || capsuleFinding
          ? 'insufficient_evidence'
          : 'unavailable',
      reason: hotspot
        ? 'Direct repository-owned CPU samples were normalized to an original source anchor.'
        : rawHotspot || capsuleFinding
          ? 'Only a cumulative CPU path was captured; it may include callee work and cannot seed a source experiment.'
          : 'The exact workload produced no qualified repository-owned CPU hotspot.',
      evidence_kinds: ['cpu_profile', 'source_map'],
    },
    {
      detector: 'repository_allocation_hotspot',
      status: allocationReady
        ? 'ran'
        : allocationPaths.length > 0 || benchmark
          ? 'insufficient_evidence'
          : 'unavailable',
      reason: allocationReady
        ? objectAllocationProfile
          ? 'Go benchmark allocations intersected a repository-owned repeated-object allocation path.'
          : 'Go benchmark allocations intersected only an alloc_space path, which is diagnostic but cannot exclude setup allocations.'
        : 'The exact workload did not produce both Go allocation metrics and a repository-owned allocation path.',
      evidence_kinds: [
        'go_benchmark',
        objectAllocationProfile ? 'go_alloc_objects_profile' : 'go_alloc_space_profile',
        'source_map',
      ],
    },
    {
      detector: 'repository_heap_allocation_hotspot',
      status: heapAllocationReady
        ? 'ran'
        : heapAllocationPaths.length > 0 || heapAllocationFindings.length > 0
          ? 'insufficient_evidence'
          : 'unavailable',
      reason: heapAllocationReady
        ? 'Two independent V8 sampling heap profiles repeated bounded material repository-owned application sources.'
        : 'The exact workload did not produce a repeatable material repository-owned V8 heap-allocation source.',
      evidence_kinds: ['v8_heap_profile', 'source_map'],
    },
  ];
  const findings = [];
  if (hotspot) {
    findings.push(
      createProfileFinding(report, {
        detector: 'repeatable_application_cpu_hotspot',
        kind: 'application_cpu_hotspot',
        origin: 'tool_detected',
        flow_id: 'profile-root',
        source,
        observed: {
          cpu_self_time_ms: hotspot.self_time_ms,
          cpu_sample_share: hotspot.sample_share,
          operation_kind: 'application_cpu',
          operation_shape: hotspot.source?.function ?? '<anonymous>',
          flow_ids: ['profile-root'],
        },
        inference: {
          summary: `${hotspot.source.file}:${hotspot.source.line} is the leading captured repository-owned CPU candidate.`,
          mechanism: 'repeatable_application_cpu_path',
        },
        unverified: [
          'A CPU hotspot is a prioritization signal, not proof that a semantics-preserving faster implementation exists.',
          'Local workload data and host conditions do not establish production impact.',
        ],
        confidence: {
          level: repeatable ? 'medium' : 'low',
          basis: repeatable
            ? 'Independent diagnostic profiles repeated the same repository-owned candidate.'
            : 'Repository CPU was captured, but independent profile repeatability was not qualified.',
        },
        expected_effect: {
          metric: 'same_scope_repository_cpu_share',
          direction: 'decrease',
          scope: 'identical local workload',
        },
        verification: {
          required_observation:
            'Correctness passes and a paired identical-scope profile reduces candidate CPU share without wall-time regression.',
          rejection_condition:
            'Reject if correctness changes, the candidate CPU share does not fall, or wall time regresses.',
        },
        evidence_ids: report.diagnosis.evidence_ids,
        limitations: source ? [] : ['Original repository source attribution is unavailable.'],
        eligible_for_experiment: Boolean(source && repeatable),
      })
    );
  }
  for (const allocationPath of allocationPaths) {
    const allocationSource = normalizeSource(
      allocationPath?.source,
      'source_mapped_allocation_profile'
    );
    if (
      !allocationSource ||
      !Number.isFinite(benchmark?.allocs_per_op?.median) ||
      !Number.isFinite(benchmark?.bytes_per_op?.median)
    ) {
      continue;
    }
    const pathUsesObjectProfile =
      allocationPath.profile_kind === 'go_alloc_objects' ||
      Number.isFinite(allocationPath.cumulative_profile_objects);
    const directAllocationObjects = pathUsesObjectProfile
      ? (allocationPath.flat_profile_objects ?? 0)
      : 0;
    const directAllocationShare = pathUsesObjectProfile ? (allocationPath.flat_share ?? 0) : 0;
    const allocationSourcePattern = sourcePatternForAllocation(report, allocationPath);
    const allocationExperimentEligible = Boolean(
      pathUsesObjectProfile &&
        directAllocationObjects > 0 &&
        (directAllocationShare >= ALLOCATION_EXPERIMENT_MINIMUM_DIRECT_SHARE ||
          (allocationSourcePattern &&
            directAllocationShare >= ALLOCATION_PATTERN_MINIMUM_DIRECT_SHARE))
    );
    findings.push(
      createProfileFinding(report, {
        detector: 'repository_allocation_hotspot',
        kind: 'application_allocation_hotspot',
        origin: 'tool_detected',
        flow_id: 'profile-root',
        source: allocationSource,
        observed: {
          allocs_per_op: benchmark.allocs_per_op.median,
          bytes_per_op: benchmark.bytes_per_op.median,
          ...(pathUsesObjectProfile
            ? { allocation_profile_objects: allocationPath.cumulative_profile_objects }
            : { allocation_profile_bytes: allocationPath.cumulative_profile_bytes }),
          allocation_profile_share: allocationPath.cumulative_share,
          ...(Number.isFinite(allocationPath.objects_per_op)
            ? {
                objects_per_op: allocationPath.objects_per_op,
                per_run_objects_per_op: allocationPath.per_run_objects_per_op,
              }
            : {}),
          ...(allocationSourcePattern
            ? {
                source_pattern: {
                  kind: allocationSourcePattern.kind,
                  lines: allocationSourcePattern.lines,
                  string_verbs: allocationSourcePattern.string_verbs,
                },
                selection_basis: 'direct_allocation_with_supported_source_pattern',
              }
            : { selection_basis: 'direct_allocation_share' }),
          operation_kind: 'application_allocation',
          operation_shape: allocationPath.source?.function ?? '<anonymous>',
          flow_ids: ['profile-root'],
        },
        inference: {
          summary: allocationSourcePattern
            ? `${allocationPath.source.file}:${allocationPath.source.line} is a directly sampled allocation source with bounded static string formatting.`
            : Number.isFinite(allocationPath.objects_per_op)
              ? `${allocationPath.source.file}:${allocationPath.source.line} repeated as a direct allocation leaf in both profiles at ${allocationPath.objects_per_op} objects/op.`
              : `${allocationPath.source.file}:${allocationPath.source.line} is the strongest captured repository-owned repeated-allocation path.`,
          mechanism: allocationSourcePattern
            ? 'direct_allocation_source_with_static_string_format'
            : Number.isFinite(allocationPath.objects_per_op)
              ? 'repeatable_direct_go_allocation_source'
              : 'repository_alloc_objects_path',
        },
        unverified: [
          'A cumulative alloc_objects path can include allocations performed by callees rather than the anchored line itself.',
          ...(allocationSourcePattern
            ? [
                'Replacing formatting with concatenation is only a hypothesis; argument types, escaping, and exact output must remain unchanged.',
              ]
            : []),
          'A semantics-preserving implementation may not reduce the benchmark allocation count.',
          'Local benchmark data does not establish production impact.',
        ],
        confidence: {
          level: 'medium',
          basis:
            'Repeated Go benchmark allocation metrics intersect a repository-owned alloc_objects profile path.',
        },
        expected_effect: {
          metric: 'same_scope_allocs_per_op',
          direction: 'decrease',
          scope: 'identical local workload',
        },
        verification: {
          required_observation:
            'Correctness passes and the identical Go benchmark reduces allocations or bytes per operation without a material latency regression.',
          rejection_condition:
            'Reject if correctness changes, allocation cost does not improve, or latency materially regresses.',
        },
        evidence_ids: [benchmark.id, allocationPath.id].filter(Boolean),
        limitations: allocationExperimentEligible
          ? []
          : [
              pathUsesObjectProfile && directAllocationObjects > 0
                ? `The directly sampled line represents ${roundPercent(directAllocationShare)}% of allocation objects, below the applicable autonomous experiment floor.`
                : pathUsesObjectProfile
                  ? 'The source anchor is a cumulative caller path, not a directly observed repeated allocation line.'
                  : 'Alloc_space can be dominated by one-time benchmark setup; alloc_objects evidence is required before opening an experiment.',
            ],
        eligible_for_experiment: allocationExperimentEligible,
      })
    );
  }
  for (const { finding: heapAllocationFinding, path: heapAllocationPath } of heapAllocationPairs) {
    const heapAllocationSource = normalizeSource(
      heapAllocationPath.source,
      'v8_sampling_heap_profile'
    );
    const heapAllocationIntersectsCpu =
      heapAllocationFinding.basis ===
      'repository_owned_v8_sampled_allocation_bytes_intersecting_cpu_candidate';
    findings.push(
      createProfileFinding(report, {
        detector: 'repository_heap_allocation_hotspot',
        kind: 'application_allocation_hotspot',
        origin: 'tool_detected',
        flow_id: 'profile-root',
        source: heapAllocationSource,
        observed: {
          sampled_bytes: heapAllocationFinding.sampled_bytes,
          per_run_sampled_bytes: heapAllocationFinding.per_run_sampled_bytes,
          allocation_profile_share: heapAllocationFinding.sample_share,
          operation_kind: 'application_heap_allocation',
          operation_shape: heapAllocationFinding.source?.function ?? '<anonymous>',
          flow_ids: ['profile-root'],
          interpretation: 'sampled_allocations_including_objects_collected_by_minor_and_major_gc',
        },
        inference: {
          summary: heapAllocationIntersectsCpu
            ? `${heapAllocationSource.file}:${heapAllocationSource.line} is a material repeated sampled-allocation source on the leading CPU path.`
            : `${heapAllocationSource.file}:${heapAllocationSource.line} is the leading repeated repository-owned sampled-allocation source.`,
          mechanism: heapAllocationIntersectsCpu
            ? 'repeatable_v8_sampling_heap_path_intersecting_cpu_candidate'
            : 'repeatable_v8_sampling_heap_path',
        },
        unverified: [
          'Sampling does not provide exact retained bytes or forced-GC reachability.',
          'A repeated allocation source is not proof that a semantics-preserving reduction exists.',
          'Local workload data does not establish production memory impact.',
        ],
        confidence: {
          level: 'medium',
          basis:
            'Two independent heap profiles repeated the same material repository-owned source.',
        },
        expected_effect: {
          metric: 'same_scope_candidate_sampled_bytes',
          direction: 'decrease',
          scope: 'identical local workload',
        },
        verification: {
          required_observation:
            'Correctness passes and two paired identical-scope heap profiles repeat fewer candidate sampled bytes without latency or peak-RSS regression.',
          rejection_condition:
            'Reject if correctness changes, the allocation source does not repeat with less sampled memory, or latency or peak RSS regresses.',
        },
        evidence_ids: heapAllocationPath.id
          ? [heapAllocationPath.id]
          : report.diagnosis.evidence_ids,
        limitations: [],
        eligible_for_experiment: true,
      })
    );
  }
  findings.sort((left, right) => left.id.localeCompare(right.id));
  const limitations = detectorCoverage
    .filter((entry) => entry.status !== 'ran')
    .map((entry) => entry.reason);
  return assertPerformanceFindingsReport({
    schema_version: PERFORMANCE_FINDINGS_SCHEMA_VERSION,
    subject: {
      repository_revision: report?.subject?.repository_revision ?? '<unknown>',
      ...(report?.subject?.source_snapshot_sha256
        ? { source_snapshot_sha256: report.subject.source_snapshot_sha256 }
        : {}),
    },
    scope: {
      root_flow_id: 'profile-root',
      adapter: report?.adapter?.kind ?? '<unknown>',
      target: report?.scope?.target ?? '<unknown>',
      name: report?.scope?.name ?? null,
    },
    policy: {
      version: 'tool-led-profile-detectors/v1',
      detectors: [
        'repeatable_application_cpu_hotspot',
        'repository_allocation_hotspot',
        'repository_heap_allocation_hotspot',
      ],
      repeated_operation_count: 3,
      serialized_operation_count: 3,
      serialized_combined_ms: 1,
      serialized_parent_share: 0.2,
      unaccounted_ms: 5,
      unaccounted_parent_share: 0.5,
      allocation_experiment_minimum_direct_share: ALLOCATION_EXPERIMENT_MINIMUM_DIRECT_SHARE,
      allocation_pattern_minimum_direct_share: ALLOCATION_PATTERN_MINIMUM_DIRECT_SHARE,
    },
    findings,
    detector_coverage: detectorCoverage,
    limitations,
    verdict: findings.length
      ? {
          status: 'findings',
          reason: 'Deterministic profile findings were derived from captured evidence.',
        }
      : {
          status: 'no_confidence',
          reason: 'No qualified repository CPU or allocation evidence was available.',
        },
  });
}

function sourcePatternForAllocation(report, allocationPath) {
  if (!allocationPath?.source?.file || !allocationPath.source.function) return null;
  const context = report?.observed?.find(
    (entry) =>
      entry.kind === 'runtime_source_context' &&
      entry.source?.file === allocationPath.source.file &&
      (entry.source?.reported_function === allocationPath.source.function ||
        entry.source?.function === allocationPath.source.function)
  );
  return context?.patterns?.find((pattern) => pattern.kind === 'go_static_string_format') ?? null;
}

function createProfileFinding(report, payload) {
  const context = sourceContextForFinding(report, payload);
  const identitySha256 = context?.source_context_sha256 ?? report?.subject?.source_snapshot_sha256;
  const candidateKey = payload.eligible_for_experiment
    ? candidateIdentity(payload, identitySha256)
    : null;
  return createFinding(
    candidateKey
      ? {
          ...payload,
          candidate_key: candidateKey,
          ...(context?.source_context_sha256
            ? { candidate_context_sha256: context.source_context_sha256 }
            : {}),
        }
      : payload
  );
}

function sourceContextForFinding(report, finding) {
  if (!finding.source?.file) return null;
  const simpleFunction = finding.source.function?.split('.').at(-1);
  return report?.observed?.find(
    (entry) =>
      entry.kind === 'runtime_source_context' &&
      entry.source?.file === finding.source.file &&
      (entry.source?.reported_function === finding.source.function ||
        entry.source?.function === finding.source.function ||
        entry.source?.function === simpleFunction)
  );
}

function roundPercent(value) {
  return Math.round(value * 10_000) / 100;
}

export function selectProfileExperimentFinding(
  report,
  { excludedFindingIds = [], excludedCandidateKeys = [] } = {}
) {
  const excluded = new Set(excludedFindingIds);
  const excludedCandidates = new Set(excludedCandidateKeys);
  const eligible = report?.tool_diagnosis?.findings
    ?.filter(
      (finding) =>
        finding.eligible_for_experiment &&
        !excluded.has(finding.id) &&
        !excludedCandidates.has(finding.candidate_key)
    )
    .toSorted((left, right) => compareExperimentFindings(report, left, right));
  if (!eligible?.length) return null;
  return eligible[0];
}

function compareExperimentFindings(report, left, right) {
  const preferredKind = ['allocation_pressure', 'node_allocation_source'].includes(
    report?.diagnosis?.kind
  )
    ? 'application_allocation_hotspot'
    : report?.diagnosis?.kind === 'application_cpu_hotspot'
      ? 'application_cpu_hotspot'
      : null;
  return (
    Number(right.kind === preferredKind) - Number(left.kind === preferredKind) ||
    Number(
      right.inference?.mechanism === 'repeatable_v8_sampling_heap_path_intersecting_cpu_candidate'
    ) -
      Number(
        left.inference?.mechanism === 'repeatable_v8_sampling_heap_path_intersecting_cpu_candidate'
      ) ||
    Number(right.observed?.selection_basis === 'direct_allocation_with_supported_source_pattern') -
      Number(
        left.observed?.selection_basis === 'direct_allocation_with_supported_source_pattern'
      ) ||
    (right.observed?.allocation_profile_share ?? right.observed?.cpu_sample_share ?? 0) -
      (left.observed?.allocation_profile_share ?? left.observed?.cpu_sample_share ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

function normalizeSource(value, provenance = 'source_mapped_cpu_profile') {
  if (
    !value ||
    typeof value.file !== 'string' ||
    value.file.startsWith('/') ||
    value.file.includes('\\') ||
    value.file.split('/').includes('..') ||
    !Number.isInteger(value.line) ||
    value.line < 1
  )
    return null;
  return {
    file: value.file,
    line: value.line,
    function: typeof value.function === 'string' ? value.function : null,
    ...(Number.isInteger(value.reported_line) && value.reported_line > 0
      ? { reported_line: value.reported_line }
      : {}),
    ...(typeof value.reported_function === 'string'
      ? { reported_function: value.reported_function }
      : {}),
    provenance,
  };
}
