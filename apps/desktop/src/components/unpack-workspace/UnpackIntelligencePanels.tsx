import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  FlaskConical,
  GitCommit,
  Wrench,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { UnpackQaReadiness, UnpackRepoHealth, UnpackRepoHistoryBrief } from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';
import { SourceLink } from './SourceLink';

export function qaStatusTone(status: string | null | undefined): string {
  const s = (status ?? '').toLowerCase();
  if (s === 'ready') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (s === 'partial') return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200';
  return 'border-red-500/30 bg-red-500/10 text-red-200';
}

export function QaReadinessPanel({
  readiness,
  repoPath,
}: {
  readiness?: UnpackQaReadiness | null;
  repoPath: string;
}) {
  if (!readiness) return null;
  const topSignals = readiness.signals.slice(0, 6);
  const suggestedFlows = readiness.suggested_flows.slice(0, 5);
  return (
    <div className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)]/45 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            <FlaskConical size={14} className="text-[var(--cv-accent)]" />
            Synthetic QA readiness
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--text-secondary)]">
            {readiness.summary}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 border text-[10px] uppercase tracking-wider',
            qaStatusTone(readiness.status)
          )}
        >
          {readiness.score}/100 · {readiness.status}
        </Badge>
      </div>

      {topSignals.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {topSignals.map((signal) => (
            <div
              key={signal.id}
              className="rounded border border-[var(--cv-line)] bg-[var(--bg-main)]/50 p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
                  {signal.status === 'ready' ? (
                    <CheckCircle2 size={12} className="text-emerald-300" />
                  ) : signal.status === 'partial' ? (
                    <AlertTriangle size={12} className="text-yellow-300" />
                  ) : (
                    <AlertTriangle size={12} className="text-red-300" />
                  )}
                  {signal.label}
                </div>
                <span className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
                  {signal.status}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                {signal.detail}
              </p>
              {signal.sources.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {signal.sources.slice(0, 3).map((source) => (
                    <SourceLink key={source} path={source} repoPath={repoPath} />
                  ))}
                  {signal.sources.length > 3 && (
                    <span className="text-[10px] text-[var(--text-muted)]">
                      +{signal.sources.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {suggestedFlows.length > 0 && (
        <div className="mt-3">
          <div className="cv-label mb-1.5">Suggested local QA flows</div>
          <div className="grid gap-1.5">
            {suggestedFlows.map((flow) => (
              <div
                key={flow.id}
                className="flex flex-col gap-1 rounded border border-[var(--cv-line)] bg-[var(--bg-main)]/50 px-2 py-1.5 text-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="font-mono text-[var(--cv-accent)]">{flow.route}</span>
                <span className="text-[var(--text-secondary)]">{flow.goal}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function healthBucketTone(bucket: string | null | undefined): string {
  const s = (bucket ?? '').toLowerCase();
  if (s === 'hotspot') return 'border-red-500/30 bg-red-500/10 text-red-200';
  if (s === 'watch') return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200';
  return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
}

function findingTone(severity: string | null | undefined): string {
  const s = (severity ?? '').toLowerCase();
  if (s === 'high') return 'text-red-200';
  if (s === 'medium') return 'text-yellow-200';
  return 'text-[var(--text-secondary)]';
}

export function RepoHealthPanel({
  health,
  repoPath,
}: {
  health?: UnpackRepoHealth | null;
  repoPath: string;
}) {
  if (!health || health.files_analyzed === 0 || health.top_files.length === 0) return null;
  const topFiles = health.top_files.slice(0, 6);
  return (
    <div className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)]/45 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            <Activity size={14} className="text-[var(--cv-accent)]" />
            Deterministic repo health
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--text-secondary)]">
            {health.summary}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 border text-[10px] uppercase tracking-wider',
            health.hotspot_count > 0
              ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
          )}
        >
          v{health.schema_version} · {health.average_score.toFixed(1)}/10 · {health.hotspot_count}{' '}
          hotspots{health.truncated ? ' · truncated' : ''}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {topFiles.map((file) => (
          <div
            key={file.path}
            className="rounded border border-[var(--cv-line)] bg-[var(--bg-main)]/50 p-2 text-xs"
          >
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="truncate font-medium text-[var(--text-primary)]">
                  <SourceLink path={file.path} repoPath={repoPath} />
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase text-[var(--text-muted)]">
                  {file.lines.toLocaleString()} lines · churn {file.churn.toLocaleString()} ·{' '}
                  {file.has_test_signal ? 'test signal' : 'no test signal'}
                </div>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  'shrink-0 border text-[10px] uppercase tracking-wider',
                  healthBucketTone(file.bucket)
                )}
              >
                {file.score.toFixed(1)} · {file.bucket}
              </Badge>
            </div>

            {file.findings.length > 0 && (
              <div className="mt-2 space-y-1">
                {file.findings.slice(0, 3).map((finding) => (
                  <div key={finding.id} className="leading-relaxed">
                    <span className={cn('font-medium', findingTone(finding.severity))}>
                      {finding.label}
                    </span>
                    <span className="text-[var(--text-muted)]">
                      {' '}
                      {finding.dimension}/{finding.severity}
                    </span>
                    <span className="text-[var(--text-secondary)]"> · {finding.detail}</span>
                  </div>
                ))}
              </div>
            )}

            {file.refactoring_targets.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {file.refactoring_targets.slice(0, 2).map((target) => (
                  <div
                    key={target}
                    className="flex items-start gap-1.5 text-[11px] text-[var(--text-secondary)]"
                  >
                    <Wrench size={11} className="mt-0.5 shrink-0 text-[var(--cv-accent)]" />
                    {target}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CodebaseHistoryBriefPanel({
  historyBrief,
  repoPath,
}: {
  historyBrief?: UnpackRepoHistoryBrief | null;
  repoPath: string;
}) {
  if (
    !historyBrief ||
    (historyBrief.recent_commits.length === 0 &&
      historyBrief.decisions.length === 0 &&
      historyBrief.test_hints.length === 0 &&
      (historyBrief.temporal_couplings?.length ?? 0) === 0)
  ) {
    return null;
  }
  const temporalCouplings = historyBrief.temporal_couplings ?? [];

  return (
    <div className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)]/45 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            <GitCommit size={14} className="text-[var(--cv-accent)]" />
            Codebase history brief
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--text-secondary)]">
            {historyBrief.summary}
          </p>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 border border-violet-500/30 bg-violet-500/10 text-[10px] uppercase tracking-wider text-violet-200"
        >
          v{historyBrief.schema_version} · {historyBrief.recent_commits.length} commits ·{' '}
          {historyBrief.decisions.length} decisions · {temporalCouplings.length} clusters
          {historyBrief.truncated ? ' · truncated' : ''}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-4">
        {historyBrief.recent_commits.length > 0 && (
          <div>
            <div className="cv-label mb-1.5">Recent commits</div>
            <div className="space-y-1.5">
              {historyBrief.recent_commits.slice(0, 5).map((commit) => (
                <div
                  key={`${commit.sha}-${commit.subject}`}
                  className="rounded border border-[var(--cv-line)] bg-[var(--bg-main)]/50 p-2 text-xs"
                >
                  <div className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
                    {commit.sha}
                    {commit.date ? ` · ${commit.date}` : ''}
                  </div>
                  <div className="mt-1 text-[var(--text-secondary)]">{commit.subject}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {historyBrief.decisions.length > 0 && (
          <div>
            <div className="cv-label mb-1.5">Decision markers</div>
            <div className="space-y-1.5">
              {historyBrief.decisions.slice(0, 5).map((decision) => (
                <div
                  key={`${decision.source}-${decision.text}`}
                  className="rounded border border-[var(--cv-line)] bg-[var(--bg-main)]/50 p-2 text-xs"
                >
                  <div className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
                    {decision.marker}
                  </div>
                  <div className="mt-1 text-[var(--text-secondary)]">{decision.text}</div>
                  <div className="mt-1">
                    <SourceLink path={decision.source} repoPath={repoPath} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {historyBrief.test_hints.length > 0 && (
          <div>
            <div className="cv-label mb-1.5">Verification hints</div>
            <div className="space-y-1.5">
              {historyBrief.test_hints.slice(0, 5).map((hint) => (
                <div
                  key={`${hint.path}-${hint.reason}`}
                  className="rounded border border-[var(--cv-line)] bg-[var(--bg-main)]/50 p-2 text-xs"
                >
                  <div className="text-[var(--text-secondary)]">{hint.reason}</div>
                  <div className="mt-1">
                    <SourceLink path={hint.path} repoPath={repoPath} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {temporalCouplings.length > 0 && (
          <div>
            <div className="cv-label mb-1.5">Co-change clusters</div>
            <div className="space-y-1.5">
              {temporalCouplings.slice(0, 5).map((cluster) => (
                <div
                  key={`${cluster.files.join('|')}-${cluster.commit_count}`}
                  className="rounded border border-[var(--cv-line)] bg-[var(--bg-main)]/50 p-2 text-xs"
                >
                  <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-[var(--text-muted)]">
                    <GitBranch size={10} className="text-[var(--cv-accent)]" />
                    {cluster.commit_count} commits
                    {cluster.last_commit ? ` · ${cluster.last_commit}` : ''}
                  </div>
                  <div className="mt-1 space-y-1">
                    {cluster.files.slice(0, 2).map((file) => (
                      <SourceLink key={file} path={file} repoPath={repoPath} />
                    ))}
                  </div>
                  <div className="mt-1 text-[var(--text-secondary)]">{cluster.reason}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
