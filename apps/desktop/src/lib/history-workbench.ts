import type { HistoryRevision, UnpackRepoGraph } from '@/lib/tauri-ipc';

export interface HistoryRevisionMatch {
  item: HistoryRevision;
  revisionIndex: number;
}

export function filterHistoryRevisions(
  revisions: HistoryRevision[],
  query: string,
  releasesOnly: boolean,
  limit = 12
): HistoryRevisionMatch[] {
  const normalized = query.trim().toLocaleLowerCase();
  return revisions
    .map((item, revisionIndex) => ({ item, revisionIndex }))
    .filter(({ item }) => !releasesOnly || item.is_release)
    .filter(({ item }) => {
      if (!normalized) return releasesOnly;
      return [item.sha, item.short_sha, item.subject, item.author, ...item.tags]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalized);
    })
    .slice(0, Math.max(1, limit));
}

export type HistoryNodeState = 'added' | 'removed' | 'changed';

export function deriveHistoryGraphTransition(
  previous: UnpackRepoGraph,
  current: UnpackRepoGraph
): { displayGraph: UnpackRepoGraph; nodeStates: Record<string, HistoryNodeState> } {
  const currentById = new Map(current.nodes.map((node) => [node.id, node]));
  const previousById = new Map(previous.nodes.map((node) => [node.id, node]));
  const removed = previous.nodes.filter((node) => !currentById.has(node.id));
  const nodeStates: Record<string, HistoryNodeState> = {};
  for (const node of current.nodes) {
    const before = previousById.get(node.id);
    if (!before) nodeStates[node.id] = 'added';
    else if (JSON.stringify(before) !== JSON.stringify(node)) nodeStates[node.id] = 'changed';
  }
  for (const node of removed) nodeStates[node.id] = 'removed';
  const visibleIds = new Set([...current.nodes, ...removed].map((node) => node.id));
  const edges = [...current.edges];
  const edgeKeys = new Set(edges.map((edge) => `${edge.from}\0${edge.to}\0${edge.kind}`));
  for (const edge of previous.edges) {
    const key = `${edge.from}\0${edge.to}\0${edge.kind}`;
    if (!edgeKeys.has(key) && visibleIds.has(edge.from) && visibleIds.has(edge.to)) {
      edges.push(edge);
    }
  }
  return {
    displayGraph: { ...current, nodes: [...current.nodes, ...removed], edges },
    nodeStates,
  };
}

export function historyInspectionAriaLabel(input: {
  entityLabel: string;
  stale: boolean;
  evidenceGaps: number;
  contradictions: number;
  ambiguousLineage: number;
  annotations: number;
  truncated: boolean;
}): string {
  return [
    `History inspection for ${input.entityLabel}`,
    input.stale ? 'stale index' : 'current index',
    `${input.evidenceGaps} evidence gaps`,
    `${input.contradictions} contradictions`,
    `${input.ambiguousLineage} ambiguous lineage links`,
    `${input.annotations} local annotations`,
    input.truncated ? 'bounded result' : 'complete result',
  ].join(', ');
}
