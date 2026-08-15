import type { PerformanceAdapter } from '@/lib/performance-workbench';

export type EvidenceScopeKind = 'flow' | 'change' | 'codebase';
export type EvidenceScopeConsumer = 'testing' | 'performance';

export interface EvidenceScopeInput {
  repo_path: string;
  kind: EvidenceScopeKind;
  value?: string;
  consumer: EvidenceScopeConsumer;
}

export interface EvidenceScopeCandidate {
  id: string;
  adapter: PerformanceAdapter;
  target: string;
  name: string | null;
  reason: string;
  source_paths: string[];
  confidence_milli: number;
  testing_supported: boolean;
  performance_supported: boolean;
}

export interface EvidenceScopePlan {
  schema_version: 1;
  plan_id: string;
  repository_revision: string;
  dirty: boolean;
  kind: EvidenceScopeKind;
  original_input: string | null;
  consumer: EvidenceScopeConsumer;
  status: 'ready' | 'no_runnable_scope';
  candidates: EvidenceScopeCandidate[];
  uncovered_paths: string[];
  limitations: string[];
}

export function evidenceScopeNeedsValue(kind: EvidenceScopeKind): boolean {
  return kind !== 'codebase';
}

export function evidenceScopePlaceholder(kind: EvidenceScopeKind): string {
  if (kind === 'flow') return 'checkout coupon calculation';
  if (kind === 'change') return 'main..HEAD or https://github.com/org/repo/pull/123';
  return 'CodeVetter will discover repository-owned executable scopes';
}

export function evidenceScopePreviewPlan(
  consumer: EvidenceScopeConsumer = 'performance'
): EvidenceScopePlan {
  return {
    schema_version: 1,
    plan_id: `scope-plan-v1:${'b7'.repeat(32)}`,
    repository_revision: 'a91d2f8b1337',
    dirty: true,
    kind: 'flow',
    original_input: 'checkout coupon calculation',
    consumer,
    status: 'ready',
    candidates: [
      {
        id: 'scope-preview-checkout',
        adapter: 'vitest',
        target: 'src/cart/cart.test.ts',
        name: 'updates totals',
        reason: 'Matched the described flow through local path/content evidence',
        source_paths: ['src/cart/price.ts', 'src/cart/coupon.ts'],
        confidence_milli: 880,
        testing_supported: true,
        performance_supported: true,
      },
    ],
    uncovered_paths: ['src/cart/coupon-edge-cases.ts'],
    limitations: ['Illustrative preview; no repository discovery was executed.'],
  };
}
