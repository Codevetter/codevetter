import { AlertTriangle, CheckCircle2, Loader2, Play, Square, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { EvidenceScopeCandidate, EvidenceScopePlan } from '@/lib/evidence-scope';
import {
  createPerformanceRequestId,
  type PerformanceRunReceipt,
} from '@/lib/performance-workbench';
import { cancelLocalPerformance, isTauriAvailable, runLocalPerformance } from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';

interface EvidenceScopeTestRunProps {
  repoPath: string;
  plan: EvidenceScopePlan;
  candidates: EvidenceScopeCandidate[];
}

interface TestResult {
  candidate: EvidenceScopeCandidate;
  receipt?: PerformanceRunReceipt;
  error?: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function receiptVerdict(receipt: PerformanceRunReceipt): string {
  const result = record(receipt.result);
  return String(record(result.verdict).status ?? result.status ?? receipt.state);
}

function receiptSummary(receipt: PerformanceRunReceipt): string {
  const result = record(receipt.result);
  const failure = record(result.failure);
  return String(
    failure.message ??
      result.summary ??
      record(result.verdict).reason ??
      'Runtime evidence captured; inspect the receipt for details.'
  );
}

async function captureTestCandidate(
  repoPath: string,
  candidate: EvidenceScopeCandidate,
  requestId: string
): Promise<TestResult> {
  try {
    const receipt = await runLocalPerformance({
      request_id: requestId,
      operation: 'test',
      repo_path: repoPath,
      adapter: candidate.adapter,
      target: candidate.target,
      name: candidate.name ?? undefined,
      timeout_ms: 30_000,
    });
    return { candidate, receipt };
  } catch (cause) {
    return { candidate, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

export function EvidenceScopeTestRun({ repoPath, plan, candidates }: EvidenceScopeTestRunProps) {
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);
  const [activeRequest, setActiveRequest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRequestRef = useRef<string | null>(null);
  const cancelled = useRef(false);
  const disposed = useRef(false);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      cancelled.current = true;
      if (activeRequestRef.current && isTauriAvailable()) {
        void cancelLocalPerformance(activeRequestRef.current).catch(() => undefined);
      }
    };
  }, []);

  async function run() {
    if (!isTauriAvailable()) {
      setError('Executable testing requires the CodeVetter desktop app.');
      return;
    }
    cancelled.current = false;
    setRunning(true);
    setResults([]);
    setError(null);
    for (const candidate of candidates) {
      if (cancelled.current || disposed.current) break;
      const requestId = createPerformanceRequestId();
      activeRequestRef.current = requestId;
      setActiveRequest(requestId);
      const result = await captureTestCandidate(repoPath, candidate, requestId);
      if (!disposed.current) {
        setResults((current) => [...current, result]);
      }
    }
    activeRequestRef.current = null;
    if (!disposed.current) {
      setActiveRequest(null);
      setRunning(false);
    }
  }

  async function stop() {
    cancelled.current = true;
    const requestId = activeRequestRef.current;
    if (!requestId) return;
    try {
      await cancelLocalPerformance(requestId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 lg:p-5">
      <TestRunHeading
        plan={plan}
        candidateCount={candidates.length}
        running={running}
        onRun={() => void run()}
        onStop={() => void stop()}
      />
      <TestRunStatus
        running={running}
        resultCount={results.length}
        candidateCount={candidates.length}
        activeRequest={activeRequest}
        error={error}
      />
      <TestResults results={results} />
    </section>
  );
}

function TestRunHeading({
  plan,
  candidateCount,
  running,
  onRun,
  onStop,
}: {
  plan: EvidenceScopePlan;
  candidateCount: number;
  running: boolean;
  onRun: () => void;
  onStop: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">
          Confirmed execution plan
        </p>
        <h2 className="mt-1 text-sm font-semibold text-zinc-200">
          Run {candidateCount} selected {candidateCount === 1 ? 'scope' : 'scopes'}
        </h2>
        <p className="mt-1 font-mono text-[10px] text-zinc-400">
          {plan.plan_id.slice(0, 28)}… · sequential · 30s per scope
        </p>
      </div>
      <TestRunAction running={running} onRun={onRun} onStop={onStop} />
    </div>
  );
}

function TestRunAction({
  running,
  onRun,
  onStop,
}: {
  running: boolean;
  onRun: () => void;
  onStop: () => void;
}) {
  if (running) {
    return (
      <Button variant="destructive" className="h-[44px]" onClick={onStop}>
        <Square size={12} className="mr-1.5" />
        Stop
      </Button>
    );
  }
  return (
    <Button className="h-[44px]" onClick={onRun}>
      <Play size={13} className="mr-1.5" />
      Run tests
    </Button>
  );
}

function TestRunStatus({
  running,
  resultCount,
  candidateCount,
  activeRequest,
  error,
}: {
  running: boolean;
  resultCount: number;
  candidateCount: number;
  activeRequest: string | null;
  error: string | null;
}) {
  return (
    <>
      {running ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 size={13} className="animate-spin text-amber-300" />
          Capturing executable evidence for scope {resultCount + 1} of {candidateCount}
          {activeRequest ? ` · ${activeRequest.slice(0, 14)}…` : ''}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 flex items-center gap-2 text-xs text-red-300">
          <AlertTriangle size={13} />
          {error}
        </p>
      ) : null}
    </>
  );
}

function TestResults({ results }: { results: TestResult[] }) {
  if (results.length === 0) return null;
  return (
    <div className="mt-4 space-y-2 border-t border-white/[0.07] pt-4">
      {results.map((result) => (
        <TestResultRow key={result.candidate.id} result={result} />
      ))}
    </div>
  );
}

function TestResultRow({ result }: { result: TestResult }) {
  const verdict = result.receipt ? receiptVerdict(result.receipt) : 'error';
  const failed = Boolean(result.error || ['failed', 'completed_with_rejection'].includes(verdict));
  const confirmed = ['passed', 'succeeded', 'approved'].includes(verdict);
  return (
    <div className="grid gap-2 rounded-xl border border-white/[0.07] bg-black/10 p-3 sm:grid-cols-[auto_1fr_auto] sm:items-start">
      <ResultIcon failed={failed} confirmed={confirmed} />
      <div className="min-w-0">
        <p className="truncate font-mono text-xs text-zinc-200">{result.candidate.target}</p>
        <p className="mt-1 text-[11px] leading-4 text-zinc-400">
          {result.error ?? (result.receipt ? receiptSummary(result.receipt) : '')}
        </p>
      </div>
      <span
        className={cn(
          'rounded border px-2 py-1 font-mono text-[9px] uppercase tracking-wider',
          failed
            ? 'border-red-400/25 bg-red-400/[0.06] text-red-300'
            : confirmed
              ? 'border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-300'
              : 'border-amber-300/25 bg-amber-300/[0.06] text-amber-200'
        )}
      >
        {verdict.replaceAll('_', ' ')}
      </span>
    </div>
  );
}

function ResultIcon({ failed, confirmed }: { failed: boolean; confirmed: boolean }) {
  if (failed) return <XCircle size={15} className="mt-0.5 text-red-300" />;
  if (confirmed) return <CheckCircle2 size={15} className="mt-0.5 text-emerald-300" />;
  return <AlertTriangle size={15} className="mt-0.5 text-amber-300" />;
}
