import type { IntentClosureReceipt, ManagedWorkRun } from '@/lib/tauri-ipc';

export function managedRunCanRecover(run: ManagedWorkRun): boolean {
  return run.state === 'planned' || run.state === 'disconnected';
}

export function managedRunStatusLabel(run: ManagedWorkRun): string {
  if (run.disconnectedReason) return `Disconnected · ${run.disconnectedReason}`;
  if (run.currentCheckpointId && run.state === 'checking') return 'Check running';
  return run.state.replaceAll('_', ' ');
}

export function intentClosureEvidenceLabel(receipt: IntentClosureReceipt): string {
  const disposition = receipt.disposition.replaceAll('_', ' ');
  return receipt.stale
    ? `${disposition} · stale after the change advanced`
    : `${disposition} · exact-current`;
}
