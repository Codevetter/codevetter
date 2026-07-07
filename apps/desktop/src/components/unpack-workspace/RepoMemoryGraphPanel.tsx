import { Database, FlaskConical, GitBranch, Network, Route, Waypoints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { DeepGraphViewer } from '@/components/deep-graph-viewer';
import { DisclosurePanel } from '@/components/unpack-workspace/DisclosurePanel';
import { SourceLink } from '@/components/unpack-workspace/SourceLink';
import type { UnpackRepoGraph, UnpackRepoGraphNode } from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';

type GraphNodeInsight = UnpackRepoGraphNode & {
  degree: number;
  incoming: number;
  outgoing: number;
};

type GraphInsight = {
  label: string;
  value: string;
  detail: string;
  tone: string;
  icon: LucideIcon;
  source?: string | null;
};

const PRIMARY_KINDS = new Set([
  'workspace_unit',
  'subsystem',
  'package',
  'route',
  'tauri_command',
  'db_table',
  'entrypoint',
  'script',
]);

const BOUNDARY_KINDS = new Set(['route', 'tauri_command', 'db_table', 'entrypoint', 'script']);
const TESTABLE_KINDS = new Set([
  'workspace_unit',
  'subsystem',
  'package',
  'route',
  'tauri_command',
]);
const SUPPORTING_KINDS = new Set(['test', 'decision']);

function humanKind(kind: string): string {
  return kind.replaceAll('_', ' ');
}

function shortLabel(label: string): string {
  return label.length > 48 ? `${label.slice(0, 45)}...` : label;
}

function buildGraphDegree(graph: UnpackRepoGraph): Map<string, GraphNodeInsight> {
  const degree = new Map(
    graph.nodes.map((node) => [
      node.id,
      {
        ...node,
        degree: 0,
        incoming: 0,
        outgoing: 0,
      },
    ])
  );
  for (const edge of graph.edges) {
    const from = degree.get(edge.from);
    const to = degree.get(edge.to);
    if (from) {
      from.degree += 1;
      from.outgoing += 1;
    }
    if (to) {
      to.degree += 1;
      to.incoming += 1;
    }
  }
  return degree;
}

function hasTestLink(graph: UnpackRepoGraph, nodeId: string): boolean {
  return graph.edges.some((edge) => {
    if (edge.kind === 'tests' && edge.from === nodeId) return true;
    if (edge.from !== nodeId && edge.to !== nodeId) return false;
    const otherId = edge.from === nodeId ? edge.to : edge.from;
    const other = graph.nodes.find((node) => node.id === otherId);
    return other?.kind === 'test';
  });
}

function buildFocusedGraph(graph: UnpackRepoGraph, hubs: GraphNodeInsight[]): UnpackRepoGraph {
  if (graph.nodes.length <= 46) return graph;

  const selected = new Set<string>();
  for (const node of hubs.slice(0, 18)) selected.add(node.id);
  for (const node of graph.nodes) {
    if (selected.size >= 46) break;
    if (PRIMARY_KINDS.has(node.kind) || SUPPORTING_KINDS.has(node.kind)) selected.add(node.id);
  }
  for (const edge of graph.edges) {
    if (selected.size >= 46) break;
    if (selected.has(edge.from)) selected.add(edge.to);
    if (selected.has(edge.to)) selected.add(edge.from);
  }

  const nodes = graph.nodes.filter((node) => selected.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  return {
    ...graph,
    nodes,
    edges,
    truncated: true,
  };
}

function buildGraphPanelModel(graph: UnpackRepoGraph) {
  const degree = buildGraphDegree(graph);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const topKinds = Object.entries(
    graph.nodes.reduce<Record<string, number>>((acc, node) => {
      acc[node.kind] = (acc[node.kind] ?? 0) + 1;
      return acc;
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7);
  const hubs = [...degree.values()]
    .filter((node) => PRIMARY_KINDS.has(node.kind) || node.degree >= 2)
    .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
    .slice(0, 8);
  const boundaries = graph.nodes.filter((node) => BOUNDARY_KINDS.has(node.kind));
  const testableNodes = graph.nodes.filter((node) => TESTABLE_KINDS.has(node.kind));
  const untestedNodes = testableNodes
    .filter((node) => !hasTestLink(graph, node.id))
    .sort((a, b) => (degree.get(b.id)?.degree ?? 0) - (degree.get(a.id)?.degree ?? 0));
  const decisions = graph.nodes.filter((node) => node.kind === 'decision');
  const visualGraph = buildFocusedGraph(graph, hubs);
  const relationshipEdges = [...graph.edges]
    .sort((a, b) => {
      const score = (edge: (typeof graph.edges)[number]) => {
        const from = degree.get(edge.from)?.degree ?? 0;
        const to = degree.get(edge.to)?.degree ?? 0;
        const kindWeight =
          edge.kind === 'tests'
            ? 4
            : edge.kind === 'persists_to'
              ? 4
              : edge.kind === 'routes_to'
                ? 3
                : edge.kind === 'decided_by'
                  ? 3
                  : 1;
        return from + to + kindWeight;
      };
      return score(b) - score(a);
    })
    .slice(0, 8);
  const primary = hubs[0] ?? graph.nodes[0];
  const covered = testableNodes.length - untestedNodes.length;
  const insights: GraphInsight[] = [
    {
      label: 'Start point',
      value: primary ? shortLabel(primary.label) : 'No hub',
      detail: primary
        ? `${humanKind(primary.kind)} with ${degree.get(primary.id)?.degree ?? 0} graph links.`
        : 'No connected hub was detected.',
      tone: 'border-cyan-400/25 bg-cyan-400/[0.07] text-cyan-100',
      icon: Waypoints,
      source: primary?.path,
    },
    {
      label: 'Boundaries',
      value: boundaries.length.toLocaleString(),
      detail: 'Routes, commands, database tables, scripts, and entrypoints found locally.',
      tone: 'border-violet-400/25 bg-violet-400/[0.07] text-violet-100',
      icon: Route,
    },
    {
      label: 'Test links',
      value: testableNodes.length
        ? `${covered.toLocaleString()} / ${testableNodes.length.toLocaleString()}`
        : 'none',
      detail:
        untestedNodes.length > 0
          ? `${untestedNodes.length.toLocaleString()} mapped areas have no direct test edge.`
          : 'Every mapped testable area has an explicit test edge.',
      tone:
        untestedNodes.length > 0
          ? 'border-amber-400/25 bg-amber-400/[0.07] text-amber-100'
          : 'border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-100',
      icon: FlaskConical,
      source: untestedNodes[0]?.path,
    },
    {
      label: 'Decisions',
      value: decisions.length.toLocaleString(),
      detail: 'Repo-local decision markers attached to files in the map.',
      tone: 'border-slate-400/20 bg-white/[0.035] text-slate-100',
      icon: GitBranch,
      source: decisions[0]?.path,
    },
  ];

  return {
    nodeById,
    topKinds,
    hubs,
    boundaries,
    untestedNodes,
    visualGraph,
    relationshipEdges,
    insights,
  };
}

export function RepoMemoryGraphPanel({
  graph,
  repoPath,
  title = 'Repo memory graph',
  description = 'Local map of files, scripts, routes, commands, tables, tests, and decisions.',
  meta,
  warnings = [],
}: {
  graph?: UnpackRepoGraph | null;
  repoPath: string;
  title?: string;
  description?: string;
  meta?: string;
  warnings?: string[];
}) {
  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--cv-line)] bg-[var(--bg-raised)]/35 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <Network size={14} className="text-[var(--cv-accent)]" />
          Local graph pending
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
          The fast snapshot is available, but this snapshot does not include graph nodes yet. Rescan
          the repo to build the local package, route, command, table, and test graph.
        </p>
      </div>
    );
  }

  const {
    nodeById,
    topKinds,
    hubs,
    boundaries,
    untestedNodes,
    visualGraph,
    relationshipEdges,
    insights,
  } = buildGraphPanelModel(graph);

  const edgeLabel = (id: string) => nodeById.get(id)?.label ?? id;
  const agentFacts = [
    `start_node: ${hubs[0]?.label ?? graph.nodes[0]?.label ?? 'none'}`,
    `nodes: ${graph.nodes.length}`,
    `edges: ${graph.edges.length}`,
    `boundaries: ${boundaries.length}`,
    `testable_nodes: ${graph.nodes.filter((node) => TESTABLE_KINDS.has(node.kind)).length}`,
    `missing_direct_test_edges: ${untestedNodes.length}`,
    `top_hubs: ${hubs
      .slice(0, 5)
      .map((node) => node.path ?? node.label)
      .join(', ')}`,
  ];

  return (
    <div className="rounded-xl border border-[var(--cv-line)] bg-[var(--bg-raised)]/35 p-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
            <Network size={18} className="text-[var(--cv-accent)]" />
            {title}
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
            {description}
          </p>
          {meta && <p className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">{meta}</p>}
        </div>
        <Badge
          variant="outline"
          className="shrink-0 border border-cyan-500/30 bg-cyan-500/10 text-[10px] uppercase tracking-wider text-cyan-200"
        >
          v{graph.schema_version} · {graph.nodes.length} nodes · {graph.edges.length} edges
          {graph.truncated ? ' · truncated' : ''}
        </Badge>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {insights.map((insight) => {
          const Icon = insight.icon;
          return (
            <div key={insight.label} className={cn('rounded-xl border p-4', insight.tone)}>
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] opacity-80">
                <Icon size={13} />
                {insight.label}
              </div>
              <div className="mt-3 truncate text-xl font-semibold text-[var(--text-primary)]">
                {insight.value}
              </div>
              <div className="mt-1 text-xs leading-5 opacity-85">{insight.detail}</div>
              {insight.source ? (
                <div className="mt-3">
                  <SourceLink path={insight.source} repoPath={repoPath} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {warnings.length > 0 && (
        <div className="mt-3 rounded border border-yellow-500/25 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-100">
          {warnings.slice(0, 3).map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}

      {topKinds.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {topKinds.map(([kind, count]) => (
            <Badge
              key={kind}
              variant="secondary"
              className="border border-[var(--cv-line)] bg-[var(--bg-main)] text-[10px] uppercase tracking-wider text-[var(--text-secondary)]"
            >
              {humanKind(kind)}: {count}
            </Badge>
          ))}
          {graph.nodes.length !== visualGraph.nodes.length ? (
            <Badge
              variant="outline"
              className="border-cyan-500/20 bg-cyan-500/5 text-[10px] uppercase tracking-wider text-cyan-200"
            >
              showing {visualGraph.nodes.length} strongest nodes
            </Badge>
          ) : null}
        </div>
      )}

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.45fr),minmax(320px,0.55fr)]">
        <DeepGraphViewer
          graph={visualGraph}
          mode="context"
          repoPath={repoPath}
          summary={`${visualGraph.nodes.length.toLocaleString()} visible of ${graph.nodes.length.toLocaleString()} nodes`}
        />

        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--cv-line)] bg-[var(--bg-main)]/35 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Waypoints size={15} className="text-cyan-200" />
              Highest leverage nodes
            </div>
            <div className="mt-3 space-y-2">
              {hubs.slice(0, 6).map((node) => (
                <div key={node.id} className="rounded-lg border border-[var(--cv-line)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {node.label}
                      </div>
                      <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                        {humanKind(node.kind)} · {node.incoming} in · {node.outgoing} out
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="shrink-0 border-[var(--cv-line)] font-mono text-[10px] text-[var(--text-muted)]"
                    >
                      {node.degree}
                    </Badge>
                  </div>
                  {node.path ? (
                    <div className="mt-2">
                      <SourceLink path={node.path} repoPath={repoPath} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {untestedNodes.length > 0 ? (
            <DisclosurePanel
              title="Missing direct test edges"
              summary={`${untestedNodes.length.toLocaleString()} mapped areas need verification links`}
              className="border-amber-400/20 bg-amber-400/[0.035]"
            >
              <div className="space-y-2">
                {untestedNodes.slice(0, 8).map((node) => (
                  <div key={node.id} className="text-xs leading-5 text-amber-100/80">
                    <span className="font-medium text-amber-50">{shortLabel(node.label)}</span>
                    <span className="text-amber-200/55"> · {humanKind(node.kind)}</span>
                    {node.path ? (
                      <div className="mt-1">
                        <SourceLink path={node.path} repoPath={repoPath} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </DisclosurePanel>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <DisclosurePanel
          title={
            <span className="inline-flex items-center gap-2">
              <GitBranch size={15} className="text-cyan-200" />
              Relationships worth checking
            </span>
          }
          summary={`${relationshipEdges.length} strongest edges with local evidence`}
        >
          <div className="space-y-2">
            {relationshipEdges.map((edge) => (
              <div
                key={`${edge.from}-${edge.to}-${edge.kind}`}
                className="rounded-lg border border-[var(--cv-line)] bg-[var(--bg-raised)]/45 p-3 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    {humanKind(edge.kind)}
                  </div>
                  <div className="text-right text-[10px] text-[var(--text-muted)]">
                    {edge.sources.slice(0, 1).join(', ')}
                  </div>
                </div>
                <div className="mt-1 leading-5 text-[var(--text-secondary)]">
                  <span className="font-medium text-[var(--text-primary)]">
                    {shortLabel(edgeLabel(edge.from))}
                  </span>
                  <span className="px-1.5 text-[var(--text-muted)]">{'->'}</span>
                  <span className="font-medium text-[var(--text-primary)]">
                    {shortLabel(edgeLabel(edge.to))}
                  </span>
                </div>
                <div className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
                  {edge.evidence}
                </div>
              </div>
            ))}
          </div>
        </DisclosurePanel>

        <DisclosurePanel
          title={
            <span className="inline-flex items-center gap-2">
              <Database size={15} className="text-cyan-200" />
              Boundary inventory
            </span>
          }
          summary={`${boundaries.length.toLocaleString()} routes, commands, tables, scripts, and entrypoints`}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {boundaries.slice(0, 10).map((node) => (
              <div key={node.id} className="rounded-lg border border-[var(--cv-line)] p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-[var(--text-primary)]">
                    {node.label}
                  </span>
                  <span className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
                    {humanKind(node.kind)}
                  </span>
                </div>
                {node.path ? (
                  <div className="mt-2">
                    <SourceLink path={node.path} repoPath={repoPath} />
                  </div>
                ) : null}
              </div>
            ))}
            {boundaries.length === 0 ? (
              <div className="text-sm leading-6 text-[var(--text-secondary)]">
                No explicit route, command, table, entrypoint, or script boundary was detected in
                this snapshot.
              </div>
            ) : null}
          </div>
        </DisclosurePanel>
      </div>

      <DisclosurePanel
        title="Agent handoff facts"
        summary="Compact facts an AI agent can consume before changing code"
        className="mt-4"
      >
        <pre className="overflow-auto rounded-lg border border-[var(--cv-line)] bg-black/20 p-3 text-xs leading-6 text-[var(--text-secondary)]">
          {agentFacts.join('\n')}
        </pre>
      </DisclosurePanel>
    </div>
  );
}
