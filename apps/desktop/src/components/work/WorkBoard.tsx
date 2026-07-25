import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ClipboardCheck,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  createWorkItem,
  archiveManagedWorkRun,
  createIntentClosure,
  createManagedWorkRun,
  deleteWorkItem,
  getManagedWorkHandoff,
  isTauriAvailable,
  listIntentClosures,
  listManagedProviderProfiles,
  listManagedWorkRuns,
  listWorkItems,
  reconcileManagedWorkRun,
  runManagedWorkHook,
  transitionWorkItem,
  updateWorkItem,
  type IntentClosureReceipt,
  type ManagedProviderProfile,
  type ManagedWorkRun,
  type RepoProject,
} from '@/lib/tauri-ipc';
import {
  intentClosureEvidenceLabel,
  managedRunCanRecover,
  managedRunStatusLabel,
} from '@/lib/managed-work';
import {
  groupWorkItems,
  WORK_ITEM_STATUSES,
  workItemEvidence,
  type WorkItem,
  type WorkItemProvider,
  type WorkItemStatus,
  type WorkSessionLink,
} from '@/lib/work-items';
import { cn } from '@/lib/utils';

const COLUMN_COPY: Record<WorkItemStatus, { label: string; hint: string }> = {
  plan: { label: 'Plan', hint: 'Define the outcome' },
  build: { label: 'Build', hint: 'Agent work in motion' },
  review: { label: 'Review', hint: 'Inspect the change' },
  verify: { label: 'Verify', hint: 'Prove it works' },
  done: { label: 'Done', hint: 'Verified or waived' },
};

interface WorkBoardProps {
  repoProjects: RepoProject[];
  sessionLinks: WorkSessionLink[];
  onBuild: (item: WorkItem) => void;
  onManagedBuild: (item: WorkItem, run: ManagedWorkRun) => Promise<void>;
  onAttachSession: (item: WorkItem, session: WorkSessionLink) => Promise<WorkItem>;
}

interface WorkItemDraft {
  title: string;
  description: string;
  acceptanceCriteria: string;
  projectPath: string;
  provider: WorkItemProvider;
  sessionKey: string;
}

const EMPTY_DRAFT: WorkItemDraft = {
  title: '',
  description: '',
  acceptanceCriteria: '',
  projectPath: '',
  provider: 'codex',
  sessionKey: '',
};

