import type { PerformanceLabReceipt } from '@/lib/tauri-ipc';

const SUMMARY_LABELS: Record<string, string> = {
  discovered_flows: 'Flows found',
  measured_profile_flows: 'Profiled flows',
  browser_traced_flows: 'Browser traces',
  candidate_ready_flows: 'Candidates ready',
  correctness_bound_flows: 'Correctness-bound',
  screening_eligible_flows: 'Ready to screen',
};

export function humanizeLabToken(value: string): string {
  const sentence = value.replaceAll('_', ' ').replaceAll('-', ' ').trim();
  return sentence ? sentence[0].toUpperCase() + sentence.slice(1) : 'Unknown';
}

export function performanceSummaryMetrics(
  summary: Record<string, unknown> | null | undefined
): { key: string; label: string; value: number }[] {
  if (!summary) return [];
  return Object.entries(SUMMARY_LABELS)
    .map(([key, label]) => ({ key, label, value: summary[key] }))
    .filter((entry): entry is { key: string; label: string; value: number } =>
      Number.isFinite(entry.value)
    );
}

export function performanceChangeCost(receipt: PerformanceLabReceipt): {
  files: number;
  added: number;
  removed: number;
  gross: number;
  dependenciesAdded: number;
  violations: string[];
} | null {
  const cost = receipt.acceptance?.change_cost;
  const observed = cost?.observed;
  if (
    !observed ||
    !Number.isFinite(observed.files_changed) ||
    !Number.isFinite(observed.lines_added) ||
    !Number.isFinite(observed.lines_removed) ||
    !Number.isFinite(observed.gross_lines_changed)
  ) {
    return null;
  }
  return {
    files: observed.files_changed as number,
    added: observed.lines_added as number,
    removed: observed.lines_removed as number,
    gross: observed.gross_lines_changed as number,
    dependenciesAdded: observed.production_dependencies_added?.length ?? 0,
    violations: cost.violations ?? [],
  };
}

export function labOutcomeCopy(receipt: PerformanceLabReceipt): {
  eyebrow: string;
  title: string;
  tone: 'good' | 'attention' | 'failed';
} {
  if (receipt.state === 'failed') {
    return { eyebrow: 'Execution failed', title: 'No performance claim', tone: 'failed' };
  }
  if (!receipt.stop) {
    return {
      eyebrow: receipt.state === 'running' ? 'Incomplete receipt' : 'Decision unavailable',
      title: 'No terminal performance decision was recorded',
      tone: 'attention',
    };
  }
  if (receipt.stop.kind === 'source_edit_required') {
    return {
      eyebrow: 'Agent handoff ready',
      title: 'A source-bounded candidate was found',
      tone: 'attention',
    };
  }
  if (receipt.acceptance) {
    const accepted = receipt.acceptance.verdict?.status === 'accepted';
    return {
      eyebrow: accepted ? 'Verification recorded' : 'Candidate not retained',
      title: accepted ? 'Candidate accepted within policy' : 'Candidate decision available',
      tone: accepted ? 'good' : 'attention',
    };
  }
  if (receipt.state === 'completed') {
    return { eyebrow: 'Lab complete', title: 'The bounded search finished', tone: 'good' };
  }
  return {
    eyebrow: 'Lab stopped safely',
    title: humanizeLabToken(receipt.stop.kind),
    tone: 'attention',
  };
}
