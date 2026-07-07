import {
  BookOpenText,
  CheckCircle2,
  Download,
  FileText,
  History,
  type LucideIcon,
  Network,
} from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DisclosurePanel } from '@/components/unpack-workspace/DisclosurePanel';
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
  const topUnits = workspaceUnits.slice(0, 6);
  const topGraphNodes = graph?.nodes.slice(0, 8) ?? [];
  const qaSignals = readiness?.signals.slice(0, 4) ?? [];
  const qaFlows = readiness?.suggested_flows.slice(0, 3) ?? [];
  const topHealthFiles = health?.top_files.slice(0, 3) ?? [];
  const decisions = historyBrief?.decisions.slice(0, 6) ?? [];
  const recentCommits = historyBrief?.recent_commits.slice(0, 4) ?? [];
  const couplings = historyBrief?.temporal_couplings?.slice(0, 3) ?? [];
  const coverage = inventory.coverage;
  const scanShape =
    coverage?.total_files && coverage.total_files > inventory.files_scanned
      ? `${inventory.files_scanned.toLocaleString()} sampled of ${coverage.total_files.toLocaleString()} files`
      : `${inventory.files_scanned.toLocaleString()} files`;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[var(--cv-line)] bg-white/[0.018] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <BookOpenText size={16} className="text-cyan-200/85" />
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Handoff</h2>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.025] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                local
              </span>
            </div>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--text-secondary)]">
              <span className="font-medium text-[var(--text-primary)]">{inventory.repo_name}</span>{' '}
              scanned {scanShape}
              {inventory.stack_tags.length > 0 ? ` across ${inventory.stack_tags.join(', ')}` : ''}
              {hasReport ? '. AI analysis is attached.' : '. No AI analysis attached.'}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onExportMemory}
          >
            <Download size={14} className="mr-1.5" />
            Export
          </Button>
        </div>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="space-y-4">
          <MemorySection
            title="Start here"
            icon={FileText}
            description="Files most likely to explain how the repository is shaped."
          >
            <div className="grid gap-1.5 sm:grid-cols-2">
              {startHere.map((file) => (
                <div
                  key={file}
                  className="min-w-0 rounded-md border border-[var(--cv-line)] bg-[var(--bg-main)]/35 px-2.5 py-2 text-xs"
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
            title="Verification"
            icon={CheckCircle2}
            description="Confidence signals and likely commands."
          >
            <div className="space-y-1.5">
              {qaSignals.map((signal) => (
                <div
                  key={signal.id}
                  className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-main)]/35 px-3 py-2"
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
                  <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                    {signal.detail}
                  </div>
                </div>
              ))}
              {qaFlows.map((flow) => (
                <div
                  key={flow.id}
                  className="rounded-md border border-emerald-500/15 bg-emerald-500/[0.045] px-3 py-2 text-xs text-emerald-100/85"
                >
                  <span className="font-medium">{flow.route}</span> · {flow.goal}
                </div>
              ))}
              {topHealthFiles.map((file) => (
                <div
                  key={file.path}
                  className="rounded-md border border-amber-500/15 bg-amber-500/[0.045] px-3 py-2 text-xs text-amber-100/85"
                >
                  <SourceLink path={file.path} repoPath={inventory.repo_path} /> ·{' '}
                  {file.score.toFixed(1)}/10 · {file.findings[0]?.label ?? file.bucket}
                </div>
              ))}
            </div>
          </MemorySection>
        </div>

        <div className="space-y-4">
          <MemorySection
            title="Architecture leads"
            icon={Network}
            description="Boundaries and graph nodes worth opening before making changes."
          >
            <div className="space-y-2">
              {topUnits.map((unit) => (
                <div
                  key={`${unit.path}-${unit.manifest_path ?? unit.name}`}
                  className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-main)]/35 px-3 py-2.5"
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

          <DisclosurePanel
            title={
              <span className="inline-flex items-center gap-2">
                <History size={15} className="text-cyan-200/80" />
                Change memory
              </span>
            }
            summary="Recent decisions, commits, and files that tend to change together."
          >
            <div className="space-y-2">
              {decisions.map((decision) => (
                <div
                  key={`${decision.marker}-${decision.source}`}
                  className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-main)]/35 px-3 py-2 text-xs"
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
                  className="rounded-md border border-cyan-500/14 bg-cyan-500/[0.045] px-3 py-2 text-xs text-cyan-100/80"
                >
                  {coupling.files.join(' + ')} · {coupling.commit_count} commits · {coupling.reason}
                </div>
              ))}
              {decisions.length === 0 && recentCommits.length > 0
                ? recentCommits.map((commit) => (
                    <div
                      key={commit.sha}
                      className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-main)]/35 px-3 py-2 text-xs text-[var(--text-secondary)]"
                    >
                      <span className="font-mono text-[var(--text-primary)]">{commit.sha}</span>
                      {commit.date ? ` · ${commit.date}` : ''} · {commit.subject}
                    </div>
                  ))
                : null}
              {decisions.length === 0 && recentCommits.length === 0 && couplings.length === 0 ? (
                <div className="text-xs leading-5 text-[var(--text-muted)]">
                  No local history leads were captured for this snapshot.
                </div>
              ) : null}
            </div>
          </DisclosurePanel>
        </div>
      </div>
    </div>
  );
});

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
    <section className="rounded-xl border border-[var(--cv-line)] bg-white/[0.018] p-4">
      <div className="mb-3 flex items-start gap-2.5">
        <Icon size={16} className="mt-0.5 shrink-0 text-cyan-200/80" />
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