export function WorkBoard({
  repoProjects,
  sessionLinks,
  onBuild,
  onManagedBuild,
  onAttachSession,
}: WorkBoardProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WorkItem | null>(null);
  const [draft, setDraft] = useState<WorkItemDraft>(EMPTY_DRAFT);
  const [completionItem, setCompletionItem] = useState<WorkItem | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<WorkItemStatus>('plan');
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [managedRuns, setManagedRuns] = useState<ManagedWorkRun[]>([]);
  const [managedItem, setManagedItem] = useState<WorkItem | null>(null);
  const grouped = useMemo(() => groupWorkItems(items), [items]);

  const refresh = useCallback(async () => {
    if (!isTauriAvailable()) {
      setLoading(false);
      setError('Work items are stored locally by the CodeVetter Mac app.');
      return;
    }
    try {
      const [nextItems, nextRuns] = await Promise.all([
        listWorkItems({ limit: 250 }),
        listManagedWorkRuns(),
      ]);
      setItems(nextItems);
      // Older desktop mocks and partially upgraded clients can return no value
      // for the additive managed-work projection. Keep the existing Board
      // usable until that optional evidence is available.
      setManagedRuns(Array.isArray(nextRuns) ? nextRuns : []);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!focusItemId) return;
    const card = document.getElementById(`work-card-${focusItemId}`);
    card?.focus();
    setFocusItemId(null);
  }, [focusItemId, items]);

  function openCreate(status: WorkItemStatus = 'plan') {
    setEditingItem(null);
    setDraft({ ...EMPTY_DRAFT, projectPath: repoProjects[0]?.repo_path ?? '' });
    setCreateStatus(status);
    setEditorOpen(true);
  }

  function openEdit(item: WorkItem) {
    setEditingItem(item);
    setDraft({
      title: item.title,
      description: item.description ?? '',
      acceptanceCriteria: item.acceptance_criteria ?? '',
      projectPath: item.project_path ?? '',
      provider: item.preferred_provider,
      sessionKey: linkedSessionKey(item, sessionLinks),
    });
    setEditorOpen(true);
  }

  async function saveDraft() {
    const title = draft.title.trim();
    if (!title) return;
    setBusyId(editingItem?.id ?? 'create');
    try {
      if (editingItem) {
        let updated = await updateWorkItem(editingItem.id, {
          title,
          description: draft.description.trim(),
          acceptance_criteria: draft.acceptanceCriteria.trim(),
          project_path: draft.projectPath || undefined,
          preferred_provider: draft.provider,
        });
        const selectedSession = sessionLinks.find((session) => session.key === draft.sessionKey);
        if (selectedSession && !workItemHasSession(editingItem, selectedSession)) {
          updated = await onAttachSession(updated, selectedSession);
        }
        setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        let created = await createWorkItem({
          title,
          description: draft.description.trim() || null,
          acceptance_criteria: draft.acceptanceCriteria.trim() || null,
          project_path: draft.projectPath || null,
          preferred_provider: draft.provider,
        });
        if (createStatus !== 'plan') {
          created = await transitionWorkItem(created.id, createStatus);
        }
        const selectedSession = sessionLinks.find((session) => session.key === draft.sessionKey);
        if (selectedSession) created = await onAttachSession(created, selectedSession);
        setItems((current) => [created, ...current]);
      }
      setEditorOpen(false);
      setEditingItem(null);
      setDraft(EMPTY_DRAFT);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  }

  function applyTransition(updated: WorkItem) {
    setItems((current) =>
      current.map((candidate) => (candidate.id === updated.id ? updated : candidate))
    );
    setAnnouncement(`${updated.title} moved to ${COLUMN_COPY[updated.status].label}.`);
    setFocusItemId(updated.id);
  }

  async function move(item: WorkItem, status: WorkItemStatus) {
    if (item.status === status) return;
    if (status === 'done') {
      if (
        item.review_id &&
        item.verification_run_id &&
        item.verification_status === 'passed' &&
        item.change_identity
      ) {
        setBusyId(item.id);
        try {
          const updated = await transitionWorkItem(item.id, 'done', 'verified');
          applyTransition(updated);
          setError(null);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
          setBusyId(null);
        }
        return;
      }
      setCompletionItem(item);
      return;
    }
    setBusyId(item.id);
    try {
      const updated = await transitionWorkItem(item.id, status);
      applyTransition(updated);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function completeAsWaived() {
    if (!completionItem) return;
    setBusyId(completionItem.id);
    try {
      const updated = await transitionWorkItem(completionItem.id, 'done', 'waived');
      applyTransition(updated);
      setCompletionItem(null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: WorkItem) {
    setBusyId(item.id);
    try {
      await deleteWorkItem(item.id);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setEditorOpen(false);
      setEditingItem(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-400">
        <Loader2 className="mr-2 animate-spin" size={16} /> Loading local work…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-5 pb-5">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {error ? (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-rose-300/20 bg-rose-300/[0.055] px-4 py-3 text-sm text-rose-100"
        >
          {error}
        </div>
      ) : null}

      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-400">One local trail from intent to evidence.</p>
          <p className="mt-1 text-xs text-zinc-400">
            {items.length} work item{items.length === 1 ? '' : 's'} on this Mac
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => openCreate()} className="gap-2">
          <Plus size={14} /> New work
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 auto-cols-[minmax(250px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
        {WORK_ITEM_STATUSES.map((status) => (
          <section
            key={status}
            aria-label={`${COLUMN_COPY[status].label} work items`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const item = items.find((candidate) => candidate.id === draggingId);
              setDraggingId(null);
              if (item) void move(item, status);
            }}
            className={cn(
              'flex min-h-0 flex-col rounded-2xl border border-white/[0.07] bg-white/[0.018] p-2.5',
              draggingId && 'border-white/[0.12]'
            )}
          >
            <header className="mb-2 flex items-center justify-between px-1 py-1">
              <div>
                <h2 className="text-xs font-semibold tracking-[-0.005em] text-zinc-200">
                  {COLUMN_COPY[status].label}
                </h2>
                <p className="mt-0.5 text-[11px] text-zinc-400">{COLUMN_COPY[status].hint}</p>
              </div>
              <span className="rounded-md bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-zinc-400">
                {grouped[status].length}
              </span>
            </header>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {grouped[status].map((item) => (
                <WorkCard
                  key={item.id}
                  item={item}
                  busy={busyId === item.id}
                  onBuild={() => onBuild(item)}
                  managedRun={managedRuns.find((run) => run.workItemId === item.id) ?? null}
                  onManage={() => setManagedItem(item)}
                  onEdit={() => openEdit(item)}
                  onMove={(nextStatus) => void move(item, nextStatus)}
                  onReview={() =>
                    navigate(`/review?project=${encodeURIComponent(item.project_path ?? '')}`)
                  }
                  onVerify={() =>
                    navigate(`/trex?project=${encodeURIComponent(item.project_path ?? '')}`)
                  }
                  onUnderstand={() =>
                    navigate(`/unpack?repo=${encodeURIComponent(item.project_path ?? '')}`)
                  }
                  onDragStart={() => setDraggingId(item.id)}
                  onDragEnd={() => setDraggingId(null)}
                />
              ))}
              {grouped[status].length === 0 ? (
                <button
                  type="button"
                  onClick={() => openCreate(status)}
                  className="flex min-h-12 w-full items-center justify-center rounded-lg border border-dashed border-white/[0.07] text-xs text-zinc-400 transition hover:border-amber-300/20 hover:bg-amber-300/[0.025] hover:text-zinc-200"
                >
                  <Plus className="mr-1.5" size={13} /> Add to {COLUMN_COPY[status].label}
                </button>
              ) : null}
            </div>
          </section>
        ))}
      </div>

      <WorkItemEditor
        open={editorOpen}
        item={editingItem}
        draft={draft}
        busy={busyId === (editingItem?.id ?? 'create')}
        repoProjects={repoProjects}
        sessionLinks={sessionLinks}
        onOpenChange={setEditorOpen}
        onDraftChange={setDraft}
        onSave={() => void saveDraft()}
        onDelete={editingItem ? () => void remove(editingItem) : undefined}
      />

      <ManagedWorkDialog
        item={managedItem}
        runs={managedItem ? managedRuns.filter((run) => run.workItemId === managedItem.id) : []}
        onOpenChange={(open) => !open && setManagedItem(null)}
        onRunChange={(run) =>
          setManagedRuns((current) => [
            run,
            ...current.filter((candidate) => candidate.id !== run.id),
          ])
        }
        onLaunch={async (run) => {
          if (!managedItem) return;
          await onManagedBuild(managedItem, run);
          setManagedItem(null);
        }}
      />

      <Dialog
        open={Boolean(completionItem)}
        onOpenChange={(open) => !open && setCompletionItem(null)}
      >
        <DialogContent>
          <div className="rounded-2xl border border-white/[0.1] bg-[#111215] p-6">
            <DialogHeader>
              <DialogTitle>Complete without exact evidence?</DialogTitle>
              <DialogDescription>
                CodeVetter only marks work Verified when a review and a passing verification run
                match the current change. You can still complete this item explicitly as waived.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCompletionItem(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void completeAsWaived()}
                disabled={busyId === completionItem?.id}
              >
                Complete as waived
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkCard({
  item,
  busy,
  onBuild,
  managedRun,
  onManage,
  onEdit,
  onMove,
  onReview,
  onVerify,
  onUnderstand,
  onDragStart,
  onDragEnd,
}: {
  item: WorkItem;
  busy: boolean;
  onBuild: () => void;
  managedRun: ManagedWorkRun | null;
  onManage: () => void;
  onEdit: () => void;
  onMove: (status: WorkItemStatus) => void;
  onReview: () => void;
  onVerify: () => void;
  onUnderstand: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const evidence = workItemEvidence(item);
  const index = WORK_ITEM_STATUSES.indexOf(item.status);
  const repoName = item.project_path?.split('/').filter(Boolean).at(-1);

  return (
    <article
      id={`work-card-${item.id}`}
      tabIndex={-1}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="group rounded-xl border border-white/[0.075] bg-[#0d0e11] p-3 shadow-[0_12px_30px_-24px_rgba(0,0,0,0.95)] outline-none transition hover:-translate-y-px hover:border-white/[0.13] focus-visible:border-amber-300/35 focus-visible:ring-2 focus-visible:ring-amber-300/20"
    >
      <button type="button" onClick={onEdit} className="block w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-medium leading-5 text-zinc-100">{item.title}</h3>
          {busy ? (
            <Loader2 className="mt-0.5 shrink-0 animate-spin text-zinc-500" size={13} />
          ) : null}
        </div>
        {item.description ? (
          <p className="mt-2 line-clamp-2 text-xs leading-4 text-zinc-400">{item.description}</p>
        ) : null}
      </button>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="rounded-md border border-white/[0.06] bg-white/[0.025] px-1.5 py-1 capitalize text-zinc-400">
          {item.preferred_provider}
        </span>
        {repoName ? (
          <span className="max-w-28 truncate rounded-md border border-white/[0.06] px-1.5 py-1 font-mono text-zinc-400">
            {repoName}
          </span>
        ) : null}
        <span
          className={cn(
            'rounded-md border px-1.5 py-1',
            evidence.tone === 'success'
              ? 'border-emerald-300/18 bg-emerald-300/[0.055] text-emerald-200'
              : evidence.tone === 'attention'
                ? 'border-rose-300/18 bg-rose-300/[0.055] text-rose-200'
                : evidence.tone === 'active'
                  ? 'border-cyan-300/18 bg-cyan-300/[0.055] text-cyan-200'
                  : 'border-white/[0.06] text-zinc-400'
          )}
        >
          {evidence.label}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-white/[0.055] pt-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={index === 0 || busy}
            onClick={() => onMove(WORK_ITEM_STATUSES[index - 1]!)}
            aria-label={`Move ${item.title} left`}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100 disabled:opacity-20"
          >
            <ArrowLeft size={13} />
          </button>
          <button
            type="button"
            disabled={index === WORK_ITEM_STATUSES.length - 1 || busy}
            onClick={() => onMove(WORK_ITEM_STATUSES[index + 1]!)}
            aria-label={`Move ${item.title} right`}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100 disabled:opacity-20"
          >
            <ArrowRight size={13} />
          </button>
          {item.project_path ? (
            <button
              type="button"
              onClick={onUnderstand}
              aria-label={`Understand ${item.title} in Repo Unpack`}
              title="Open Repo Unpack"
              className="rounded-md p-1.5 text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100"
            >
              <GitBranch size={13} />
            </button>
          ) : null}
        </div>
        {item.status === 'review' ? (
          <button
            type="button"
            onClick={onReview}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] text-amber-100 hover:bg-amber-300/[0.07]"
          >
            <ClipboardCheck size={12} /> Review
          </button>
        ) : item.status === 'verify' ? (
          <button
            type="button"
            onClick={onVerify}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] text-emerald-100 hover:bg-emerald-300/[0.07]"
          >
            <Check size={12} /> Verify
          </button>
        ) : item.status !== 'done' ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onManage}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] text-amber-100 hover:bg-amber-300/[0.07]"
            >
              <ShieldCheck size={12} /> {managedRun ? managedRun.state : 'Managed'}
            </button>
            <button
              type="button"
              onClick={onBuild}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] text-cyan-100 hover:bg-cyan-300/[0.07]"
            >
              <Bot size={12} /> Open
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ManagedWorkDialog({
  item,
  runs,
  onOpenChange,
  onRunChange,
  onLaunch,
}: {
  item: WorkItem | null;
  runs: ManagedWorkRun[];
  onOpenChange: (open: boolean) => void;
  onRunChange: (run: ManagedWorkRun) => void;
  onLaunch: (run: ManagedWorkRun) => Promise<void>;
}) {
  const [profiles, setProfiles] = useState<ManagedProviderProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<Record<string, unknown> | null>(null);
  const [hookProgram, setHookProgram] = useState('pnpm');
  const [hookArgs, setHookArgs] = useState('lint');
  const [hookResult, setHookResult] = useState<string | null>(null);
  const [closureReason, setClosureReason] = useState('');
  const [closureDisposition, setClosureDisposition] =
    useState<IntentClosureReceipt['disposition']>('satisfied');
  const [closures, setClosures] = useState<IntentClosureReceipt[]>([]);
  const run = runs[0] ?? null;

  useEffect(() => {
    if (!item) return;
    setError(null);
    setHandoff(null);
    setHookResult(null);
    void Promise.all([listManagedProviderProfiles(), listIntentClosures(item.id)])
      .then(([nextProfiles, nextClosures]) => {
        const compatible = (Array.isArray(nextProfiles) ? nextProfiles : []).filter(
          (profile) => profile.provider === item.preferred_provider
        );
        setProfiles(compatible);
        setProfileId((current) =>
          compatible.some((profile) => profile.id === current)
            ? current
            : (compatible.find((profile) => profile.isDefault)?.id ?? compatible[0]?.id ?? '')
        );
        setClosures(Array.isArray(nextClosures) ? nextClosures : []);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [item]);

  async function perform(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function createAndLaunch() {
    if (!item?.project_path || !profileId) return;
    await perform('create', async () => {
      const created = await createManagedWorkRun({
        workItemId: item.id,
        provider: item.preferred_provider,
        profileId,
        repoPath: item.project_path!,
      });
      onRunChange(created);
      await onLaunch(created);
    });
  }

  async function reconcile() {
    if (!run) return;
    await perform('reconcile', async () => onRunChange(await reconcileManagedWorkRun(run.id)));
  }

  async function check() {
    if (!run) return;
    const args = hookArgs.trim() ? hookArgs.trim().split(/\s+/) : [];
    await perform('check', async () => {
      const result = await runManagedWorkHook({
        runId: run.id,
        kind: 'check',
        program: hookProgram.trim(),
        args,
      });
      setHookResult(
        `${result.success ? 'Passed' : result.timedOut ? 'Timed out' : 'Failed'} · ${result.durationMs} ms · ${result.changeIdentity.slice(0, 24)}`
      );
      onRunChange(await reconcileManagedWorkRun(run.id));
    });
  }

  async function inspectHandoff() {
    if (!run) return;
    await perform('handoff', async () => setHandoff(await getManagedWorkHandoff(run.id)));
  }

  async function archive() {
    if (!run) return;
    await perform('archive', async () => onRunChange(await archiveManagedWorkRun(run.id)));
  }

  async function closeIntent() {
    if (!item || !closureReason.trim()) return;
    await perform('closure', async () => {
      const receipt = await createIntentClosure({
        workItemId: item.id,
        managedRunId: run?.id ?? null,
        disposition: closureDisposition,
        reason: closureReason.trim(),
      });
      setClosures((current) => [receipt, ...current]);
      setClosureReason('');
    });
  }

  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="max-h-[85vh] overflow-y-auto rounded-2xl border border-white/[0.1] bg-[#111215] p-6">
          <DialogHeader>
            <DialogTitle>Managed work</DialogTitle>
            <DialogDescription>
              Isolated worktree, explicit profile, bounded checks, and evidence handoff. Publishing
              is never automatic.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-rose-300/[0.07] p-3 text-xs text-rose-100"
            >
              {error}
            </p>
          ) : null}
          {!run ? (
            <div className="mt-5 space-y-4">
              <p className="text-xs leading-5 text-zinc-400">
                CodeVetter will branch from the repository’s exact current revision into a local
                temporary worktree. The selected profile changes the launched provider environment;
                credential contents are not read.
              </p>
              <label className="block text-xs text-zinc-400">
                {item?.preferred_provider === 'claude' ? 'Claude' : 'Codex'} profile
                <select
                  value={profileId}
                  onChange={(event) => setProfileId(event.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 text-sm text-zinc-200 outline-none"
                >
                  {profiles.length === 0 ? <option value="">No usable profile found</option> : null}
                  {profiles.map((profile) => (
                    <option
                      key={profile.id}
                      value={profile.id}
                      disabled={!profile.executableAvailable}
                    >
                      {profile.label}
                      {profile.executableAvailable ? '' : ' · CLI unavailable'}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                onClick={() => void createAndLaunch()}
                disabled={!item?.project_path || !profileId || busy !== null}
                className="gap-2"
              >
                {busy === 'create' ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <Bot size={14} />
                )}
                Create isolated run
              </Button>
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium capitalize text-zinc-200">
                    {managedRunStatusLabel(run)}
                  </span>
                  <span className="font-mono text-zinc-500">{run.baseRevision.slice(0, 12)}</span>
                </div>
                <p className="mt-2 break-all text-zinc-400">{run.worktreePath}</p>
                {run.disconnectedReason ? (
                  <p className="mt-2 text-amber-200">{run.disconnectedReason}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void reconcile()}
                  >
                    <RefreshCw size={13} className="mr-1.5" /> Reconcile
                  </Button>
                  {managedRunCanRecover(run) ? (
                    <Button type="button" size="sm" onClick={() => void onLaunch(run)}>
                      Recover conversation
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void inspectHandoff()}
                  >
                    Inspect handoff
                  </Button>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-medium text-zinc-200">Bounded checkpoint</h3>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2">
                  <Input
                    aria-label="Check program"
                    value={hookProgram}
                    onChange={(event) => setHookProgram(event.target.value)}
                    placeholder="pnpm"
                  />
                  <Input
                    aria-label="Check arguments"
                    value={hookArgs}
                    onChange={(event) => setHookArgs(event.target.value)}
                    placeholder="test:unit"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void check()}
                    disabled={!hookProgram.trim() || busy !== null}
                  >
                    Check
                  </Button>
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-500">
                  Exact program and arguments only; shells, publish commands, and destructive git
                  operations are rejected.
                </p>
                {hookResult ? <p className="mt-2 text-xs text-zinc-300">{hookResult}</p> : null}
              </div>

              {handoff ? (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.07] bg-black/20 p-3 text-[10px] leading-4 text-zinc-400">
                  {JSON.stringify(handoff, null, 2)}
                </pre>
              ) : null}

              <div className="border-t border-white/[0.07] pt-4">
                <h3 className="text-xs font-medium text-zinc-200">Intent closure</h3>
                <div className="mt-2 grid grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)_auto] gap-2">
                  <select
                    aria-label="Intent disposition"
                    value={closureDisposition}
                    onChange={(event) =>
                      setClosureDisposition(
                        event.target.value as IntentClosureReceipt['disposition']
                      )
                    }
                    className="h-10 rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 text-xs text-zinc-200 outline-none"
                  >
                    <option value="satisfied">Satisfied</option>
                    <option value="partially_satisfied">Partially satisfied</option>
                    <option value="not_satisfied">Not satisfied</option>
                    <option value="waived">Waived</option>
                  </select>
                  <Input
                    aria-label="Intent closure reason"
                    value={closureReason}
                    onChange={(event) => setClosureReason(event.target.value)}
                    placeholder="Evidence-based reason"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void closeIntent()}
                    disabled={!closureReason.trim() || busy !== null}
                  >
                    Record
                  </Button>
                </div>
                {closures[0] ? (
                  <p className="mt-2 text-[11px] text-zinc-400">
                    Latest: {intentClosureEvidenceLabel(closures[0])}
                  </p>
                ) : null}
              </div>

              <div className="flex justify-end border-t border-white/[0.07] pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void archive()}
                  disabled={busy !== null}
                  className="gap-2 text-zinc-400"
                >
                  <Archive size={14} /> Archive clean worktree
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WorkItemEditor({
  open,
  item,
  draft,
  busy,
  repoProjects,
  sessionLinks,
  onOpenChange,
  onDraftChange,
  onSave,
  onDelete,
}: {
  open: boolean;
  item: WorkItem | null;
  draft: WorkItemDraft;
  busy: boolean;
  repoProjects: RepoProject[];
  sessionLinks: WorkSessionLink[];
  onOpenChange: (open: boolean) => void;
  onDraftChange: (draft: WorkItemDraft) => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const compatibleSessions = sessionLinks.filter(
    (session) =>
      !draft.projectPath ||
      (item ? workItemHasSession(item, session) : false) ||
      (session.project_path !== null &&
        normalizedProjectPath(draft.projectPath) === normalizedProjectPath(session.project_path))
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="rounded-2xl border border-white/[0.1] bg-[#111215] p-6">
          <DialogHeader>
            <DialogTitle>{item ? 'Work item' : 'Plan new work'}</DialogTitle>
            <DialogDescription>
              Keep the intent, repository, agent, and proof in one local record.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 space-y-4">
            <label className="block text-xs text-zinc-400">
              Outcome
              <Input
                className="mt-1.5"
                value={draft.title}
                onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
                placeholder="What should be true when this is done?"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Context
              <textarea
                value={draft.description}
                onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
                className="mt-1.5 min-h-20 w-full resize-y rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-amber-300/35"
                placeholder="Why this work matters"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Acceptance criteria
              <textarea
                value={draft.acceptanceCriteria}
                onChange={(event) =>
                  onDraftChange({ ...draft, acceptanceCriteria: event.target.value })
                }
                className="mt-1.5 min-h-24 w-full resize-y rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-amber-300/35"
                placeholder="Observable proof, one line per condition"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-zinc-400">
                Repository
                <select
                  value={draft.projectPath}
                  onChange={(event) => onDraftChange({ ...draft, projectPath: event.target.value })}
                  className="mt-1.5 h-10 w-full rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 text-sm text-zinc-200 outline-none"
                >
                  <option value="">No repository</option>
                  {repoProjects.map((project) => (
                    <option key={project.id} value={project.repo_path}>
                      {project.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-zinc-400">
                Preferred agent
                <select
                  value={draft.provider}
                  onChange={(event) =>
                    onDraftChange({ ...draft, provider: event.target.value as WorkItemProvider })
                  }
                  className="mt-1.5 h-10 w-full rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 text-sm text-zinc-200 outline-none"
                >
                  <option value="codex">Codex</option>
                  <option value="claude">Claude</option>
                </select>
              </label>
            </div>
            <label className="block text-xs text-zinc-400">
              Existing agent run
              <select
                value={draft.sessionKey}
                onChange={(event) => {
                  const session = sessionLinks.find(
                    (candidate) => candidate.key === event.target.value
                  );
                  onDraftChange({
                    ...draft,
                    sessionKey: event.target.value,
                    provider: session?.provider ?? draft.provider,
                    projectPath: draft.projectPath || session?.project_path || '',
                  });
                }}
                className="mt-1.5 h-10 w-full rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 text-sm text-zinc-200 outline-none"
              >
                <option value="">
                  {item?.agent_terminal_id || item?.agent_session_id
                    ? 'Keep linked run'
                    : 'No linked run'}
                </option>
                {compatibleSessions.map((session) => (
                  <option key={session.key} value={session.key}>
                    {session.running ? 'Live' : 'Recent'} · {session.label} · {session.detail}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-[11px] leading-4 text-zinc-500">
                Attaching records this run as evidence. It does not restart or resume the agent.
              </span>
            </label>
          </div>
          <div className="mt-6 flex items-center justify-between gap-3">
            {onDelete ? (
              <Button
                type="button"
                variant="ghost"
                onClick={onDelete}
                className="gap-2 text-rose-200 hover:bg-rose-300/[0.07]"
              >
                <Trash2 size={14} /> Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={onSave} disabled={!draft.title.trim() || busy}>
                {busy ? <Loader2 className="mr-2 animate-spin" size={14} /> : null}
                {item ? 'Save changes' : 'Create work'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function linkedSessionKey(item: WorkItem, sessions: WorkSessionLink[]): string {
  return (
    sessions.find(
      (session) =>
        (item.agent_terminal_id && session.terminal_id === item.agent_terminal_id) ||
        (item.agent_session_id && session.session_id === item.agent_session_id)
    )?.key ?? ''
  );
}

function workItemHasSession(item: WorkItem, session: WorkSessionLink): boolean {
  return Boolean(
    (session.terminal_id && item.agent_terminal_id === session.terminal_id) ||
      (session.session_id && item.agent_session_id === session.session_id)
  );
}

function normalizedProjectPath(value: string): string {
  return value.trim().replace(/\/+$/, '');
}
