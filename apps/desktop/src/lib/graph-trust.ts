import type { GraphPathResult, UnpackRepoGraph } from '@/lib/tauri-ipc';

export type ActiveGraphPreview = {
  graph: UnpackRepoGraph;
  imported: boolean;
};

export function selectActiveGraph(
  savedGraph: UnpackRepoGraph,
  importedPreview: UnpackRepoGraph | null
): ActiveGraphPreview {
  return importedPreview
    ? { graph: importedPreview, imported: true }
    : { graph: savedGraph, imported: false };
}

export function graphImportError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text === 'TAURI_NOT_AVAILABLE'
    ? 'Graph import is available in the desktop app.'
    : `Could not preview graph: ${text}`;
}

export function graphPathCandidateId(
  result: GraphPathResult | null,
  endpoint: 'source' | 'target'
): string | null {
  const resolution = result?.[endpoint];
  return resolution?.status === 'ambiguous' ? (resolution.candidates[0]?.id ?? null) : null;
}

export function renderQualifiedGraphPath(result: GraphPathResult): string {
  if (!result.found || result.hops.length === 0) return result.message;
  const route = [
    result.hops[0]?.from.label,
    ...result.hops.map(
      (hop) =>
        `${hop.follows_stored_direction ? '→' : '←'}[${hop.kind}; ${hop.trust}; ${hop.origin}]→ ${hop.to.label}`
    ),
  ].join(' ');
  const anchors = [...new Set(result.hops.flatMap((hop) => hop.sources))].slice(0, 8);
  const qualification = result.requires_verification
    ? 'Navigation lead only: uncertain/imported/legacy hops must be verified against source and cannot establish a finding or verified claim.'
    : 'Source-backed connectivity context only: this path cannot independently establish a finding or verified claim.';
  return `${route}\n${qualification}${anchors.length ? `\nSources: ${anchors.join(', ')}` : ''}`;
}
