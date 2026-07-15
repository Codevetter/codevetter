import {
  AlertTriangle,
  Boxes,
  Crosshair,
  GitCompareArrows,
  LoaderCircle,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DeepGraphViewer } from '@/components/deep-graph-viewer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SourceLink } from '@/components/unpack-workspace/SourceLink';
import {
  buildStructuralGraph,
  diffStructuralGraphSnapshots,
  findStructuralGraphPath,
  getStructuralGraphAnalysis,
  getStructuralGraphCommunity,
  getStructuralGraphImpact,
  getStructuralGraphNeighbors,
  getStructuralGraphOverview,
  getStructuralGraphStatus,
  getStructuralGraphSubgraph,
  isTauriAvailable,
  listStructuralGraphSnapshots,
  onStructuralGraphProgress,
  searchStructuralGraph,
  type StructuralGraphNode,
  type StructuralGraphAnalysisSummary,
  type StructuralGraphProgress,
  type StructuralGraphProjection,
  type StructuralGraphSearchResult,
  type StructuralGraphSnapshotDiff,
  type StructuralGraphStatus,
  type StructuralGraphStoredSummary,
  type StructuralGraphTrust,
  type UnpackRepoGraph,
} from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';

const TRUST_TONE: Record<StructuralGraphTrust, string> = {
  extracted: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  inferred: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200',
  ambiguous: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  legacy: 'border-slate-400/25 bg-slate-400/10 text-slate-300',
};

function viewerGraph(
  projection: StructuralGraphProjection | null,
  hiddenNodes: ReadonlySet<string>
): UnpackRepoGraph {
  if (!projection) return { schema_version: 3, nodes: [], edges: [], truncated: false };
  return {
    schema_version: 3,
    truncated: projection.truncated,
    nodes: projection.nodes
      .filter((node) => !hiddenNodes.has(node.id))
      .map((node) => ({
        id: node.id,
        kind: node.kind,
        label: node.label,
        path: node.path,
        detail: `${node.trust} · ${node.origin}${node.detail ? ` · ${node.detail}` : ''}`,
        sources: node.sources.map((source) => source.path),
      })),
    edges: projection.edges
      .filter((edge) => !hiddenNodes.has(edge.from) && !hiddenNodes.has(edge.to))
      .map((edge) => ({
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
        evidence: `${edge.trust} · ${edge.evidence}`,
        sources: edge.sources.map((source) => source.path),
        trust: edge.trust,
        origin: edge.origin,
      })),
  };
}

function statusLabel(status: StructuralGraphStatus | null): string {
  if (!status?.indexed) return 'Not indexed';
  if (status.building) return 'Indexing';
  if (status.stale) return 'Refresh available';
  return 'Current';
}

