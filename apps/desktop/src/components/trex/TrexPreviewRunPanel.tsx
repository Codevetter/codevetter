import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  GitCompareArrows,
  Link2,
  Loader2,
  Play,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  isTauriAvailable,
  listTrexPreviewRuns,
  runTrexPreviewVerification,
  type TrexPreviewChangeKind,
  type TrexPreviewIdentityStatus,
  type TrexPreviewReceipt,
  type TrexPreviewVerdict,
} from '@/lib/tauri-ipc';

interface TrexPreviewRunPanelProps {
  repoPath: string;
}

function formatDuration(milliseconds: number): string {
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1_000).toFixed(2)} s`;
}

function verdictLabel(verdict: TrexPreviewVerdict): string {
  if (verdict === 'passed_with_limits') return 'Passed with limits';
  if (verdict === 'no_confidence') return 'No confidence';
  return 'Failed';
}

function verdictBadge(verdict: TrexPreviewVerdict) {
  const className =
    verdict === 'passed_with_limits'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
      : verdict === 'failed'
        ? 'border-red-500/40 bg-red-500/10 text-red-300'
        : 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  return (
    <Badge variant="outline" className={className}>
      {verdictLabel(verdict)}
    </Badge>
  );
}

function previewIdentityBadge(identity: TrexPreviewIdentityStatus) {
  const className =
    identity === 'verified'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
      : identity === 'mismatch'
        ? 'border-red-500/40 bg-red-500/10 text-red-300'
        : 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  return (
    <Badge variant="outline" className={className}>
      Preview {identity}
    </Badge>
  );
}

function validateInput(
  kind: TrexPreviewChangeKind,
  change: string,
  previewUrl: string
): string | null {
  const normalizedChange = change.trim();
  if (!normalizedChange) {
    return kind === 'pull_request'
      ? 'Enter a GitHub pull request URL.'
      : 'Enter a Git range such as main..HEAD.';
  }
  if (
    kind === 'pull_request' &&
    !/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/[1-9]\d*$/.test(normalizedChange)
  ) {
    return 'Use a canonical GitHub pull request URL.';
  }
  if (
    kind === 'range' &&
    (!/^[^\s.][^\s]*\.{2,3}[^\s.][^\s]*$/.test(normalizedChange) ||
      normalizedChange.startsWith('-'))
  ) {
    return 'Use one Git range such as main..HEAD or main...HEAD.';
  }
  try {
    const url = new URL(previewUrl.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return 'Use an HTTP(S) preview URL without embedded credentials.';
    }
  } catch {
    return 'Enter a valid preview URL.';
  }
  return null;
}

function ResultIcon({ verdict }: { verdict: TrexPreviewVerdict }) {
  if (verdict === 'passed_with_limits') {
    return <CheckCircle2 size={17} className="text-emerald-300" aria-hidden="true" />;
  }
  if (verdict === 'failed') {
    return <XCircle size={17} className="text-red-300" aria-hidden="true" />;
  }
  return <AlertTriangle size={17} className="text-amber-300" aria-hidden="true" />;
}

export function TrexPreviewRunPanel({ repoPath }: TrexPreviewRunPanelProps) {
  const [changeKind, setChangeKind] = useState<TrexPreviewChangeKind>('pull_request');
  const [change, setChange] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [latest, setLatest] = useState<TrexPreviewReceipt | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validation = useMemo(
    () => validateInput(changeKind, change, previewUrl),
    [changeKind, change, previewUrl]
  );

  useEffect(() => {
    let disposed = false;
    setLoadingHistory(true);
    setLatest(null);
    setError(null);
    if (!isTauriAvailable()) {
      setLoadingHistory(false);
      return;
    }
    void listTrexPreviewRuns(repoPath, 1)
      .then((runs) => {
        if (!disposed) setLatest(runs[0] ?? null);
      })
      .catch((cause) => {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!disposed) setLoadingHistory(false);
      });
    return () => {
      disposed = true;
    };
  }, [repoPath]);

  const handleRun = async () => {
    const inputError = validateInput(changeKind, change, previewUrl);
    if (inputError) {
      setError(inputError);
      return;
    }
    if (!isTauriAvailable()) {
      setError('The CodeVetter desktop app is required to run T-Rex.');
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const receipt = await runTrexPreviewVerification({
        repo_path: repoPath,
        change_kind: changeKind,
        change: change.trim(),
        preview_url: previewUrl.trim(),
      });
      setLatest(receipt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card
      data-testid="trex-preview-run-panel"
      className="mb-6 border-amber-300/20 bg-[var(--bg-surface)]"
    >
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <GitCompareArrows size={16} className="text-[var(--cv-accent)]" />
                Test change in preview
              </CardTitle>
              <Badge variant="default">Direct run</Badge>
            </div>
            <CardDescription className="mt-1 max-w-2xl text-xs leading-5">
              Give T-Rex a pull request or commit range and its deployed preview. It resolves the
              exact change, selects bounded routes, and returns executable browser evidence.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <ShieldCheck size={14} className="text-emerald-300" />
            Read-only preview
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[170px_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          <label className="space-y-1.5">
            <span className="cv-label">Change source</span>
            <select
              aria-label="Change source"
              value={changeKind}
              onChange={(event) => {
                setChangeKind(event.target.value as TrexPreviewChangeKind);
                setChange('');
                setError(null);
              }}
              className="h-10 w-full rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 text-sm text-zinc-100 outline-none transition-colors hover:border-white/[0.15] focus-visible:border-amber-300/35 focus-visible:ring-2 focus-visible:ring-amber-300/15"
            >
              <option value="pull_request">Pull request</option>
              <option value="range">Commit range</option>
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="cv-label">
              {changeKind === 'pull_request' ? 'Pull request URL' : 'Commit range'}
            </span>
            <Input
              aria-label={changeKind === 'pull_request' ? 'Pull request URL' : 'Commit range'}
              value={change}
              onChange={(event) => {
                setChange(event.target.value);
                setError(null);
              }}
              placeholder={
                changeKind === 'pull_request'
                  ? 'https://github.com/org/repo/pull/123'
                  : 'main..HEAD'
              }
              spellCheck={false}
            />
          </label>

          <label className="space-y-1.5">
            <span className="cv-label">Preview URL</span>
            <Input
              aria-label="Preview URL"
              value={previewUrl}
              onChange={(event) => {
                setPreviewUrl(event.target.value);
                setError(null);
              }}
              placeholder="https://preview.example.com"
              inputMode="url"
              spellCheck={false}
            />
          </label>

          <Button
            className="w-full lg:w-auto"
            disabled={running || Boolean(validation)}
            onClick={() => void handleRun()}
          >
            {running ? (
              <Loader2 size={14} className="mr-2 animate-spin" />
            ) : (
              <Play size={14} className="mr-2" />
            )}
            {running ? 'Testing preview…' : 'Test change'}
          </Button>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-red-400/25 bg-red-400/[0.07] px-3 py-2.5 text-xs leading-5 text-red-200"
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {running && (
          <div
            role="status"
            className="flex items-center gap-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-3 py-3"
          >
            <Loader2 size={16} className="animate-spin text-amber-300" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-amber-100">Testing the exact change</p>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                Resolving source identity, checking preview linkage, and running selected routes.
              </p>
            </div>
          </div>
        )}

        {!running && latest ? (
          <section
            aria-label="Latest T-Rex direct run"
            className="rounded-lg border border-[var(--cv-line)] bg-[var(--bg-elevated)] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <ResultIcon verdict={latest.verdict} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {verdictBadge(latest.verdict)}
                    {previewIdentityBadge(latest.preview.status)}
                  </div>
                  <p className="mt-2 text-sm leading-5 text-zinc-200">{latest.summary}</p>
                </div>
              </div>
              <span className="text-xs text-[var(--text-secondary)]">
                {formatDuration(latest.duration_ms)}
              </span>
            </div>

            <dl className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--cv-line)] bg-black/10 px-3 py-2.5">
                <dt className="cv-label">Change head</dt>
                <dd className="mt-1 truncate font-mono text-xs text-zinc-200">
                  {latest.source.head_sha.slice(0, 12)}
                </dd>
              </div>
              <div className="rounded-lg border border-[var(--cv-line)] bg-black/10 px-3 py-2.5">
                <dt className="cv-label">Changed paths</dt>
                <dd className="mt-1 text-xs text-zinc-200">{latest.source.changed_paths.length}</dd>
              </div>
              <div className="rounded-lg border border-[var(--cv-line)] bg-black/10 px-3 py-2.5">
                <dt className="cv-label">Preview routes</dt>
                <dd className="mt-1 text-xs text-zinc-200">{latest.routes.length}</dd>
              </div>
            </dl>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
              <div>
                <h4 className="text-xs font-semibold text-zinc-200">Journey evidence</h4>
                <div className="mt-2 space-y-2">
                  {latest.journeys.length > 0 ? (
                    latest.journeys.map((journey) => (
                      <div
                        key={`${latest.run_id}-${journey.route}`}
                        className="flex items-start gap-2 rounded-lg border border-[var(--cv-line)] bg-black/10 px-3 py-2.5"
                      >
                        {journey.pass ? (
                          <CheckCircle2
                            size={14}
                            className="mt-0.5 shrink-0 text-emerald-300"
                            aria-label="Passed"
                          />
                        ) : (
                          <XCircle
                            size={14}
                            className="mt-0.5 shrink-0 text-red-300"
                            aria-label="Failed"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-xs text-zinc-200">
                              {journey.route}
                            </span>
                            <span className="shrink-0 text-xs text-[var(--text-secondary)]">
                              {formatDuration(journey.duration_ms)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                            {journey.notes}
                          </p>
                          {journey.screenshot_path && (
                            <p className="mt-1 truncate font-mono text-xs text-red-200">
                              Artifact: {journey.screenshot_path}
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--cv-line)] px-3 py-3 text-xs text-[var(--text-secondary)]">
                      <CircleDashed size={14} aria-hidden="true" />
                      No browser journey completed.
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-zinc-200">Coverage and identity</h4>
                <div className="mt-2 rounded-lg border border-[var(--cv-line)] bg-black/10 px-3 py-3">
                  <p className="flex items-start gap-2 text-xs leading-5 text-zinc-300">
                    <Link2
                      size={14}
                      className="mt-0.5 shrink-0 text-amber-300"
                      aria-hidden="true"
                    />
                    <span>{latest.preview.evidence}</span>
                  </p>
                  <a
                    href={latest.preview.final_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 flex min-h-6 items-center gap-1.5 truncate text-xs text-amber-200 hover:text-amber-100"
                  >
                    <span className="truncate">{latest.preview.final_url}</span>
                    <ExternalLink size={12} className="shrink-0" aria-hidden="true" />
                  </a>
                  {latest.limitations.length > 0 && (
                    <ul className="mt-3 space-y-1.5 border-t border-[var(--cv-line)] pt-3 text-xs leading-5 text-[var(--text-secondary)]">
                      {latest.limitations.map((limitation) => (
                        <li key={limitation} className="flex gap-2">
                          <span aria-hidden="true">•</span>
                          <span>{limitation}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </section>
        ) : !running && !loadingHistory ? (
          <div className="rounded-lg border border-dashed border-[var(--cv-line)] px-4 py-5 text-center">
            <p className="text-sm font-medium text-zinc-300">No direct run for this repository</p>
            <p className="mx-auto mt-1 max-w-2xl text-xs leading-5 text-[var(--text-secondary)]">
              Start with a PR or commit range and the preview that contains it. T-Rex will preserve
              exact source identity and state what the preview did—and did not—prove.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
