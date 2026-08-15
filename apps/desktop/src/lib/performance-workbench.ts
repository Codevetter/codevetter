type PerformanceOperation = 'test' | 'plan' | 'diagnose' | 'inspect' | 'verify_paired';

export type PerformanceAdapter =
  | 'go-test'
  | 'node-test'
  | 'node-script'
  | 'vitest'
  | 'playwright'
  | 'go-bench';

export interface PerformanceRunInput {
  request_id: string;
  operation: PerformanceOperation;
  repo_path: string;
  adapter?: PerformanceAdapter;
  target?: string;
  name?: string;
  samples?: number;
  warmups?: number;
  timeout_ms?: number;
  subject_run_id?: string;
  baseline_repo_path?: string;
}

export interface PerformanceRunProgress {
  request_id: string;
  operation: PerformanceOperation;
  stage: 'started' | 'completed' | 'cancelled';
}

export interface PerformanceRunReceipt {
  schema_version: 1;
  request_id: string;
  operation: PerformanceOperation;
  state: 'succeeded' | 'completed_with_rejection' | 'no_confidence' | 'cancelled';
  exit_code: number | null;
  duration_ms: number;
  result: Record<string, unknown>;
  stderr_summary: string | null;
  cleanup: {
    owned_process_reaped: boolean;
    temporary_profiles_retained: boolean;
  };
}

export type PerformanceBridgeFixtureKind =
  | 'success'
  | 'unsupported_runtime'
  | 'unsafe_scope'
  | 'cancellation'
  | 'timeout'
  | 'malformed_output'
  | 'cleanup_failure';

export type PerformanceBridgeFixture =
  | { kind: 'receipt'; receipt: PerformanceRunReceipt }
  | { kind: 'rejected'; message: string };

