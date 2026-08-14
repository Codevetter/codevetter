/*
THESIS: Optimization is an evidence pipeline, not a magic button; refuse the generic dashboard of disconnected metrics.
OWN-WORLD: Inherit the Evidence Bench—ink planes, written states, one warm action voice, and receipt identities in mono.
STORY: Select a repository, run a bounded lab, see every attempted step, then hand a source-bounded candidate to an agent.
FIRST VIEWPORT: Repository identity and start action lead; the five-stage process and latest receipt sit directly beneath.
FORM: Existing preserve-lane workbench extension; no new world, concept seed, or staging assignment is required.
*/
import animeProof from '../../../../benchmarks/performance-lab/autonomous-browser-loop-anime-proof-2026-08-14.json';
import {
  AlertTriangle,
  ArrowDownRight,
  Check,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FileCode2,
  FlaskConical,
  FolderPlus,
  Gauge,
  GitCompareArrows,
  Loader2,
  Play,
  RotateCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ProjectWorkspaceEmpty } from '@/components/project-workspace/ProjectWorkspaceEmpty';
import { ProjectWorkspaceShell } from '@/components/project-workspace/ProjectWorkspaceShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useProjectWorkspace } from '@/lib/project-workspace';
import {
  humanizeLabToken,
  labOutcomeCopy,
  performanceChangeCost,
  performanceSummaryMetrics,
} from '@/lib/optimization-presentation';
import {
  isTauriAvailable,
  listPerformanceLabReceipts,
  type PerformanceLabRecord,
  runPerformanceLab,
} from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';

const PROCESS_STAGES = [
  { label: 'Map', detail: 'Find measurable repository-owned flows', icon: Gauge },
  { label: 'Measure', detail: 'Capture bounded runtime and browser evidence', icon: FlaskConical },
  { label: 'Diagnose', detail: 'Rank source-bounded candidates', icon: FileCode2 },
  { label: 'Verify', detail: 'Screen correctness before promotion', icon: ShieldCheck },
  { label: 'Decide', detail: 'Keep, reject, stop, or hand off', icon: GitCompareArrows },
] as const;