export function StructuralGraphWorkbench({ repoPath }: { repoPath: string }) {
  const [status, setStatus] = useState<StructuralGraphStatus | null>(null);
  const [analysis, setAnalysis] = useState<StructuralGraphAnalysisSummary | null>(null);
  const [snapshots, setSnapshots] = useState<StructuralGraphStoredSummary[]>([]);
  const [snapshotDiff, setSnapshotDiff] = useState<StructuralGraphSnapshotDiff | null>(null);
  const [projection, setProjection] = useState<StructuralGraphProjection | null>(null);
  const [progress, setProgress] = useState<StructuralGraphProgress | null>(null);
  const [searchText, setSearchText] = useState('');
  const [searchResult, setSearchResult] = useState<StructuralGraphSearchResult | null>(null);
  const [selected, setSelected] = useState<StructuralGraphNode | null>(null);
  const [pathFrom, setPathFrom] = useState('');
  const [pathTo, setPathTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeCommunity, setActiveCommunity] = useState<string | null>(null);
  const [hideSuperHubs, setHideSuperHubs] = useState(false);
  const [activeTrust, setActiveTrust] = useState<StructuralGraphTrust[]>([]);
  const [pathNodeIds, setPathNodeIds] = useState<Set<string>>(() => new Set());
  const [pathSummary, setPathSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const repoPathRef = useRef(repoPath);
  const loadGeneration = useRef(0);
  repoPathRef.current = repoPath;

  const refreshStatus = useCallback(async () => {
    if (!isTauriAvailable()) return;
    const requestedRepo = repoPath;
    const next = await getStructuralGraphStatus(repoPath);
    if (repoPathRef.current === requestedRepo) setStatus(next);
    return next;
  }, [repoPath]);

  const loadOverview = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const requestedRepo = repoPath;
    const [next, nextAnalysis, nextSnapshots] = await Promise.all([
      getStructuralGraphOverview(repoPath, 72),
      getStructuralGraphAnalysis(repoPath),
      listStructuralGraphSnapshots(repoPath, 20),
    ]);
    if (generation !== loadGeneration.current || requestedRepo !== repoPathRef.current) return;
    setProjection(next);
    setAnalysis(nextAnalysis);
    setSnapshots(nextSnapshots);
    setSnapshotDiff(null);
    setActiveCommunity(null);
    setSearchResult(null);
    setSelected(null);
    setPathNodeIds(new Set());
    setPathSummary(null);
  }, [repoPath]);

  useEffect(() => {
    let alive = true;
    const generation = ++loadGeneration.current;
    if (!isTauriAvailable()) return undefined;
    void refreshStatus()
      .then((next) => {
        if (alive && generation === loadGeneration.current && next?.indexed) return loadOverview();
        return undefined;
      })
      .catch((cause) => alive && setError(String(cause)));
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void onStructuralGraphProgress((next) => alive && setProgress(next)).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      alive = false;
      disposed = true;
      unlisten?.();
    };
  }, [loadOverview, refreshStatus]);

  const hiddenNodes = useMemo(
    () =>
      hideSuperHubs
        ? new Set(analysis?.super_hubs.map((node) => node.node_id) ?? [])
        : new Set<string>(),
    [analysis, hideSuperHubs]
  );
  const visibleProjection = useMemo(() => {
    if (!projection || activeTrust.length === 0) return projection;
    const nodes = projection.nodes.filter((node) => activeTrust.includes(node.trust));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = projection.edges.filter(
      (edge) => activeTrust.includes(edge.trust) && nodeIds.has(edge.from) && nodeIds.has(edge.to)
    );
    return { ...projection, nodes, edges };
  }, [activeTrust, projection]);
  const graph = useMemo(
    () => viewerGraph(visibleProjection, hiddenNodes),
    [hiddenNodes, visibleProjection]
  );
  const pathNodeStates = useMemo(
    () =>
      Object.fromEntries([...pathNodeIds].map((nodeId) => [nodeId, 'changed' as const])) as Record<
        string,
        'changed'
      >,
    [pathNodeIds]
  );
  const queryFilter = useMemo(
    () => (activeTrust.length ? { trust: activeTrust } : undefined),
    [activeTrust]
  );
  const selectedSources = selected?.sources.slice(0, 3) ?? [];
  const selectedEdges = useMemo(
    () =>
      selected
        ? (visibleProjection?.edges.filter(
            (edge) => edge.from === selected.id || edge.to === selected.id
          ) ?? [])
        : [],
    [selected, visibleProjection]
  );

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function selectNode(label: string, path?: string | null, nodeId?: string) {
    const node =
      (nodeId
        ? visibleProjection?.nodes.find((candidate) => candidate.id === nodeId)
        : undefined) ??
      visibleProjection?.nodes.find(
        (candidate) => candidate.label === label && (path == null || candidate.path === path)
      );
    if (node) {
      setSelected(node);
      if (!pathFrom) setPathFrom(node.id);
      else if (!pathTo && pathFrom !== node.id) setPathTo(node.id);
    }
  }

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) return;
    await run(async () => {
      const result = await searchStructuralGraph(repoPath, query, queryFilter, 30);
      setSearchResult(result);
      setPathNodeIds(new Set());
      setPathSummary(null);
      const first = result?.hits[0]?.node;
      if (!first) {
        setProjection(
          result ? { nodes: [], edges: [], truncated: false, context: result.context } : null
        );
        setSelected(null);
        return;
      }
      setSelected(first);
      const neighborhood = await getStructuralGraphNeighbors(repoPath, first.id, {
        direction: 'both',
        filter: queryFilter,
        limit: 90,
      });
      setProjection(neighborhood);
    });
  }

  async function inspectNode(node: StructuralGraphNode) {
    await run(async () => {
      setSelected(node);
      setPathNodeIds(new Set());
      setPathSummary(null);
      const neighborhood = await getStructuralGraphNeighbors(repoPath, node.id, {
        direction: 'both',
        filter: queryFilter,
        limit: 90,
      });
      setProjection(neighborhood);
    });
  }

  async function showImpact() {
    if (!selected) return;
    await run(async () => {
      const result = await getStructuralGraphImpact(repoPath, selected.id, {
        depth: 4,
        filter: queryFilter,
        limit: 120,
      });
      setProjection(
        result
          ? {
              nodes: [result.root, ...result.affected],
              edges: result.edges,
              truncated: result.truncated,
              context: result.context,
            }
          : null
      );
      setPathNodeIds(new Set());
      setPathSummary(null);
    });
  }

  async function showPath() {
    if (!pathFrom.trim() || !pathTo.trim()) return;
    await run(async () => {
      const result = await findStructuralGraphPath(repoPath, pathFrom, pathTo, queryFilter);
      setProjection(
        result
          ? {
              nodes: result.nodes,
              edges: result.edges,
              truncated: result.truncated,
              context: result.context,
            }
          : null
      );
      const nodeIds = new Set(result?.nodes.map((node) => node.id) ?? []);
      setPathNodeIds(nodeIds);
      setPathSummary(
        result
          ? `${result.nodes.length} nodes · ${result.edges.length} edges · cost ${result.total_cost.toFixed(2)}`
          : 'No path found'
      );
    });
  }

  async function focusCommunity(communityId: string) {
    await run(async () => {
      const result = await getStructuralGraphCommunity(repoPath, communityId, 120);
      setProjection(result);
      setActiveCommunity(communityId);
      setSelected(null);
      setSearchResult(null);
      setPathNodeIds(new Set());
      setPathSummary(null);
    });
  }

  async function focusRank(nodeId: string) {
    await run(async () => {
      const result = await searchStructuralGraph(repoPath, nodeId, undefined, 1);
      const node = result?.hits[0]?.node;
      if (!node) return;
      setSelected(node);
      const neighborhood = await getStructuralGraphNeighbors(repoPath, node.id, {
        direction: 'both',
        filter: queryFilter,
        limit: 90,
      });
      setProjection(neighborhood);
      setActiveCommunity(null);
      setPathNodeIds(new Set());
      setPathSummary(null);
    });
  }

  async function showContext() {
    if (!selected) return;
    await run(async () => {
      const result = await getStructuralGraphSubgraph(repoPath, [selected.id], {
        depth: 2,
        filter: queryFilter,
        limit: 120,
      });
      setProjection(result);
      setPathNodeIds(new Set());
      setPathSummary(null);
    });
  }

  async function compareLatestSnapshots() {
    if (snapshots.length < 2) return;
    await run(async () => {
      const result = await diffStructuralGraphSnapshots(repoPath, snapshots[1].id, snapshots[0].id);
      setSnapshotDiff(result);
    });
  }

  function toggleTrust(trust: StructuralGraphTrust) {
    setPathNodeIds(new Set());
    setPathSummary(null);
    setActiveTrust((current) =>
      current.includes(trust) ? current.filter((value) => value !== trust) : [...current, trust]
    );
  }

  async function buildIndex() {
    await run(async () => {
      setProgress({ phase: 'starting', completed: 0, total: 1, detail: 'Preparing index' });
      await buildStructuralGraph(repoPath);
      await refreshStatus();
      await loadOverview();
      setProgress(null);
    });
  }

  if (!isTauriAvailable()) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--cv-line)] bg-[var(--bg-raised)]/35 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <Network size={15} className="text-[var(--cv-accent)]" />
          Structural graph runs in the desktop app
        </div>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Open this repository in CodeVetter to build and query the local Tree-sitter index.
        </p>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-cyan-500/20 bg-[var(--bg-raised)]/40">
      <header className="flex flex-col gap-4 border-b border-cyan-500/15 p-5 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Network size={18} className="text-cyan-300" />
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">
              Structural intelligence graph
            </h3>
            <Badge className="border border-cyan-400/25 bg-cyan-400/10 text-cyan-200">
              schema v{status?.schema_version ?? 3}
            </Badge>
            <Badge
              className={cn(
                'border',
                status?.stale
                  ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                  : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
              )}
            >
              {statusLabel(status)}
            </Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
            Source-located symbols and relationships with explicit trust. Queries return bounded
            projections, so large repositories remain responsive.
          </p>
          {status?.indexed ? (
            <div className="mt-3 flex flex-wrap gap-3 font-mono text-[10px] text-[var(--text-muted)]">
              <span>{status.indexed_files.toLocaleString()} files</span>
              <span>{status.node_count.toLocaleString()} nodes</span>
              <span>{status.edge_count.toLocaleString()} edges</span>
              <span>
                {status.engine_id}@{status.engine_version}
              </span>
            </div>
          ) : null}
        </div>
        <Button type="button" size="sm" disabled={busy} onClick={() => void buildIndex()}>
          {busy ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {status?.indexed ? 'Refresh index' : 'Build index'}
        </Button>
      </header>

      {progress ? (
        <div className="border-b border-cyan-500/10 bg-cyan-500/[0.04] px-5 py-3">
          <div className="flex items-center justify-between gap-3 text-[11px] text-cyan-100">
            <span>{progress.detail}</span>
            <span className="font-mono">
              {progress.completed.toLocaleString()} / {progress.total.toLocaleString()}
            </span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400 transition-[width] duration-150"
              style={{
                width: `${Math.min(100, (progress.completed / Math.max(1, progress.total)) * 100)}%`,
              }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="m-4 flex items-start gap-2 rounded-lg border border-rose-400/25 bg-rose-400/10 p-3 text-xs text-rose-100">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      ) : null}

      {!status?.indexed ? (
        <div className="p-8 text-center">
          <Boxes size={28} className="mx-auto text-cyan-300/70" />
          <h4 className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
            Build the canonical local index
          </h4>
          <p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-[var(--text-secondary)]">
            The first build parses supported source files in parallel. Later refreshes parse only
            changed files and retain stable node identities.
          </p>
        </div>
      ) : (
        <div className="p-4">
          <div className="grid gap-2 xl:grid-cols-[minmax(260px,1fr)_auto_minmax(200px,0.55fr)_minmax(200px,0.55fr)_auto]">
            <form className="flex gap-2" onSubmit={(event) => void submitSearch(event)}>
              <Input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Symbol, qualified name, file path, or stable id"
                aria-label="Search structural graph"
              />
              <Button type="submit" variant="secondary" size="sm" disabled={busy}>
                <Search size={14} />
                Search
              </Button>
            </form>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadOverview()}>
              <Boxes size={14} />
              Overview
            </Button>
            <Input
              value={pathFrom}
              onChange={(event) => setPathFrom(event.target.value)}
              placeholder="Path from"
              aria-label="Path start node"
            />
            <Input
              value={pathTo}
              onChange={(event) => setPathTo(event.target.value)}
              placeholder="Path to"
              aria-label="Path target node"
            />
            <Button type="button" variant="outline" size="sm" onClick={() => void showPath()}>
              <GitCompareArrows size={14} />
              Trace
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Graph trust filters">
            <span className="mr-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Trust
            </span>
            {(['extracted', 'inferred', 'ambiguous', 'legacy'] as StructuralGraphTrust[]).map(
              (trust) => (
                <button
                  key={trust}
                  type="button"
                  aria-pressed={activeTrust.includes(trust)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[10px] transition-colors',
                    activeTrust.includes(trust)
                      ? TRUST_TONE[trust]
                      : 'border-[var(--cv-line)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  )}
                  onClick={() => toggleTrust(trust)}
                >
                  {trust}
                </button>
              )
            )}
            {snapshots.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => void compareLatestSnapshots()}
              >
                <GitCompareArrows size={13} />
                Compare latest snapshots
              </Button>
            ) : null}
          </div>

          {snapshotDiff ? (
            <div className="mt-3 rounded-lg border border-violet-400/20 bg-violet-400/[0.06] px-3 py-2 text-[10px] text-violet-100">
              Snapshot change: +{snapshotDiff.added_node_ids.length} / -
              {snapshotDiff.removed_node_ids.length} / ~{snapshotDiff.changed_node_ids.length} nodes
              · +{snapshotDiff.added_edge_ids.length} / -{snapshotDiff.removed_edge_ids.length} / ~
              {snapshotDiff.changed_edge_ids.length} edges
            </div>
          ) : null}

          {projection?.context.coverage ? (
            <div
              className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-cyan-400/15 bg-cyan-400/[0.04] px-3 py-2 text-[10px] text-[var(--text-secondary)]"
              aria-label="Structural graph coverage"
            >
              <span>
                Coverage {projection.context.coverage.indexed_files.toLocaleString()} /{' '}
                {projection.context.coverage.discovered_files.toLocaleString()} files indexed
              </span>
              {projection.context.coverage.skipped_files > 0 ? (
                <span>{projection.context.coverage.skipped_files.toLocaleString()} skipped</span>
              ) : null}
              {projection.context.coverage.error_files > 0 ? (
                <span className="text-rose-200">
                  {projection.context.coverage.error_files.toLocaleString()} errors
                </span>
              ) : null}
              {projection.context.coverage.languages
                .filter((language) => !language.supported && language.discovered_files > 0)
                .map((language) => (
                  <span key={language.language} className="text-amber-200">
                    Unsupported: {language.language} ({language.discovered_files.toLocaleString()}{' '}
                    files)
                  </span>
                ))}
            </div>
          ) : null}

          {pathSummary ? (
            <div
              className="mt-3 rounded-lg border border-cyan-400/25 bg-cyan-400/[0.07] px-3 py-2 text-[10px] text-cyan-100"
              aria-label="Path trace result"
              aria-live="polite"
            >
              Highlighted trust-weighted path: {pathSummary}
            </div>
          ) : null}

          {searchResult?.hits.length ? (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {searchResult.hits.map((hit) => (
                <button
                  key={hit.node.id}
                  type="button"
                  className={cn(
                    'shrink-0 rounded-lg border px-3 py-2 text-left transition-colors',
                    selected?.id === hit.node.id
                      ? 'border-cyan-400/50 bg-cyan-400/10'
                      : 'border-[var(--cv-line)] bg-[var(--bg-main)]/40 hover:border-cyan-400/30'
                  )}
                  onClick={() => void inspectNode(hit.node)}
                >
                  <div className="max-w-48 truncate text-xs font-medium text-[var(--text-primary)]">
                    {hit.node.label}
                  </div>
                  <div className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">
                    {hit.node.kind} · {hit.matched_by.replaceAll('_', ' ')}
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {analysis ? (
            <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
              <div className="rounded-xl border border-[var(--cv-line)] bg-[var(--bg-main)]/30 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-[var(--text-primary)]">
                      Navigation communities
                    </div>
                    <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                      Deterministic topology clusters seeded by repository paths
                    </div>
                  </div>
                  {analysis.super_hubs.length ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-pressed={hideSuperHubs}
                      onClick={() => setHideSuperHubs((current) => !current)}
                    >
                      {hideSuperHubs ? 'Show' : 'Hide'} {analysis.super_hubs.length} super-hubs
                    </Button>
                  ) : null}
                </div>
                <div
                  className="mt-3 flex gap-2 overflow-x-auto pb-1"
                  aria-label="Graph communities"
                >
                  {[...analysis.communities]
                    .sort(
                      (left, right) =>
                        right.score - left.score || left.label.localeCompare(right.label)
                    )
                    .slice(0, 16)
                    .map((community) => (
                      <button
                        key={community.id}
                        type="button"
                        aria-pressed={activeCommunity === community.id}
                        className={cn(
                          'shrink-0 rounded-lg border px-3 py-2 text-left transition-colors',
                          activeCommunity === community.id
                            ? 'border-violet-400/50 bg-violet-400/10'
                            : 'border-[var(--cv-line)] bg-black/10 hover:border-violet-400/30'
                        )}
                        onClick={() => void focusCommunity(community.id)}
                      >
                        <div className="max-w-40 truncate text-xs font-medium text-[var(--text-primary)]">
                          {community.label}
                        </div>
                        <div className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">
                          {community.member_count.toLocaleString()} nodes ·{' '}
                          {community.bridge_node_ids.length} bridges
                        </div>
                      </button>
                    ))}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--cv-line)] bg-[var(--bg-main)]/30 p-3">
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  Hubs and bridges
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[
                    ...analysis.bridges.slice(0, 3).map((node) => ({ ...node, role: 'bridge' })),
                    ...analysis.hubs.slice(0, 3).map((node) => ({ ...node, role: 'hub' })),
                  ]
                    .slice(0, 6)
                    .map((node) => (
                      <button
                        key={`${node.role}:${node.node_id}`}
                        type="button"
                        className="min-w-0 rounded-lg border border-[var(--cv-line)] bg-black/10 p-2 text-left hover:border-cyan-400/30"
                        onClick={() => void focusRank(node.node_id)}
                      >
                        <div className="truncate text-[11px] font-medium text-[var(--text-primary)]">
                          {node.label}
                        </div>
                        <div className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">
                          {node.role} · degree {node.degree}
                        </div>
                      </button>
                    ))}
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_320px]">
            <DeepGraphViewer
              graph={graph}
              mode="context"
              repoPath={repoPath}
              summary={`${graph.nodes.length.toLocaleString()} visible of ${status.node_count.toLocaleString()} indexed nodes · ${graph.edges.length.toLocaleString()} visible edges${projection?.truncated ? ' · bounded projection' : ''}`}
              onSelectSymbol={selectNode}
              nodeStates={pathNodeStates}
            />

            <aside className="rounded-xl border border-[var(--cv-line)] bg-[var(--bg-main)]/35 p-4">
              {selected ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                        {selected.label}
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
                        {selected.kind} · {selected.language ?? 'metadata'}
                      </div>
                    </div>
                    <Badge className={cn('shrink-0 border text-[9px]', TRUST_TONE[selected.trust])}>
                      <ShieldCheck size={10} />
                      {selected.trust}
                    </Badge>
                  </div>
                  {selected.qualified_name ? (
                    <div className="mt-3 break-all rounded border border-[var(--cv-line)] bg-black/15 p-2 font-mono text-[10px] text-cyan-100/80">
                      {selected.qualified_name}
                    </div>
                  ) : null}
                  <div className="mt-3 space-y-2">
                    {selectedSources.map((source) => (
                      <div key={`${source.path}:${source.start_line ?? 0}`}>
                        <SourceLink
                          path={`${source.path}${source.start_line ? `#L${source.start_line}` : ''}`}
                          repoPath={repoPath}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void inspectNode(selected)}
                    >
                      <Network size={13} />
                      Neighbors
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void showImpact()}
                    >
                      <Crosshair size={13} />
                      Impact
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void showContext()}
                    >
                      <Boxes size={13} />
                      Context
                    </Button>
                  </div>
                  {selectedEdges.length ? (
                    <div className="mt-4 space-y-2" aria-label="Selected node relationships">
                      {selectedEdges.slice(0, 6).map((edge) => (
                        <div
                          key={edge.id}
                          className="rounded border border-[var(--cv-line)] bg-black/10 p-2"
                        >
                          <div className="font-mono text-[9px] text-cyan-100/80">
                            {edge.kind} · {edge.trust}
                          </div>
                          <div className="mt-1 text-[10px] leading-4 text-[var(--text-secondary)]">
                            {edge.evidence}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 break-all font-mono text-[9px] text-slate-600">
                    {selected.id}
                  </div>
                </>
              ) : (
                <div className="flex h-full min-h-52 flex-col items-center justify-center text-center">
                  <Network size={24} className="text-cyan-300/50" />
                  <div className="mt-3 text-sm font-medium text-[var(--text-primary)]">
                    Select a node
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                    Inspect source evidence, neighborhood, impact, or choose two nodes to trace a
                    trust-weighted path.
                  </p>
                </div>
              )}
            </aside>
          </div>
        </div>
      )}
    </section>
  );
}