export function createPerformanceRequestId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `perf-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function performanceBridgeFixture(
  fixture: PerformanceBridgeFixtureKind
): PerformanceBridgeFixture {
  if (fixture === 'unsafe_scope') {
    return {
      kind: 'rejected',
      message: 'Performance target must be a safe repository-relative path',
    };
  }
  const state =
    fixture === 'success'
      ? 'succeeded'
      : fixture === 'cancellation'
        ? 'cancelled'
        : 'no_confidence';
  const limitation =
    fixture === 'success'
      ? 'Deterministic bridge fixture; no repository workload was executed.'
      : {
          unsupported_runtime: 'The required local runtime was unavailable.',
          cancellation: 'The user cancelled the owned local operation.',
          timeout: 'The owned local operation exceeded its bounded timeout.',
          malformed_output: 'The runtime returned malformed or excessive output.',
          cleanup_failure: 'Owned-process cleanup could not be proven.',
        }[fixture];
  return {
    kind: 'receipt',
    receipt: {
      schema_version: 1,
      request_id: `perf-fixture-${fixture.replaceAll('_', '-')}`,
      operation: 'plan',
      state,
      exit_code: fixture === 'success' ? 0 : fixture === 'cancellation' ? null : 2,
      duration_ms: fixture === 'success' ? 12 : 0,
      result: {
        schema_version: 'desktop-performance-fixture/v1',
        fixture,
        verdict: { status: state },
        limitations: [limitation],
      },
      stderr_summary: null,
      cleanup: {
        owned_process_reaped: fixture !== 'cleanup_failure',
        temporary_profiles_retained: false,
      },
    },
  };
}

export function performancePreviewReceipts(): {
  plan: PerformanceRunReceipt;
  diagnosis: PerformanceRunReceipt;
} {
  const planId = 'af'.repeat(32);
  return {
    plan: {
      schema_version: 1,
      request_id: 'perf-preview-plan',
      operation: 'plan',
      state: 'succeeded',
      exit_code: 0,
      duration_ms: 84,
      stderr_summary: null,
      cleanup: { owned_process_reaped: true, temporary_profiles_retained: false },
      result: {
        schema_version: 'performance-execution-plan/v1',
        plan_id: planId,
        subject: { repository_revision: 'a91d2f8', diff_identity: 'working-tree', dirty: true },
        scope: { adapter: 'vitest', target: 'src/cart/cart.test.ts', name: 'updates totals' },
        mode: 'local_zero_egress',
        limits: {
          max_wall_time_ms: 120000,
          max_processes: 4,
          max_concurrency: 1,
          max_retries: 0,
          max_external_requests: 0,
          max_cost_microusd: 0,
        },
        decision: {
          status: 'admitted',
          reason: 'The exact workload is admitted for bounded local zero-egress execution.',
          blockers: [],
        },
        limitations: ['Local measurements do not model production database or network latency.'],
      },
    },
    diagnosis: {
      schema_version: 1,
      request_id: 'perf-preview-diagnosis',
      operation: 'diagnose',
      state: 'succeeded',
      exit_code: 0,
      duration_ms: 4281,
      stderr_summary: null,
      cleanup: { owned_process_reaped: true, temporary_profiles_retained: false },
      result: {
        schema_version: 'runtime-performance-diagnosis/v1',
        subject: { repository_revision: 'a91d2f8', dirty: true },
        scope: { adapter: 'vitest', target: 'src/cart/cart.test.ts', name: 'updates totals' },
        diagnosis: {
          kind: 'application_hotspot',
          summary: 'Repeated price normalization dominates the captured application work.',
          confidence: 0.82,
          evidence_ids: ['obs-1', 'obs-2'],
        },
        observed: [
          { id: 'obs-1', kind: 'wall_time', median_ms: 31.4, samples: 3 },
          {
            id: 'obs-2',
            kind: 'runtime_source_context',
            source: 'src/cart/price.ts:41',
            share_percent: 62.8,
          },
        ],
        inferred: [
          {
            kind: 'optimization_candidate',
            summary: 'Normalize the catalog once before mapping cart lines.',
          },
        ],
        unverified: [
          {
            kind: 'hypothesis',
            summary: 'Hoisting normalization may reduce repeated allocations.',
          },
        ],
        next_action: {
          summary: 'Change one hotspot, then run paired verification against this exact scope.',
        },
        limitations: [
          'Preview evidence is illustrative and was not captured from the selected repository.',
        ],
        verdict: { status: 'diagnosed' },
      },
    },
  };
}

export type PerformancePreviewState =
  | 'performance-empty'
  | 'performance-blocked'
  | 'performance-planned'
  | 'performance-running'
  | 'performance-failed'
  | 'performance-no-confidence'
  | 'performance-diagnosed'
  | 'performance-paired-proof';

export function performancePreviewState(state: PerformancePreviewState): {
  plan: PerformanceRunReceipt | null;
  diagnosis: PerformanceRunReceipt | null;
  running: boolean;
} {
  const receipts = performancePreviewReceipts();
  if (state === 'performance-empty') return { plan: null, diagnosis: null, running: false };
  if (state === 'performance-planned') {
    return { plan: receipts.plan, diagnosis: null, running: false };
  }
  if (state === 'performance-running') {
    return { plan: receipts.plan, diagnosis: null, running: true };
  }
  if (state === 'performance-blocked') {
    return {
      plan: {
        ...receipts.plan,
        state: 'no_confidence',
        exit_code: 2,
        result: {
          ...receipts.plan.result,
          decision: {
            status: 'blocked',
            reason: 'The workload is blocked before project code executes.',
            blockers: ['A remote service was detected in the selected workload.'],
          },
        },
      },
      diagnosis: null,
      running: false,
    };
  }
  if (state === 'performance-no-confidence' || state === 'performance-failed') {
    return {
      plan: receipts.plan,
      diagnosis: {
        ...receipts.diagnosis,
        state: state === 'performance-failed' ? 'completed_with_rejection' : 'no_confidence',
        exit_code: state === 'performance-failed' ? 1 : 2,
        result: {
          schema_version: 'runtime-performance-diagnosis/v1',
          diagnosis: {
            summary:
              state === 'performance-failed'
                ? 'The exact workload failed before comparable measurements were captured.'
                : 'The run completed without enough application evidence for a diagnosis.',
            confidence: 0,
          },
          observed: [],
          inferred: [],
          unverified: [],
          limitations: [
            state === 'performance-failed'
              ? 'The workload exit code was non-zero.'
              : 'No application-source hotspot met the evidence threshold.',
          ],
          verdict: { status: state === 'performance-failed' ? 'failed' : 'no_confidence' },
        },
      },
      running: false,
    };
  }
  if (state === 'performance-paired-proof') {
    return {
      plan: receipts.plan,
      diagnosis: {
        ...receipts.diagnosis,
        operation: 'verify_paired',
        result: {
          schema_version: 'paired-performance-verification/v1',
          diagnosis: {
            summary: 'The candidate improved the same exact workload without failing its gate.',
            confidence: 0.95,
          },
          observed: [
            { kind: 'baseline_median', value_ms: 31.4 },
            { kind: 'candidate_median', value_ms: 22.1 },
          ],
          inferred: [],
          unverified: [],
          limitations: ['This verdict applies only to the declared local workload.'],
          next_action: { summary: 'Keep the candidate and preserve this paired receipt.' },
          verdict: { status: 'confirmed' },
        },
      },
      running: false,
    };
  }
  return { plan: receipts.plan, diagnosis: receipts.diagnosis, running: false };
}
