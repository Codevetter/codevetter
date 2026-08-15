/*
THESIS: Performance work should read as an evidence lane, not a metrics dashboard.
OWN-WORLD: It extends CodeVetter's ink, amber, mono, and receipt-first desktop language.
STORY: Select one exact workload, admit it safely, capture it, then verify one change.
FIRST VIEWPORT: Scope and run controls stay beside the current plan and evidence state.
FORM: A dense workbench with a narrow scope rail, continuous ledger, and restrained status color.
*/
import {
  Activity,
  ArrowRight,
  Check,
  CircleDot,
  Clipboard,
  Gauge,
  Loader2,
  Play,
  ShieldCheck,
  Square,
  TerminalSquare,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { EvidenceScopePlanner } from '@/components/evidence-scope/EvidenceScopePlanner';
import { ProjectWorkspaceEmpty } from '@/components/project-workspace/ProjectWorkspaceEmpty';
import { ProjectWorkspaceShell } from '@/components/project-workspace/ProjectWorkspaceShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createPerformanceRequestId,
  type PerformanceAdapter,
  type PerformancePreviewState,
  type PerformanceRunReceipt,
  performancePreviewState,
} from '@/lib/performance-workbench';
import { useProjectWorkspace } from '@/lib/project-workspace';
import {
  cancelLocalPerformance,
  isTauriAvailable,
  listenPerformanceRunProgress,
  runLocalPerformance,
} from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';
import type { VerificationWindow } from '@/lib/verification-state-bridge';

const ADAPTERS: Array<{ value: PerformanceAdapter; label: string }> = [
  { value: 'vitest', label: 'Vitest' },
  { value: 'node-test', label: 'Node test' },
  { value: 'node-script', label: 'Node script' },
  { value: 'playwright', label: 'Playwright' },
  { value: 'go-bench', label: 'Go benchmark' },
];

type JsonRecord = Record<string, unknown>;
type PerformanceOperation = 'plan' | 'diagnose' | 'verify_paired';

function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(record).filter((item) => Object.keys(item).length > 0)
    : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function concise(value: JsonRecord): string {
  return Object.entries(value)
    .filter(([key]) => !['id', 'kind', 'summary', 'evidence_ids'].includes(key))
    .slice(0, 3)
    .map(
      ([key, item]) =>
        `${key.replaceAll('_', ' ')}: ${typeof item === 'object' ? JSON.stringify(item) : String(item)}`
    )
    .join(' · ');
}

