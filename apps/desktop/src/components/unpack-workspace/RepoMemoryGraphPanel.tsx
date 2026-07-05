import { Network } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { SourceLink } from '@/components/unpack-workspace/SourceLink';
import type { UnpackRepoGraph } from '@/lib/tauri-ipc';

export function RepoMemoryGraphPanel({
  graph,
  repoPath,
  title = 'Repo memory graph',
  description = 'Local graph artifact over files, package scripts, routes, commands, tables, tests, and decision markers. Edges are navigation leads, not proof by themselves.',
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
  if (!graph || graph.nodes.length === 0) return null;

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeKinds = graph.nodes.reduce<Record<string, number>>((acc, node) => {
    acc[node.kind] = (acc[node.kind] ?? 0) + 1;
    return acc;
  }, {});
  const topKinds = Object.entries(nodeKinds)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const startKinds = [
    'workspace_unit',
    'subsystem',
    'package',
    'route',
    'command',
    'table',
    'test',
  ];
  const startNodes = graph.nodes
    .filter((node) => startKinds.includes(node.kind))
    .sort((a, b) => startKinds.indexOf(a.kind) - startKinds.indexOf(b.kind))
    .slice(0, 8);
  const sampleNodes = startNodes.length > 0 ? startNodes : graph.nodes.slice(0, 8);
  const sampleEdges = graph.edges.slice(0, 8);
  const edgeLabel = (id: string) => nodeById.get(id)?.label ?? id;
  const edgePath = (id: string) => nodeById.get(id)?.path ?? null;

  return (
    <div className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)]/45 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            <Network size={14} className="text-[var(--cv-accent)]" />
            {title}
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--text-secondary)]">
            {description}
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--text-secondary)]">
            Use this to answer: where does this package start, what tests cover it, what scripts or
            routes are nearby, and what files should move together during a change.
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

      {warnings.length > 0 && (
        <div className="mt-3 rounded border border-yellow-500/25 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-100">
          {warnings.slice(0, 3).map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}

      {topKinds.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {topKinds.map(([kind, count]) => (
            <Badge
              key={kind}
              variant="secondary"
              className="border border-[var(--cv-line)] bg-[var(--bg-main)] text-[10px] uppercase tracking-wider text-[var(--text-secondary)]"
            >
              {kind}: {count}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <div>
          <div className="cv-label mb-1.5">Start here</div>
          <div className="space-y-1.5">
            {sampleNodes.map((node) => (
              <div
                key={node.id}
                className="rounded border border-[var(--cv-line)] bg-[var(--bg-main)]/50 p-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-[var(--text-primary)]">
                    {node.label}
                  </span>
                  <span className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
                    {node.kind}
                  </span>
                </div>
                {node.detail && (
                  <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{node.detail}</div>
                )}
                {node.path && (
                  <div className="mt-1">
                    <SourceLink path={node.path} repoPath={repoPath} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {sampleEdges.length > 0 && (
          <div>
            <div className="cv-label mb-1.5">Useful relationships</div>
            <div className="space-y-1.5">
              {sampleEdges.map((edge) => (
                <div
                  key={`${edge.from}-${edge.to}-${edge.kind}`}
                  className="rounded border border-[var(--cv-line)] bg-[var(--bg-main)]/50 p-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
                      {edge.kind.replaceAll('_', ' ')}
                    </div>
                    <div className="text-right text-[10px] text-[var(--text-muted)]">
                      {edge.sources.slice(0, 1).join(', ')}
                    </div>
                  </div>
                  <div className="mt-1 text-[var(--text-secondary)]">
                    <span className="text-[var(--text-primary)]">{edgeLabel(edge.from)}</span>
                    <span className="px-1.5 text-[var(--text-muted)]">{'->'}</span>
                    <span className="text-[var(--text-primary)]">{edgeLabel(edge.to)}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--text-muted)]">{edge.evidence}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {[edgePath(edge.from), edgePath(edge.to)]
                      .filter((path): path is string => Boolean(path))
                      .filter((path, index, list) => list.indexOf(path) === index)
                      .slice(0, 2)
                      .map((path) => (
                        <SourceLink key={path} path={path} repoPath={repoPath} />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