function createLabId(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `opt-${Date.now().toString(36)}-${suffix}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function CaseStudyPreview({ compact = false }: { compact?: boolean }) {
  const retained = animeProof.retained_experiment;
  const rejected = animeProof.rejected_experiments[0];
  const production = animeProof.production_build_check;
  return (
    <section
      className={cn(
        'overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0d0f]',
        compact ? 'p-4' : 'p-5'
      )}
      aria-labelledby="anime-proof-title"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
              Completed case study
            </Badge>
            <Badge variant="outline" className="border-white/10 text-zinc-400">
              Local development flow
            </Badge>
          </div>
          <h2 id="anime-proof-title" className="mt-3 text-lg font-semibold text-zinc-100">
            Anime List: one candidate rejected, one retained
          </h2>
          <p className="mt-2 max-w-[70ch] text-sm leading-6 text-zinc-400">
            CodeVetter measured one exact mobile home-page flow, rejected a Radix import change
            below policy, then promoted a two-file Lucide boundary after repeated paired evidence.
          </p>
        </div>
        <div className="shrink-0 text-left lg:text-right">
          <div className="font-mono text-3xl font-semibold tracking-[-0.04em] text-emerald-300">
            {Math.abs(
              retained.promotion.browser_completed_response_transfer_bytes.delta_percent
            ).toFixed(1)}
            % fewer
          </div>
          <div className="mt-1 text-xs text-zinc-400">local navigation response bytes</div>
        </div>
      </div>

      <div className="mt-5 grid gap-px overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.07] md:grid-cols-3">
        <div className="bg-[#101216] p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
            <X size={14} className="text-rose-300" /> Rejected first
          </div>
          <p className="mt-2 font-mono text-lg text-zinc-100">
            {Math.abs(rejected.delta_percent ?? 0).toFixed(1)}% fewer
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">Below the policy's 10% minimum</p>
        </div>
        <div className="bg-[#101216] p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
            <Check size={14} className="text-emerald-300" /> Repeated before keep
          </div>
          <p className="mt-2 font-mono text-lg text-zinc-100">
            {retained.promotion.samples_per_side} × 2
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            samples plus warmups and correctness
          </p>
        </div>
        <div className="bg-[#101216] p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
            <AlertTriangle size={14} className="text-amber-300" /> Production check
          </div>
          <p className="mt-2 font-mono text-lg text-zinc-100">
            {Math.abs(production.delta.gzip_percent).toFixed(1)}% smaller
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">not a material shipped-bundle win</p>
        </div>
      </div>
    </section>
  );
}

function BrowserPreview() {
  return (
    <div className="h-full overflow-y-auto px-6 py-6 lg:px-8">
      <header className="mx-auto max-w-6xl">
        <span className="cv-page-kicker">Optimization Studio</span>
        <h1 className="cv-page-title mt-2 text-zinc-100">Profile a flow. Prove the change.</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          Repository execution is available in the desktop app. This browser preview shows the same
          process and one receipt-backed completed case study.
        </p>
      </header>
      <div className="mx-auto mt-6 max-w-6xl">
        <ProcessRail running={false} />
        <div className="mt-5">
          <CaseStudyPreview />
        </div>
      </div>
    </div>
  );
}

function ProcessRail({
  running,
  elapsedSeconds = 0,
}: {
  running: boolean;
  elapsedSeconds?: number;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.075] bg-[#0c0d0f] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-100">What CodeVetter does</p>
          <p className="mt-1 text-xs text-zinc-400">
            Up to eight steps; each operation has a 30-second timeout
          </p>
        </div>
        {running ? (
          <Badge className="border-amber-300/20 bg-amber-300/10 text-amber-200">
            <Loader2 size={12} className="mr-1.5 animate-spin" /> Running locally · {elapsedSeconds}
            s
          </Badge>
        ) : null}
      </div>
      <ol className="mt-5 grid gap-3 lg:grid-cols-5">
        {PROCESS_STAGES.map(({ label, detail, icon: Icon }, index) => (
          <li key={label} className="relative min-w-0">
            <div className="flex items-start gap-3 lg:block">
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                  'border-white/[0.08] bg-white/[0.035] text-zinc-400'
                )}
              >
                <Icon size={15} />
              </span>
              <div className="min-w-0 lg:mt-3">
                <p className="text-xs font-semibold text-zinc-200">{label}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">{detail}</p>
              </div>
            </div>
            {index < PROCESS_STAGES.length - 1 ? (
              <ArrowDownRight
                size={13}
                className="absolute -right-2 top-2 hidden text-zinc-700 lg:block"
                aria-hidden="true"
              />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ReceiptView({ record }: { record: PerformanceLabRecord }) {
  const { receipt } = record;
  const outcome = labOutcomeCopy(receipt);
  const metrics = performanceSummaryMetrics(receipt.final_summary);
  const changeCost = performanceChangeCost(receipt);
  return (
    <div className="space-y-4">
      <Card className="border-white/[0.08] bg-[#0c0d0f]">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p
                className={cn(
                  'text-xs font-medium',
                  outcome.tone === 'good'
                    ? 'text-emerald-300'
                    : outcome.tone === 'failed'
                      ? 'text-rose-300'
                      : 'text-amber-200'
                )}
              >
                {outcome.eyebrow}
              </p>
              <CardTitle className="mt-1 text-base text-zinc-100">{outcome.title}</CardTitle>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                {receipt.stop?.reason ??
                  'The receipt ended before a terminal decision was written. No performance claim is available.'}
              </p>
            </div>
            <Badge variant="outline" className="w-fit border-white/10 font-mono text-zinc-400">
              {receipt.state}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {metrics.length > 0 ? (
            <dl className="grid gap-px overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.07] sm:grid-cols-3">
              {metrics.slice(0, 6).map((metric) => (
                <div key={metric.key} className="bg-[#101216] p-3.5">
                  <dt className="text-xs text-zinc-400">{metric.label}</dt>
                  <dd className="mt-1 font-mono text-lg text-zinc-100">{metric.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {changeCost ? (
            <div className="mt-4 rounded-xl border border-white/[0.07] bg-[#101216] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-zinc-300">Verified patch cost</p>
                <Badge
                  variant="outline"
                  className={cn(
                    'border-white/10 text-xs',
                    changeCost.violations.length === 0 ? 'text-emerald-300' : 'text-amber-200'
                  )}
                >
                  {changeCost.violations.length === 0
                    ? 'Within budget'
                    : `${changeCost.violations.length} budget violation${changeCost.violations.length === 1 ? '' : 's'}`}
                </Badge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-zinc-500">Files</dt>
                  <dd className="mt-1 font-mono text-zinc-200">{changeCost.files}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Line movement</dt>
                  <dd className="mt-1 font-mono text-zinc-200">
                    +{changeCost.added} / -{changeCost.removed}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Gross lines</dt>
                  <dd className="mt-1 font-mono text-zinc-200">{changeCost.gross}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Production deps</dt>
                  <dd className="mt-1 font-mono text-zinc-200">+{changeCost.dependenciesAdded}</dd>
                </div>
              </dl>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-zinc-400">
            <span>{record.lab_id}</span>
            <span>{record.receipt_path}</span>
            <span>{receipt.policy.samples} samples / comparison</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/[0.08] bg-[#0c0d0f]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-100">Executed process</CardTitle>
        </CardHeader>
        <CardContent>
          {receipt.steps.length === 0 ? (
            <p className="rounded-xl bg-white/[0.025] p-4 text-sm text-zinc-400">
              The lab stopped before an executable measurement step. The terminal reason above is
              the evidence.
            </p>
          ) : (
            <ol className="divide-y divide-white/[0.06]">
              {receipt.steps.map((step) => (
                <li key={`${step.index}-${step.action}`} className="flex gap-3 py-3 first:pt-1">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.04] font-mono text-[10px] text-zinc-400">
                    {step.index}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-zinc-200">
                        {humanizeLabToken(step.action)}
                      </p>
                      <Badge variant="outline" className="border-white/10 text-xs text-zinc-400">
                        {humanizeLabToken(step.result)}
                      </Badge>
                    </div>
                    {(step.run_id || step.capture_id) && (
                      <p className="mt-1 truncate font-mono text-xs text-zinc-400">
                        {step.run_id ?? step.capture_id}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {receipt.limitations.length > 0 ? (
        <section className="rounded-2xl border border-amber-300/10 bg-amber-300/[0.035] p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-amber-100">
            <AlertTriangle size={14} /> Evidence limits
          </div>
          <ul className="mt-3 space-y-2 text-xs leading-5 text-zinc-400">
            {receipt.limitations.map((limitation) => (
              <li key={limitation} className="flex gap-2">
                <span className="text-amber-300/70" aria-hidden="true">
                  ·
                </span>
                <span>{limitation}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export default function Optimize() {
  const desktopAvailable = isTauriAvailable();
  const { selectedRepoPath, selectedProject, addProject, addingProject } = useProjectWorkspace();
  const [history, setHistory] = useState<PerformanceLabRecord[]>([]);
  const [selectedLabId, setSelectedLabId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [maxSteps, setMaxSteps] = useState(8);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultRegionRef = useRef<HTMLElement>(null);

  const selectedRecord = useMemo(
    () => history.find((record) => record.lab_id === selectedLabId) ?? history[0] ?? null,
    [history, selectedLabId]
  );

  const refreshHistory = useCallback(async () => {
    if (!desktopAvailable || !selectedRepoPath) return;
    setLoadingHistory(true);
    try {
      const records = await listPerformanceLabReceipts(selectedRepoPath);
      setHistory(records);
      setSelectedLabId((current) =>
        current && records.some((record) => record.lab_id === current)
          ? current
          : (records[0]?.lab_id ?? null)
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingHistory(false);
    }
  }, [desktopAvailable, selectedRepoPath]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (!running) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = globalThis.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 1_000);
    return () => globalThis.clearInterval(timer);
  }, [running]);

  const startLab = async () => {
    if (!selectedRepoPath || !desktopAvailable || running) return;
    setRunning(true);
    setError(null);
    try {
      const record = await runPerformanceLab({
        repoPath: selectedRepoPath,
        labId: createLabId(),
        maxSteps,
      });
      setHistory((current) => [record, ...current.filter((item) => item.lab_id !== record.lab_id)]);
      setSelectedLabId(record.lab_id);
      globalThis.setTimeout(() => resultRegionRef.current?.focus(), 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };

  if (!desktopAvailable) return <BrowserPreview />;
  if (!selectedRepoPath) {
    return (
      <ProjectWorkspaceShell>
        <ProjectWorkspaceEmpty
          title="Choose a repository to optimize"
          description="CodeVetter runs bounded local measurements and keeps the evidence inside the selected repository."
        />
      </ProjectWorkspaceShell>
    );
  }

  return (
    <ProjectWorkspaceShell>
      <div className="mx-auto w-full max-w-6xl px-6 py-6 lg:px-8">
        <header className="cv-spotlight-surface rounded-2xl px-5 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <span className="cv-page-kicker">Optimization Studio</span>
              <h1 className="cv-page-title mt-2 truncate text-zinc-100">
                {selectedProject?.display_name ?? selectedRepoPath.split('/').pop()}
              </h1>
              <p className="mt-1.5 max-w-3xl truncate font-mono text-xs text-zinc-500">
                {selectedRepoPath}
              </p>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                Find a measurable local flow, collect runtime evidence, and return a bounded work
                order that a connected coding agent can attempt and CodeVetter can verify.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <label className="flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.025] px-3 text-xs text-zinc-300">
                <span>Search bound</span>
                <select
                  value={maxSteps}
                  onChange={(event) => setMaxSteps(Number(event.target.value))}
                  disabled={running}
                  className="bg-transparent font-mono text-amber-100 outline-none disabled:opacity-60"
                  aria-label="Maximum laboratory steps"
                >
                  <option value={4}>4 steps</option>
                  <option value={8}>8 steps</option>
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                className="border-white/10 bg-white/[0.035]"
                onClick={() => void addProject()}
                disabled={addingProject || running}
              >
                <FolderPlus size={14} className="mr-1.5" /> Switch repository
              </Button>
              <Button type="button" onClick={() => void startLab()} disabled={running}>
                {running ? (
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                ) : (
                  <Play size={14} className="mr-1.5" />
                )}
                {running ? 'Running lab…' : 'Start local lab'}
              </Button>
            </div>
          </div>
        </header>

        <div aria-live="polite" aria-atomic="true">
          {error ? (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-4 text-sm text-rose-100">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">The laboratory did not produce evidence</p>
                <p className="mt-1 text-xs leading-5 text-rose-200/70">{error}</p>
              </div>
            </div>
          ) : running ? (
            <p className="sr-only">Performance laboratory running for {elapsedSeconds} seconds.</p>
          ) : null}
        </div>

        <div className="mt-5">
          <ProcessRail running={running} elapsedSeconds={elapsedSeconds} />
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
          <main ref={resultRegionRef} tabIndex={-1} className="min-w-0 outline-none">
            {selectedRecord ? (
              <ReceiptView record={selectedRecord} />
            ) : (
              <section className="rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.02] p-6">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-400">
                  <Sparkles size={16} />
                </div>
                <h2 className="mt-4 text-sm font-semibold text-zinc-100">No lab receipt yet</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">
                  Start the local lab. CodeVetter will either return executable evidence, a
                  source-bounded agent handoff, or a written reason it stopped safely.
                </p>
              </section>
            )}
          </main>

          <aside className="min-w-0">
            <div className="rounded-2xl border border-white/[0.075] bg-[#0c0d0f] p-3">
              <div className="flex items-center justify-between px-1 pb-2">
                <p className="text-xs font-medium text-zinc-300">Receipt history</p>
                <button
                  type="button"
                  onClick={() => void refreshHistory()}
                  disabled={loadingHistory || running}
                  className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200 disabled:opacity-50"
                  aria-label="Refresh receipt history"
                >
                  <RotateCw size={13} className={cn(loadingHistory && 'animate-spin')} />
                </button>
              </div>
              {history.length === 0 ? (
                <p className="rounded-lg bg-white/[0.025] px-3 py-4 text-xs leading-5 text-zinc-400">
                  Receipts appear here after a lab finishes or stops.
                </p>
              ) : (
                <div className="space-y-1">
                  {history.map((record) => {
                    const active = record.lab_id === selectedRecord?.lab_id;
                    return (
                      <button
                        key={record.lab_id}
                        type="button"
                        onClick={() => setSelectedLabId(record.lab_id)}
                        className={cn(
                          'w-full rounded-lg px-3 py-2.5 text-left transition-colors',
                          active
                            ? 'bg-amber-300/[0.09] text-amber-50'
                            : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {record.receipt.state === 'completed' ? (
                            <CheckCircle2 size={13} className="text-emerald-300" />
                          ) : record.receipt.state === 'failed' ? (
                            <AlertTriangle size={13} className="text-rose-300" />
                          ) : (
                            <CircleDashed size={13} className="text-amber-200" />
                          )}
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                            {record.lab_id}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5 pl-5 text-xs text-zinc-400">
                          <Clock3 size={10} /> {formatTimestamp(record.recorded_at)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>

        <div className="mt-5">
          <CaseStudyPreview compact />
        </div>
      </div>
    </ProjectWorkspaceShell>
  );
}
