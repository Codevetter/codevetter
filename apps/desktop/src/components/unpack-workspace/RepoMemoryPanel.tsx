import {
  BookOpenText,
  CheckCircle2,
  Download,
  FileText,
  History,
  type LucideIcon,
  Network,
  ShieldAlert,
} from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { qaStatusTone } from '@/components/unpack-workspace/UnpackIntelligencePanels';
import { SourceLink } from '@/components/unpack-workspace/SourceLink';
import type { UnpackRepoInventory } from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';

export const RepoMemoryPanel = memo(function RepoMemoryPanel({
  inventory,
  hasReport,
  disabled,
  onExportMemory,
}: {
  inventory: UnpackRepoInventory;
  hasReport: boolean;
  disabled: boolean;
  onExportMemory: () => void;
}) {
  const startHere = useMemo(() => {
    const seen = new Set<string>();
    const files = [
      ...inventory.docs.map((doc) => doc.path),
      ...inventory.entrypoints.map((entrypoint) => entrypoint.path),
      ...inventory.manifests.map((manifest) => manifest.path),
      ...inventory.config_files,
    ];
    return files
      .filter((file) => {
        if (!file || seen.has(file)) return false;
        seen.add(file);
        return true;
      })
      .slice(0, 12);
  }, [inventory.config_files, inventory.docs, inventory.entrypoints, inventory.manifests]);

  const workspaceUnits = inventory.workspace_units ?? [];
  const graph = inventory.repo_graph;
  const historyBrief = inventory.history_brief;
  const health = inventory.repo_health;
  const readiness = inventory.qa_readiness;
  const graphNodeCount = graph?.nodes.length ?? 0;
  const graphEdgeCount = graph?.edges.length ?? 0;
  const healthHotspots = health?.hotspot_count ?? 0;
  const topUnits = workspaceUnits.slice(0, 6);
  const topGraphNodes = graph?.nodes.slice(0, 8) ?? [];
  const qaSignals = readiness?.signals.slice(0, 6) ?? [];
  const qaFlows = readiness?.suggested_flows.slice(0, 5) ?? [];
  const topHealthFiles = health?.top_files.slice(0, 5) ?? [];
  const decisions = historyBrief?.decisions.slice(0, 6) ?? [];
  const recentCommits = historyBrief?.recent_commits.slice(0, 5) ?? [];
  const couplings = historyBrief?.temporal_couplings?.slice(0, 4) ?? [];
  const coverage = inventory.coverage;
  const scanShape =
    coverage?.total_files && coverage.total_files > inventory.files_scanned
      ? `${inventory.files_scanned.toLocaleString()} sampled of ${coverage.total_files.toLocaleString()} files`
      : `${inventory.files_scanned.toLocaleString()} files`;

  return (
    <Card className="cv-frame cv-glow-edge overflow-hidden rounded-lg">
      <CardHeader className="border-b border-[var(--cv-line)] bg-white/[0.015] pb-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2">
              <BookOpenText size={17} className="text-[var(--cv-accent)]" />
              <CardTitle className="text-lg">Repo memory</CardTitle>
              <Badge
                variant="outline"
                className="border-cyan-500/25 bg-cyan-500/10 text-[10px] uppercase tracking-wider text-cyan-100"
              >
                Local · no AI
              </Badge>
            </div>
            <CardDescription className="mt-2 text-sm leading-relaxed">
              A durable start-here brief for humans and agents: source map, architecture leads,
              verification signals, change memory, and operating notes from this exact snapshot.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onExportMemory}
          >
            <Download size={14} className="mr-1.5" />
            Export memory
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MemoryStat
            label="Scan shape"
            value={scanShape}
            detail={inventory.branch ?? 'no branch'}
          />
          <MemoryStat
            label="Graph"
            value={`${graphNodeCount.toLocaleString()} nodes`}
            detail={`${graphEdgeCount.toLocaleString()} edges`}
          />
          <MemoryStat
            label="QA posture"
            value={`${readiness?.score ?? 0}/100`}
            detail={readiness?.status ?? 'missing'}
          />
          <MemoryStat
            label="Health"
            value={`${health?.average_score?.toFixed(1) ?? '0.0'}/10`}
            detail={`${healthHotspots.toLocaleString()} hotspots`}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <MemorySection
            title="Start here"
            icon={FileText}
            description="Files most likely to explain how the repository is shaped."
          >
            <div className="rounded-lg border border-[var(--cv-line)] bg-[var(--bg-main)]/45 p-4 text-sm leading-relaxed text-[var(--text-secondary)]">
              <span className="font-medium text-[var(--text-primary)]">{inventory.repo_name}</span>{' '}
              scanned {scanShape}
              {inventory.stack_tags.length > 0 ? ` across ${inventory.stack_tags.join(', ')}` : ''}
              {hasReport
                ? '. AI analysis is attached to this snapshot.'
                : '. No AI analysis is attached yet.'}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {startHere.map((file) => (
                <div
                  key={file}
                  className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] px-3 py-2 text-xs"
                >
                  <SourceLink path={file} repoPath={inventory.repo_path} />
                </div>
              ))}
              {startHere.length === 0 ? (
                <div className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] px-3 py-2 text-xs text-[var(--text-muted)]">
                  No docs, manifests, entrypoints, or config files were captured.
                </div>
              ) : null}
            </div>
          </MemorySection>

          <MemorySection
            title="Architecture leads"
            icon={Network}
            description="Boundaries and graph nodes worth opening before making changes."
          >
            <div className="space-y-2">
              {topUnits.map((unit) => (
                <div
                  key={`${unit.path}-${unit.manifest_path ?? unit.name}`}
                  className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-main)]/45 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {unit.name}
                      </div>
                      <div className="mt-1 text-xs text-[var(--text-muted)]">
                        {unit.kind.replaceAll('_', ' ')} · {unit.file_count.toLocaleString()} files
                        {unit.build_system ? ` · ${unit.build_system}` : ''}
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className="shrink-0 border border-[var(--cv-line)] bg-[var(--bg-raised)] text-[10px] text-[var(--text-muted)]"
                    >
                      {unit.path}
                    </Badge>
                  </div>
                  {unit.manifest_path ? (
                    <div className="mt-2 text-xs">
                      <SourceLink path={unit.manifest_path} repoPath={inventory.repo_path} />
                    </div>
                  ) : null}
                </div>
              ))}
              {topUnits.length === 0 && topGraphNodes.length > 0
                ? topGraphNodes.map((node) => (
                    <div
                      key={node.id}
                      className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-main)]/45 p-3"
                    >
                      <div className="text-sm font-medium text-[var(--text-primary)]">
                        {node.label}
                      </div>
                      <div className="mt-1 text-xs text-[var(--text-muted)]">
                        {node.kind}
                        {node.detail ? ` · ${node.detail}` : ''}
                      </div>
                      {node.path ? (
                        <div className="mt-2 text-xs">
                          <SourceLink path={node.path} repoPath={inventory.repo_path} />
                        </div>
                      ) : null}
                    </div>
                  ))
                : null}
            </div>
          </MemorySection>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <MemorySection
            title="Verification"
            icon={CheckCircle2}
            description="Where confidence comes from, and what to run after changing code."
          >
            <div className="space-y-2">
              {qaSignals.map((signal) => (
                <div
                  key={signal.id}
                  className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-main)]/45 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        'border text-[10px] uppercase tracking-wider',
                        qaStatusTone(signal.status)
                      )}
                    >
                      {signal.status}
                    </Badge>
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {signal.label}
                    </span>
                  </div>
                  <div className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                    {signal.detail}
                  </div>
                </div>
              ))}
              {qaFlows.map((flow) => (
                <div
                  key={flow.id}
                  className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-100"
                >
                  <span className="font-medium">{flow.route}</span> · {flow.goal}
                </div>
              ))}
              {topHealthFiles.map((file) => (
                <div
                  key={file.path}
                  className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100"
                >
                  <SourceLink path={file.path} repoPath={inventory.repo_path} /> ·{' '}
                  {file.score.toFixed(1)}/10 · {file.findings[0]?.label ?? file.bucket}
                </div>
              ))}
            </div>
          </MemorySection>

          <MemorySection
            title="Change memory"
            icon={History}
            description="Recent decisions, commits, and co-change clusters to respect."
          >
            <div className="space-y-3">
              {historyBrief?.summary ? (
                <p className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-main)]/45 p-3 text-sm leading-relaxed text-[var(--text-secondary)]">
                  {historyBrief.summary}
                </p>
              ) : null}
              {decisions.map((decision) => (
                <div
                  key={`${decision.marker}-${decision.source}`}
                  className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] p-3 text-xs"
                >
                  <div className="font-medium text-[var(--text-primary)]">{decision.marker}</div>
                  <div className="mt-1 text-[var(--text-secondary)]">{decision.text}</div>
                  <div className="mt-2">
                    <SourceLink path={decision.source} repoPath={inventory.repo_path} />
                  </div>
                </div>
              ))}
              {couplings.map((coupling) => (
                <div
                  key={`${coupling.files.join(':')}-${coupling.commit_count}`}
                  className="rounded-md border border-blue-500/20 bg-blue-500/10 p-3 text-xs text-blue-100"
                >
                  {coupling.files.join(' + ')} · {coupling.commit_count} commits · {coupling.reason}
                </div>
              ))}
              {decisions.length === 0 && recentCommits.length > 0
                ? recentCommits.map((commit) => (
                    <div
                      key={commit.sha}
                      className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] p-3 text-xs text-[var(--text-secondary)]"
                    >
                      <span className="font-mono text-[var(--text-primary)]">{commit.sha}</span>
                      {commit.date ? ` · ${commit.date}` : ''} · {commit.subject}
                    </div>
                  ))
                : null}
            </div>
          </MemorySection>
        </div>

        <MemorySection
          title="Operating notes"
          icon={ShieldAlert}
          description="Rules of use for this generated memory."
        >
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {[
              'Graph edges are navigation leads, not proof by themselves.',
              'Prefer linked source files over inferred summaries when editing.',
              'Rerun Unpack after branch changes or large refactors.',
              'This memory is deterministic and excludes AI claims unless analysis is attached.',
            ].map((note) => (
              <div
                key={note}
                className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-main)]/45 p-3 text-xs leading-relaxed text-[var(--text-secondary)]"
              >
                {note}
              </div>
            ))}
          </div>
        </MemorySection>
      </CardContent>
    </Card>
  );
});

function MemoryStat({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <div className="rounded-xl border border-[var(--cv-line)] bg-[var(--bg-raised)] p-4">
      <div className="cv-label">{label}</div>
      <div className="mt-2 truncate text-xl font-semibold text-[var(--text-primary)]">{value}</div>
      <div className="mt-1 truncate text-xs text-[var(--text-muted)]">{detail}</div>
    </div>
  );
}

function MemorySection({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string;
  icon: LucideIcon;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--cv-line)] bg-[var(--bg-surface)]/70 p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-lg border border-[var(--cv-line)] bg-[var(--bg-raised)] p-2 text-[var(--cv-accent)]">
          <Icon size={16} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
