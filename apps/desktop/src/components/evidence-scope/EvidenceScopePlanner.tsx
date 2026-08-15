import { AlertTriangle, Check, GitPullRequest, Loader2, Search, Workflow } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  type EvidenceScopeCandidate,
  type EvidenceScopeConsumer,
  type EvidenceScopeKind,
  type EvidenceScopePlan,
  evidenceScopeNeedsValue,
  evidenceScopePlaceholder,
  evidenceScopePreviewPlan,
} from '@/lib/evidence-scope';
import { isTauriAvailable, resolveEvidenceScope } from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';

const MODES: Array<{
  kind: EvidenceScopeKind;
  label: string;
  description: string;
  icon: typeof Workflow;
}> = [
  {
    kind: 'flow',
    label: 'Function or flow',
    description: 'Describe behavior in your own words',
    icon: Workflow,
  },
  {
    kind: 'change',
    label: 'PR or change',
    description: 'Use a pull request or Git range',
    icon: GitPullRequest,
  },
  {
    kind: 'codebase',
    label: 'Entire codebase',
    description: 'Discover a bounded runnable portfolio',
    icon: Search,
  },
];

interface EvidenceScopePlannerProps {
  repoPath: string;
  consumer: EvidenceScopeConsumer;
  preview?: boolean;
  executionScopeFingerprint?: string;
  onConfirm: (plan: EvidenceScopePlan, candidates: EvidenceScopeCandidate[]) => string | undefined;
}

function defaultSelection(plan: EvidenceScopePlan): string[] {
  if (plan.consumer === 'testing' && plan.kind === 'codebase') {
    return plan.candidates.map((candidate) => candidate.id);
  }
  return plan.candidates[0] ? [plan.candidates[0].id] : [];
}

function scopeInputError(kind: EvidenceScopeKind, value: string): string | null {
  if (!evidenceScopeNeedsValue(kind) || value.trim()) return null;
  return kind === 'flow' ? 'Describe one function or flow.' : 'Enter a PR URL or Git range.';
}

async function discoverScope({
  repoPath,
  consumer,
  kind,
  value,
  preview,
}: {
  repoPath: string;
  consumer: EvidenceScopeConsumer;
  kind: EvidenceScopeKind;
  value: string;
  preview: boolean;
}): Promise<EvidenceScopePlan> {
  if (preview) return evidenceScopePreviewPlan(consumer);
  if (!isTauriAvailable()) {
    throw new Error('Scope discovery requires the CodeVetter desktop app.');
  }
  return resolveEvidenceScope({
    repo_path: repoPath,
    kind,
    value: evidenceScopeNeedsValue(kind) ? value.trim() : undefined,
    consumer,
  });
}