function EvidenceList({ label, items }: { label: string; items: JsonRecord[] }) {
  if (items.length === 0) return null;
  return (
    <section className="border-t border-white/[0.07] py-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">{label}</p>
      <div className="mt-3 space-y-2">
        {items.map((item, index) => {
          const details = concise(item);
          return (
            <div
              key={`${String(item.id ?? item.kind ?? label)}-${index}`}
              className="flex gap-3 text-sm"
            >
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300/70" />
              <div className="min-w-0">
                <p className="font-medium text-zinc-200">
                  {String(item.summary ?? item.kind ?? 'Evidence')}
                </p>
                {details ? (
                  <p className="mt-0.5 break-words font-mono text-[11px] leading-5 text-zinc-400">
                    {details}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function statusOf(receipt: PerformanceRunReceipt | null): string {
  if (!receipt) return 'Not run';
  const result = record(receipt.result);
  return String(record(result.verdict).status ?? record(result.decision).status ?? receipt.state);
}

function readableMode(value: unknown): string {
  const mode = String(value ?? 'local');
  if (mode === 'local_zero_egress') return 'Local · zero egress';
  return mode.replaceAll('_', ' ').replace(/^local/, 'Local');
}

function performanceRunError({
  operation,
  canRun,
  repository,
  baselineRepoPath,
  tauriAvailable,
}: {
  operation: PerformanceOperation;
  canRun: boolean;
  repository: string | null;
  baselineRepoPath: string;
  tauriAvailable: boolean;
}): string | null {
  if (operation === 'verify_paired' && !baselineRepoPath.trim()) {
    return 'Choose an absolute baseline repository before paired verification.';
  }
  if (!canRun || !repository) return 'Enter a contained repository-relative target.';
  if (!tauriAvailable) return 'Run this action in the CodeVetter desktop app.';
  return null;
}

function phaseForOperation(operation: PerformanceOperation): PerformancePhase {
  if (operation === 'plan') return 'planning';
  if (operation === 'diagnose') return 'running';
  return 'verifying';
}

function performanceScopeFingerprint(
  adapter: PerformanceAdapter,
  target: string,
  workload: string,
  samples: number,
  warmups: number,
  timeoutMs: number
): string {
  return [adapter, target.trim(), workload.trim(), samples, warmups, timeoutMs].join('\u0000');
}

export default function Performance() {
  const { selectedRepoPath, selectedProject } = useProjectWorkspace();
  const requestedPreview = import.meta.env.DEV
    ? (new URLSearchParams(window.location.search).get('__codevetter_preview') ??
      (window as unknown as VerificationWindow).__CODEVETTER_VERIFY__?.stateName)
    : null;
  const previewState = requestedPreview?.startsWith('performance-')
    ? (requestedPreview as PerformancePreviewState)
    : null;
  const preview = previewState !== null;
  const previewReceipts = useMemo(
    () => performancePreviewState(previewState ?? 'performance-empty'),
    [previewState]
  );
  const repository = selectedRepoPath ?? (preview ? '/Users/demo/commerce-app' : null);
  const [adapter, setAdapter] = useState<PerformanceAdapter>('vitest');
  const [target, setTarget] = useState(preview ? 'src/cart/cart.test.ts' : '');
  const [workload, setWorkload] = useState(preview ? 'updates totals' : '');
  const [samples, setSamples] = useState(3);
  const [warmups, setWarmups] = useState(1);
  const [timeoutMs, setTimeoutMs] = useState(30_000);
  const [baselineRepoPath, setBaselineRepoPath] = useState('');
  const [plan, setPlan] = useState<PerformanceRunReceipt | null>(previewReceipts.plan);
  const [diagnosis, setDiagnosis] = useState<PerformanceRunReceipt | null>(
    previewReceipts.diagnosis
  );
  const [activeRequest, setActiveRequest] = useState<string | null>(
    previewReceipts.running ? 'perf-preview-running' : null
  );
  const [phase, setPhase] = useState<PerformancePhase>(
    previewReceipts.running ? 'running' : 'idle'
  );
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const repositoryIdentity = useRef(repository);
  const repositoryGeneration = useRef(0);
  const activeRequestRef = useRef<string | null>(activeRequest);

  useEffect(() => {
    if (repositoryIdentity.current === repository) return;
    repositoryIdentity.current = repository;
    repositoryGeneration.current += 1;
    const staleRequest = activeRequestRef.current;
    activeRequestRef.current = null;
    setActiveRequest(null);
    setPhase('idle');
    setPlan(null);
    setDiagnosis(null);
    setBaselineRepoPath('');
    setError(null);
    if (staleRequest && isTauriAvailable()) {
      void cancelLocalPerformance(staleRequest).catch(() => undefined);
    }
  }, [repository]);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let disposed = false;
    let unlisten: () => void = () => undefined;
    void listenPerformanceRunProgress((progress) => {
      if (!disposed && progress.request_id === activeRequest && progress.stage === 'cancelled') {
        setPhase('idle');
      }
    }).then((next) => {
      if (disposed) next();
      else unlisten = next;
    });
    return () => {
      disposed = true;
      unlisten();
    };
  }, [activeRequest]);

  if (!repository) {
    return (
      <ProjectWorkspaceShell projectSidebarClassName="hidden lg:block">
        <ProjectWorkspaceEmpty
          title="Choose a workload to measure"
          description="Add a local repository, then CodeVetter can plan a bounded, zero-egress performance run."
        />
      </ProjectWorkspaceShell>
    );
  }

  const repoPath = repository;
  const scope = {
    adapter,
    target: target.trim(),
    name: workload.trim() || undefined,
    samples,
    warmups,
    timeout_ms: timeoutMs,
  };
  const busy = phase !== 'idle';
  const canRun =
    target.trim().length > 0 && samples >= 2 && samples <= 10 && warmups >= 0 && warmups <= 5;
  const admitted = record(record(plan?.result).decision).status === 'admitted';

  async function execute(operation: PerformanceOperation) {
    const validationError = performanceRunError({
      operation,
      canRun,
      repository: repoPath,
      baselineRepoPath,
      tauriAvailable: isTauriAvailable(),
    });
    if (validationError) {
      setError(validationError);
      return;
    }
    const runGeneration = repositoryGeneration.current;
    const requestId = createPerformanceRequestId();
    activeRequestRef.current = requestId;
    setActiveRequest(requestId);
    setPhase(phaseForOperation(operation));
    setError(null);
    try {
      const receipt = await runLocalPerformance({
        request_id: requestId,
        operation,
        repo_path: repoPath,
        baseline_repo_path: operation === 'verify_paired' ? baselineRepoPath.trim() : undefined,
        ...scope,
      });
      if (
        runGeneration !== repositoryGeneration.current ||
        repositoryIdentity.current !== repoPath
      ) {
        return;
      }
      if (operation === 'plan') {
        setPlan(receipt);
        setDiagnosis(null);
      } else {
        setDiagnosis(receipt);
      }
    } catch (cause) {
      if (runGeneration === repositoryGeneration.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (runGeneration === repositoryGeneration.current) {
        activeRequestRef.current = null;
        setActiveRequest(null);
        setPhase('idle');
      }
    }
  }

  async function cancel() {
    if (!activeRequest) return;
    setPhase('cancelling');
    try {
      await cancelLocalPerformance(activeRequest);
      activeRequestRef.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase('idle');
    }
  }

  async function copyReceipt() {
    if (!diagnosis) return;
    await navigator.clipboard.writeText(JSON.stringify(diagnosis, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function changeScope(update: () => void) {
    update();
    setPlan(null);
    setDiagnosis(null);
    setError(null);
  }

  return (
    <ProjectWorkspaceShell
      mainClassName="bg-[#08090b]"
      projectSidebarClassName="hidden lg:block"
      showProjectSidebar={!preview}
    >
      <div className="min-h-full px-5 py-5 lg:px-7 lg:py-6">
        <PerformanceHeader
          preview={preview}
          repository={repository}
          projectName={selectedProject?.display_name}
        />
        <EvidenceScopePlanner
          key={`${repository}-${preview ? 'preview' : 'live'}`}
          repoPath={repository}
          consumer="performance"
          preview={preview}
          executionScopeFingerprint={performanceScopeFingerprint(
            adapter,
            target,
            workload,
            samples,
            warmups,
            timeoutMs
          )}
          onConfirm={(_resolvedPlan, candidates) => {
            const candidate = candidates[0];
            if (!candidate || !candidate.performance_supported || candidate.adapter === 'go-test') {
              setError('The resolved scope is not supported by the performance runtime.');
              return undefined;
            }
            changeScope(() => {
              setAdapter(candidate.adapter);
              setTarget(candidate.target);
              setWorkload(candidate.name ?? '');
            });
            return performanceScopeFingerprint(
              candidate.adapter,
              candidate.target,
              candidate.name ?? '',
              samples,
              warmups,
              timeoutMs
            );
          }}
        />
        <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
          <ScopePanel
            adapter={adapter}
            setAdapter={(value) => changeScope(() => setAdapter(value))}
            target={target}
            setTarget={(value) => changeScope(() => setTarget(value))}
            workload={workload}
            setWorkload={(value) => changeScope(() => setWorkload(value))}
            samples={samples}
            setSamples={(value) => changeScope(() => setSamples(value))}
            warmups={warmups}
            setWarmups={(value) => changeScope(() => setWarmups(value))}
            timeoutMs={timeoutMs}
            setTimeoutMs={(value) => changeScope(() => setTimeoutMs(value))}
            phase={phase}
            activeRequest={activeRequest}
            canRun={canRun}
            admitted={admitted}
            error={error}
            onPlan={() => void execute('plan')}
            onCapture={() => void execute('diagnose')}
            onCancel={() => void cancel()}
          />
          <EvidenceLedger
            plan={plan}
            diagnosis={diagnosis}
            samples={samples}
            phase={phase}
            activeRequest={activeRequest}
            canRun={canRun}
            admitted={admitted}
            copied={copied}
            onCopy={() => void copyReceipt()}
            baselineRepoPath={baselineRepoPath}
            setBaselineRepoPath={setBaselineRepoPath}
            onVerify={() => void execute('verify_paired')}
          />
        </div>
      </div>
    </ProjectWorkspaceShell>
  );
}

function PerformanceHeader({
  preview,
  repository,
  projectName,
}: {
  preview: boolean;
  repository: string;
  projectName?: string;
}) {
  return (
    <header className="mb-5 flex flex-col gap-4 border-b border-white/[0.075] pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="flex items-center gap-2 text-amber-200">
          <Gauge size={15} />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
            Performance workbench
          </span>
          {preview ? (
            <span className="rounded border border-sky-400/25 bg-sky-400/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-sky-300">
              Illustrative preview
            </span>
          ) : null}
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-zinc-100">
          Measure one flow. Change one thing. Prove it.
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-400">
          Local evidence for rendering, runtime speed, memory, allocations, and bundles—when the
          selected adapter can observe them.
        </p>
      </div>
      <div className="min-w-0 text-left lg:text-right">
        <p className="truncate text-sm font-medium text-zinc-300">
          {projectName ?? repository.split('/').pop()}
        </p>
        <p className="mt-1 max-w-md truncate font-mono text-[10px] text-zinc-400">{repository}</p>
      </div>
    </header>
  );
}

type PerformancePhase = 'idle' | 'planning' | 'running' | 'verifying' | 'cancelling';

interface ScopePanelProps {
  adapter: PerformanceAdapter;
  setAdapter: (value: PerformanceAdapter) => void;
  target: string;
  setTarget: (value: string) => void;
  workload: string;
  setWorkload: (value: string) => void;
  samples: number;
  setSamples: (value: number) => void;
  warmups: number;
  setWarmups: (value: number) => void;
  timeoutMs: number;
  setTimeoutMs: (value: number) => void;
  phase: PerformancePhase;
  activeRequest: string | null;
  canRun: boolean;
  admitted: boolean;
  error: string | null;
  onPlan: () => void;
  onCapture: () => void;
  onCancel: () => void;
}

function ScopePanel(props: ScopePanelProps) {
  const busy = props.phase !== 'idle';
  return (
    <aside
      aria-label="Performance workload controls"
      className="self-start rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 xl:sticky xl:top-5"
    >
      <div className="flex items-center gap-2">
        <CircleDot size={14} className="text-amber-300" />
        <h2 className="text-sm font-semibold text-zinc-200">Exact workload</h2>
      </div>
      <p className="mt-1 text-xs leading-5 text-zinc-400">
        Expert controls for the exact run. Editing them invalidates any resolved confirmation.
      </p>
      <div className="mt-5 space-y-4">
        <label className="block text-[11px] font-medium text-zinc-400">
          Adapter
          <select
            value={props.adapter}
            onChange={(event) => props.setAdapter(event.target.value as PerformanceAdapter)}
            disabled={busy}
            className="mt-1.5 h-9 w-full rounded-lg border border-white/[0.09] bg-[#0d0f12] px-3 text-sm text-zinc-200 outline-none focus:border-amber-300/50"
          >
            {ADAPTERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-medium text-zinc-400">
          Relative target
          <Input
            value={props.target}
            onChange={(event) => props.setTarget(event.target.value)}
            disabled={busy}
            placeholder="src/cart/cart.test.ts"
            className="mt-1.5 h-9 border-white/[0.09] bg-[#0d0f12] font-mono text-xs"
          />
        </label>
        <label className="block text-[11px] font-medium text-zinc-400">
          Exact test or benchmark <span className="text-zinc-400/70">optional</span>
          <Input
            value={props.workload}
            onChange={(event) => props.setWorkload(event.target.value)}
            disabled={busy}
            placeholder="updates totals"
            className="mt-1.5 h-9 border-white/[0.09] bg-[#0d0f12] text-xs"
          />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="Samples"
            value={props.samples}
            min={2}
            max={10}
            onChange={props.setSamples}
            disabled={busy}
          />
          <NumberField
            label="Warmups"
            value={props.warmups}
            min={0}
            max={5}
            onChange={props.setWarmups}
            disabled={busy}
          />
          <NumberField
            label="Timeout"
            value={Math.round(props.timeoutMs / 1000)}
            min={1}
            max={120}
            suffix="s"
            onChange={(value) => props.setTimeoutMs(value * 1000)}
            disabled={busy}
          />
        </div>
      </div>
      <ScopeActions {...props} busy={busy} />
      {props.error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-400/20 bg-red-400/[0.06] p-2.5 text-xs leading-5 text-red-300"
        >
          {props.error}
        </p>
      ) : null}
    </aside>
  );
}

function ScopeActions(props: ScopePanelProps & { busy: boolean }) {
  const running = props.busy && props.activeRequest;
  return (
    <div className="mt-5 grid grid-cols-2 gap-2">
      <Button
        variant="outline"
        className="border-white/[0.1] bg-white/[0.03]"
        disabled={!props.canRun || props.busy}
        onClick={props.onPlan}
      >
        {props.phase === 'planning' ? (
          <Loader2 size={14} className="mr-1.5 animate-spin" />
        ) : (
          <ShieldCheck size={14} className="mr-1.5" />
        )}
        Plan
      </Button>
      {running ? (
        <Button
          variant="destructive"
          onClick={props.onCancel}
          disabled={props.phase === 'cancelling'}
        >
          <Square size={12} className="mr-1.5" />
          Stop
        </Button>
      ) : (
        <Button disabled={!props.admitted || !props.canRun} onClick={props.onCapture}>
          <Play size={13} className="mr-1.5" />
          Capture
        </Button>
      )}
    </div>
  );
}

interface EvidenceLedgerProps {
  plan: PerformanceRunReceipt | null;
  diagnosis: PerformanceRunReceipt | null;
  samples: number;
  phase: PerformancePhase;
  activeRequest: string | null;
  canRun: boolean;
  admitted: boolean;
  copied: boolean;
  onCopy: () => void;
  baselineRepoPath: string;
  setBaselineRepoPath: (value: string) => void;
  onVerify: () => void;
}

function EvidenceLedger(props: EvidenceLedgerProps) {
  return (
    <section
      aria-label="Performance evidence"
      className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0e11]"
    >
      <EvidenceLane {...props} />
      <div className="px-5 py-5 lg:px-7">
        <EvidenceLedgerBody {...props} />
      </div>
    </section>
  );
}

function EvidenceLane(props: EvidenceLedgerProps) {
  const admitState = props.plan ? (props.admitted ? 'ready' : 'blocked') : 'waiting';
  const verdict = statusOf(props.diagnosis);
  const captureState = captureLaneState(props.phase, verdict, Boolean(props.diagnosis));
  const verifyState = verifyLaneState(props.phase, verdict);
  return (
    <div className="grid border-b border-white/[0.07] sm:grid-cols-4">
      <LaneStep index="01" label="Scope" state={props.canRun ? 'ready' : 'waiting'} />
      <LaneStep index="02" label="Admit" state={admitState} />
      <LaneStep index="03" label="Capture" state={captureState} />
      <LaneStep index="04" label="Verify" state={verifyState} />
    </div>
  );
}

function captureLaneState(
  phase: PerformancePhase,
  verdict: string,
  hasDiagnosis: boolean
): 'waiting' | 'ready' | 'active' | 'blocked' {
  if (phase === 'running') return 'active';
  if (verdict === 'failed' || verdict === 'no_confidence') return 'blocked';
  return hasDiagnosis ? 'ready' : 'waiting';
}

function verifyLaneState(
  phase: PerformancePhase,
  verdict: string
): 'waiting' | 'ready' | 'active' | 'blocked' | 'next' {
  if (phase === 'verifying') return 'active';
  if (verdict === 'confirmed') return 'ready';
  if (verdict === 'failed' || verdict === 'no_confidence') return 'blocked';
  return verdict === 'diagnosed' ? 'next' : 'waiting';
}

function EvidenceLedgerBody(props: EvidenceLedgerProps) {
  if (!props.plan) return <EmptyEvidence />;
  return (
    <>
      <PlanSummary plan={props.plan} samples={props.samples} admitted={props.admitted} />
      <RunEvidence {...props} />
      <Limitations plan={props.plan} diagnosis={props.diagnosis} />
    </>
  );
}

function EmptyEvidence() {
  return (
    <div className="flex min-h-[430px] flex-col items-center justify-center text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-zinc-400">
        <Activity size={20} />
      </div>
      <h2 className="mt-4 text-base font-semibold text-zinc-200">
        No performance claim without a plan
      </h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-zinc-400">
        Choose an exact target. CodeVetter will inspect the repository state and show the execution
        boundary before project code runs.
      </p>
    </div>
  );
}

function PlanSummary({
  plan,
  samples,
  admitted,
}: {
  plan: PerformanceRunReceipt;
  samples: number;
  admitted: boolean;
}) {
  const planResult = record(plan.result);
  const decision = record(planResult.decision);
  const limits = record(planResult.limits);
  return (
    <section className="grid gap-5 border-b border-white/[0.07] pb-5 md:grid-cols-[minmax(0,1fr)_220px]">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
          Execution plan
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span
            className={cn('h-2 w-2 rounded-full', admitted ? 'bg-emerald-400' : 'bg-red-400')}
          />
          <h2 className="text-lg font-semibold capitalize text-zinc-100">
            {String(decision.status ?? statusOf(plan))}
          </h2>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          {String(decision.reason ?? 'The performance plan returned no decision summary.')}
        </p>
        {strings(decision.blockers).map((blocker) => (
          <p key={blocker} className="mt-2 text-xs text-red-300">
            {blocker}
          </p>
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 font-mono text-[10px]">
        <Metric label="Mode" value={readableMode(planResult.mode)} />
        <Metric label="Cost" value={limits.max_cost_microusd === 0 ? '$0' : 'unknown'} />
        <Metric label="Processes" value={String(limits.max_processes ?? '—')} />
        <Metric label="Egress" value={limits.max_external_requests === 0 ? 'blocked' : 'unknown'} />
        <Metric label="Samples" value={String(samples)} />
        <Metric
          label="Working tree"
          value={record(planResult.subject).dirty === true ? 'Changed' : 'Clean'}
        />
      </dl>
    </section>
  );
}

function RunEvidence(props: EvidenceLedgerProps) {
  if (props.phase === 'running' || props.phase === 'verifying' || props.phase === 'cancelling') {
    return (
      <RunningEvidence requestId={props.activeRequest} verifying={props.phase === 'verifying'} />
    );
  }
  if (props.diagnosis) {
    return <DiagnosisEvidence {...props} diagnosis={props.diagnosis} />;
  }
  if (!props.admitted) return <BlockedPlan />;
  return <PlanReady />;
}

function BlockedPlan() {
  return (
    <div className="flex min-h-[300px] items-center justify-center py-10 text-center">
      <div>
        <Square size={18} className="mx-auto text-red-400" />
        <p className="mt-3 text-sm font-medium text-zinc-200">Plan blocked</p>
        <p className="mt-1 text-xs text-zinc-400">
          Resolve the admission blocker, then plan this exact workload again.
        </p>
      </div>
    </div>
  );
}

function RunningEvidence({
  requestId,
  verifying,
}: {
  requestId: string | null;
  verifying: boolean;
}) {
  return (
    <div className="flex min-h-[320px] items-center justify-center py-10 text-center">
      <div>
        <Loader2 size={22} className="mx-auto animate-spin text-amber-300" />
        <p className="mt-3 text-sm font-medium text-zinc-200">
          {verifying
            ? 'Running same-scope paired verification'
            : 'Capturing bounded runtime evidence'}
        </p>
        <p className="mt-1 font-mono text-[10px] text-zinc-400">{requestId}</p>
      </div>
    </div>
  );
}

function PlanReady() {
  return (
    <div className="flex min-h-[300px] items-center justify-center py-10 text-center">
      <div>
        <ShieldCheck size={20} className="mx-auto text-emerald-400" />
        <p className="mt-3 text-sm font-medium text-zinc-200">Plan ready</p>
        <p className="mt-1 text-xs text-zinc-400">
          Capture the admitted workload to produce observed evidence.
        </p>
      </div>
    </div>
  );
}

function DiagnosisEvidence(props: EvidenceLedgerProps & { diagnosis: PerformanceRunReceipt }) {
  const { diagnosis, copied, onCopy } = props;
  const result = record(diagnosis.result);
  const summary = record(result.diagnosis);
  const nextAction = record(result.next_action);
  const verdict = statusOf(diagnosis);
  return (
    <>
      <section className="py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
              Diagnosis · {statusOf(diagnosis)}
            </p>
            <h2 className="mt-2 max-w-3xl text-xl font-semibold tracking-[-0.02em] text-zinc-100">
              {String(summary.summary ?? 'Runtime evidence captured for the exact workload.')}
            </h2>
            <p className="mt-2 text-xs text-zinc-400">
              Observed and inferred evidence are kept separate. Confidence{' '}
              {String(summary.confidence ?? 'not reported')}.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-white/[0.1] bg-transparent"
            onClick={onCopy}
          >
            {copied ? (
              <Check size={13} className="mr-1.5" />
            ) : (
              <Clipboard size={13} className="mr-1.5" />
            )}
            {copied ? 'Copied' : 'Copy receipt'}
          </Button>
        </div>
      </section>
      <EvidenceList label="Observed" items={rows(result.observed)} />
      <EvidenceList label="Inferred" items={rows(result.inferred)} />
      <EvidenceList label="Unverified hypotheses" items={rows(result.unverified)} />
      <section className="border-t border-white/[0.07] py-5">
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.045] p-4">
          <ArrowRight size={15} className="mt-0.5 shrink-0 text-amber-300" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-200">
              One next action
            </p>
            <p className="mt-1 text-sm leading-6 text-zinc-300">
              {nextActionSummary(verdict, nextAction)}
            </p>
          </div>
        </div>
      </section>
      <CampaignHandoff {...props} verdict={verdict} />
    </>
  );
}

function nextActionSummary(verdict: string, nextAction: JsonRecord): string {
  if (nextAction.summary) return String(nextAction.summary);
  if (verdict === 'failed') {
    return 'Fix the workload failure, then capture this exact scope again.';
  }
  if (verdict === 'no_confidence') {
    return 'Narrow or strengthen the workload until CodeVetter captures comparable evidence.';
  }
  return 'Make one scoped change, then compare the same workload against this baseline.';
}

function CampaignHandoff(
  props: EvidenceLedgerProps & {
    verdict: string;
  }
) {
  const presentation = campaignPresentation(props.verdict);
  const canVerify =
    props.verdict === 'diagnosed' &&
    props.baselineRepoPath.trim().length > 0 &&
    props.phase === 'idle';
  return (
    <section className="border-t border-white/[0.07] py-5">
      <div className="flex items-center gap-2">
        <TerminalSquare size={14} className="text-zinc-400" />
        <p className="text-xs font-semibold text-zinc-300">Agent campaign handoff</p>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <CampaignCell label="Baseline" value={presentation.baseline} tone="ready" />
        <CampaignCell label="Candidate" value={presentation.candidate} />
        <CampaignCell label="Promotion" value={presentation.promotion} />
      </div>
      {props.verdict === 'diagnosed' ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            aria-label="Baseline repository path"
            value={props.baselineRepoPath}
            onChange={(event) => props.setBaselineRepoPath(event.target.value)}
            placeholder="Absolute path to unchanged baseline repository"
            className="h-9 border-white/[0.09] bg-[#0d0f12] font-mono text-xs"
          />
          <Button onClick={props.onVerify} disabled={!canVerify}>
            {props.phase === 'verifying' ? (
              <Loader2 size={13} className="mr-1.5 animate-spin" />
            ) : (
              <ShieldCheck size={13} className="mr-1.5" />
            )}
            Verify paired
          </Button>
        </div>
      ) : null}
      <p className="mt-3 text-[11px] leading-5 text-zinc-400">
        Compare the unchanged baseline and candidate with the same adapter, target, workload, and
        sample policy. This surface does not add chat, tasks, or an editor.
      </p>
    </section>
  );
}

function campaignPresentation(verdict: string): {
  baseline: string;
  candidate: string;
  promotion: string;
} {
  if (verdict === 'confirmed') {
    return {
      baseline: 'Paired baseline',
      candidate: 'Candidate accepted',
      promotion: 'Confirmed',
    };
  }
  if (verdict === 'failed' || verdict === 'no_confidence') {
    return {
      baseline: 'Receipt captured',
      candidate: 'Not comparable',
      promotion: 'Blocked',
    };
  }
  return {
    baseline: 'Receipt captured',
    candidate: 'Awaiting one change',
    promotion: 'Requires paired proof',
  };
}

function Limitations({
  plan,
  diagnosis,
}: {
  plan: PerformanceRunReceipt;
  diagnosis: PerformanceRunReceipt | null;
}) {
  const items = strings(record(diagnosis?.result).limitations ?? record(plan.result).limitations);
  if (items.length === 0) return null;
  return (
    <section className="border-t border-white/[0.07] pt-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">Limits</p>
      {items.map((item) => (
        <p key={item} className="mt-2 text-xs leading-5 text-zinc-400">
          {item}
        </p>
      ))}
    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <label className="text-[10px] text-zinc-400">
      {label}
      <span className="relative mt-1.5 block">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-9 w-full rounded-lg border border-white/[0.09] bg-[#0d0f12] px-2 font-mono text-xs text-zinc-200 outline-none focus:border-amber-300/50"
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-2 top-2.5 font-mono text-[10px] text-zinc-400">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function LaneStep({
  index,
  label,
  state,
}: {
  index: string;
  label: string;
  state: 'waiting' | 'ready' | 'active' | 'blocked' | 'next';
}) {
  return (
    <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <span
        className={cn(
          'font-mono text-[10px]',
          state === 'active'
            ? 'text-amber-300'
            : state === 'ready'
              ? 'text-emerald-400'
              : state === 'blocked'
                ? 'text-red-400'
                : 'text-zinc-500'
        )}
      >
        {index}
      </span>
      <span
        className={cn(
          'text-xs font-medium',
          state === 'waiting' ? 'text-zinc-500' : 'text-zinc-300'
        )}
      >
        {label}
      </span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="uppercase tracking-wider text-zinc-400">{label}</dt>
      <dd className="mt-1 truncate text-zinc-300">{value}</dd>
    </div>
  );
}

function CampaignCell({ label, value, tone }: { label: string; value: string; tone?: 'ready' }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/15 px-3 py-2.5">
      <p className="font-mono text-[9px] uppercase tracking-wider text-zinc-400">{label}</p>
      <p className={cn('mt-1 text-xs', tone === 'ready' ? 'text-emerald-300' : 'text-zinc-400')}>
        {value}
      </p>
    </div>
  );
}