export function EvidenceScopePlanner({
  repoPath,
  consumer,
  preview = false,
  executionScopeFingerprint,
  onConfirm,
}: EvidenceScopePlannerProps) {
  const [kind, setKind] = useState<EvidenceScopeKind>('flow');
  const [value, setValue] = useState(preview ? 'checkout coupon calculation' : '');
  const [plan, setPlan] = useState<EvidenceScopePlan | null>(
    preview ? evidenceScopePreviewPlan(consumer) : null
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(plan ? defaultSelection(plan) : []);
  const [confirmedPlanId, setConfirmedPlanId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const confirmedFingerprint = useRef<string | null>(null);

  useEffect(() => {
    generation.current += 1;
    if (preview) {
      const next = evidenceScopePreviewPlan(consumer);
      setKind(next.kind);
      setValue(next.original_input ?? '');
      setPlan(next);
      setSelectedIds(defaultSelection(next));
    } else {
      setPlan(null);
      setSelectedIds([]);
    }
    setConfirmedPlanId(null);
    confirmedFingerprint.current = null;
    setError(null);
    setResolving(false);
  }, [consumer, preview, repoPath]);

  useEffect(() => {
    if (
      confirmedPlanId &&
      executionScopeFingerprint &&
      confirmedFingerprint.current !== executionScopeFingerprint
    ) {
      setConfirmedPlanId(null);
      confirmedFingerprint.current = null;
    }
  }, [confirmedPlanId, executionScopeFingerprint]);

  function invalidate(next?: { kind?: EvidenceScopeKind; value?: string }) {
    generation.current += 1;
    if (next?.kind) setKind(next.kind);
    if (next?.value !== undefined) setValue(next.value);
    setPlan(null);
    setSelectedIds([]);
    setConfirmedPlanId(null);
    confirmedFingerprint.current = null;
    setError(null);
  }

  async function resolve() {
    const inputError = scopeInputError(kind, value);
    if (inputError) {
      setError(inputError);
      return;
    }
    const runGeneration = ++generation.current;
    setResolving(true);
    setError(null);
    try {
      const next = await discoverScope({
        repoPath,
        consumer,
        kind,
        value,
        preview,
      });
      if (runGeneration !== generation.current) return;
      setPlan(next);
      setSelectedIds(defaultSelection(next));
      setConfirmedPlanId(null);
    } catch (cause) {
      if (runGeneration === generation.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (runGeneration === generation.current) setResolving(false);
    }
  }

  const portfolio = consumer === 'testing' && plan?.kind === 'codebase';
  const chosen = plan?.candidates.filter((candidate) => selectedIds.includes(candidate.id)) ?? [];

  function select(candidate: EvidenceScopeCandidate) {
    setConfirmedPlanId(null);
    confirmedFingerprint.current = null;
    if (!portfolio) {
      setSelectedIds([candidate.id]);
      return;
    }
    setSelectedIds((current) =>
      current.includes(candidate.id)
        ? current.filter((id) => id !== candidate.id)
        : [...current, candidate.id]
    );
  }

  function confirm() {
    if (!plan || chosen.length === 0) return;
    confirmedFingerprint.current = onConfirm(plan, chosen) ?? null;
    setConfirmedPlanId(plan.plan_id);
  }

  return (
    <section
      aria-label={`${consumer === 'testing' ? 'Testing' : 'Performance'} scope planner`}
      className="mb-5 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]"
    >
      <PlannerInput
        kind={kind}
        value={value}
        resolving={resolving}
        error={error}
        onKindChange={(next) => invalidate({ kind: next, value: '' })}
        onValueChange={(next) => invalidate({ value: next })}
        onResolve={() => void resolve()}
      />
      <ResolvedPlan
        plan={plan}
        preview={preview}
        selectedIds={selectedIds}
        portfolio={Boolean(portfolio)}
        confirmedPlanId={confirmedPlanId}
        chosenCount={chosen.length}
        onSelect={select}
        onConfirm={confirm}
      />
    </section>
  );
}

interface PlannerInputProps {
  kind: EvidenceScopeKind;
  value: string;
  resolving: boolean;
  error: string | null;
  onKindChange: (kind: EvidenceScopeKind) => void;
  onValueChange: (value: string) => void;
  onResolve: () => void;
}

function PlannerInput(props: PlannerInputProps) {
  return (
    <div className="border-b border-white/[0.07] px-4 py-4 lg:px-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">
        Start with intent
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {MODES.map((mode) => (
          <ModeButton
            key={mode.kind}
            mode={mode}
            active={props.kind === mode.kind}
            onClick={() => props.onKindChange(mode.kind)}
          />
        ))}
      </div>
      <ScopeInput {...props} />
      {props.error ? (
        <p role="alert" className="mt-2 flex items-center gap-2 text-xs text-red-300">
          <AlertTriangle size={13} />
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

function ModeButton({
  mode,
  active,
  onClick,
}: {
  mode: (typeof MODES)[number];
  active: boolean;
  onClick: () => void;
}) {
  const Icon = mode.icon;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-xl border p-3 text-left transition-colors',
        active
          ? 'border-amber-300/35 bg-amber-300/[0.08] text-amber-50'
          : 'border-white/[0.08] bg-black/10 text-zinc-400 hover:border-white/[0.14] hover:text-zinc-200'
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <Icon size={14} className={active ? 'text-amber-300' : undefined} />
        {mode.label}
      </span>
      <span className="mt-1 block text-[11px] leading-4 text-zinc-400">{mode.description}</span>
    </button>
  );
}

function ScopeInput(props: PlannerInputProps) {
  return (
    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      {evidenceScopeNeedsValue(props.kind) ? (
        <Input
          aria-label={
            props.kind === 'flow' ? 'Function or flow description' : 'Pull request or change'
          }
          value={props.value}
          onChange={(event) => props.onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') props.onResolve();
          }}
          placeholder={evidenceScopePlaceholder(props.kind)}
          className="h-[44px] shrink-0 border-white/[0.09] bg-[#0d0f12] text-sm sm:flex-1"
        />
      ) : (
        <p className="flex min-h-[44px] flex-1 items-center rounded-lg border border-white/[0.07] bg-black/10 px-3 text-xs text-zinc-400">
          {evidenceScopePlaceholder(props.kind)}
        </p>
      )}
      <Button onClick={props.onResolve} disabled={props.resolving} className="h-[44px] shrink-0">
        {props.resolving ? (
          <Loader2 size={14} className="mr-1.5 animate-spin" />
        ) : (
          <Search size={14} className="mr-1.5" />
        )}
        Resolve scope
      </Button>
    </div>
  );
}

interface ResolvedPlanProps {
  plan: EvidenceScopePlan | null;
  preview: boolean;
  selectedIds: string[];
  portfolio: boolean;
  confirmedPlanId: string | null;
  chosenCount: number;
  onSelect: (candidate: EvidenceScopeCandidate) => void;
  onConfirm: () => void;
}

function ResolvedPlan(props: ResolvedPlanProps) {
  if (!props.plan) return null;
  const plan = props.plan;
  return (
    <div className="px-4 py-4 lg:px-5">
      <PlanHeading plan={plan} preview={props.preview} />
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {plan.candidates.map((candidate) => (
          <CandidateButton
            key={candidate.id}
            candidate={candidate}
            selected={props.selectedIds.includes(candidate.id)}
            portfolio={props.portfolio}
            onClick={() => props.onSelect(candidate)}
          />
        ))}
      </div>
      <PlanFooter {...props} plan={plan} />
    </div>
  );
}

function PlanHeading({ plan, preview }: { plan: EvidenceScopePlan; preview: boolean }) {
  const scopeLabel = `${plan.candidates.length} runnable ${plan.candidates.length === 1 ? 'scope' : 'scopes'}`;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-200">
          {plan.status === 'ready' ? scopeLabel : 'No runnable scope found'}
        </h2>
        <p className="mt-1 font-mono text-[10px] text-zinc-400">
          {plan.repository_revision.slice(0, 12)} · {plan.dirty ? 'working tree changed' : 'clean'}{' '}
          · {plan.plan_id.slice(0, 24)}…
        </p>
      </div>
      {preview ? (
        <span className="rounded border border-sky-400/25 bg-sky-400/10 px-2 py-1 text-[9px] uppercase tracking-wider text-sky-300">
          Illustrative
        </span>
      ) : null}
    </div>
  );
}

function CandidateButton({
  candidate,
  selected,
  portfolio,
  onClick,
}: {
  candidate: EvidenceScopeCandidate;
  selected: boolean;
  portfolio: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'rounded-xl border p-3 text-left transition-colors',
        selected
          ? 'border-amber-300/30 bg-amber-300/[0.06]'
          : 'border-white/[0.07] bg-black/10 hover:border-white/[0.13]'
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate font-mono text-xs text-zinc-200">{candidate.target}</span>
          <span className="mt-1 block text-[11px] text-zinc-400">
            {candidate.adapter}
            {candidate.name ? ` · ${candidate.name}` : ''}
          </span>
        </span>
        <span
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center border',
            portfolio ? 'rounded' : 'rounded-full',
            selected ? 'border-amber-300 bg-amber-300 text-black' : 'border-zinc-600'
          )}
        >
          {selected ? <Check size={11} strokeWidth={3} /> : null}
        </span>
      </span>
      <span className="mt-2 block text-[11px] leading-4 text-zinc-400">
        {candidate.reason} · {(candidate.confidence_milli / 10).toFixed(0)}% match
      </span>
    </button>
  );
}

function PlanFooter(props: ResolvedPlanProps & { plan: EvidenceScopePlan }) {
  const confirmed = props.confirmedPlanId === props.plan.plan_id;
  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
      <div className="space-y-1 text-[11px] leading-4 text-zinc-400">
        {props.plan.limitations.map((limitation) => (
          <p key={limitation}>Limit: {limitation}</p>
        ))}
        <UncoveredPaths paths={props.plan.uncovered_paths} />
      </div>
      <Button
        variant={confirmed ? 'outline' : 'default'}
        className="h-[44px]"
        disabled={props.chosenCount === 0 || confirmed}
        onClick={props.onConfirm}
      >
        {confirmed ? <Check size={14} className="mr-1.5" /> : null}
        {confirmed
          ? 'Plan confirmed'
          : `Confirm ${props.chosenCount} ${props.chosenCount === 1 ? 'scope' : 'scopes'}`}
      </Button>
    </div>
  );
}

function UncoveredPaths({ paths }: { paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <div>
      <p>Uncovered ({paths.length}):</p>
      <ul className="mt-1 space-y-0.5 rounded-lg border border-white/[0.06] bg-black/10 px-2 py-1.5 font-mono text-[10px]">
        {paths.map((path) => (
          <li key={path} className="break-all">
            {path}
          </li>
        ))}
      </ul>
    </div>
  );
}
