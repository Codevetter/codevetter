import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as XTerm } from '@xterm/xterm';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  Bot,
  ChevronDown,
  ChevronUp,
  Columns2,
  ClipboardPaste,
  Download,
  Files,
  FolderOpen,
  GitBranch,
  History,
  Loader2,
  Maximize2,
  Minimize2,
  Copy,
  Play,
  Plus,
  RotateCcw,
  Rows2,
  Search,
  SendHorizontal,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from 'lucide-react';
import {
  Fragment,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Group as PanelGroup,
  Panel,
  type Layout as PanelLayout,
  Separator as PanelResizeHandle,
} from 'react-resizable-panels';

import { Button } from '@/components/ui/button';
import {
  isCodexFailureEvent,
  parseCodexCliAgentPayload,
  terminalPatchForCodexEvent,
  type CodexAgentEventPatch,
  type CodexCliAgentPayload,
} from '@/lib/codex-agent-events';
import {
  getCodexWarpPluginStatus,
  getRepoProjectGitStatus,
  getResourceSnapshot,
  installCodexWarpPlugin,
  isTauriAvailable,
  listSessions,
  listenToAgentTerminalEvents,
  listenToSessionArchiveUpdates,
  listCodexAgentTerminals,
  listRepoProjects,
  pickDirectory,
  openInApp,
  resizeCodexAgentTerminal,
  runAgentTerminalCommand,
  sendCodexAgentTerminalInput,
  sendTrayNotification,
  startCodexAgentTerminal,
  stopCodexAgentTerminal,
  type AgentTerminalEvent,
  type AgentTerminalCommandResult,
  type CodexAgentTerminalSnapshot,
  type CodexWarpPluginStatus,
  type ResourceProcessSample,
  type RepoProject,
  type RepoProjectGitStatus,
  type SessionRow,
} from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';

type AgentStatus = 'white' | 'green' | 'yellow' | 'red';
type AgentSize = 'compact' | 'wide' | 'tall';
type AgentLayout = 'focus' | 'columns' | 'rows' | 'grid';
type AgentActivityKind = 'info' | 'event' | 'input' | 'attention' | 'error' | 'exit';
type AgentBlockKind = 'launch' | 'prompt' | 'shell' | 'event' | 'attention' | 'exit';
type AgentEventSource = 'codex-warp' | 'codex-osc9' | 'terminal';
type AgentLaunchMode = 'start' | 'resume' | 'fork';
type AgentComposerMode = 'prompt' | 'shell';
type AgentListFilter = 'all' | 'running' | 'attention' | 'background' | 'recoverable';
type AgentBroadcastScope = 'foreground' | 'attention' | 'all';
type AgentLifecycleState =
  | 'ready'
  | 'live'
  | 'waiting'
  | 'failed'
  | 'resumable'
  | 'stopped'
  | 'detached';

interface AgentActivityEntry {
  id: string;
  at: number;
  kind: AgentActivityKind;
  label: string;
  detail?: string;
}

interface AgentBlockEntry {
  id: string;
  at: number;
  kind: AgentBlockKind;
  status: AgentStatus;
  title: string;
  detail?: string;
  output?: string;
  cwd?: string;
  exitCode?: number;
  durationMs?: number;
}

interface AgentStructuredEventEntry {
  id: string;
  seq: number | null;
  at: number;
  source: AgentEventSource;
  event: string;
  status: AgentStatus;
  title: string;
  detail?: string;
}

interface AgentTerminal {
  id: string;
  name: string;
  cwd: string;
  prompt: string;
  model: string;
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalPolicy: 'untrusted' | 'on-request' | 'never';
  status: AgentStatus;
  size: AgentSize;
  background: boolean;
  running: boolean;
  started: boolean;
  updatedAt: string;
  statusReason: string;
  idleMs: number | null;
  lastOutputAt: number | null;
  lastHeartbeatAt: number | null;
  waitingSince: number | null;
  structuredEventsActive: boolean;
  lastAgentEvent: string | null;
  lastAgentEventSource: AgentEventSource | null;
  lastAgentEventAt: number | null;
  lastStructuredEventSeq: number | null;
  structuredEventLog: AgentStructuredEventEntry[];
  activities: AgentActivityEntry[];
  blocks: AgentBlockEntry[];
  composerDraft: string;
  composerMode: AgentComposerMode;
  composerHistory: string[];
  outputTail: string;
  pid: number | null;
  codexSessionId: string | null;
  transcriptPath: string | null;
}

type RepoStatusByPath = Record<string, RepoProjectGitStatus | null>;
type AgentResourceSamplesByPid = Record<number, ResourceProcessSample>;

const STALL_AFTER_MS = 120_000;
const OUTPUT_TAIL_CHARS = 6000;
const OUTPUT_BUFFER_CHARS = 500_000;
const XTERM_WRITE_CHUNK_CHARS = 32_000;
const XTERM_RENDER_QUEUE_CHARS = 256_000;
const XTERM_DENSE_RENDER_QUEUE_CHARS = 96_000;
const XTERM_SCROLLBACK_ROWS = 20_000;
const XTERM_DENSE_SCROLLBACK_ROWS = 8_000;
const XTERM_DENSE_PANE_COUNT = 8;
const LIVE_REPO_STATUS_REFRESH_MS = 15_000;
const DENSE_LIVE_REPO_STATUS_REFRESH_MS = 60_000;
const AGENT_RESOURCE_REFRESH_MS = 5_000;
const DENSE_AGENT_RESOURCE_REFRESH_MS = 10_000;
const ACTIVITY_LIMIT = 40;
const BLOCK_LIMIT = 40;
const STRUCTURED_EVENT_LOG_LIMIT = 40;
const PROMPT_HISTORY_LIMIT = 30;
const SHELL_CONTEXT_OUTPUT_CHARS = 12_000;
const TERMINAL_CONTEXT_OUTPUT_CHARS = 12_000;
const TERMINAL_SEARCH_OPTIONS: ISearchOptions = {
  decorations: {
    matchBackground: '#374151',
    matchBorder: '#94a3b8',
    matchOverviewRuler: '#64748b',
    activeMatchBackground: '#f59e0b',
    activeMatchBorder: '#fde68a',
    activeMatchColorOverviewRuler: '#f59e0b',
  },
};
const terminalFocusBus = new EventTarget();
const terminalShortcutBus = new EventTarget();
const outputSubscribers = new Map<string, Set<TerminalOutputSubscriber>>();
const outputBuffers = new Map<string, string>();
const outputTails = new Map<string, string>();
const outputSequences = new Map<string, number>();

interface TerminalOutputEvent {
  id: string;
  chunk: string;
  clear?: boolean;
}

type TerminalOutputSubscriber = (event: TerminalOutputEvent) => void;

interface TerminalFocusEvent {
  id: string;
}

interface TerminalShortcutEvent {
  action: 'next' | 'previous';
}

interface TerminalContextMenuState {
  x: number;
  y: number;
}

interface SavedAgentTerminal {
  id: string;
  name: string;
  cwd: string;
  prompt: string;
  model: string;
  sandbox: AgentTerminal['sandbox'];
  approvalPolicy: AgentTerminal['approvalPolicy'];
  size: AgentSize;
  background: boolean;
  status?: AgentStatus;
  started?: boolean;
  updatedAt?: string;
  statusReason?: string;
  structuredEventsActive?: boolean;
  lastAgentEvent?: string | null;
  lastAgentEventSource?: AgentEventSource | null;
  lastAgentEventAt?: number | null;
  lastStructuredEventSeq?: number | null;
  structuredEventLog?: AgentStructuredEventEntry[];
  activities?: AgentActivityEntry[];
  blocks?: AgentBlockEntry[];
  composerDraft?: string;
  composerMode?: AgentComposerMode;
  composerHistory?: string[];
  codexSessionId?: string | null;
  transcriptPath?: string | null;
}

interface SavedAgentWorkspace {
  version: 1;
  layout: AgentLayout;
  selectedId: string;
  terminals: SavedAgentTerminal[];
}

const AGENT_WORKSPACE_STORAGE_KEY = 'codevetter.agent-panel.workspace.v1';
const AGENT_PANEL_LAYOUT_STORAGE_PREFIX = 'codevetter.agent-panel.layout.v1';
const PROMPT_PRESETS = [
  {
    label: 'Review changes',
    prompt:
      'Review the current uncommitted changes in this repo. Focus on correctness bugs, regressions, and missing tests. Make small fixes only when clearly safe.',
  },
  {
    label: 'Fix checks',
    prompt:
      'Run the smallest relevant checks for this repo, identify any failures, and fix the highest-confidence issue with the smallest safe diff.',
  },
  {
    label: 'Explain repo',
    prompt:
      'Inspect this repository and summarize the architecture, key commands, current risks, and the next most useful engineering action.',
  },
  {
    label: 'Continue task',
    prompt:
      'Continue the current task in this repo. Inspect local context first, preserve unrelated changes, make concrete progress, and run a focused check.',
  },
] as const;
const CODEX_SLASH_COMMANDS = [
  {
    command: '/usage',
    description: 'Show Codex usage and reset information',
  },
  {
    command: '/help',
    description: 'Show Codex interactive commands',
  },
  {
    command: '/compact',
    description: 'Compact the current Codex conversation context',
  },
  {
    command: '/exit',
    description: 'Ask Codex to exit this session',
  },
] as const;

const statusMeta: Record<
  AgentStatus,
  { label: string; dot: string; row: string; terminal: string; text: string }
> = {
  white: {
    label: 'Initialized',
    dot: 'bg-white/70',
    row: 'border-white/10 bg-white/[0.035]',
    terminal: 'border-white/10',
    text: 'text-slate-300',
  },
  green: {
    label: 'Running',
    dot: 'bg-emerald-300',
    row: 'border-emerald-300/20 bg-emerald-300/[0.045]',
    terminal: 'border-emerald-300/16',
    text: 'text-emerald-200',
  },
  yellow: {
    label: 'Needs input',
    dot: 'bg-amber-300',
    row: 'border-amber-300/20 bg-amber-300/[0.045]',
    terminal: 'border-amber-300/16',
    text: 'text-amber-200',
  },
  red: {
    label: 'Failed',
    dot: 'bg-red-300',
    row: 'border-red-300/20 bg-red-300/[0.045]',
    terminal: 'border-red-300/16',
    text: 'text-red-200',
  },
};

export default function AgentPanel() {
  const savedWorkspaceRef = useRef(loadSavedAgentWorkspace());
  const [terminals, setTerminals] = useState<AgentTerminal[]>(
    () => savedWorkspaceRef.current?.terminals.map(terminalFromSaved) ?? []
  );
  const [selectedId, setSelectedId] = useState(() => savedWorkspaceRef.current?.selectedId ?? '');
  const [layout, setLayout] = useState<AgentLayout>(
    () => savedWorkspaceRef.current?.layout ?? 'focus'
  );
  const [codexPluginStatus, setCodexPluginStatus] = useState<CodexWarpPluginStatus | null>(null);
  const [codexPluginBusy, setCodexPluginBusy] = useState(false);
  const [repoProjects, setRepoProjects] = useState<RepoProject[]>([]);
  const [recentCodexSessions, setRecentCodexSessions] = useState<SessionRow[]>([]);
  const [agentListFilter, setAgentListFilter] = useState<AgentListFilter>('all');
  const [terminalFocusMode, setTerminalFocusMode] = useState(false);
  const [batchRepoPaths, setBatchRepoPaths] = useState<string[]>([]);
  const [batchPrompt, setBatchPrompt] = useState<string>(PROMPT_PRESETS[0].prompt);
  const [batchStartImmediately, setBatchStartImmediately] = useState(false);
  const [batchBackground, setBatchBackground] = useState(false);
  const [broadcastPrompt, setBroadcastPrompt] = useState('');
  const [broadcastScope, setBroadcastScope] = useState<AgentBroadcastScope>('foreground');
  const [, setLifecycleNow] = useState(() => Date.now());
  const [defaultCwd, setDefaultCwd] = useState('~');
  const [repoStatusByPath, setRepoStatusByPath] = useState<RepoStatusByPath>({});
  const [resourceSamplesByPid, setResourceSamplesByPid] = useState<AgentResourceSamplesByPid>({});
  const [repoStatusLoadingPaths, setRepoStatusLoadingPaths] = useState<Set<string>>(
    () => new Set()
  );
  const notifiedAttentionRef = useRef(new Map<string, string>());
  const repoStatusRequestsRef = useRef(new Set<string>());
  const repoPathsSignature = useMemo(() => repoStatusPathSignature(terminals), [terminals]);
  const liveRepoPathsSignature = useMemo(
    () => liveRepoStatusPathSignature(terminals, selectedId),
    [selectedId, terminals]
  );
  const workspaceSnapshot = useMemo(
    () => serializeAgentWorkspace({ layout, selectedId, terminals }),
    [layout, selectedId, terminals]
  );

  const selected = terminals.find((terminal) => terminal.id === selectedId) ?? terminals[0] ?? null;
  const foregroundTerminals = terminals.filter((terminal) => !terminal.background);
  const runningTerminals = terminals.filter((terminal) => terminal.running);
  const hasRunningTerminals = runningTerminals.length > 0;
  const denseAgentWorkspace = terminals.length >= XTERM_DENSE_PANE_COUNT;
  const selectedRepoPath = selected?.cwd ?? '';
  const runningPidSignature = useMemo(
    () =>
      runningTerminals
        .map((terminal) => terminal.pid)
        .filter((pid): pid is number => Number.isFinite(pid))
        .sort((a, b) => a - b)
        .join(','),
    [runningTerminals]
  );
  const attentionTerminals = useMemo(() => sortAttentionTerminals(terminals), [terminals]);
  const backgroundAttentionCount = attentionTerminals.filter(
    (terminal) => terminal.background
  ).length;
  const broadcastTargets = useMemo(
    () => agentBroadcastTargets(terminals, broadcastScope),
    [broadcastScope, terminals]
  );
  const filteredAgentTerminals = useMemo(
    () => terminals.filter((terminal) => agentMatchesListFilter(terminal, agentListFilter)),
    [agentListFilter, terminals]
  );
  const visibleTerminals =
    terminalFocusMode && selected
      ? [selected]
      : layout === 'focus'
        ? selected
          ? [selected]
          : []
        : foregroundTerminals.length > 0
          ? foregroundTerminals
          : selected
            ? [selected]
            : [];

  const updateTerminal = useCallback((id: string, patch: Partial<AgentTerminal>) => {
    if (typeof patch.cwd === 'string' && patch.cwd.trim()) {
      setDefaultCwd(patch.cwd);
    }
    setTerminals((current) =>
      current.map((terminal) =>
        terminal.id === id
          ? { ...terminal, ...patch, updatedAt: patch.updatedAt ?? 'now' }
          : terminal
      )
    );
  }, []);

  const refreshCodexPluginStatus = useCallback(async () => {
    if (!isTauriAvailable()) return;
    try {
      setCodexPluginStatus(await getCodexWarpPluginStatus());
    } catch (error) {
      setCodexPluginStatus({
        codex_available: false,
        marketplace_installed: false,
        warp_plugin_installed: false,
        warp_plugin_enabled: false,
        orchestration_plugin_installed: false,
        orchestration_plugin_enabled: false,
        structured_env_enabled: false,
        needs_install: true,
        codex_path: 'codex',
        marketplace_output: '',
        plugin_output: '',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const refreshRepoStatus = useCallback(
    (repoPath: string, force = false) => {
      if (!isTauriAvailable()) return;
      const path = repoPath.trim();
      if (!isConcreteRepoPath(path)) return;
      if (!force && (path in repoStatusByPath || repoStatusRequestsRef.current.has(path))) return;

      repoStatusRequestsRef.current.add(path);
      setRepoStatusLoadingPaths((current) => new Set(current).add(path));
      void getRepoProjectGitStatus(path)
        .then((status) => {
          setRepoStatusByPath((current) => ({ ...current, [path]: status }));
        })
        .catch(() => {
          setRepoStatusByPath((current) => ({ ...current, [path]: null }));
        })
        .finally(() => {
          repoStatusRequestsRef.current.delete(path);
          setRepoStatusLoadingPaths((current) => {
            const next = new Set(current);
            next.delete(path);
            return next;
          });
        });
    },
    [repoStatusByPath]
  );

  const installCodexWarp = useCallback(async () => {
    if (!isTauriAvailable()) return;
    setCodexPluginBusy(true);
    try {
      setCodexPluginStatus(await installCodexWarpPlugin());
    } catch (error) {
      setCodexPluginStatus((current) => ({
        codex_available: current?.codex_available ?? false,
        marketplace_installed: current?.marketplace_installed ?? false,
        warp_plugin_installed: current?.warp_plugin_installed ?? false,
        warp_plugin_enabled: current?.warp_plugin_enabled ?? false,
        orchestration_plugin_installed: current?.orchestration_plugin_installed ?? false,
        orchestration_plugin_enabled: current?.orchestration_plugin_enabled ?? false,
        structured_env_enabled: current?.structured_env_enabled ?? false,
        needs_install: true,
        codex_path: current?.codex_path ?? 'codex',
        marketplace_output: current?.marketplace_output ?? '',
        plugin_output: current?.plugin_output ?? '',
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setCodexPluginBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshCodexPluginStatus();
  }, [refreshCodexPluginStatus]);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let cancelled = false;
    void listRepoProjects()
      .then((projects) => {
        if (cancelled) return;
        setRepoProjects(projects);
        setDefaultCwd(projects[0]?.repo_path ?? '~');
      })
      .catch(() => {
        // Repo registry is a convenience for new agents; manual cwd entry still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (batchRepoPaths.length > 0 || repoProjects.length === 0) return;
    setBatchRepoPaths(repoProjects.slice(0, 3).map((project) => project.repo_path));
  }, [batchRepoPaths.length, repoProjects]);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    const refresh = async () => {
      try {
        const sessions = await listSessions(undefined, undefined, 40, 0, 'codex');
        if (cancelled) return;
        setRecentCodexSessions(
          sessions.filter((session) => Boolean(session.id.trim())).slice(0, 40)
        );
      } catch {
        if (!cancelled) setRecentCodexSessions([]);
      }
    };

    void refresh();
    void listenToSessionArchiveUpdates(() => void refresh())
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Indexed session history is optional; live terminals still work.
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    for (const repoPath of repoStatusPathsFromSignature(repoPathsSignature)) {
      refreshRepoStatus(repoPath);
    }
  }, [refreshRepoStatus, repoPathsSignature]);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    const refreshMs = denseAgentWorkspace
      ? DENSE_LIVE_REPO_STATUS_REFRESH_MS
      : LIVE_REPO_STATUS_REFRESH_MS;
    const interval = window.setInterval(() => {
      for (const repoPath of repoStatusPathsFromSignature(liveRepoPathsSignature)) {
        if (denseAgentWorkspace && repoPath === selectedRepoPath) continue;
        refreshRepoStatus(repoPath, true);
      }
    }, refreshMs);
    return () => window.clearInterval(interval);
  }, [denseAgentWorkspace, liveRepoPathsSignature, refreshRepoStatus, selectedRepoPath]);

  useEffect(() => {
    if (!isTauriAvailable() || !denseAgentWorkspace || !isConcreteRepoPath(selectedRepoPath)) {
      return;
    }
    const interval = window.setInterval(() => {
      refreshRepoStatus(selectedRepoPath, true);
    }, LIVE_REPO_STATUS_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [denseAgentWorkspace, refreshRepoStatus, selectedRepoPath]);

  useEffect(() => {
    if (!isTauriAvailable() || !runningPidSignature) {
      setResourceSamplesByPid({});
      return;
    }

    let cancelled = false;
    const wantedPids = new Set(runningPidSignature.split(',').map((pid) => Number(pid)));
    const refreshMs =
      wantedPids.size >= XTERM_DENSE_PANE_COUNT
        ? DENSE_AGENT_RESOURCE_REFRESH_MS
        : AGENT_RESOURCE_REFRESH_MS;

    async function refreshAgentResources() {
      try {
        const snapshot = await getResourceSnapshot();
        if (cancelled) return;
        const nextSamples: AgentResourceSamplesByPid = {};
        for (const child of snapshot.children) {
          if (wantedPids.has(child.pid)) nextSamples[child.pid] = child;
        }
        setResourceSamplesByPid(nextSamples);
      } catch {
        if (!cancelled) setResourceSamplesByPid({});
      }
    }

    void refreshAgentResources();
    const interval = window.setInterval(refreshAgentResources, refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [runningPidSignature]);

  useEffect(() => {
    saveAgentWorkspace(workspaceSnapshot);
  }, [workspaceSnapshot]);

  useEffect(() => {
    if (!hasRunningTerminals) return;
    const interval = window.setInterval(() => {
      setLifecycleNow(Date.now());
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [hasRunningTerminals]);

  useEffect(() => {
    if (selectedId) focusTerminalPane(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let cancelled = false;
    void listCodexAgentTerminals()
      .then((snapshots) => {
        if (cancelled || snapshots.length === 0) return;
        setTerminals((current) => {
          const snapshotById = new Map(
            snapshots.map((snapshot) => [snapshot.session_id, snapshot] as const)
          );
          const updated = current.map((terminal) => {
            const snapshot = snapshotById.get(terminal.id);
            return snapshot ? mergeTerminalSnapshot(terminal, snapshot) : terminal;
          });
          const known = new Set(updated.map((terminal) => terminal.id));
          const reattached = snapshots
            .filter((snapshot) => !known.has(snapshot.session_id))
            .map((snapshot, index) => terminalFromSnapshot(snapshot, updated.length + index + 1));
          if (reattached.length === 0) return updated;
          return [...updated, ...reattached];
        });
        setSelectedId((current) => current || snapshots[0]?.session_id || '');
      })
      .catch(() => {
        // Reattach is best-effort; event listening still works for terminals created in this view.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTerminalEvent = useCallback((event: AgentTerminalEvent) => {
    setTerminals((current) =>
      current.map((terminal) => {
        if (terminal.id !== event.session_id) return terminal;

        if (event.kind === 'output') {
          if (isDuplicateTerminalOutput(event.session_id, event.seq ?? null)) {
            return terminal;
          }
          const chunk = event.data ?? '';
          const outputTail = appendTerminalOutput(event.session_id, chunk);
          if (terminal.structuredEventsActive) {
            if (terminal.running && terminal.started && terminal.idleMs === 0) {
              return terminal;
            }
            return {
              ...terminal,
              running: true,
              started: true,
              idleMs: 0,
              lastOutputAt: Date.now(),
            };
          }
          const blockedReason = codexBlockedReason(chunk);
          if (
            !blockedReason &&
            terminal.running &&
            terminal.started &&
            terminal.status === 'green' &&
            terminal.updatedAt === 'running'
          ) {
            return terminal;
          }
          const next = {
            ...terminal,
            outputTail,
            status: (blockedReason ? 'yellow' : 'green') as AgentStatus,
            running: true,
            started: true,
            updatedAt: blockedReason ?? 'running',
            statusReason: blockedReason ?? 'active output',
            idleMs: 0,
            lastOutputAt: Date.now(),
            waitingSince: blockedReason ? (terminal.waitingSince ?? Date.now()) : null,
          };
          return blockedReason && terminal.status !== 'yellow'
            ? appendActivity(
                appendBlock(next, {
                  kind: 'attention',
                  status: 'yellow',
                  title: blockedReason,
                  detail: 'Detected from terminal output fallback',
                }),
                {
                  kind: 'attention',
                  label: blockedReason,
                  detail: 'Detected from terminal output fallback',
                }
              )
            : next;
        }

        if (event.kind === 'started') {
          return appendActivity(
            {
              ...terminal,
              running: true,
              started: true,
              pid: event.pid ?? terminal.pid,
              status: 'green',
              updatedAt: 'running',
              statusReason: 'Codex process started',
              idleMs: 0,
              lastOutputAt: Date.now(),
              lastHeartbeatAt: Date.now(),
              waitingSince: null,
              structuredEventsActive: false,
              lastAgentEvent: null,
              lastAgentEventSource: null,
              lastAgentEventAt: null,
              lastStructuredEventSeq: null,
              structuredEventLog: [],
            },
            {
              kind: 'info',
              label: 'Codex process started',
              detail: event.pid ? `pid ${event.pid}` : undefined,
            }
          );
        }

        if (event.kind === 'heartbeat') {
          const idleMs = event.idle_ms ?? terminal.idleMs ?? 0;
          if (terminal.structuredEventsActive) {
            if (terminal.status === 'yellow') {
              return {
                ...terminal,
                pid: event.pid ?? terminal.pid,
                idleMs,
                lastHeartbeatAt: Date.now(),
              };
            }
            return {
              ...terminal,
              pid: event.pid ?? terminal.pid,
              status: terminal.status === 'red' ? 'red' : 'green',
              updatedAt:
                idleMs >= STALL_AFTER_MS &&
                terminal.lastAgentEvent !== 'stop' &&
                terminal.lastAgentEvent !== 'idle_prompt'
                  ? `quiet ${formatDuration(idleMs)}`
                  : terminal.updatedAt,
              statusReason:
                idleMs >= STALL_AFTER_MS &&
                terminal.lastAgentEvent !== 'stop' &&
                terminal.lastAgentEvent !== 'idle_prompt'
                  ? 'Codex is still running; waiting only changes on explicit Codex-Warp events'
                  : terminal.statusReason,
              idleMs,
              lastHeartbeatAt: Date.now(),
              waitingSince: null,
            };
          }
          const blockedReason = codexBlockedReason(getTerminalOutputTail(event.session_id));
          if (blockedReason) {
            const next = {
              ...terminal,
              pid: event.pid ?? terminal.pid,
              idleMs,
              lastHeartbeatAt: Date.now(),
              status: 'yellow' as AgentStatus,
              updatedAt: blockedReason,
              statusReason: blockedReason,
              waitingSince: terminal.waitingSince ?? Date.now(),
            };
            return terminal.status === 'yellow'
              ? next
              : appendActivity(
                  appendBlock(next, {
                    kind: 'attention',
                    status: 'yellow',
                    title: blockedReason,
                    detail: 'Detected from terminal output fallback',
                  }),
                  {
                    kind: 'attention',
                    label: blockedReason,
                    detail: 'Detected from terminal output fallback',
                  }
                );
          }
          if (terminal.lastAgentEvent === 'stop') {
            return {
              ...terminal,
              pid: event.pid ?? terminal.pid,
              status: terminal.status === 'red' ? 'red' : 'green',
              updatedAt: terminal.updatedAt === 'turn done' ? terminal.updatedAt : 'turn done',
              statusReason: terminal.statusReason || 'Codex completed its turn',
              idleMs,
              lastHeartbeatAt: Date.now(),
              waitingSince: null,
            };
          }
          if (idleMs >= STALL_AFTER_MS) {
            const next = {
              ...terminal,
              pid: event.pid ?? terminal.pid,
              idleMs,
              lastHeartbeatAt: Date.now(),
              status: 'yellow' as AgentStatus,
              updatedAt: `silent ${formatDuration(idleMs)}`,
              statusReason: 'No terminal output; process is still alive',
              waitingSince: terminal.waitingSince,
            };
            return terminal.status === 'yellow'
              ? next
              : appendActivity(
                  appendBlock(next, {
                    kind: 'attention',
                    status: 'yellow',
                    title: 'Silent process',
                    detail: 'No terminal output; process is still alive',
                  }),
                  {
                    kind: 'attention',
                    label: 'Silent process',
                    detail: 'No terminal output; process is still alive',
                  }
                );
          }
          return {
            ...terminal,
            pid: event.pid ?? terminal.pid,
            status: 'green',
            updatedAt: `idle ${formatDuration(idleMs)}`,
            statusReason: 'Process heartbeat is healthy',
            idleMs,
            lastHeartbeatAt: Date.now(),
            waitingSince: null,
          };
        }

        if (event.kind === 'agent_event') {
          const payload = parseCodexCliAgentPayload(event.data);
          if (!payload) return terminal;
          const eventSeq = typeof event.seq === 'number' ? event.seq : null;
          if (
            eventSeq != null &&
            !isNewStructuredEvent(terminal.lastStructuredEventSeq, eventSeq)
          ) {
            return terminal;
          }
          if (payload.event === 'idle_prompt' && terminal.lastAgentEvent === 'stop') {
            return terminal;
          }
          const patch = terminalPatchForCodexEvent(payload);
          const now = Date.now();
          const blockKind = codexBlockKindForStatus(patch.status);
          const activityKind = codexActivityKindForStatus(patch.status);
          const eventSource = codexPayloadEventSource(payload);
          return appendActivity(
            appendBlock(
              {
                ...terminal,
                ...patch,
                running: true,
                started: true,
                structuredEventsActive:
                  terminal.structuredEventsActive || eventSource === 'codex-warp',
                pid: event.pid ?? terminal.pid,
                lastHeartbeatAt: now,
                lastAgentEventSource: eventSource,
                lastAgentEventAt: now,
                lastStructuredEventSeq: maxStructuredEventSeq(
                  terminal.lastStructuredEventSeq,
                  eventSeq
                ),
                structuredEventLog: appendStructuredEventLog(terminal.structuredEventLog, {
                  terminalId: terminal.id,
                  payload,
                  source: eventSource,
                  seq: eventSeq,
                  at: now,
                  status: patch.status ?? terminal.status,
                  detail: patch.statusReason,
                }),
                waitingSince:
                  patch.status === 'yellow' ? (terminal.waitingSince ?? Date.now()) : null,
              },
              {
                kind: blockKind,
                status: patch.status ?? terminal.status,
                title: codexEventBlockTitle(payload, patch),
                detail: codexEventBlockDetail(payload, patch),
                at: now,
              }
            ),
            {
              kind: activityKind,
              label: payload.event ?? 'Codex event',
              detail: patch.statusReason,
            }
          );
        }

        if (event.kind === 'error') {
          const message = `\r\n${event.data ?? 'Codex terminal error'}\r\n`;
          const outputTail = appendTerminalOutput(event.session_id, message);
          return appendActivity(
            appendBlock(
              {
                ...terminal,
                outputTail,
                running: false,
                started: true,
                status: 'red',
                updatedAt: 'error',
                statusReason: event.data ?? 'Codex terminal error',
                lastAgentEvent: terminal.lastAgentEvent,
                lastAgentEventSource: terminal.lastAgentEventSource,
              },
              {
                kind: 'exit',
                status: 'red',
                title: 'Terminal error',
                detail: event.data ?? 'Codex terminal error',
              }
            ),
            {
              kind: 'error',
              label: 'Terminal error',
              detail: event.data ?? 'Codex terminal error',
            }
          );
        }

        if (event.kind === 'exit') {
          const success = event.success === true;
          const suffix =
            event.data ??
            (event.exit_code != null ? `Codex exited with ${event.exit_code}` : 'Codex exited');
          const outputTail = appendTerminalOutput(event.session_id, `\r\n${suffix}\r\n`);
          return appendActivity(
            appendBlock(
              {
                ...terminal,
                outputTail,
                running: false,
                started: true,
                status: success ? 'green' : 'red',
                updatedAt: success ? 'done' : 'failed',
                statusReason: success ? 'Codex exited cleanly' : suffix,
                idleMs: null,
                waitingSince: null,
              },
              {
                kind: 'exit',
                status: success ? 'green' : 'red',
                title: success ? 'Codex exited' : 'Codex failed',
                detail: suffix,
              }
            ),
            {
              kind: success ? 'exit' : 'error',
              label: success ? 'Codex exited' : 'Codex failed',
              detail: suffix,
            }
          );
        }

        return terminal;
      })
    );
  }, []);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let unlisten: (() => void) | null = null;
    void listenToAgentTerminalEvents(handleTerminalEvent).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [handleTerminalEvent]);

  useEffect(() => {
    for (const terminal of terminals) {
      if (!terminal.background || (terminal.status !== 'yellow' && terminal.status !== 'red')) {
        notifiedAttentionRef.current.delete(terminal.id);
        continue;
      }

      const notificationKey = `${terminal.status}:${terminal.statusReason}`;
      if (notifiedAttentionRef.current.get(terminal.id) === notificationKey) continue;
      notifiedAttentionRef.current.set(terminal.id, notificationKey);

      const title =
        terminal.status === 'red' ? 'Codex agent failed' : 'Codex agent needs attention';
      void sendTrayNotification(title, `${terminal.name}: ${terminal.statusReason}`).catch(() => {
        // Notifications are best-effort; sidebar and header attention remain authoritative.
      });
    }
  }, [terminals]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      if (isFormTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (event.shiftKey && key === 'n') {
        event.preventDefault();
        createTerminal();
        return;
      }
      if (event.shiftKey && event.code === 'BracketRight') {
        event.preventDefault();
        selectTerminalByOffset(1);
        return;
      }
      if (event.shiftKey && event.code === 'BracketLeft') {
        event.preventDefault();
        selectTerminalByOffset(-1);
        return;
      }
      if (event.shiftKey && key === 'j') {
        event.preventDefault();
        jumpToAttentionTerminal();
        return;
      }
      if (event.shiftKey && key === 'f') {
        event.preventDefault();
        setTerminalFocusMode((current) => !current);
        return;
      }
      if (key === 'd' && (event.shiftKey || event.altKey)) {
        event.preventDefault();
        splitTerminal(selected?.id ?? '', event.altKey ? 'down' : 'right');
      }
    };
    const onTerminalShortcut = (event: Event) => {
      const detail = (event as CustomEvent<TerminalShortcutEvent>).detail;
      if (detail.action === 'next') selectTerminalByOffset(1);
      else if (detail.action === 'previous') selectTerminalByOffset(-1);
    };

    window.addEventListener('keydown', onKeyDown, true);
    terminalShortcutBus.addEventListener('shortcut', onTerminalShortcut);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      terminalShortcutBus.removeEventListener('shortcut', onTerminalShortcut);
    };
  });

  function createTerminal() {
    const id = `agent-${Date.now()}`;
    const shouldSplit = layout === 'focus' && foregroundTerminals.length >= 1;
    const terminal = createAgentTerminal({
      id,
      index: terminals.length + 1,
      cwd: defaultCwd,
    });
    setTerminals((current) => [...current, { ...terminal, name: `Codex ${current.length + 1}` }]);
    setSelectedId(id);
    if (shouldSplit) setLayout('columns');
  }

  async function launchBatchAgents() {
    const paths = batchRepoPaths
      .map((path) => path.trim())
      .filter((path, index, all) => path && all.indexOf(path) === index)
      .slice(0, 12);
    if (paths.length === 0) return;
    const startedAt = Date.now();
    const prompt = batchPrompt.trim();
    const batchTerminals = paths.map((path, index) =>
      createAgentTerminal({
        id: `agent-${startedAt}-${index}`,
        index: terminals.length + index + 1,
        cwd: path,
        prompt,
        background: batchBackground,
        name: repoProjectName(repoProjects, path) ?? `Codex ${terminals.length + index + 1}`,
      })
    );
    const shouldSplit =
      !batchBackground &&
      layout === 'focus' &&
      foregroundTerminals.length + batchTerminals.length > 1;
    setTerminals((current) => [...current, ...batchTerminals]);
    setSelectedId(batchTerminals[0]?.id ?? selectedId);
    if (shouldSplit) setLayout('columns');
    if (!batchStartImmediately) return;
    for (const terminal of batchTerminals) {
      await startTerminal(terminal.id, { terminalOverride: terminal });
    }
  }

  async function broadcastPromptToAgents() {
    const message = broadcastPrompt.trim();
    if (!message || broadcastTargets.length === 0) return;
    setBroadcastPrompt('');
    for (const terminal of broadcastTargets) {
      await sendPrompt(terminal.id, message);
    }
  }

  function selectTerminalByOffset(offset: number) {
    if (terminals.length === 0) return;
    const candidates = foregroundTerminals.length > 0 ? foregroundTerminals : terminals;
    const currentIndex = Math.max(
      0,
      candidates.findIndex((terminal) => terminal.id === selected?.id)
    );
    const nextIndex = (currentIndex + offset + candidates.length) % candidates.length;
    setSelectedId(candidates[nextIndex]?.id ?? selected?.id ?? '');
  }

  function jumpToAttentionTerminal() {
    const target = nextAttentionTerminal(attentionTerminals, selected?.id ?? null);
    if (!target) return;
    setSelectedId(target.id);
    if (target.background) updateTerminal(target.id, { background: false });
  }

  async function startForegroundTerminals() {
    const startable = foregroundTerminals.filter(isTerminalStartable);
    for (const terminal of startable) {
      await startTerminal(terminal.id);
    }
  }

  async function stopRunningTerminals() {
    const running = terminals.filter((terminal) => terminal.running);
    for (const terminal of running) {
      await stopTerminal(terminal.id);
    }
  }

  async function recoverFilteredAgents() {
    const recoverable = filteredAgentTerminals.filter(isRecoverableTerminal);
    for (const terminal of recoverable) {
      if (terminal.codexSessionId) await resumeTerminal(terminal.id);
      else if (terminal.started) await startTerminal(terminal.id);
    }
  }

  async function stopFilteredAgents() {
    const running = filteredAgentTerminals.filter((terminal) => terminal.running);
    for (const terminal of running) {
      await stopTerminal(terminal.id);
    }
  }

  function duplicateTerminal(id: string) {
    const source = terminals.find((terminal) => terminal.id === id);
    if (!source) return;
    const nextId = `agent-${Date.now()}`;
    const shouldSplit = layout === 'focus' && foregroundTerminals.length >= 1;
    setTerminals((current) => [
      ...current,
      {
        ...terminalFromSaved({
          id: nextId,
          name: `${source.name} copy`,
          cwd: source.cwd,
          prompt: source.prompt,
          model: source.model,
          sandbox: source.sandbox,
          approvalPolicy: source.approvalPolicy,
          size: source.size,
          background: false,
        }),
        updatedAt: 'duplicated',
      },
    ]);
    setSelectedId(nextId);
    if (shouldSplit) setLayout('columns');
  }

  function splitTerminal(id: string, direction: 'right' | 'down') {
    const source = terminals.find((terminal) => terminal.id === id) ?? selected;
    const nextId = `agent-${Date.now()}`;
    const base = source ?? {
      name: `Codex ${terminals.length + 1}`,
      cwd: defaultCwd,
      prompt: '',
      model: '',
      sandbox: 'workspace-write' as const,
      approvalPolicy: 'on-request' as const,
      size: 'compact' as const,
    };

    setTerminals((current) => [
      ...current,
      {
        ...terminalFromSaved({
          id: nextId,
          name: `Codex ${current.length + 1}`,
          cwd: base.cwd,
          prompt: '',
          model: base.model,
          sandbox: base.sandbox,
          approvalPolicy: base.approvalPolicy,
          size: base.size,
          background: false,
        }),
        updatedAt: direction === 'right' ? 'split right' : 'split down',
      },
    ]);
    setSelectedId(nextId);
    setLayout(direction === 'right' ? 'columns' : 'rows');
  }

  function removeTerminal(id: string) {
    const target = terminals.find((terminal) => terminal.id === id);
    if (!target || target.running) return;
    clearTerminalOutput(id);
    const next = terminals.filter((terminal) => terminal.id !== id);
    setTerminals(next);
    setSelectedId((selected) => (selected === id ? (next[0]?.id ?? '') : selected));
  }

  async function restartTerminal(id: string) {
    const terminal = terminals.find((item) => item.id === id);
    if (!terminal || (terminal.running && !isDetachedTerminal(terminal))) return;
    const marker = `\r\n--- Restarting Codex in ${terminal.cwd || '~'} ---\r\n`;
    const outputTail = appendTerminalOutput(id, marker);
    setTerminals((current) =>
      current.map((item) =>
        item.id === id
          ? appendActivity(
              {
                ...item,
                outputTail,
                status: 'white',
                running: false,
                started: false,
                updatedAt: 'restart',
                statusReason: 'Restarting Codex process',
                idleMs: null,
                lastOutputAt: null,
                lastHeartbeatAt: null,
                waitingSince: null,
                structuredEventsActive: false,
                lastAgentEvent: null,
                lastAgentEventSource: null,
                lastAgentEventAt: null,
                lastStructuredEventSeq: null,
                structuredEventLog: [],
                codexSessionId: null,
                transcriptPath: null,
                blocks: [
                  ...appendBlock(item, {
                    kind: 'launch',
                    status: 'white',
                    title: 'Restart',
                    detail: `Restarting in ${item.cwd || '~'}`,
                  }).blocks,
                ],
                pid: null,
              },
              {
                kind: 'info',
                label: 'Restart requested',
                detail: 'Preserved terminal transcript and starting again',
              }
            )
          : item
      )
    );
    await startTerminal(id);
  }

  async function resumeTerminal(id: string) {
    await startTerminal(id, { resume: true });
  }

  async function forkTerminal(id: string) {
    const source = terminals.find((terminal) => terminal.id === id);
    const forkSessionId = source?.codexSessionId?.trim();
    if (!source || !forkSessionId) return;
    const nextId = `agent-${Date.now()}`;
    const shouldSplit = layout === 'focus' && foregroundTerminals.length >= 1;
    const forked = {
      ...terminalFromSaved({
        id: nextId,
        name: `${source.name} fork`,
        cwd: source.cwd,
        prompt: '',
        model: source.model,
        sandbox: source.sandbox,
        approvalPolicy: source.approvalPolicy,
        size: source.size,
        background: false,
      }),
      updatedAt: 'fork',
      statusReason: `Forking ${compactSessionId(forkSessionId)}`,
    };
    setTerminals((current) => [...current, forked]);
    setSelectedId(nextId);
    if (shouldSplit) setLayout('columns');
    await startTerminal(nextId, { forkSessionId, terminalOverride: forked });
  }

  async function launchIndexedSession(session: SessionRow, mode: 'resume' | 'fork') {
    const codexSessionId = session.id.trim();
    if (!codexSessionId) return;
    const nextId = `agent-${Date.now()}`;
    const shouldSplit = layout === 'focus' && foregroundTerminals.length >= 1;
    const sessionTerminal = {
      ...terminalFromSaved({
        id: nextId,
        name: indexedSessionPaneName(session, terminals.length + 1, mode),
        cwd: session.cwd || defaultCwd,
        prompt: '',
        model: session.model_used ?? '',
        sandbox: 'workspace-write',
        approvalPolicy: 'on-request',
        size: 'compact',
        background: false,
      }),
      codexSessionId: mode === 'resume' ? codexSessionId : null,
      transcriptPath: session.jsonl_path,
      updatedAt: mode,
      statusReason:
        mode === 'resume'
          ? `Resuming ${compactSessionId(codexSessionId)}`
          : `Forking ${compactSessionId(codexSessionId)}`,
      activities: [
        {
          id: `${nextId}-indexed-session-${Date.now()}`,
          at: Date.now(),
          kind: 'info' as const,
          label: mode === 'resume' ? 'Indexed session resume' : 'Indexed session fork',
          detail: indexedSessionTitle(session),
        },
      ],
    };
    setTerminals((current) => [...current, sessionTerminal]);
    setSelectedId(nextId);
    if (shouldSplit) setLayout('columns');
    await startTerminal(nextId, {
      resume: mode === 'resume',
      forkSessionId: mode === 'fork' ? codexSessionId : null,
      terminalOverride: sessionTerminal,
    });
  }

  async function startTerminal(
    id: string,
    options: {
      resume?: boolean;
      forkSessionId?: string | null;
      terminalOverride?: AgentTerminal;
    } = {}
  ) {
    const sourceTerminal = options.terminalOverride ?? terminals.find((item) => item.id === id);
    if (!sourceTerminal) return;
    const detached = isDetachedTerminal(sourceTerminal);
    if (sourceTerminal.running && !detached) return;
    const terminal = detached
      ? {
          ...sourceTerminal,
          running: false,
          pid: null,
          updatedAt: 'detached',
          statusReason: 'Recovering a pane whose backend heartbeat stopped',
        }
      : sourceTerminal;
    const resumeSessionId = options.resume ? terminal.codexSessionId?.trim() : null;
    if (options.resume && !resumeSessionId) return;
    const forkSessionId = options.forkSessionId?.trim() || null;
    const launchMode: AgentLaunchMode = forkSessionId
      ? 'fork'
      : options.resume
        ? 'resume'
        : 'start';

    if (!isTauriAvailable()) {
      const outputTail = appendTerminalOutput(
        id,
        '\r\nDesktop runtime is required to start Codex.\r\n'
      );
      updateTerminal(id, {
        outputTail,
        status: 'red',
        updatedAt: 'not run',
        statusReason: 'Desktop runtime is required to start Codex',
      });
      setTerminals((current) =>
        current.map((item) =>
          item.id === id
            ? appendBlock(item, {
                kind: 'exit',
                status: 'red',
                title: 'Launch blocked',
                detail: 'Desktop runtime is required to start Codex',
              })
            : item
        )
      );
      return;
    }

    const startLine =
      getTerminalOutput(id) ||
      `${launchVerb(launchMode)} ${codexLaunchCommand(terminal, { includeEnv: false, resume: launchMode === 'resume', forkSessionId })}\r\n`;
    if (!getTerminalOutput(id)) appendTerminalOutput(id, startLine);
    outputSequences.delete(id);

    updateTerminal(id, {
      prompt: terminal.prompt,
      status: 'green',
      running: true,
      started: true,
      updatedAt: 'starting',
      statusReason: 'Starting Codex process',
      idleMs: 0,
      lastOutputAt: Date.now(),
      lastHeartbeatAt: null,
      waitingSince: null,
      structuredEventsActive: false,
      lastAgentEvent: null,
      lastAgentEventSource: null,
      lastAgentEventAt: null,
      lastStructuredEventSeq: null,
      structuredEventLog: [],
      codexSessionId: launchMode === 'resume' ? terminal.codexSessionId : null,
      transcriptPath: launchMode === 'resume' ? terminal.transcriptPath : null,
      outputTail: startLine.slice(-OUTPUT_TAIL_CHARS),
    });
    setTerminals((current) =>
      current.map((item) =>
        item.id === id
          ? appendBlock(item, {
              kind: 'launch',
              status: 'green',
              title: launchBlockTitle(launchMode),
              detail: codexLaunchCommand(terminal, {
                includeEnv: false,
                resume: launchMode === 'resume',
                forkSessionId,
              }),
            })
          : item
      )
    );

    try {
      const started = await startCodexAgentTerminal({
        sessionId: id,
        cwd: terminal.cwd,
        prompt: terminal.prompt,
        model: terminal.model,
        sandbox: terminal.sandbox,
        approvalPolicy: terminal.approvalPolicy,
        resumeSessionId,
        forkSessionId,
        cols: terminal.size === 'wide' ? 140 : 100,
        rows: terminal.size === 'tall' ? 34 : 24,
      });
      updateTerminal(id, {
        cwd: started.cwd,
        pid: started.pid ?? null,
        status: 'green',
        updatedAt: 'running',
        statusReason: launchStatusReason(launchMode),
      });
    } catch (error) {
      const message = `\r\n${error instanceof Error ? error.message : String(error)}\r\n`;
      const outputTail = appendTerminalOutput(id, message);
      updateTerminal(id, {
        outputTail,
        running: false,
        started: true,
        status: 'red',
        updatedAt: 'failed',
        statusReason: error instanceof Error ? error.message : String(error),
      });
      setTerminals((current) =>
        current.map((item) =>
          item.id === id
            ? appendBlock(item, {
                kind: 'exit',
                status: 'red',
                title: 'Launch failed',
                detail: error instanceof Error ? error.message : String(error),
              })
            : item
        )
      );
    }
  }

  async function stopTerminal(id: string) {
    try {
      await stopCodexAgentTerminal(id);
      updateTerminal(id, { updatedAt: 'stopping', statusReason: 'Sent /exit to Codex process' });
    } catch (error) {
      const outputTail = appendTerminalOutput(
        id,
        `\r\n${error instanceof Error ? error.message : String(error)}\r\n`
      );
      updateTerminal(id, {
        outputTail,
        status: 'red',
        running: false,
        updatedAt: 'stop failed',
        statusReason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function sendInput(id: string, data: string) {
    const terminal = terminals.find((item) => item.id === id);
    if (!terminal?.running) return;
    if (data === '\r' || data === '\n' || data === '\x1b') {
      const label = data === '\x1b' ? 'Escape sent' : 'Input sent';
      setTerminals((current) =>
        current.map((item) =>
          item.id === id
            ? appendActivity(
                {
                  ...item,
                  status: 'green',
                  updatedAt: 'running',
                  statusReason: 'Input sent',
                  waitingSince: null,
                  idleMs: 0,
                  lastAgentEvent:
                    item.lastAgentEvent === 'stop' && item.lastAgentEventSource !== 'codex-warp'
                      ? null
                      : item.lastAgentEvent,
                  lastAgentEventSource:
                    item.lastAgentEvent === 'stop' && item.lastAgentEventSource !== 'codex-warp'
                      ? null
                      : item.lastAgentEventSource,
                },
                { kind: 'input', label }
              )
            : item
        )
      );
    }
    try {
      await sendCodexAgentTerminalInput(id, data);
    } catch (error) {
      const outputTail = appendTerminalOutput(
        id,
        `\r\n${error instanceof Error ? error.message : String(error)}\r\n`
      );
      updateTerminal(id, {
        outputTail,
        status: 'red',
        running: false,
        updatedAt: 'input failed',
        statusReason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function sendPrompt(id: string, prompt: string) {
    const terminal = terminals.find((item) => item.id === id);
    const message = prompt.trim();
    if (!terminal || !message) return;
    const shellCommand = message.startsWith('!');
    if (shellCommand) {
      const command = message.slice(1).trim();
      if (!command) return;
      await runPaneShellCommand(id, terminal, command);
      return;
    }
    if (!terminal.running) {
      if (terminal.started) return;
      await startTerminal(id, {
        terminalOverride: {
          ...terminal,
          prompt: message,
        },
      });
      return;
    }
    const blockTitle = 'Prompt';
    const activityLabel = 'Prompt sent';
    setTerminals((current) =>
      current.map((item) =>
        item.id === id
          ? appendActivity(
              appendBlock(
                {
                  ...item,
                  status: 'green',
                  updatedAt: 'prompt sent',
                  statusReason: 'Prompt sent to Codex',
                  waitingSince: null,
                  idleMs: 0,
                  lastAgentEvent:
                    item.lastAgentEvent === 'stop' && item.lastAgentEventSource !== 'codex-warp'
                      ? null
                      : item.lastAgentEvent,
                  lastAgentEventSource:
                    item.lastAgentEvent === 'stop' && item.lastAgentEventSource !== 'codex-warp'
                      ? null
                      : item.lastAgentEventSource,
                },
                {
                  kind: 'prompt',
                  status: 'green',
                  title: blockTitle,
                  detail: message,
                }
              ),
              { kind: 'input', label: activityLabel, detail: truncateText(message, 120) }
            )
          : item
      )
    );
    try {
      await sendCodexAgentTerminalInput(id, `${message}\r`);
    } catch (error) {
      const outputTail = appendTerminalOutput(
        id,
        `\r\n${error instanceof Error ? error.message : String(error)}\r\n`
      );
      updateTerminal(id, {
        outputTail,
        status: 'red',
        running: false,
        updatedAt: 'input failed',
        statusReason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function runPaneShellCommand(id: string, terminal: AgentTerminal, command: string) {
    const startedAt = Date.now();
    const blockId = `${id}-shell-${startedAt}`;
    const startOutput = `\r\n$ ${command}\r\n`;
    const outputTail = appendTerminalOutput(id, startOutput);
    setTerminals((current) =>
      current.map((item) =>
        item.id === id
          ? appendActivity(
              appendBlock(
                {
                  ...item,
                  outputTail,
                  status: 'green',
                  updatedAt: 'shell running',
                  statusReason: 'Running local shell command',
                },
                {
                  kind: 'shell',
                  status: 'green',
                  title: 'Shell command',
                  detail: command,
                  cwd: terminal.cwd,
                  id: blockId,
                  at: startedAt,
                }
              ),
              { kind: 'input', label: 'Shell command started', detail: truncateText(command, 120) }
            )
          : item
      )
    );

    if (!isTauriAvailable()) {
      const message = 'Desktop runtime is required to run shell commands';
      const nextTail = appendTerminalOutput(id, `${message}\r\n`);
      setTerminals((current) =>
        current.map((item) =>
          item.id === id
            ? appendActivity(
                updateAgentBlock(
                  {
                    ...item,
                    outputTail: nextTail,
                    status: 'red',
                    updatedAt: 'shell blocked',
                    statusReason: message,
                  },
                  blockId,
                  {
                    status: 'red',
                    title: 'Shell blocked',
                    output: message,
                    durationMs: Date.now() - startedAt,
                  }
                ),
                { kind: 'error', label: 'Shell blocked', detail: message }
              )
            : item
        )
      );
      return;
    }

    try {
      const result = await runAgentTerminalCommand({
        command,
        cwd: terminal.cwd,
        timeoutMs: 120_000,
      });
      const cwdChanged = result.success && result.cwd !== terminal.cwd;
      const output = `${formatShellCommandOutput(result)}${
        cwdChanged ? `[cwd ${result.cwd}]\r\n` : ''
      }`;
      const nextTail = appendTerminalOutput(id, output);
      if (cwdChanged) {
        setDefaultCwd(result.cwd);
      }
      setTerminals((current) =>
        current.map((item) =>
          item.id === id
            ? appendActivity(
                updateAgentBlock(
                  {
                    ...item,
                    cwd: result.success ? result.cwd : item.cwd,
                    outputTail: nextTail,
                    status: result.success ? 'green' : 'red',
                    updatedAt: result.success ? 'shell done' : 'shell failed',
                    statusReason: result.success
                      ? cwdChanged
                        ? `cwd ${compactPathLabel(result.cwd)}`
                        : `Command exited ${result.exit_code}`
                      : shellCommandFailureReason(result),
                  },
                  blockId,
                  {
                    status: result.success ? 'green' : 'red',
                    title: result.success
                      ? cwdChanged
                        ? 'Working directory changed'
                        : 'Shell complete'
                      : 'Shell failed',
                    output,
                    cwd: result.cwd,
                    exitCode: result.exit_code,
                    durationMs: result.duration_ms,
                  }
                ),
                {
                  kind: result.success ? 'info' : 'error',
                  label: result.success
                    ? cwdChanged
                      ? 'Working directory changed'
                      : 'Shell command complete'
                    : 'Shell command failed',
                  detail: shellCommandBlockDetail(result),
                }
              )
            : item
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextTail = appendTerminalOutput(id, `\r\n${message}\r\n`);
      setTerminals((current) =>
        current.map((item) =>
          item.id === id
            ? appendActivity(
                updateAgentBlock(
                  {
                    ...item,
                    outputTail: nextTail,
                    status: 'red',
                    updatedAt: 'shell failed',
                    statusReason: message,
                  },
                  blockId,
                  {
                    status: 'red',
                    title: 'Shell failed',
                    output: message,
                    durationMs: Date.now() - startedAt,
                  }
                ),
                { kind: 'error', label: 'Shell command failed', detail: message }
              )
            : item
        )
      );
    }
  }

  async function chooseDirectory(id: string) {
    const selectedPath = await pickDirectory('Select Codex working directory');
    if (!selectedPath) return;
    updateTerminal(id, { cwd: selectedPath });
  }

  function clearTerminal(id: string) {
    clearTerminalOutput(id);
    setTerminals((current) =>
      current.map((terminal) =>
        terminal.id === id
          ? appendActivity(
              {
                ...terminal,
                outputTail: '',
              },
              { kind: 'info', label: 'Terminal cleared' }
            )
          : terminal
      )
    );
  }

  async function copyTerminalOutput(id: string) {
    const output = getTerminalOutput(id);
    if (!output) return;
    await copyText(output);
    setTerminals((current) =>
      current.map((terminal) =>
        terminal.id === id
          ? appendActivity(terminal, {
              kind: 'info',
              label: 'Terminal output copied',
              detail: `${output.length.toLocaleString()} chars`,
            })
          : terminal
      )
    );
  }

  async function copyTerminalTranscript(id: string) {
    const terminal = terminals.find((item) => item.id === id);
    if (!terminal) return;
    const transcript = buildTerminalTranscript(terminal, getTerminalOutput(id));
    await copyText(transcript);
    setTerminals((current) =>
      current.map((item) =>
        item.id === id
          ? appendActivity(item, {
              kind: 'info',
              label: 'Session transcript copied',
              detail: `${transcript.length.toLocaleString()} chars`,
            })
          : item
      )
    );
  }

  function downloadTerminalTranscript(id: string) {
    const terminal = terminals.find((item) => item.id === id);
    if (!terminal) return;
    const transcript = buildTerminalTranscript(terminal, getTerminalOutput(id));
    downloadTextFile(
      transcript,
      `${safeFilename(terminal.name)}-${formatFileTimestamp()}.md`,
      'text/markdown'
    );
    setTerminals((current) =>
      current.map((item) =>
        item.id === id
          ? appendActivity(item, {
              kind: 'info',
              label: 'Session transcript downloaded',
              detail: `${transcript.length.toLocaleString()} chars`,
            })
          : item
      )
    );
  }

  async function copyTerminalTranscriptPath(id: string) {
    const terminal = terminals.find((item) => item.id === id);
    const path = terminal?.transcriptPath?.trim();
    if (!terminal || !path) return;
    await copyText(path);
    setTerminals((current) =>
      current.map((item) =>
        item.id === id
          ? appendActivity(item, {
              kind: 'info',
              label: 'Codex rollout path copied',
              detail: path,
            })
          : item
      )
    );
  }

  async function copyTerminalWorkingDirectory(id: string) {
    const terminal = terminals.find((item) => item.id === id);
    const path = terminal?.cwd.trim();
    if (!terminal || !path) return;
    await copyText(path);
    setTerminals((current) =>
      current.map((item) =>
        item.id === id
          ? appendActivity(item, {
              kind: 'info',
              label: 'Working directory copied',
              detail: path,
            })
          : item
      )
    );
  }

  async function revealTerminalWorkingDirectory(id: string) {
    const terminal = terminals.find((item) => item.id === id);
    const path = terminal?.cwd.trim();
    if (!terminal || !path || !isConcreteRepoPath(path)) return;
    try {
      await openInApp('reveal', path);
      setTerminals((current) =>
        current.map((item) =>
          item.id === id
            ? appendActivity(item, {
                kind: 'info',
                label: 'Working directory revealed',
                detail: path,
              })
            : item
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTerminals((current) =>
        current.map((item) =>
          item.id === id
            ? appendActivity(
                {
                  ...item,
                  status: 'red',
                  updatedAt: 'reveal failed',
                  statusReason: message,
                },
                {
                  kind: 'error',
                  label: 'Reveal working directory failed',
                  detail: message,
                }
              )
            : item
        )
      );
    }
  }

  async function revealTerminalTranscriptPath(id: string) {
    const terminal = terminals.find((item) => item.id === id);
    const path = terminal?.transcriptPath?.trim();
    if (!terminal || !path) return;
    try {
      await openInApp('reveal', path);
      setTerminals((current) =>
        current.map((item) =>
          item.id === id
            ? appendActivity(item, {
                kind: 'info',
                label: 'Codex rollout revealed',
                detail: path,
              })
            : item
        )
      );
    } catch (error) {
      setTerminals((current) =>
        current.map((item) =>
          item.id === id
            ? appendActivity(
                {
                  ...item,
                  status: 'red',
                  updatedAt: 'reveal failed',
                  statusReason: error instanceof Error ? error.message : String(error),
                },
                {
                  kind: 'error',
                  label: 'Reveal rollout failed',
                  detail: error instanceof Error ? error.message : String(error),
                }
              )
            : item
        )
      );
    }
  }

  async function copyTerminalLaunchCommand(id: string) {
    const terminal = terminals.find((item) => item.id === id);
    if (!terminal) return;
    await copyText(codexLaunchCommand(terminal, { resume: Boolean(terminal.codexSessionId) }));
    setTerminals((current) =>
      current.map((item) =>
        item.id === id
          ? appendActivity(item, {
              kind: 'info',
              label: 'Launch command copied',
              detail: 'Codex argv and Warp event env copied',
            })
          : item
      )
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#07080a] pt-16 text-slate-100">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--cv-line)] px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-cyan-300/18 bg-cyan-300/[0.055] text-cyan-100">
            <Bot size={16} />
          </span>
          <div>
            <h1 className="text-base font-semibold text-slate-100">Codex Agents</h1>
            <p className="text-xs text-slate-500">
              {foregroundTerminals.length} foreground ·{' '}
              {terminals.length - foregroundTerminals.length} background
              {backgroundAttentionCount > 0 ? ` · ${backgroundAttentionCount} bg attention` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-end gap-2">
          {repoProjects.length > 0 && (
            <select
              value={
                repoProjects.some((project) => project.repo_path === defaultCwd) ? defaultCwd : ''
              }
              onChange={(event) => {
                if (event.target.value) setDefaultCwd(event.target.value);
              }}
              className="hidden h-8 max-w-52 rounded-md border border-white/[0.07] bg-black/20 px-2 text-xs text-slate-300 outline-none hover:bg-white/[0.035] focus:border-cyan-300/30 xl:block"
              aria-label="Default repository for new Codex agents"
              title="Default repository for new Codex agents"
            >
              <option value="">Default repo</option>
              {repoProjects.slice(0, 12).map((project) => (
                <option key={project.id} value={project.repo_path}>
                  {project.display_name}
                </option>
              ))}
            </select>
          )}
          {attentionTerminals.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              onClick={jumpToAttentionTerminal}
              className="h-8 gap-2 border border-amber-300/20 bg-amber-300/[0.07] px-3 text-xs text-amber-100 hover:bg-amber-300/[0.12]"
              title="Cycle agents needing attention"
            >
              <span className="h-2 w-2 rounded-full bg-amber-300" />
              Attention {attentionTerminals.length}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => void startForegroundTerminals()}
            disabled={!foregroundTerminals.some(isTerminalStartable)}
            className="h-8 gap-2 border border-emerald-300/20 bg-emerald-300/[0.06] px-3 text-xs text-emerald-100 hover:bg-emerald-300/[0.1] disabled:opacity-35"
            title="Start all foreground agents"
          >
            <Play size={14} />
            Start fg
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void stopRunningTerminals()}
            disabled={runningTerminals.length === 0}
            className="h-8 gap-2 border border-red-300/18 bg-red-300/[0.055] px-3 text-xs text-red-100 hover:bg-red-300/[0.09] disabled:opacity-35"
            title="Stop all running agents"
          >
            <Square size={14} />
            Stop all
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-pressed={terminalFocusMode}
            onClick={() => setTerminalFocusMode((current) => !current)}
            disabled={!selected}
            className={cn(
              'h-8 gap-2 border px-3 text-xs disabled:opacity-35',
              terminalFocusMode
                ? 'border-cyan-300/24 bg-cyan-300/[0.09] text-cyan-100 hover:bg-cyan-300/[0.13]'
                : 'border-white/[0.07] bg-black/15 text-slate-300 hover:bg-white/[0.04]'
            )}
            title="Focus selected terminal"
          >
            {terminalFocusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            Focus
          </Button>
          <LayoutSwitcher value={layout} onChange={setLayout} />
          <Button
            type="button"
            onClick={createTerminal}
            className="h-8 gap-2 border border-cyan-300/20 bg-cyan-300/[0.08] px-3 text-xs text-cyan-100 hover:bg-cyan-300/[0.12]"
          >
            <Plus size={14} />
            Codex agent
          </Button>
        </div>
      </header>

      <div
        className={cn(
          'grid min-h-0 flex-1 grid-cols-1 overflow-hidden',
          !terminalFocusMode && 'lg:grid-cols-[240px_minmax(0,1fr)_300px]'
        )}
      >
        {!terminalFocusMode && (
          <aside className="min-h-0 overflow-y-auto border-r border-[var(--cv-line)] bg-[#090b0f] p-3">
            {repoProjects.length > 0 && (
              <BatchLaunchPanel
                repoProjects={repoProjects}
                selectedPaths={batchRepoPaths}
                prompt={batchPrompt}
                startImmediately={batchStartImmediately}
                background={batchBackground}
                onSelectedPathsChange={setBatchRepoPaths}
                onPromptChange={setBatchPrompt}
                onStartImmediatelyChange={setBatchStartImmediately}
                onBackgroundChange={setBatchBackground}
                onLaunch={() => void launchBatchAgents()}
              />
            )}
            <BroadcastPromptPanel
              prompt={broadcastPrompt}
              scope={broadcastScope}
              targetCount={broadcastTargets.length}
              onPromptChange={setBroadcastPrompt}
              onScopeChange={setBroadcastScope}
              onBroadcast={() => void broadcastPromptToAgents()}
            />
            <AgentSidebarList
              terminals={terminals}
              filteredTerminals={filteredAgentTerminals}
              selectedId={selected?.id ?? ''}
              filter={agentListFilter}
              repoStatusByPath={repoStatusByPath}
              resourceSamplesByPid={resourceSamplesByPid}
              onFilterChange={setAgentListFilter}
              onSelect={(terminal) => {
                setSelectedId(terminal.id);
                if (terminal.background) updateTerminal(terminal.id, { background: false });
              }}
              onRecover={() => void recoverFilteredAgents()}
              onStop={() => void stopFilteredAgents()}
            />
            {recentCodexSessions.length > 0 && (
              <RecentCodexSessions
                sessions={recentCodexSessions}
                onResume={(session) => void launchIndexedSession(session, 'resume')}
                onFork={(session) => void launchIndexedSession(session, 'fork')}
              />
            )}
          </aside>
        )}

        <main className={cn('min-h-0 overflow-hidden', terminalFocusMode ? 'p-2' : 'p-4')}>
          {!selected ? (
            <div className="flex h-full min-h-[360px] items-center justify-center rounded-md border border-dashed border-white/[0.09] bg-white/[0.018]">
              <Button
                type="button"
                onClick={createTerminal}
                className="h-9 gap-2 border border-cyan-300/20 bg-cyan-300/[0.08] px-3 text-xs text-cyan-100 hover:bg-cyan-300/[0.12]"
              >
                <Plus size={14} />
                Codex agent
              </Button>
            </div>
          ) : (
            <AgentWorkspace
              layout={layout}
              terminals={visibleTerminals}
              selectedId={selected.id}
              repoStatusByPath={repoStatusByPath}
              resourceSamplesByPid={resourceSamplesByPid}
              onSelect={setSelectedId}
              onUpdate={updateTerminal}
              onStart={startTerminal}
              onStop={stopTerminal}
              onRestart={restartTerminal}
              onResume={resumeTerminal}
              onFork={forkTerminal}
              onDuplicate={duplicateTerminal}
              onSplit={splitTerminal}
              onRemove={removeTerminal}
              onClear={clearTerminal}
              onCopyOutput={copyTerminalOutput}
              onCopyTranscript={copyTerminalTranscript}
              onDownloadTranscript={downloadTerminalTranscript}
              onCopyTranscriptPath={copyTerminalTranscriptPath}
              onRevealTranscriptPath={revealTerminalTranscriptPath}
              onCopyWorkingDirectory={copyTerminalWorkingDirectory}
              onRevealWorkingDirectory={revealTerminalWorkingDirectory}
              onCopyLaunchCommand={copyTerminalLaunchCommand}
              onChooseDirectory={chooseDirectory}
              onInput={sendInput}
              onPromptSubmit={sendPrompt}
            />
          )}
        </main>

        {!terminalFocusMode && (
          <aside className="hidden min-h-0 overflow-y-auto border-l border-[var(--cv-line)] bg-[#090b0f] p-4 lg:block">
            {selected ? (
              <Inspector
                terminal={selected}
                codexPluginStatus={codexPluginStatus}
                codexPluginBusy={codexPluginBusy}
                repoProjects={repoProjects}
                repoStatus={repoStatusByPath[selected.cwd] ?? null}
                resourceSample={resourceSampleForTerminal(selected, resourceSamplesByPid)}
                repoStatusLoading={repoStatusLoadingPaths.has(selected.cwd)}
                onUpdate={(patch) => updateTerminal(selected.id, patch)}
                onStart={() => startTerminal(selected.id)}
                onStop={() => stopTerminal(selected.id)}
                onRestart={() => restartTerminal(selected.id)}
                onResume={() => resumeTerminal(selected.id)}
                onFork={() => forkTerminal(selected.id)}
                onDuplicate={() => duplicateTerminal(selected.id)}
                onSplit={(direction) => splitTerminal(selected.id, direction)}
                onRemove={() => removeTerminal(selected.id)}
                onChooseDirectory={() => chooseDirectory(selected.id)}
                onCopyLaunchCommand={() => copyTerminalLaunchCommand(selected.id)}
                onCopyTranscriptPath={() => copyTerminalTranscriptPath(selected.id)}
                onRevealTranscriptPath={() => revealTerminalTranscriptPath(selected.id)}
                onCopyWorkingDirectory={() => copyTerminalWorkingDirectory(selected.id)}
                onRevealWorkingDirectory={() => revealTerminalWorkingDirectory(selected.id)}
                onRefreshRepoStatus={() => refreshRepoStatus(selected.cwd, true)}
                onInstallCodexWarp={installCodexWarp}
                onRefreshCodexWarp={refreshCodexPluginStatus}
              />
            ) : null}
          </aside>
        )}
      </div>
    </div>
  );
}

function LayoutSwitcher({
  value,
  onChange,
}: {
  value: AgentLayout;
  onChange: (layout: AgentLayout) => void;
}) {
  const options: Array<{ value: AgentLayout; label: string; icon: typeof Maximize2 }> = [
    { value: 'focus', label: 'Focus', icon: Maximize2 },
    { value: 'columns', label: 'Columns', icon: ArrowDownToLine },
    { value: 'rows', label: 'Rows', icon: ArrowUpFromLine },
    { value: 'grid', label: 'Grid', icon: Minimize2 },
  ];

  return (
    <div className="hidden rounded-md border border-white/[0.07] bg-black/20 p-0.5 md:flex">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            title={option.label}
            className={cn(
              'flex h-7 min-w-8 items-center justify-center rounded px-2 text-[11px] text-slate-500 transition-colors',
              value === option.value
                ? 'bg-cyan-300/[0.09] text-cyan-100'
                : 'hover:bg-white/[0.04] hover:text-slate-200'
            )}
          >
            <Icon size={13} />
            <span className="ml-1 hidden xl:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function BatchLaunchPanel({
  repoProjects,
  selectedPaths,
  prompt,
  startImmediately,
  background,
  onSelectedPathsChange,
  onPromptChange,
  onStartImmediatelyChange,
  onBackgroundChange,
  onLaunch,
}: {
  repoProjects: RepoProject[];
  selectedPaths: string[];
  prompt: string;
  startImmediately: boolean;
  background: boolean;
  onSelectedPathsChange: (paths: string[]) => void;
  onPromptChange: (prompt: string) => void;
  onStartImmediatelyChange: (enabled: boolean) => void;
  onBackgroundChange: (enabled: boolean) => void;
  onLaunch: () => void;
}) {
  const visibleProjects = repoProjects.slice(0, 12);
  const selectedSet = new Set(selectedPaths);
  const selectedCount = visibleProjects.filter((project) =>
    selectedSet.has(project.repo_path)
  ).length;

  function togglePath(path: string) {
    onSelectedPathsChange(
      selectedSet.has(path)
        ? selectedPaths.filter((selectedPath) => selectedPath !== path)
        : [...selectedPaths, path]
    );
  }

  return (
    <div className="mb-4 border-b border-white/[0.06] pb-3">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          Batch
        </div>
        <div className="font-mono text-[10px] text-slate-700">{selectedCount}/12</div>
      </div>
      <div className="space-y-1.5">
        {visibleProjects.map((project) => {
          const selected = selectedSet.has(project.repo_path);
          return (
            <button
              key={project.id}
              type="button"
              onClick={() => togglePath(project.repo_path)}
              className={cn(
                'flex h-8 w-full min-w-0 items-center gap-2 rounded-md border px-2 text-left text-[11px]',
                selected
                  ? 'border-cyan-300/18 bg-cyan-300/[0.06] text-cyan-100'
                  : 'border-white/[0.055] bg-white/[0.014] text-slate-500 hover:bg-white/[0.035] hover:text-slate-200'
              )}
              title={project.repo_path}
            >
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  selected ? 'bg-cyan-300' : 'bg-slate-700'
                )}
              />
              <span className="min-w-0 flex-1 truncate">{project.display_name}</span>
            </button>
          );
        })}
      </div>
      <select
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        className="mt-2 h-8 w-full rounded-md border border-white/[0.07] bg-black/20 px-2 text-[11px] text-slate-300 outline-none focus:border-cyan-300/30"
        aria-label="Batch prompt preset"
      >
        {PROMPT_PRESETS.map((preset) => (
          <option key={preset.label} value={preset.prompt}>
            {preset.label}
          </option>
        ))}
      </select>
      <textarea
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        className="mt-2 min-h-20 w-full resize-y rounded-md border border-white/[0.07] bg-black/20 px-2 py-2 font-mono text-[11px] leading-4 text-slate-300 outline-none placeholder:text-slate-700 focus:border-cyan-300/30"
        placeholder="Initial prompt"
      />
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <label className="flex h-8 items-center gap-2 rounded-md border border-white/[0.06] bg-black/15 px-2 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={startImmediately}
            onChange={(event) => onStartImmediatelyChange(event.target.checked)}
            className="h-3 w-3 accent-cyan-300"
          />
          Start
        </label>
        <label className="flex h-8 items-center gap-2 rounded-md border border-white/[0.06] bg-black/15 px-2 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={background}
            onChange={(event) => onBackgroundChange(event.target.checked)}
            className="h-3 w-3 accent-cyan-300"
          />
          Bg
        </label>
      </div>
      <Button
        type="button"
        onClick={onLaunch}
        disabled={selectedCount === 0}
        className="mt-2 h-8 w-full gap-2 border border-cyan-300/20 bg-cyan-300/[0.08] text-xs text-cyan-100 hover:bg-cyan-300/[0.12] disabled:opacity-35"
      >
        {startImmediately ? <Play size={13} /> : <Plus size={13} />}
        Add {selectedCount}
      </Button>
    </div>
  );
}

function BroadcastPromptPanel({
  prompt,
  scope,
  targetCount,
  onPromptChange,
  onScopeChange,
  onBroadcast,
}: {
  prompt: string;
  scope: AgentBroadcastScope;
  targetCount: number;
  onPromptChange: (prompt: string) => void;
  onScopeChange: (scope: AgentBroadcastScope) => void;
  onBroadcast: () => void;
}) {
  return (
    <form
      className="mb-4 border-b border-white/[0.06] pb-3"
      onSubmit={(event) => {
        event.preventDefault();
        onBroadcast();
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          Broadcast
        </div>
        <div className="font-mono text-[10px] text-slate-700">{targetCount} targets</div>
      </div>
      <select
        value={scope}
        onChange={(event) => onScopeChange(event.target.value as AgentBroadcastScope)}
        className="h-8 w-full rounded-md border border-white/[0.07] bg-black/20 px-2 text-[11px] text-slate-300 outline-none focus:border-cyan-300/30"
        aria-label="Broadcast prompt target"
      >
        <option value="foreground">Running foreground</option>
        <option value="attention">Running attention</option>
        <option value="all">All running</option>
      </select>
      <textarea
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        className="mt-2 min-h-16 w-full resize-y rounded-md border border-white/[0.07] bg-black/20 px-2 py-2 font-mono text-[11px] leading-4 text-slate-300 outline-none placeholder:text-slate-700 focus:border-cyan-300/30"
        placeholder="Prompt for selected agents"
      />
      <Button
        type="submit"
        disabled={targetCount === 0 || !prompt.trim()}
        className="mt-2 h-8 w-full gap-2 border border-emerald-300/20 bg-emerald-300/[0.07] text-xs text-emerald-100 hover:bg-emerald-300/[0.11] disabled:opacity-35"
      >
        <SendHorizontal size={13} />
        Send to {targetCount}
      </Button>
    </form>
  );
}

function AgentSidebarList({
  terminals,
  filteredTerminals,
  selectedId,
  filter,
  repoStatusByPath,
  resourceSamplesByPid,
  onFilterChange,
  onSelect,
  onRecover,
  onStop,
}: {
  terminals: AgentTerminal[];
  filteredTerminals: AgentTerminal[];
  selectedId: string;
  filter: AgentListFilter;
  repoStatusByPath: RepoStatusByPath;
  resourceSamplesByPid: AgentResourceSamplesByPid;
  onFilterChange: (filter: AgentListFilter) => void;
  onSelect: (terminal: AgentTerminal) => void;
  onRecover: () => void;
  onStop: () => void;
}) {
  const runningCount = terminals.filter((terminal) => terminal.running).length;
  const attentionCount = terminals.filter(isAttentionTerminal).length;
  const backgroundCount = terminals.filter((terminal) => terminal.background).length;
  const recoverableCount = terminals.filter(isRecoverableTerminal).length;
  const filteredRunningCount = filteredTerminals.filter((terminal) => terminal.running).length;
  const filteredRecoverableCount = filteredTerminals.filter(isRecoverableTerminal).length;
  const filters: Array<{ value: AgentListFilter; label: string; count: number }> = [
    { value: 'all', label: 'All', count: terminals.length },
    { value: 'running', label: 'Run', count: runningCount },
    { value: 'attention', label: 'Alert', count: attentionCount },
    { value: 'background', label: 'Bg', count: backgroundCount },
    { value: 'recoverable', label: 'Recover', count: recoverableCount },
  ];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          Active agents
        </div>
        <div className="font-mono text-[10px] text-slate-700">
          {filteredTerminals.length}/{terminals.length}
        </div>
      </div>
      <div className="mb-2 grid grid-cols-5 gap-1">
        {filters.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onFilterChange(item.value)}
            className={cn(
              'min-w-0 rounded border px-1 py-1 text-[10px] text-slate-500 transition-colors',
              filter === item.value
                ? 'border-cyan-300/18 bg-cyan-300/[0.06] text-cyan-100/85'
                : 'border-white/[0.055] bg-black/15 hover:bg-white/[0.035] hover:text-slate-200'
            )}
            title={`${item.label}: ${item.count}`}
          >
            <span className="block truncate">{item.label}</span>
            <span className="block font-mono text-[9px] opacity-70">{item.count}</span>
          </button>
        ))}
      </div>
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={onRecover}
          disabled={filteredRecoverableCount === 0}
          className="inline-flex h-7 items-center justify-center gap-1 rounded border border-emerald-300/14 bg-emerald-300/[0.055] px-2 text-[10px] text-emerald-100/80 hover:bg-emerald-300/[0.09] disabled:cursor-not-allowed disabled:opacity-35"
          title="Resume captured sessions or start stopped agents in the current filter"
        >
          <RotateCcw size={11} />
          Recover {filteredRecoverableCount || ''}
        </button>
        <button
          type="button"
          onClick={onStop}
          disabled={filteredRunningCount === 0}
          className="inline-flex h-7 items-center justify-center gap-1 rounded border border-red-300/14 bg-red-300/[0.045] px-2 text-[10px] text-red-100/80 hover:bg-red-300/[0.08] disabled:cursor-not-allowed disabled:opacity-35"
          title="Stop running agents in the current filter"
        >
          <Square size={11} />
          Stop {filteredRunningCount || ''}
        </button>
      </div>
      <div className="space-y-1">
        {filteredTerminals.length === 0 ? (
          <div className="rounded-md border border-dashed border-white/[0.07] px-2 py-3 text-center text-[11px] text-slate-600">
            No agents in this view
          </div>
        ) : (
          filteredTerminals.map((terminal) => (
            <AgentSidebarItem
              key={terminal.id}
              terminal={terminal}
              active={terminal.id === selectedId}
              repoStatus={repoStatusByPath[terminal.cwd] ?? null}
              resourceSample={resourceSampleForTerminal(terminal, resourceSamplesByPid)}
              onSelect={() => onSelect(terminal)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function AgentSidebarItem({
  terminal,
  active,
  repoStatus,
  resourceSample,
  onSelect,
}: {
  terminal: AgentTerminal;
  active: boolean;
  repoStatus: RepoProjectGitStatus | null;
  resourceSample: ResourceProcessSample | null;
  onSelect: () => void;
}) {
  const needsAttention = isAttentionTerminal(terminal);
  const lifecycleLabel = agentLifecycleLabel(terminal);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors',
        active
          ? 'border-cyan-300/24 bg-cyan-300/[0.07]'
          : needsAttention
            ? terminal.status === 'red'
              ? 'border-red-300/20 bg-red-300/[0.045] hover:bg-red-300/[0.07]'
              : 'border-amber-300/20 bg-amber-300/[0.045] hover:bg-amber-300/[0.07]'
            : 'border-transparent hover:border-white/[0.07] hover:bg-white/[0.035]'
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', statusMeta[terminal.status].dot)} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium text-slate-200">{terminal.name}</span>
          {terminal.background && (
            <span className="shrink-0 rounded bg-white/[0.04] px-1 font-mono text-[9px] text-slate-600">
              bg
            </span>
          )}
          <span
            className={cn(
              'shrink-0 rounded border px-1 font-mono text-[9px]',
              agentLifecycleClass(terminal)
            )}
          >
            {lifecycleLabel}
          </span>
          {isRecoverableTerminal(terminal) && (
            <span className="shrink-0 rounded bg-emerald-300/[0.07] px-1 font-mono text-[9px] text-emerald-100/65">
              rec
            </span>
          )}
        </span>
        <span className="block truncate font-mono text-[10px] text-slate-600">
          {terminalSidebarLabel(terminal, repoStatus)}
        </span>
        {resourceSample && (
          <span className="mt-0.5 block truncate font-mono text-[10px] text-cyan-100/55">
            {resourceSampleLabel(resourceSample)}
          </span>
        )}
      </span>
    </button>
  );
}

function RecentCodexSessions({
  sessions,
  onResume,
  onFork,
}: {
  sessions: SessionRow[];
  onResume: (session: SessionRow) => void;
  onFork: (session: SessionRow) => void;
}) {
  const [query, setQuery] = useState('');
  const filteredSessions = useMemo(
    () => filterIndexedSessions(sessions, query).slice(0, query.trim() ? 12 : 8),
    [query, sessions]
  );
  const hasQuery = query.trim().length > 0;

  return (
    <div className="mt-5 border-t border-white/[0.06] pt-3">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          Recent Codex sessions
        </div>
        <div className="font-mono text-[10px] text-slate-700">
          {filteredSessions.length}/{sessions.length}
        </div>
      </div>
      <div className="mb-2 flex h-8 items-center gap-1.5 rounded-md border border-white/[0.07] bg-black/20 px-2">
        <Search size={12} className="shrink-0 text-slate-600" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[11px] text-slate-300 outline-none placeholder:text-slate-700"
          placeholder="Search sessions"
          aria-label="Search recent Codex sessions"
        />
        {hasQuery && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="shrink-0 rounded p-0.5 text-slate-600 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label="Clear session search"
            title="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {filteredSessions.map((session) => (
          <div
            key={session.id}
            className="rounded-md border border-white/[0.06] bg-white/[0.018] px-2 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-slate-300" title={session.id}>
                {indexedSessionTitle(session)}
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-slate-600">
                {indexedSessionMeta(session)}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onResume(session)}
                className="inline-flex h-7 items-center justify-center gap-1 rounded border border-cyan-300/12 bg-cyan-300/[0.045] px-2 text-[10px] text-cyan-100/80 hover:bg-cyan-300/[0.08]"
                title="Resume indexed Codex session"
              >
                <History size={11} />
                Resume
              </button>
              <button
                type="button"
                onClick={() => onFork(session)}
                className="inline-flex h-7 items-center justify-center gap-1 rounded border border-white/[0.07] bg-black/15 px-2 text-[10px] text-slate-300 hover:bg-white/[0.04]"
                title="Fork indexed Codex session"
              >
                <GitBranch size={11} />
                Fork
              </button>
            </div>
          </div>
        ))}
        {filteredSessions.length === 0 && (
          <div className="rounded-md border border-white/[0.06] bg-white/[0.018] px-2 py-3 text-[11px] text-slate-600">
            No Codex sessions match this search.
          </div>
        )}
      </div>
    </div>
  );
}

function AgentWorkspace({
  layout,
  terminals,
  selectedId,
  repoStatusByPath,
  resourceSamplesByPid,
  onSelect,
  onUpdate,
  onStart,
  onStop,
  onRestart,
  onResume,
  onFork,
  onDuplicate,
  onSplit,
  onRemove,
  onClear,
  onCopyOutput,
  onCopyTranscript,
  onDownloadTranscript,
  onCopyTranscriptPath,
  onRevealTranscriptPath,
  onCopyWorkingDirectory,
  onRevealWorkingDirectory,
  onCopyLaunchCommand,
  onChooseDirectory,
  onInput,
  onPromptSubmit,
}: {
  layout: AgentLayout;
  terminals: AgentTerminal[];
  selectedId: string;
  repoStatusByPath: RepoStatusByPath;
  resourceSamplesByPid: AgentResourceSamplesByPid;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<AgentTerminal>) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onResume: (id: string) => void;
  onFork: (id: string) => void;
  onDuplicate: (id: string) => void;
  onSplit: (id: string, direction: 'right' | 'down') => void;
  onRemove: (id: string) => void;
  onClear: (id: string) => void;
  onCopyOutput: (id: string) => void;
  onCopyTranscript: (id: string) => void;
  onDownloadTranscript: (id: string) => void;
  onCopyTranscriptPath: (id: string) => void;
  onRevealTranscriptPath: (id: string) => void;
  onCopyWorkingDirectory: (id: string) => void;
  onRevealWorkingDirectory: (id: string) => void;
  onCopyLaunchCommand: (id: string) => void;
  onChooseDirectory: (id: string) => void;
  onInput: (id: string, data: string) => void;
  onPromptSubmit: (id: string, prompt: string) => void;
}) {
  const denseTerminalWorkspace = terminals.length >= XTERM_DENSE_PANE_COUNT;

  if (terminals.length === 0) {
    return (
      <div className="flex h-full min-h-[360px] items-center justify-center rounded-md border border-dashed border-white/[0.09] bg-white/[0.018] text-xs text-slate-500">
        No foreground agents
      </div>
    );
  }

  if (layout === 'grid' && terminals.length > 1) {
    return (
      <div
        className="grid h-full min-h-0 gap-3 overflow-auto"
        style={{
          gridAutoRows: 'minmax(340px, 1fr)',
          gridTemplateColumns: `repeat(${Math.min(terminals.length, 2)}, minmax(0, 1fr))`,
        }}
      >
        {terminals.map((terminal) => (
          <TerminalPane
            key={terminal.id}
            terminal={terminal}
            denseWorkspace={denseTerminalWorkspace}
            repoStatus={repoStatusByPath[terminal.cwd] ?? null}
            resourceSample={resourceSampleForTerminal(terminal, resourceSamplesByPid)}
            selected={terminal.id === selectedId}
            onSelect={() => onSelect(terminal.id)}
            onUpdate={(patch) => onUpdate(terminal.id, patch)}
            onStart={() => onStart(terminal.id)}
            onStop={() => onStop(terminal.id)}
            onRestart={() => onRestart(terminal.id)}
            onResume={() => onResume(terminal.id)}
            onFork={() => onFork(terminal.id)}
            onDuplicate={() => onDuplicate(terminal.id)}
            onSplit={(direction) => onSplit(terminal.id, direction)}
            onRemove={() => onRemove(terminal.id)}
            onClear={() => onClear(terminal.id)}
            onCopyOutput={() => onCopyOutput(terminal.id)}
            onCopyTranscript={() => onCopyTranscript(terminal.id)}
            onDownloadTranscript={() => onDownloadTranscript(terminal.id)}
            onCopyTranscriptPath={() => onCopyTranscriptPath(terminal.id)}
            onRevealTranscriptPath={() => onRevealTranscriptPath(terminal.id)}
            onCopyWorkingDirectory={() => onCopyWorkingDirectory(terminal.id)}
            onRevealWorkingDirectory={() => onRevealWorkingDirectory(terminal.id)}
            onCopyLaunchCommand={() => onCopyLaunchCommand(terminal.id)}
            onChooseDirectory={() => onChooseDirectory(terminal.id)}
            onInput={(data) => onInput(terminal.id, data)}
            onPromptSubmit={(prompt) => onPromptSubmit(terminal.id, prompt)}
          />
        ))}
      </div>
    );
  }

  if ((layout === 'columns' || layout === 'rows') && terminals.length > 1) {
    const orientation = layout === 'columns' ? 'horizontal' : 'vertical';
    const paneIds = terminals.map((terminal) => terminal.id).join('-');
    const paneLayoutKey = agentPaneLayoutStorageKey(layout, paneIds);
    return (
      <PanelGroup
        key={`${layout}-${paneIds}`}
        id={`agent-panel-${layout}-${paneIds}`}
        defaultLayout={loadAgentPaneLayout(paneLayoutKey, terminals)}
        onLayoutChanged={(nextLayout) => saveAgentPaneLayout(paneLayoutKey, nextLayout)}
        orientation={orientation}
        className="h-full min-h-0 min-w-0"
      >
        {terminals.map((terminal, index) => (
          <Fragment key={terminal.id}>
            <Panel
              id={terminal.id}
              defaultSize={100 / terminals.length}
              minSize={layout === 'columns' ? 22 : 18}
              className="min-h-0 min-w-0"
            >
              <TerminalPane
                terminal={terminal}
                denseWorkspace={denseTerminalWorkspace}
                repoStatus={repoStatusByPath[terminal.cwd] ?? null}
                resourceSample={resourceSampleForTerminal(terminal, resourceSamplesByPid)}
                selected={terminal.id === selectedId}
                onSelect={() => onSelect(terminal.id)}
                onUpdate={(patch) => onUpdate(terminal.id, patch)}
                onStart={() => onStart(terminal.id)}
                onStop={() => onStop(terminal.id)}
                onRestart={() => onRestart(terminal.id)}
                onResume={() => onResume(terminal.id)}
                onFork={() => onFork(terminal.id)}
                onDuplicate={() => onDuplicate(terminal.id)}
                onSplit={(direction) => onSplit(terminal.id, direction)}
                onRemove={() => onRemove(terminal.id)}
                onClear={() => onClear(terminal.id)}
                onCopyOutput={() => onCopyOutput(terminal.id)}
                onCopyTranscript={() => onCopyTranscript(terminal.id)}
                onDownloadTranscript={() => onDownloadTranscript(terminal.id)}
                onCopyTranscriptPath={() => onCopyTranscriptPath(terminal.id)}
                onRevealTranscriptPath={() => onRevealTranscriptPath(terminal.id)}
                onCopyWorkingDirectory={() => onCopyWorkingDirectory(terminal.id)}
                onRevealWorkingDirectory={() => onRevealWorkingDirectory(terminal.id)}
                onCopyLaunchCommand={() => onCopyLaunchCommand(terminal.id)}
                onChooseDirectory={() => onChooseDirectory(terminal.id)}
                onInput={(data) => onInput(terminal.id, data)}
                onPromptSubmit={(prompt) => onPromptSubmit(terminal.id, prompt)}
              />
            </Panel>
            {index < terminals.length - 1 && <AgentResizeHandle orientation={orientation} />}
          </Fragment>
        ))}
      </PanelGroup>
    );
  }

  const terminal = terminals[0];
  return (
    <TerminalPane
      key={terminal.id}
      terminal={terminal}
      denseWorkspace={denseTerminalWorkspace}
      repoStatus={repoStatusByPath[terminal.cwd] ?? null}
      resourceSample={resourceSampleForTerminal(terminal, resourceSamplesByPid)}
      selected={terminal.id === selectedId}
      onSelect={() => onSelect(terminal.id)}
      onUpdate={(patch) => onUpdate(terminal.id, patch)}
      onStart={() => onStart(terminal.id)}
      onStop={() => onStop(terminal.id)}
      onRestart={() => onRestart(terminal.id)}
      onResume={() => onResume(terminal.id)}
      onFork={() => onFork(terminal.id)}
      onDuplicate={() => onDuplicate(terminal.id)}
      onSplit={(direction) => onSplit(terminal.id, direction)}
      onRemove={() => onRemove(terminal.id)}
      onClear={() => onClear(terminal.id)}
      onCopyOutput={() => onCopyOutput(terminal.id)}
      onCopyTranscript={() => onCopyTranscript(terminal.id)}
      onDownloadTranscript={() => onDownloadTranscript(terminal.id)}
      onCopyTranscriptPath={() => onCopyTranscriptPath(terminal.id)}
      onRevealTranscriptPath={() => onRevealTranscriptPath(terminal.id)}
      onCopyWorkingDirectory={() => onCopyWorkingDirectory(terminal.id)}
      onRevealWorkingDirectory={() => onRevealWorkingDirectory(terminal.id)}
      onCopyLaunchCommand={() => onCopyLaunchCommand(terminal.id)}
      onChooseDirectory={() => onChooseDirectory(terminal.id)}
      onInput={(data) => onInput(terminal.id, data)}
      onPromptSubmit={(prompt) => onPromptSubmit(terminal.id, prompt)}
    />
  );
}

function AgentResizeHandle({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
  return (
    <PanelResizeHandle
      className={cn(
        'shrink-0 rounded bg-transparent transition-colors hover:bg-cyan-300/20 data-[separator=active]:bg-cyan-300/25',
        orientation === 'horizontal'
          ? 'mx-1 w-1.5 cursor-col-resize'
          : 'my-1 h-1.5 cursor-row-resize'
      )}
    />
  );
}

function TerminalPane({
  terminal,
  denseWorkspace,
  repoStatus,
  resourceSample,
  selected,
  onSelect,
  onUpdate,
  onStart,
  onStop,
  onRestart,
  onResume,
  onFork,
  onDuplicate,
  onSplit,
  onRemove,
  onClear,
  onCopyOutput,
  onCopyTranscript,
  onDownloadTranscript,
  onCopyTranscriptPath,
  onRevealTranscriptPath,
  onCopyWorkingDirectory,
  onRevealWorkingDirectory,
  onCopyLaunchCommand,
  onChooseDirectory,
  onInput,
  onPromptSubmit,
}: {
  terminal: AgentTerminal;
  denseWorkspace: boolean;
  repoStatus: RepoProjectGitStatus | null;
  resourceSample: ResourceProcessSample | null;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<AgentTerminal>) => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onResume: () => void;
  onFork: () => void;
  onDuplicate: () => void;
  onSplit: (direction: 'right' | 'down') => void;
  onRemove: () => void;
  onClear: () => void;
  onCopyOutput: () => void;
  onCopyTranscript: () => void;
  onDownloadTranscript: () => void;
  onCopyTranscriptPath: () => void;
  onRevealTranscriptPath: () => void;
  onCopyWorkingDirectory: () => void;
  onRevealWorkingDirectory: () => void;
  onCopyLaunchCommand: () => void;
  onChooseDirectory: () => void;
  onInput: (data: string) => void;
  onPromptSubmit: (prompt: string) => void;
}) {
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const composerHistoryIndexRef = useRef<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const composerValue = terminal.composerDraft;
  const composerMode = terminal.composerMode ?? 'prompt';
  const composerHistory = terminal.composerHistory;
  const historyPreview = composerHistory.slice(0, 8);
  const composerRows =
    composerMode === 'shell' ? 1 : Math.min(6, Math.max(1, composerValue.split('\n').length));
  const slashQuery =
    terminal.running && composerMode === 'prompt' && composerValue.startsWith('/')
      ? composerValue.slice(1).trim().toLowerCase()
      : null;
  const slashCommandMatches =
    slashQuery == null
      ? []
      : CODEX_SLASH_COMMANDS.filter((entry) => {
          const haystack = `${entry.command} ${entry.description}`.toLowerCase();
          return haystack.includes(slashQuery);
        }).slice(0, 5);
  const primaryRecovery = primaryRecoveryAction(terminal);
  const detached = isDetachedTerminal(terminal);
  const canResume = Boolean(terminal.codexSessionId && (!terminal.running || detached));
  const canSubmitComposer = !terminal.started || terminal.running;
  const composerPlaceholder =
    composerMode === 'shell'
      ? composerHistory.length > 0
        ? 'Run command · Up for history'
        : 'Run command'
      : terminal.running
        ? composerHistory.length > 0
          ? 'Message Codex · Up for history'
          : 'Message Codex'
        : 'Start Codex';

  function submitComposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = composerValue.trim();
    if (!message || (!terminal.running && terminal.started)) return;
    submitPromptMessage(composerMode === 'shell' ? `!${message}` : message);
  }

  function submitPromptMessage(message: string) {
    onPromptSubmit(message);
    const nextMode = 'prompt';
    onUpdate({
      composerDraft: '',
      composerMode: nextMode,
      composerHistory: [message, ...composerHistory.filter((entry) => entry !== message)].slice(
        0,
        PROMPT_HISTORY_LIMIT
      ),
    });
    composerHistoryIndexRef.current = null;
  }

  function updateComposerDraft(value: string) {
    composerHistoryIndexRef.current = null;
    if (composerMode === 'prompt' && value.startsWith('!')) {
      onUpdate({ composerDraft: value.slice(1), composerMode: 'shell' });
      return;
    }
    onUpdate({ composerDraft: value });
  }

  function restoreComposerHistoryEntry(value: string) {
    if (value.startsWith('!')) {
      onUpdate({ composerDraft: value.slice(1), composerMode: 'shell' });
      return;
    }
    onUpdate({ composerDraft: value, composerMode: 'prompt' });
  }

  function exitShellComposerMode() {
    if (composerMode !== 'shell' || composerValue.length > 0) return false;
    onUpdate({ composerDraft: '', composerMode: 'prompt' });
    return true;
  }

  function recallPromptHistory(direction: 'previous' | 'next') {
    if (composerHistory.length === 0) return;
    const current = composerHistoryIndexRef.current;
    if (direction === 'previous') {
      const next = current == null ? 0 : Math.min(current + 1, composerHistory.length - 1);
      composerHistoryIndexRef.current = next;
      restoreComposerHistoryEntry(composerHistory[next] ?? '');
      return;
    }
    const next = current == null ? null : current - 1;
    if (next == null || next < 0) {
      composerHistoryIndexRef.current = null;
      onUpdate({ composerDraft: '', composerMode: 'prompt' });
      return;
    }
    composerHistoryIndexRef.current = next;
    restoreComposerHistoryEntry(composerHistory[next] ?? '');
  }

  function isComposerAtHistoryBoundary(
    target: HTMLTextAreaElement,
    direction: 'previous' | 'next'
  ): boolean {
    if (target.selectionStart !== target.selectionEnd) return false;
    if (direction === 'previous') {
      return !target.value.slice(0, target.selectionStart).includes('\n');
    }
    return !target.value.slice(target.selectionStart).includes('\n');
  }

  function submitComposerValue() {
    const message = composerValue.trim();
    if (!message || !canSubmitComposer) return;
    submitPromptMessage(composerMode === 'shell' ? `!${message}` : message);
  }

  function loadComposerHistoryEntry(entry: string) {
    composerHistoryIndexRef.current = null;
    restoreComposerHistoryEntry(entry);
    setHistoryOpen(false);
    window.setTimeout(() => composerInputRef.current?.focus(), 0);
  }

  function sendComposerHistoryEntry(entry: string) {
    submitPromptMessage(entry);
    setHistoryOpen(false);
  }

  function loadSlashCommand(command: string) {
    composerHistoryIndexRef.current = null;
    setHistoryOpen(false);
    onUpdate({ composerDraft: command, composerMode: 'prompt' });
    window.setTimeout(() => composerInputRef.current?.focus(), 0);
  }

  function sendSlashCommand(command: string) {
    submitPromptMessage(command);
    setHistoryOpen(false);
  }

  return (
    <section
      data-agent-pane={terminal.id}
      data-agent-selected={selected ? 'true' : 'false'}
      data-agent-name={terminal.name}
      aria-label={`${terminal.name} terminal`}
      className={cn(
        'cv-panel flex h-full min-h-[260px] min-w-0 flex-col overflow-hidden rounded-md',
        statusMeta[terminal.status].terminal,
        selected && 'ring-1 ring-cyan-300/28'
      )}
      onClick={onSelect}
    >
      <div className="cv-terminal-bar h-9 justify-between px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', statusMeta[terminal.status].dot)} />
          <span className="truncate text-xs font-medium text-slate-200">{terminal.name}</span>
          <span className="min-w-0 truncate font-mono text-[10px] text-slate-600">
            {repoContextLabel(terminal, repoStatus)}
          </span>
          <span className={cn('text-[10px]', statusMeta[terminal.status].text)}>
            {terminalStatusLabel(terminal)}
          </span>
          {terminalUpdatedLabel(terminal) && (
            <span className="text-[10px] text-slate-600">{terminalUpdatedLabel(terminal)}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {terminal.running && !detached ? (
            <button
              type="button"
              className="rounded p-1 text-red-300/70 hover:bg-red-300/[0.08] hover:text-red-200"
              aria-label="Stop Codex agent"
              onClick={(event) => {
                event.stopPropagation();
                onStop();
              }}
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              type="button"
              className="rounded p-1 text-emerald-300/70 hover:bg-emerald-300/[0.08] hover:text-emerald-200"
              aria-label={primaryRecovery.label}
              title={primaryRecovery.label}
              onClick={(event) => {
                event.stopPropagation();
                if (primaryRecovery.action === 'resume') onResume();
                else onStart();
              }}
            >
              {primaryRecovery.action === 'resume' ? <History size={14} /> : <Play size={14} />}
            </button>
          )}
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Restart Codex agent"
            title="Restart and keep transcript"
            disabled={terminal.running && !detached}
            onClick={(event) => {
              event.stopPropagation();
              onRestart();
            }}
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 text-cyan-300/65 hover:bg-cyan-300/[0.08] hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Resume Codex session"
            title="Resume captured Codex session"
            disabled={!canResume}
            onClick={(event) => {
              event.stopPropagation();
              onResume();
            }}
          >
            <History size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Fork Codex session"
            title="Fork captured Codex session into a new pane"
            disabled={!terminal.codexSessionId}
            onClick={(event) => {
              event.stopPropagation();
              onFork();
            }}
          >
            <GitBranch size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label="Duplicate terminal"
            onClick={(event) => {
              event.stopPropagation();
              onDuplicate();
            }}
          >
            <Files size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label="Split terminal right"
            onClick={(event) => {
              event.stopPropagation();
              onSplit('right');
            }}
          >
            <Columns2 size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label="Split terminal down"
            onClick={(event) => {
              event.stopPropagation();
              onSplit('down');
            }}
          >
            <Rows2 size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label="Copy working directory"
            title="Copy working directory"
            onClick={(event) => {
              event.stopPropagation();
              onCopyWorkingDirectory();
            }}
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Reveal working directory"
            title="Reveal working directory in Finder"
            disabled={!isConcreteRepoPath(terminal.cwd)}
            onClick={(event) => {
              event.stopPropagation();
              onRevealWorkingDirectory();
            }}
          >
            <FolderOpen size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label="Copy terminal output"
            onClick={(event) => {
              event.stopPropagation();
              onCopyOutput();
            }}
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label="Copy session transcript"
            title="Copy session transcript"
            onClick={(event) => {
              event.stopPropagation();
              onCopyTranscript();
            }}
          >
            <Activity size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label="Download session transcript"
            title="Download session transcript"
            onClick={(event) => {
              event.stopPropagation();
              onDownloadTranscript();
            }}
          >
            <Download size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label="Clear terminal"
            onClick={(event) => {
              event.stopPropagation();
              onClear();
            }}
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label={terminal.background ? 'Restore terminal' : 'Move terminal to background'}
            onClick={(event) => {
              event.stopPropagation();
              onUpdate({ background: !terminal.background });
            }}
          >
            {terminal.background ? <ArrowUpFromLine size={14} /> : <ArrowDownToLine size={14} />}
          </button>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-red-300/[0.08] hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Close terminal"
            disabled={terminal.running}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="border-b border-[var(--cv-line)] px-3 py-2">
        <input
          value={terminal.prompt}
          onChange={(event) => onUpdate({ prompt: event.target.value })}
          className="w-full rounded border border-white/[0.07] bg-black/20 px-2 py-1.5 font-mono text-xs text-slate-300 outline-none focus:border-cyan-300/30"
          aria-label="Initial Codex prompt"
          placeholder="Initial Codex prompt"
          disabled={terminal.running || terminal.started}
        />
        {!terminal.running && !terminal.started && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PROMPT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => onUpdate({ prompt: preset.prompt, updatedAt: preset.label })}
                className="rounded border border-white/[0.07] bg-white/[0.025] px-2 py-1 text-[10px] text-slate-500 hover:border-cyan-300/18 hover:bg-cyan-300/[0.055] hover:text-cyan-100"
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <input
            value={terminal.cwd}
            onChange={(event) => onUpdate({ cwd: event.target.value })}
            className="min-w-0 flex-1 rounded border border-white/[0.07] bg-black/20 px-2 py-1.5 font-mono text-[11px] text-slate-400 outline-none focus:border-cyan-300/30"
            aria-label="Codex working directory"
            placeholder="Working directory"
            disabled={terminal.running || terminal.started}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={onChooseDirectory}
            disabled={terminal.running || terminal.started}
            className="h-8 w-8 shrink-0 border border-white/[0.07] bg-black/15 p-0 text-slate-400 hover:bg-white/[0.04] hover:text-slate-100 disabled:opacity-45"
            title="Choose directory"
          >
            <FolderOpen size={13} />
          </Button>
        </div>
      </div>

      <AgentSessionDossier
        terminal={terminal}
        repoStatus={repoStatus}
        resourceSample={resourceSample}
        onCopyLaunchCommand={onCopyLaunchCommand}
        onCopyTranscriptPath={onCopyTranscriptPath}
        onRevealTranscriptPath={onRevealTranscriptPath}
      />

      {terminal.blocks.length > 0 && (
        <AgentBlockRail
          blocks={terminal.blocks}
          running={terminal.running}
          onCopyBlock={(block) => void copyText(blockCopyText(block))}
          onReplayPrompt={(block) => {
            if (!block.detail) return;
            submitPromptMessage(block.kind === 'shell' ? `!${block.detail}` : block.detail);
          }}
          onSendBlockContext={(block) => submitPromptMessage(shellBlockContextPrompt(block))}
        />
      )}

      <CodexXterm
        id={terminal.id}
        running={terminal.running}
        started={terminal.started}
        selected={selected}
        denseWorkspace={denseWorkspace}
        onStart={onStart}
        onInput={onInput}
        onClear={onClear}
        onCopyOutput={onCopyOutput}
        onSendContext={(contextPrompt) => submitPromptMessage(contextPrompt)}
        onResize={(cols, rows) => {
          if (terminal.running) void resizeCodexAgentTerminal(terminal.id, cols, rows);
        }}
      />

      <form
        onSubmit={submitComposer}
        className="flex shrink-0 flex-col gap-2 border-t border-[var(--cv-line)] bg-black/20 px-3 py-2"
      >
        {terminal.running && terminal.status === 'yellow' && (
          <AgentAttentionActions
            terminal={terminal}
            onEnter={() => onInput('\r')}
            onEscape={() => onInput('\x1b')}
            onContinue={() => submitPromptMessage('continue')}
          />
        )}
        {terminal.running && (
          <div className="flex flex-wrap gap-1.5">
            {PROMPT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => submitPromptMessage(preset.prompt)}
                className="rounded border border-white/[0.07] bg-white/[0.025] px-2 py-1 text-[10px] text-slate-500 hover:border-cyan-300/18 hover:bg-cyan-300/[0.055] hover:text-cyan-100"
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
        {historyOpen && historyPreview.length > 0 && (
          <div
            className="max-h-48 overflow-y-auto rounded border border-white/[0.07] bg-[#06080c] p-1"
            data-agent-composer-history={terminal.id}
          >
            {historyPreview.map((entry, index) => {
              const shellEntry = entry.startsWith('!');
              const label = shellEntry ? 'shell' : 'prompt';
              const display = shellEntry ? entry.slice(1).trim() : entry;
              return (
                <div
                  key={`${entry}-${index}`}
                  className="group flex min-w-0 items-center gap-2 rounded px-2 py-1.5 hover:bg-white/[0.035]"
                >
                  <span
                    className={cn(
                      'shrink-0 rounded border px-1.5 py-0.5 text-[10px]',
                      shellEntry
                        ? 'border-cyan-300/18 bg-cyan-300/[0.08] text-cyan-100'
                        : 'border-white/[0.06] bg-white/[0.025] text-slate-500'
                    )}
                  >
                    {label}
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-slate-400 hover:text-slate-100"
                    onClick={() => loadComposerHistoryEntry(entry)}
                    title={display}
                  >
                    {display}
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-slate-600 opacity-0 hover:bg-white/[0.06] hover:text-slate-200 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                    disabled={!canSubmitComposer}
                    onClick={() => sendComposerHistoryEntry(entry)}
                    title="Send history item"
                  >
                    send
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {slashCommandMatches.length > 0 && (
          <div
            className="rounded border border-cyan-300/14 bg-[#06080c] p-1"
            data-agent-slash-commands={terminal.id}
          >
            {slashCommandMatches.map((entry) => (
              <div
                key={entry.command}
                className="group flex min-w-0 items-center gap-2 rounded px-2 py-1.5 hover:bg-cyan-300/[0.055]"
              >
                <button
                  type="button"
                  className="shrink-0 rounded border border-cyan-300/18 bg-cyan-300/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-cyan-100 hover:bg-cyan-300/[0.12]"
                  onClick={() => loadSlashCommand(entry.command)}
                >
                  {entry.command}
                </button>
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-[11px] text-slate-500 hover:text-slate-200"
                  onClick={() => loadSlashCommand(entry.command)}
                  title={entry.description}
                >
                  {entry.description}
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-slate-600 opacity-0 hover:bg-white/[0.06] hover:text-slate-200 group-hover:opacity-100"
                  onClick={() => sendSlashCommand(entry.command)}
                  title={`Send ${entry.command}`}
                >
                  send
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <div
            className={cn(
              'flex min-w-0 flex-1 items-start rounded border bg-black/20 font-mono text-xs text-slate-300 focus-within:border-cyan-300/30',
              composerMode === 'shell' ? 'border-cyan-300/20' : 'border-white/[0.07]',
              !terminal.running && terminal.started && 'opacity-45'
            )}
          >
            {composerMode === 'shell' && (
              <span className="ml-2 mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-cyan-300/18 bg-cyan-300/[0.08] text-[11px] font-semibold text-cyan-100">
                !
              </span>
            )}
            <textarea
              ref={composerInputRef}
              value={composerValue}
              rows={composerRows}
              onChange={(event) => updateComposerDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r') {
                  if (composerHistory.length > 0) {
                    event.preventDefault();
                    setHistoryOpen((current) => !current);
                  }
                  return;
                }
                if (event.key === 'Tab' && slashCommandMatches.length > 0) {
                  event.preventDefault();
                  loadSlashCommand(slashCommandMatches[0].command);
                  return;
                }
                if (
                  composerMode === 'shell' &&
                  event.key === 'Backspace' &&
                  (composerValue.length === 0 || event.metaKey || event.ctrlKey)
                ) {
                  if (composerValue.length > 0 && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    onUpdate({ composerDraft: '', composerMode: 'prompt' });
                    return;
                  }
                  if (exitShellComposerMode()) event.preventDefault();
                  return;
                }
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.altKey &&
                  !event.ctrlKey &&
                  !event.metaKey
                ) {
                  event.preventDefault();
                  submitComposerValue();
                  return;
                }
                if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                if (event.key === 'ArrowUp') {
                  if (isComposerAtHistoryBoundary(event.currentTarget, 'previous')) {
                    event.preventDefault();
                    recallPromptHistory('previous');
                  }
                } else if (event.key === 'ArrowDown') {
                  if (isComposerAtHistoryBoundary(event.currentTarget, 'next')) {
                    event.preventDefault();
                    recallPromptHistory('next');
                  }
                }
              }}
              disabled={!terminal.running && terminal.started}
              className="max-h-32 min-h-8 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 leading-5 outline-none placeholder:text-slate-700 disabled:cursor-not-allowed"
              aria-label={
                composerMode === 'shell' ? 'Send shell command to Codex' : 'Send prompt to Codex'
              }
              placeholder={composerPlaceholder}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            disabled={composerHistory.length === 0}
            onClick={() => {
              setHistoryOpen((current) => !current);
              window.setTimeout(() => composerInputRef.current?.focus(), 0);
            }}
            className={cn(
              'h-8 w-8 shrink-0 border border-white/[0.07] bg-black/15 p-0 text-slate-400 hover:bg-white/[0.04] hover:text-slate-100 disabled:opacity-35',
              historyOpen && 'border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-100'
            )}
            aria-label="Show composer history"
            title="Show composer history"
          >
            <History size={13} />
          </Button>
          <Button
            type="submit"
            variant="ghost"
            disabled={!canSubmitComposer || !composerValue.trim()}
            className="h-8 w-8 shrink-0 border border-white/[0.07] bg-black/15 p-0 text-slate-400 hover:bg-white/[0.04] hover:text-slate-100 disabled:opacity-35"
            title="Send prompt"
          >
            <SendHorizontal size={13} />
          </Button>
        </div>
      </form>
    </section>
  );
}

function AgentBlockRail({
  blocks,
  running,
  onCopyBlock,
  onReplayPrompt,
  onSendBlockContext,
}: {
  blocks: AgentBlockEntry[];
  running: boolean;
  onCopyBlock: (block: AgentBlockEntry) => void;
  onReplayPrompt: (block: AgentBlockEntry) => void;
  onSendBlockContext: (block: AgentBlockEntry) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const visibleBlocks = showAll ? blocks : blocks.slice(0, 6);
  const attentionCount = blocks.filter(
    (block) => block.status === 'yellow' || block.status === 'red'
  ).length;

  function scrollBlocks(direction: 'newer' | 'older') {
    railRef.current?.scrollBy({
      top: direction === 'newer' ? -180 : 180,
      behavior: 'smooth',
    });
  }

  function jumpToAttentionBlock() {
    const target = railRef.current?.querySelector<HTMLElement>('[data-attention-block="true"]');
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  return (
    <div className="border-b border-[var(--cv-line)] bg-black/15 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-600">
          Timeline
        </span>
        <span className="flex items-center gap-1">
          {attentionCount > 0 && (
            <button
              type="button"
              onClick={jumpToAttentionBlock}
              className="rounded border border-amber-300/14 bg-amber-300/[0.045] px-1.5 py-0.5 text-[10px] text-amber-100/75 hover:bg-amber-300/[0.08]"
              title="Jump to attention block"
            >
              Attention {attentionCount}
            </button>
          )}
          {blocks.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAll((current) => !current)}
              className="rounded border border-white/[0.06] bg-white/[0.025] px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-white/[0.05] hover:text-slate-200"
              title={showAll ? 'Collapse timeline' : 'Show full timeline'}
            >
              {showAll ? 'Collapse' : `Show ${blocks.length}`}
            </button>
          )}
          <button
            type="button"
            onClick={() => scrollBlocks('newer')}
            className="flex h-5 w-5 items-center justify-center rounded border border-white/[0.06] bg-white/[0.025] text-slate-500 hover:bg-white/[0.05] hover:text-slate-200"
            title="Newer blocks"
          >
            <ChevronUp size={12} />
          </button>
          <button
            type="button"
            onClick={() => scrollBlocks('older')}
            className="flex h-5 w-5 items-center justify-center rounded border border-white/[0.06] bg-white/[0.025] text-slate-500 hover:bg-white/[0.05] hover:text-slate-200"
            title="Older blocks"
          >
            <ChevronDown size={12} />
          </button>
          <span className="font-mono text-[10px] text-slate-700">{blocks.length}</span>
        </span>
      </div>
      <div
        ref={railRef}
        data-agent-block-timeline="true"
        className={cn(
          'space-y-1.5 overflow-y-auto scroll-smooth pr-1',
          showAll ? 'max-h-64' : 'max-h-40'
        )}
      >
        {visibleBlocks.map((block) => {
          const expandedBlock = expanded === block.id;
          const expandableBlock = isExpandableBlock(block);
          const preview = blockPreviewText(block);
          return (
            <div
              key={block.id}
              data-attention-block={
                block.status === 'yellow' || block.status === 'red' ? 'true' : undefined
              }
              data-agent-block-kind={block.kind}
              data-agent-block-status={block.status}
              className={cn(
                'rounded border bg-black/20 px-2 py-1.5',
                blockBorderClass(block.status)
              )}
            >
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-white/[0.06] bg-white/[0.025]',
                        blockIconClass(block)
                      )}
                    >
                      {blockKindIcon(block.kind)}
                    </span>
                    <span className="truncate text-[11px] font-medium text-slate-300">
                      {block.title}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-slate-600">
                    <span className="shrink-0 rounded bg-white/[0.035] px-1 font-mono">
                      {blockKindLabel(block.kind)}
                    </span>
                    <span className="shrink-0 rounded bg-white/[0.035] px-1 font-mono">
                      {statusMeta[block.status].label}
                    </span>
                    <span className="shrink-0 font-mono">{formatActivityTime(block.at)}</span>
                    {preview && !expandedBlock && (
                      <span className="min-w-0 flex-1 truncate">{truncateText(preview, 120)}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {expandableBlock && (
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((current) => (current === block.id ? null : block.id))
                      }
                      className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
                      aria-label={
                        expandedBlock ? `Collapse ${block.title}` : `Expand ${block.title}`
                      }
                      title={expandedBlock ? 'Collapse block' : 'Expand block'}
                    >
                      {expandedBlock ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onCopyBlock(block)}
                    className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
                    aria-label={`Copy ${block.title} block`}
                    title="Copy block"
                  >
                    <Copy size={12} />
                  </button>
                  {running && isReplayableBlock(block) && (
                    <button
                      type="button"
                      onClick={() => onReplayPrompt(block)}
                      className="rounded p-1 text-emerald-100/75 hover:bg-emerald-300/[0.08] hover:text-emerald-100"
                      aria-label={`Replay ${block.title}`}
                      title={block.kind === 'shell' ? 'Replay shell command' : 'Replay prompt'}
                    >
                      <RotateCcw size={12} />
                    </button>
                  )}
                  {running && isSendableShellContextBlock(block) && (
                    <button
                      type="button"
                      onClick={() => onSendBlockContext(block)}
                      className="rounded p-1 text-cyan-100/75 hover:bg-cyan-300/[0.08] hover:text-cyan-100"
                      aria-label={`Send ${block.title} context to Codex`}
                      title="Send shell output to Codex"
                    >
                      <SendHorizontal size={12} />
                    </button>
                  )}
                </div>
              </div>
              {expandableBlock && expandedBlock && <AgentBlockExpandedContent block={block} />}
            </div>
          );
        })}
        {!showAll && blocks.length > visibleBlocks.length && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="w-full rounded border border-dashed border-white/[0.07] bg-white/[0.018] px-2 py-1.5 text-center text-[10px] text-slate-600 hover:border-cyan-300/18 hover:bg-cyan-300/[0.035] hover:text-cyan-100/75"
          >
            Show {blocks.length - visibleBlocks.length} older blocks
          </button>
        )}
      </div>
    </div>
  );
}

function AgentBlockExpandedContent({ block }: { block: AgentBlockEntry }) {
  if (block.kind !== 'shell') {
    return block.detail ? (
      <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border border-white/[0.055] bg-black/25 p-2 font-mono text-[10px] leading-4 text-slate-400">
        {block.detail}
      </pre>
    ) : null;
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="rounded border border-cyan-300/10 bg-cyan-300/[0.035] p-2">
        <div className="font-mono text-[10px] leading-4 text-cyan-100/80">
          {block.detail ? `!${block.detail}` : 'shell command'}
        </div>
        {shellBlockMeta(block) && (
          <div className="mt-1 font-mono text-[10px] text-cyan-100/45">{shellBlockMeta(block)}</div>
        )}
      </div>
      {block.output && (
        <pre
          className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-white/[0.055] bg-black/25 p-2 font-mono text-[10px] leading-4 text-slate-400"
          data-agent-block-output="shell"
        >
          {stripAnsi(block.output).trimEnd()}
        </pre>
      )}
    </div>
  );
}

function AgentAttentionActions({
  terminal,
  onEnter,
  onEscape,
  onContinue,
}: {
  terminal: AgentTerminal;
  onEnter: () => void;
  onEscape: () => void;
  onContinue: () => void;
}) {
  const waitingFor = terminal.waitingSince
    ? `waiting ${formatDuration(Date.now() - terminal.waitingSince)}`
    : 'needs input';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300/18 bg-amber-300/[0.055] px-2 py-1.5">
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-amber-100">
          {attentionActionTitle(terminal.statusReason)}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-amber-100/55">
          <span>{waitingFor}</span>
          <span className="max-w-[360px] truncate">{terminal.statusReason}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onEnter}
          className="rounded border border-amber-200/15 bg-black/20 px-2 py-1 font-mono text-[10px] text-amber-100 hover:bg-amber-200/[0.08]"
        >
          Enter
        </button>
        <button
          type="button"
          onClick={onEscape}
          className="rounded border border-amber-200/15 bg-black/20 px-2 py-1 font-mono text-[10px] text-amber-100/80 hover:bg-amber-200/[0.08]"
        >
          Esc
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="rounded border border-emerald-200/15 bg-emerald-300/[0.07] px-2 py-1 text-[10px] text-emerald-100 hover:bg-emerald-300/[0.11]"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function StructuredEventLog({ events }: { events: AgentStructuredEventEntry[] }) {
  return (
    <div className="rounded-md border border-white/[0.07] bg-black/15 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bot size={13} className="text-cyan-200/80" />
          <span className="text-xs font-medium text-slate-200">Event stream</span>
        </div>
        <span className="font-mono text-[10px] text-slate-700">{events.length}</span>
      </div>
      {events.length === 0 ? (
        <div className="text-[11px] text-slate-600">No structured Codex events yet</div>
      ) : (
        <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
          {events.slice(0, 10).map((event) => (
            <div
              key={event.id}
              className="rounded border border-white/[0.055] bg-black/20 px-2 py-1.5"
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      statusMeta[event.status].dot
                    )}
                  />
                  <span className="truncate text-[11px] font-medium text-slate-300">
                    {event.title}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-slate-600">
                  {event.seq != null ? `#${event.seq}` : formatActivityTime(event.at)}
                </span>
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-slate-600">
                <span className="shrink-0 rounded bg-white/[0.035] px-1 font-mono">
                  {event.source}
                </span>
                <span className="shrink-0 rounded bg-white/[0.035] px-1 font-mono">
                  {event.event}
                </span>
                {event.detail && <span className="truncate">{event.detail}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentRecoveryPanel({
  terminal,
  primaryRecovery,
  onStart,
  onResume,
  onRestart,
  onCopyTranscriptPath,
  onRevealTranscriptPath,
}: {
  terminal: AgentTerminal;
  primaryRecovery: { action: 'start' | 'resume'; label: string; reason: string };
  onStart: () => void;
  onResume: () => void;
  onRestart: () => void;
  onCopyTranscriptPath: () => void;
  onRevealTranscriptPath: () => void;
}) {
  const lifecycle = agentLifecycleState(terminal);

  if (terminal.running && lifecycle !== 'detached') return null;
  if (!terminal.started && !terminal.codexSessionId && !terminal.transcriptPath) return null;

  return (
    <div className="rounded-md border border-cyan-300/12 bg-cyan-300/[0.035] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-cyan-100/90">Recovery</div>
          <div className="mt-0.5 text-[11px] leading-4 text-cyan-100/55">
            {primaryRecovery.reason}
          </div>
        </div>
        <span
          className={cn(
            'mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px]',
            agentLifecycleClass(terminal)
          )}
        >
          {agentLifecycleLabel(terminal)}
        </span>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-cyan-100/55">
        {terminal.codexSessionId && (
          <span className="rounded border border-cyan-300/12 bg-black/20 px-1.5 py-0.5 font-mono">
            {compactSessionId(terminal.codexSessionId)}
          </span>
        )}
        {terminal.transcriptPath && (
          <span className="max-w-full truncate rounded border border-cyan-300/12 bg-black/20 px-1.5 py-0.5 font-mono">
            {compactPathLabel(terminal.transcriptPath)}
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={primaryRecovery.action === 'resume' ? onResume : onStart}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-emerald-300/18 bg-emerald-300/[0.07] px-2 text-[11px] text-emerald-100 hover:bg-emerald-300/[0.11]"
        >
          {primaryRecovery.action === 'resume' ? <History size={12} /> : <Play size={12} />}
          {primaryRecovery.label}
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-white/[0.07] bg-black/20 px-2 text-[11px] text-slate-300 hover:bg-white/[0.04]"
        >
          <RotateCcw size={12} />
          Fresh start
        </button>
      </div>
      {terminal.transcriptPath && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCopyTranscriptPath}
            className="inline-flex h-7 items-center justify-center gap-1.5 rounded border border-white/[0.06] bg-black/15 px-2 text-[10px] text-slate-400 hover:bg-white/[0.04] hover:text-slate-100"
          >
            <Copy size={11} />
            Copy path
          </button>
          <button
            type="button"
            onClick={onRevealTranscriptPath}
            className="inline-flex h-7 items-center justify-center gap-1.5 rounded border border-white/[0.06] bg-black/15 px-2 text-[10px] text-slate-400 hover:bg-white/[0.04] hover:text-slate-100"
          >
            <FolderOpen size={11} />
            Reveal
          </button>
        </div>
      )}
    </div>
  );
}

function AgentSessionDossier({
  terminal,
  repoStatus,
  resourceSample,
  onCopyLaunchCommand,
  onCopyTranscriptPath,
  onRevealTranscriptPath,
}: {
  terminal: AgentTerminal;
  repoStatus: RepoProjectGitStatus | null;
  resourceSample: ResourceProcessSample | null;
  onCopyLaunchCommand: () => void;
  onCopyTranscriptPath: () => void;
  onRevealTranscriptPath: () => void;
}) {
  const launchCommand = codexLaunchCommand(terminal, { includeEnv: false });
  const eventLabel = terminal.lastAgentEvent ?? (terminal.started ? 'terminal' : 'not started');
  const promptMode = terminal.prompt.trim() ? 'initial prompt' : 'interactive';

  return (
    <div className="border-b border-[var(--cv-line)] bg-[#07090d] px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-[10px] text-slate-500">
        <SessionChip label="state" value={agentLifecycleLabel(terminal)} tone="cyan" />
        <SessionChip label="signal" value={terminalSignalLabel(terminal)} tone="cyan" />
        <SessionChip label="event" value={eventLabel} />
        <SessionChip label="prompt" value={promptMode} />
        {terminal.pid != null && <SessionChip label="pid" value={String(terminal.pid)} />}
        {resourceSample && (
          <>
            <SessionChip label="cpu" value={formatCpuPercent(resourceSample.cpu_percent)} />
            <SessionChip label="ram" value={formatBytesCompact(resourceSample.ram_bytes)} />
          </>
        )}
        {terminal.codexSessionId && (
          <SessionChip label="codex" value={compactSessionId(terminal.codexSessionId)} />
        )}
        {terminal.transcriptPath && (
          <SessionChip label="rollout" value={compactPathLabel(terminal.transcriptPath)} />
        )}
        {terminal.blocks.length > 0 && (
          <SessionChip label="blocks" value={String(terminal.blocks.length)} />
        )}
        {repoStatus && <SessionChip label="git" value={repoGitStatusLabel(repoStatus)} />}
        {terminal.idleMs != null && terminal.running && (
          <SessionChip label="quiet" value={formatDuration(terminal.idleMs)} />
        )}
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono text-[10px] text-slate-600">$</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-500">
          {launchCommand}
        </code>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCopyLaunchCommand();
          }}
          className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
          aria-label="Copy launch command"
          title="Copy launch command"
        >
          <Copy size={12} />
        </button>
      </div>
      {terminal.transcriptPath && (
        <div className="mt-1.5 flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-[10px] text-slate-600">jsonl</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-500">
            {terminal.transcriptPath}
          </code>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onCopyTranscriptPath();
            }}
            className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label="Copy Codex rollout path"
            title="Copy Codex rollout path"
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRevealTranscriptPath();
            }}
            className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label="Reveal Codex rollout"
            title="Reveal Codex rollout in Finder"
          >
            <FolderOpen size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function SessionChip({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: string;
  tone?: 'slate' | 'cyan';
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5',
        tone === 'cyan'
          ? 'border-cyan-300/14 bg-cyan-300/[0.045] text-cyan-100/80'
          : 'border-white/[0.06] bg-white/[0.025] text-slate-500'
      )}
    >
      <span className="text-slate-600">{label}</span>
      <span className="max-w-[150px] truncate font-mono">{value}</span>
    </span>
  );
}

function TerminalContextMenuButton({
  icon,
  label,
  detail,
  disabled = false,
  tone = 'default',
  onClick,
}: {
  icon: ReactNode;
  label: string;
  detail: string;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-35',
        tone === 'danger'
          ? 'text-red-200/75 hover:bg-red-300/[0.08] hover:text-red-100'
          : 'text-slate-300 hover:bg-white/[0.055] hover:text-slate-100'
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-slate-500">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium">{label}</span>
        <span className="block truncate font-mono text-[9px] text-slate-600">{detail}</span>
      </span>
    </button>
  );
}

function CodexXterm({
  id,
  running,
  started,
  selected,
  denseWorkspace,
  onStart,
  onInput,
  onClear,
  onCopyOutput,
  onSendContext,
  onResize,
}: {
  id: string;
  running: boolean;
  started: boolean;
  selected: boolean;
  denseWorkspace: boolean;
  onStart: () => void;
  onInput: (data: string) => void;
  onClear: () => void;
  onCopyOutput: () => void;
  onSendContext: (prompt: string) => void;
  onResize: (cols: number, rows: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const onInputRef = useRef(onInput);
  const onClearRef = useRef(onClear);
  const onCopyOutputRef = useRef(onCopyOutput);
  const onSendContextRef = useRef(onSendContext);
  const onResizeRef = useRef(onResize);
  const runningRef = useRef(running);
  const lastResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const queuedOutputRef = useRef('');
  const writeFrameRef = useRef(0);
  const isWritingRef = useRef(false);
  const followOutputRef = useRef(true);
  const [followOutput, setFollowOutput] = useState(true);
  const [scrolledBack, setScrolledBack] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{
    resultIndex: number;
    resultCount: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<TerminalContextMenuState | null>(null);
  const [hasTerminalSelection, setHasTerminalSelection] = useState(false);
  runningRef.current = running;
  const denseInactive = denseWorkspace && !selected;

  function openSearch() {
    setContextMenu(null);
    setSearchOpen(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }

  function closeSearch() {
    searchRef.current?.clearDecorations();
    setSearchOpen(false);
    setSearchResults(null);
    window.setTimeout(() => terminalRef.current?.focus(), 0);
  }

  function runSearch(direction: 'next' | 'previous', nextQuery = searchQuery) {
    const query = nextQuery.trim();
    const search = searchRef.current;
    if (!search) return;
    if (!query) {
      search.clearDecorations();
      setSearchResults(null);
      return;
    }
    const found =
      direction === 'previous'
        ? search.findPrevious(query, TERMINAL_SEARCH_OPTIONS)
        : search.findNext(query, TERMINAL_SEARCH_OPTIONS);
    if (!found) setSearchResults({ resultIndex: -1, resultCount: 0 });
  }

  function jumpToLiveOutput() {
    setContextMenu(null);
    followOutputRef.current = true;
    setFollowOutput(true);
    setScrolledBack(false);
    terminalRef.current?.scrollToBottom();
    window.setTimeout(() => terminalRef.current?.focus(), 0);
  }

  function pauseFollowOutput() {
    setContextMenu(null);
    followOutputRef.current = false;
    setFollowOutput(false);
  }

  async function copyTerminalSelectionOrOutput() {
    setContextMenu(null);
    const term = terminalRef.current;
    const selection = term?.hasSelection() ? term.getSelection() : '';
    if (selection.trim()) {
      await copyText(selection);
      return;
    }
    onCopyOutputRef.current();
  }

  async function pasteTerminalClipboard() {
    setContextMenu(null);
    const term = terminalRef.current;
    if (
      !runningRef.current ||
      !term ||
      typeof navigator === 'undefined' ||
      !navigator.clipboard?.readText
    ) {
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      term.paste(text);
      window.setTimeout(() => term.focus(), 0);
    } catch {
      // Clipboard read permissions vary between browser smoke tests and desktop webviews.
    }
  }

  function sendTerminalContextToCodex() {
    setContextMenu(null);
    if (!runningRef.current) return;
    const term = terminalRef.current;
    const selection = term?.hasSelection() ? term.getSelection() : '';
    const selectedText = selection.trim();
    const contextText = selectedText || getTerminalOutput(id).slice(-TERMINAL_CONTEXT_OUTPUT_CHARS);
    if (!contextText.trim()) return;
    onSendContextRef.current(
      terminalOutputContextPrompt({
        text: contextText,
        source: selectedText ? 'selection' : 'recent output',
      })
    );
    window.setTimeout(() => term?.focus(), 0);
  }

  function interruptTerminalProcess() {
    setContextMenu(null);
    if (!runningRef.current) return;
    onInputRef.current('\x03');
    window.setTimeout(() => terminalRef.current?.focus(), 0);
  }

  function selectAllTerminalScrollback() {
    setContextMenu(null);
    terminalRef.current?.selectAll();
    setHasTerminalSelection(Boolean(terminalRef.current?.hasSelection()));
    window.setTimeout(() => terminalRef.current?.focus(), 0);
  }

  function openTerminalContextMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 260)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 320)),
    });
  }

  useEffect(() => {
    onInputRef.current = onInput;
    onClearRef.current = onClear;
    onCopyOutputRef.current = onCopyOutput;
    onSendContextRef.current = onSendContext;
    onResizeRef.current = onResize;
    runningRef.current = running;
  }, [onClear, onCopyOutput, onInput, onResize, onSendContext, running]);

  useEffect(() => {
    followOutputRef.current = followOutput;
  }, [followOutput]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const denseInactiveRenderer = denseWorkspace && !selected;
    const renderQueueLimit = denseInactiveRenderer
      ? XTERM_DENSE_RENDER_QUEUE_CHARS
      : XTERM_RENDER_QUEUE_CHARS;

    const term = new XTerm({
      allowProposedApi: true,
      allowTransparency: false,
      cursorBlink: !denseInactiveRenderer,
      convertEol: true,
      disableStdin: !running,
      fastScrollModifier: 'alt',
      fastScrollSensitivity: 5,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      letterSpacing: 0,
      lineHeight: 1.18,
      macOptionIsMeta: true,
      scrollSensitivity: 1,
      scrollback: denseInactiveRenderer ? XTERM_DENSE_SCROLLBACK_ROWS : XTERM_SCROLLBACK_ROWS,
      smoothScrollDuration: denseInactiveRenderer ? 0 : 120,
      theme: {
        background: '#050608',
        foreground: '#d6dde8',
        cursor: '#8be9fd',
        selectionBackground: '#263141',
      },
    });
    const fit = new FitAddon();
    const search = new SearchAddon({ highlightLimit: 1500 });
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());
    const webgl = denseInactiveRenderer ? null : loadWebglRenderer(term);
    const searchResultsDisposable = search.onDidChangeResults((result) => {
      setSearchResults({
        resultIndex: result.resultIndex,
        resultCount: result.resultCount,
      });
    });
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'f') {
        openSearch();
        return false;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
        if (event.key === 'Enter') {
          sendTerminalContextToCodex();
          return false;
        }
        if (event.code === 'BracketRight') {
          terminalShortcutBus.dispatchEvent(
            new CustomEvent<TerminalShortcutEvent>('shortcut', { detail: { action: 'next' } })
          );
          return false;
        }
        if (event.code === 'BracketLeft') {
          terminalShortcutBus.dispatchEvent(
            new CustomEvent<TerminalShortcutEvent>('shortcut', { detail: { action: 'previous' } })
          );
          return false;
        }
      }
      if (runningRef.current && (event.metaKey || event.ctrlKey) && key === 'v') {
        void pasteTerminalClipboard();
        return false;
      }
      if (event.metaKey && key === 'a') {
        term.selectAll();
        return false;
      }
      if (event.metaKey && key === 'c') {
        if (term.hasSelection()) void copyTerminalSelectionOrOutput();
        return false;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'k') {
        onClearRef.current();
        return false;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === 'c') {
        void copyTerminalSelectionOrOutput();
        return false;
      }
      return true;
    });
    term.open(host);
    const dataDisposable = term.onData((data) => onInputRef.current(data));
    terminalRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    const scheduleWrite = () => {
      if (writeFrameRef.current || isWritingRef.current) return;
      writeFrameRef.current = requestAnimationFrame(() => {
        writeFrameRef.current = 0;
        if (disposed || isWritingRef.current || !queuedOutputRef.current) return;
        const chunk = queuedOutputRef.current.slice(0, XTERM_WRITE_CHUNK_CHARS);
        queuedOutputRef.current = queuedOutputRef.current.slice(XTERM_WRITE_CHUNK_CHARS);
        isWritingRef.current = true;
        term.write(chunk, () => {
          isWritingRef.current = false;
          if (followOutputRef.current) term.scrollToBottom();
          if (!disposed && queuedOutputRef.current) scheduleWrite();
        });
      });
    };

    const writeQueuedOutput = (chunk: string) => {
      queuedOutputRef.current += chunk;
      if (queuedOutputRef.current.length > renderQueueLimit) {
        queuedOutputRef.current = queuedOutputRef.current.slice(-renderQueueLimit);
      }
      scheduleWrite();
    };

    const initialOutput = getTerminalOutput(id);
    if (initialOutput) writeQueuedOutput(initialOutput);
    term.scrollToBottom();

    let resizeFrame = 0;
    const scheduleFit = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (disposed) return;
        fitTerminal(fit, onResizeRef, lastResizeRef);
      });
    };
    scheduleFit();
    const observer = new ResizeObserver(() => {
      scheduleFit();
    });
    observer.observe(host);

    const unsubscribeOutput = subscribeTerminalOutput(id, (event) => {
      if (event.clear) {
        term.clear();
        jumpToLiveOutput();
        return;
      }
      writeQueuedOutput(event.chunk);
    });
    const scrollDisposable = term.onScroll(() => {
      const atBottom = isXtermAtBottom(term);
      setScrolledBack(!atBottom);
      if (!atBottom && followOutputRef.current) {
        followOutputRef.current = false;
        setFollowOutput(false);
      }
      if (atBottom && !followOutputRef.current) {
        followOutputRef.current = true;
        setFollowOutput(true);
      }
    });
    const selectionDisposable = term.onSelectionChange(() => {
      setHasTerminalSelection(term.hasSelection());
    });

    const focusHandler = () => term.focus();
    host.addEventListener('mousedown', focusHandler);
    const paneFocusHandler = (event: Event) => {
      const detail = (event as CustomEvent<TerminalFocusEvent>).detail;
      if (detail.id === id) term.focus();
    };
    terminalFocusBus.addEventListener('focus', paneFocusHandler);

    return () => {
      disposed = true;
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(writeFrameRef.current);
      writeFrameRef.current = 0;
      queuedOutputRef.current = '';
      isWritingRef.current = false;
      unsubscribeOutput();
      terminalFocusBus.removeEventListener('focus', paneFocusHandler);
      host.removeEventListener('mousedown', focusHandler);
      observer.disconnect();
      searchResultsDisposable.dispose();
      scrollDisposable.dispose();
      selectionDisposable.dispose();
      webgl?.dispose();
      dataDisposable.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      lastResizeRef.current = null;
      window.setTimeout(() => term.dispose(), 0);
    };
  }, [id, denseWorkspace, selected]);

  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.disableStdin = !running;
    if (running) window.setTimeout(() => term.focus(), 0);
  }, [running]);

  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults(null);
    setContextMenu(null);
    setHasTerminalSelection(false);
    followOutputRef.current = true;
    setFollowOutput(true);
    setScrolledBack(false);
  }, [id]);

  const searchResultLabel =
    searchQuery.trim().length === 0
      ? 'Find'
      : searchResults?.resultCount === 0
        ? 'No matches'
        : searchResults && searchResults.resultIndex >= 0
          ? `${searchResults.resultIndex + 1}/${searchResults.resultCount}`
          : 'Search';

  return (
    <div className="relative min-h-0 flex-1 bg-[#050608]">
      <div
        ref={hostRef}
        onContextMenu={openTerminalContextMenu}
        data-agent-xterm-density={denseInactive ? 'dense-inactive' : 'normal'}
        className={cn(
          'h-full min-h-0 overflow-hidden p-2 [&_.xterm-viewport]:!overflow-y-auto [&_.xterm]:h-full [&_.xterm]:min-h-0',
          denseInactive
            ? '[&_.xterm-screen]:will-change-auto'
            : '[&_.xterm-screen]:will-change-transform'
        )}
      />
      {contextMenu && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setContextMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu(null);
          }}
        >
          <div
            className="fixed min-w-52 rounded-md border border-white/[0.08] bg-[#07090d]/98 p-1 shadow-xl shadow-black/40 backdrop-blur"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            role="menu"
            aria-label="Terminal actions"
          >
            <TerminalContextMenuButton
              icon={<Copy size={13} />}
              label="Copy"
              detail="selection or output"
              onClick={() => void copyTerminalSelectionOrOutput()}
            />
            <TerminalContextMenuButton
              icon={<SendHorizontal size={13} />}
              label={hasTerminalSelection ? 'Send selection' : 'Send output'}
              detail={
                hasTerminalSelection
                  ? 'selected text · Cmd Shift Enter'
                  : 'recent output · Cmd Shift Enter'
              }
              disabled={!running}
              onClick={sendTerminalContextToCodex}
            />
            <TerminalContextMenuButton
              icon={<ClipboardPaste size={13} />}
              label="Paste"
              detail="clipboard to PTY"
              disabled={!running}
              onClick={() => void pasteTerminalClipboard()}
            />
            <TerminalContextMenuButton
              icon={<Files size={13} />}
              label="Select all"
              detail="terminal scrollback"
              onClick={selectAllTerminalScrollback}
            />
            <TerminalContextMenuButton
              icon={<Search size={13} />}
              label="Find"
              detail="search scrollback"
              onClick={openSearch}
            />
            <TerminalContextMenuButton
              icon={<ChevronDown size={13} />}
              label={followOutput ? 'Pause follow' : 'Jump to live'}
              detail={followOutput ? 'inspect scrollback' : 'resume tailing'}
              onClick={followOutput ? pauseFollowOutput : jumpToLiveOutput}
            />
            <div className="my-1 border-t border-white/[0.06]" />
            <TerminalContextMenuButton
              icon={<Ban size={13} />}
              label="Interrupt"
              detail="send Ctrl+C"
              disabled={!running}
              tone="danger"
              onClick={interruptTerminalProcess}
            />
          </div>
        </div>
      )}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={followOutput ? pauseFollowOutput : jumpToLiveOutput}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded border px-2 font-mono text-[10px] opacity-75 backdrop-blur hover:opacity-100',
            followOutput
              ? 'border-emerald-300/14 bg-emerald-300/[0.055] text-emerald-100/70 hover:bg-emerald-300/[0.09] hover:text-emerald-100'
              : 'border-cyan-300/18 bg-cyan-300/[0.08] text-cyan-100 hover:bg-cyan-300/[0.12]'
          )}
          aria-label={followOutput ? 'Pause terminal follow' : 'Jump to live terminal output'}
          title={followOutput ? 'Pause terminal follow' : 'Jump to live output'}
          data-agent-follow-output={followOutput ? 'true' : 'false'}
        >
          <ChevronDown size={12} className={scrolledBack ? 'animate-pulse' : undefined} />
          {followOutput ? 'live' : 'jump'}
        </button>
        <button
          type="button"
          onClick={openSearch}
          className="rounded border border-white/[0.06] bg-black/55 p-1.5 text-slate-500 opacity-70 backdrop-blur hover:bg-white/[0.06] hover:text-slate-200 hover:opacity-100"
          aria-label="Find in terminal"
          title="Find in terminal"
        >
          <Search size={13} />
        </button>
        <button
          type="button"
          onClick={() => void copyTerminalSelectionOrOutput()}
          className="rounded border border-white/[0.06] bg-black/55 p-1.5 text-slate-500 opacity-70 backdrop-blur hover:bg-white/[0.06] hover:text-slate-200 hover:opacity-100"
          aria-label="Copy terminal selection or output"
          title="Copy selection or output"
        >
          <Copy size={13} />
        </button>
        {running && hasTerminalSelection && (
          <button
            type="button"
            onClick={sendTerminalContextToCodex}
            className="rounded border border-cyan-300/14 bg-cyan-300/[0.07] p-1.5 text-cyan-100/75 opacity-80 backdrop-blur hover:bg-cyan-300/[0.11] hover:text-cyan-100 hover:opacity-100"
            aria-label="Send selected terminal text to Codex"
            title="Send selected text to Codex"
            data-agent-send-selection="true"
          >
            <SendHorizontal size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={() => void pasteTerminalClipboard()}
          disabled={!running}
          className="rounded border border-white/[0.06] bg-black/55 p-1.5 text-slate-500 opacity-70 backdrop-blur hover:bg-white/[0.06] hover:text-slate-200 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Paste clipboard to terminal"
          title="Paste clipboard to terminal"
        >
          <ClipboardPaste size={13} />
        </button>
        <button
          type="button"
          onClick={interruptTerminalProcess}
          disabled={!running}
          className="rounded border border-red-300/10 bg-black/55 p-1.5 text-red-300/55 opacity-70 backdrop-blur hover:bg-red-300/[0.08] hover:text-red-200 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="Interrupt terminal process"
          title="Interrupt terminal process"
        >
          <Ban size={13} />
        </button>
      </div>
      {searchOpen && (
        <form
          className="absolute right-3 top-3 z-20 flex max-w-[min(520px,calc(100%-24px))] items-center gap-1 rounded-md border border-cyan-300/18 bg-[#080b10]/96 p-1 shadow-xl shadow-black/30 backdrop-blur"
          onSubmit={(event) => {
            event.preventDefault();
            runSearch('next');
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              closeSearch();
            }
            if (event.key === 'Enter' && event.shiftKey) {
              event.preventDefault();
              runSearch('previous');
            }
          }}
        >
          <Search size={13} className="ml-1 shrink-0 text-cyan-100/75" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => {
              const next = event.target.value;
              setSearchQuery(next);
              runSearch('next', next);
            }}
            className="h-7 min-w-0 flex-1 bg-transparent px-1 font-mono text-xs text-slate-200 outline-none placeholder:text-slate-600"
            aria-label="Find in terminal"
            placeholder="Find in terminal"
          />
          <span className="min-w-16 shrink-0 text-right font-mono text-[10px] text-slate-500">
            {searchResultLabel}
          </span>
          <button
            type="button"
            onClick={() => runSearch('previous')}
            className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label="Previous terminal match"
            title="Previous"
          >
            <ChevronUp size={13} />
          </button>
          <button
            type="button"
            onClick={() => runSearch('next')}
            className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label="Next terminal match"
            title="Next"
          >
            <ChevronDown size={13} />
          </button>
          <button
            type="button"
            onClick={closeSearch}
            className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label="Close terminal search"
            title="Close"
          >
            <X size={13} />
          </button>
        </form>
      )}
      {!started && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#050608]/94">
          <Button
            type="button"
            onClick={onStart}
            className="h-9 gap-2 border border-emerald-300/20 bg-emerald-300/[0.08] px-3 text-xs text-emerald-100 hover:bg-emerald-300/[0.12]"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Start Codex
          </Button>
        </div>
      )}
    </div>
  );
}

function Inspector({
  terminal,
  codexPluginStatus,
  codexPluginBusy,
  repoProjects,
  repoStatus,
  resourceSample,
  repoStatusLoading,
  onUpdate,
  onStart,
  onStop,
  onRestart,
  onResume,
  onFork,
  onDuplicate,
  onSplit,
  onRemove,
  onChooseDirectory,
  onCopyLaunchCommand,
  onCopyTranscriptPath,
  onRevealTranscriptPath,
  onCopyWorkingDirectory,
  onRevealWorkingDirectory,
  onRefreshRepoStatus,
  onInstallCodexWarp,
  onRefreshCodexWarp,
}: {
  terminal: AgentTerminal;
  codexPluginStatus: CodexWarpPluginStatus | null;
  codexPluginBusy: boolean;
  repoProjects: RepoProject[];
  repoStatus: RepoProjectGitStatus | null;
  resourceSample: ResourceProcessSample | null;
  repoStatusLoading: boolean;
  onUpdate: (patch: Partial<AgentTerminal>) => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onResume: () => void;
  onFork: () => void;
  onDuplicate: () => void;
  onSplit: (direction: 'right' | 'down') => void;
  onRemove: () => void;
  onChooseDirectory: () => void;
  onCopyLaunchCommand: () => void;
  onCopyTranscriptPath: () => void;
  onRevealTranscriptPath: () => void;
  onCopyWorkingDirectory: () => void;
  onRevealWorkingDirectory: () => void;
  onRefreshRepoStatus: () => void;
  onInstallCodexWarp: () => void;
  onRefreshCodexWarp: () => void;
}) {
  const detached = isDetachedTerminal(terminal);
  const canResume = Boolean(terminal.codexSessionId && (!terminal.running || detached));
  const primaryRecovery = primaryRecoveryAction(terminal);
  const launchPreview = codexLaunchCommand(terminal, { resume: canResume });

  return (
    <div className="space-y-4">
      <div>
        <div className="cv-label mb-2">Agent</div>
        <input
          value={terminal.name}
          onChange={(event) => onUpdate({ name: event.target.value })}
          className="w-full rounded-md border border-white/[0.07] bg-black/20 px-2 py-2 text-sm text-slate-200 outline-none focus:border-cyan-300/30"
          aria-label="Agent name"
        />
      </div>

      <div>
        <div className="cv-label mb-2">Prompt preset</div>
        <div className="grid grid-cols-2 gap-1.5">
          {PROMPT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onUpdate({ prompt: preset.prompt })}
              disabled={terminal.running || terminal.started}
              className="min-h-8 rounded-md border border-white/[0.07] bg-black/15 px-2 py-1 text-left text-[11px] text-slate-400 hover:bg-white/[0.035] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="rounded-md border px-3 py-2 text-xs"
        style={{ borderColor: 'rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Status</span>
          <span className={cn('font-medium', statusMeta[terminal.status].text)}>
            {terminalStatusLabel(terminal)}
          </span>
        </div>
        <div className="mt-1 flex items-start justify-between gap-3 text-[11px] text-slate-600">
          <span>reason</span>
          <span className="max-w-[180px] text-right">{terminal.statusReason}</span>
        </div>
        {terminal.idleMs != null && terminal.running && (
          <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
            <span>silent</span>
            <span className="font-mono">{formatDuration(terminal.idleMs)}</span>
          </div>
        )}
        {terminal.pid != null && (
          <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
            <span>pid</span>
            <span className="font-mono">{terminal.pid}</span>
          </div>
        )}
        {resourceSample && (
          <>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
              <span>cpu</span>
              <span className="font-mono text-cyan-100/65">
                {formatCpuPercent(resourceSample.cpu_percent)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
              <span>ram</span>
              <span className="font-mono text-cyan-100/65">
                {formatBytesCompact(resourceSample.ram_bytes)}
              </span>
            </div>
          </>
        )}
        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
          <span>signal</span>
          <span className={cn('font-mono', terminalSignalClass(terminal))}>
            {terminalSignalLabel(terminal)}
          </span>
        </div>
        {isConcreteRepoPath(terminal.cwd) && (
          <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-slate-600">
            <span>repo</span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-right font-mono text-slate-400">
                {repoStatusLoading
                  ? 'refreshing'
                  : repoStatus
                    ? repoGitStatusLabel(repoStatus)
                    : 'unavailable'}
              </span>
              <button
                type="button"
                onClick={onRefreshRepoStatus}
                disabled={repoStatusLoading}
                className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-40"
                aria-label="Refresh repository status"
                title="Refresh repository status"
              >
                <RotateCcw size={11} className={repoStatusLoading ? 'animate-spin' : undefined} />
              </button>
            </span>
          </div>
        )}
        {terminal.lastAgentEvent && (
          <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
            <span>event</span>
            <span className="font-mono text-slate-400">{terminal.lastAgentEvent}</span>
          </div>
        )}
        {terminal.transcriptPath && (
          <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-slate-600">
            <span>rollout</span>
            <span className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate text-right font-mono text-slate-400">
                {compactPathLabel(terminal.transcriptPath)}
              </span>
              <button
                type="button"
                onClick={onCopyTranscriptPath}
                className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
                aria-label="Copy Codex rollout path"
                title="Copy Codex rollout path"
              >
                <Copy size={11} />
              </button>
              <button
                type="button"
                onClick={onRevealTranscriptPath}
                className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
                aria-label="Reveal Codex rollout"
                title="Reveal Codex rollout in Finder"
              >
                <FolderOpen size={11} />
              </button>
            </span>
          </div>
        )}
      </div>

      <div className="rounded-md border border-white/[0.07] bg-black/15 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Columns2 size={13} className="text-cyan-200/80" />
          <span className="text-xs font-medium text-slate-200">Blocks</span>
        </div>
        {terminal.blocks.length === 0 ? (
          <div className="text-[11px] text-slate-600">No agent turns yet</div>
        ) : (
          <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
            {terminal.blocks.slice(0, 10).map((block) => (
              <div
                key={block.id}
                className={cn('rounded border px-2 py-1.5', statusMeta[block.status].row)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        statusMeta[block.status].dot
                      )}
                    />
                    <span className="truncate text-[11px] font-medium text-slate-200">
                      {block.title}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-600">
                    {formatActivityTime(block.at)}
                  </span>
                </div>
                {block.detail && (
                  <div className="mt-1 line-clamp-2 break-words font-mono text-[10px] leading-4 text-slate-500">
                    {block.detail}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <AgentRecoveryPanel
        terminal={terminal}
        primaryRecovery={primaryRecovery}
        onStart={onStart}
        onResume={onResume}
        onRestart={onRestart}
        onCopyTranscriptPath={onCopyTranscriptPath}
        onRevealTranscriptPath={onRevealTranscriptPath}
      />

      <StructuredEventLog events={terminal.structuredEventLog} />

      <div className="rounded-md border border-white/[0.07] bg-black/15 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Activity size={13} className="text-cyan-200/80" />
          <span className="text-xs font-medium text-slate-200">Activity</span>
        </div>
        {terminal.activities.length === 0 ? (
          <div className="text-[11px] text-slate-600">No runtime events yet</div>
        ) : (
          <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
            {terminal.activities.slice(0, 8).map((entry) => (
              <div key={entry.id} className="border-l border-white/[0.08] pl-2">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('truncate text-[11px]', activityTextClass(entry.kind))}>
                    {entry.label}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-600">
                    {formatActivityTime(entry.at)}
                  </span>
                </div>
                {entry.detail && (
                  <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-slate-600">
                    {entry.detail}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-md border border-white/[0.07] bg-black/15 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch size={13} className="text-cyan-200/80" />
            <span className="text-xs font-medium text-slate-200">Codex-Warp</span>
          </div>
          <button
            type="button"
            onClick={onRefreshCodexWarp}
            className="text-[10px] text-slate-500 hover:text-slate-200"
          >
            refresh
          </button>
        </div>
        <div className="space-y-1 text-[11px] text-slate-500">
          <div className="flex items-center justify-between gap-3">
            <span>marketplace</span>
            <span className={codexPluginStatus?.marketplace_installed ? 'text-emerald-200' : ''}>
              {codexPluginStatus?.marketplace_installed ? 'installed' : 'missing'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>warp plugin</span>
            <span className={codexPluginReady(codexPluginStatus) ? 'text-emerald-200' : ''}>
              {codexPluginReady(codexPluginStatus) ? 'enabled' : 'missing'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>structured events</span>
            <span className={codexPluginReady(codexPluginStatus) ? 'text-emerald-200' : ''}>
              {codexPluginReady(codexPluginStatus) ? 'ready' : 'off'}
            </span>
          </div>
        </div>
        {codexPluginStatus?.error && (
          <div className="mt-2 line-clamp-3 text-[11px] text-red-200/80">
            {codexPluginStatus.error}
          </div>
        )}
        {!codexPluginReady(codexPluginStatus) && (
          <Button
            type="button"
            onClick={onInstallCodexWarp}
            disabled={codexPluginBusy || codexPluginStatus?.codex_available === false}
            className="mt-3 h-8 w-full justify-start gap-2 border border-cyan-300/20 bg-cyan-300/[0.08] px-2 text-xs text-cyan-100 hover:bg-cyan-300/[0.12] disabled:opacity-45"
          >
            {codexPluginBusy ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <GitBranch size={13} />
            )}
            Install Codex-Warp
          </Button>
        )}
      </div>

      <div className="rounded-md border border-white/[0.07] bg-black/15 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium text-slate-200">Launch</div>
            <div className="mt-0.5 text-[10px] text-slate-600">Codex argv plus Warp events</div>
          </div>
          <button
            type="button"
            onClick={onCopyLaunchCommand}
            className="rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
            aria-label="Copy launch command"
            title="Copy launch command"
          >
            <Copy size={13} />
          </button>
        </div>
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded border border-white/[0.06] bg-black/25 p-2 font-mono text-[10px] leading-4 text-slate-400">
          {launchPreview}
        </pre>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-slate-600">
          <div>
            <span className="block text-slate-500">sandbox</span>
            <span className="font-mono text-slate-400">{terminal.sandbox}</span>
          </div>
          <div>
            <span className="block text-slate-500">approvals</span>
            <span className="font-mono text-slate-400">{terminal.approvalPolicy}</span>
          </div>
          <div>
            <span className="block text-slate-500">model</span>
            <span className="font-mono text-slate-400">{terminal.model.trim() || 'default'}</span>
          </div>
          <div>
            <span className="block text-slate-500">prompt</span>
            <span className="font-mono text-slate-400">
              {terminal.prompt.trim() ? 'argv' : 'interactive'}
            </span>
          </div>
        </div>
      </div>

      <div>
        <div className="cv-label mb-2">Working directory</div>
        <div className="flex gap-2">
          <input
            value={terminal.cwd}
            onChange={(event) => onUpdate({ cwd: event.target.value })}
            className="min-w-0 flex-1 rounded-md border border-white/[0.07] bg-black/20 px-2 py-2 font-mono text-xs text-slate-300 outline-none focus:border-cyan-300/30"
            aria-label="Working directory"
            placeholder="~"
            disabled={terminal.running || terminal.started}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={onChooseDirectory}
            disabled={terminal.running || terminal.started}
            className="h-9 w-9 shrink-0 border border-white/[0.07] bg-black/15 p-0 text-slate-400 hover:bg-white/[0.04] hover:text-slate-100 disabled:opacity-45"
            title="Choose directory"
          >
            <FolderOpen size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onCopyWorkingDirectory}
            disabled={!terminal.cwd.trim()}
            className="h-9 w-9 shrink-0 border border-white/[0.07] bg-black/15 p-0 text-slate-400 hover:bg-white/[0.04] hover:text-slate-100 disabled:opacity-45"
            title="Copy working directory"
          >
            <Copy size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onRevealWorkingDirectory}
            disabled={!isConcreteRepoPath(terminal.cwd)}
            className="h-9 w-9 shrink-0 border border-white/[0.07] bg-black/15 p-0 text-slate-400 hover:bg-white/[0.04] hover:text-slate-100 disabled:opacity-45"
            title="Reveal working directory in Finder"
          >
            <FolderOpen size={14} />
          </Button>
        </div>
        {repoProjects.length > 0 && (
          <select
            value={
              repoProjects.some((project) => project.repo_path === terminal.cwd) ? terminal.cwd : ''
            }
            onChange={(event) => {
              if (event.target.value) onUpdate({ cwd: event.target.value });
            }}
            disabled={terminal.running || terminal.started}
            className="mt-2 w-full rounded-md border border-white/[0.07] bg-black/20 px-2 py-2 text-xs text-slate-300 outline-none focus:border-cyan-300/30 disabled:opacity-45"
            aria-label="Recent repository"
          >
            <option value="">Recent repo</option>
            {repoProjects.slice(0, 12).map((project) => (
              <option key={project.id} value={project.repo_path}>
                {project.display_name} · {project.repo_path}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <div className="cv-label mb-2">Model</div>
        <input
          value={terminal.model}
          onChange={(event) => onUpdate({ model: event.target.value })}
          className="w-full rounded-md border border-white/[0.07] bg-black/20 px-2 py-2 font-mono text-xs text-slate-300 outline-none focus:border-cyan-300/30"
          aria-label="Codex model"
          placeholder="default"
          disabled={terminal.running || terminal.started}
        />
      </div>

      <div>
        <div className="cv-label mb-2">Sandbox</div>
        <select
          value={terminal.sandbox}
          onChange={(event) =>
            onUpdate({ sandbox: event.target.value as AgentTerminal['sandbox'] })
          }
          disabled={terminal.running || terminal.started}
          className="w-full rounded-md border border-white/[0.07] bg-black/20 px-2 py-2 text-xs text-slate-300 outline-none focus:border-cyan-300/30"
        >
          <option value="read-only">read-only</option>
          <option value="workspace-write">workspace-write</option>
          <option value="danger-full-access">danger-full-access</option>
        </select>
      </div>

      <div>
        <div className="cv-label mb-2">Approvals</div>
        <select
          value={terminal.approvalPolicy}
          onChange={(event) =>
            onUpdate({ approvalPolicy: event.target.value as AgentTerminal['approvalPolicy'] })
          }
          disabled={terminal.running || terminal.started}
          className="w-full rounded-md border border-white/[0.07] bg-black/20 px-2 py-2 text-xs text-slate-300 outline-none focus:border-cyan-300/30"
        >
          <option value="on-request">on-request</option>
          <option value="untrusted">untrusted</option>
          <option value="never">never</option>
        </select>
      </div>

      <div>
        <div className="cv-label mb-2">Size</div>
        <div className="grid grid-cols-3 gap-1.5">
          {(['compact', 'wide', 'tall'] as AgentSize[]).map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => onUpdate({ size })}
              className={cn(
                'flex h-8 items-center justify-center gap-1 rounded-md border text-[11px] capitalize text-slate-400',
                terminal.size === size
                  ? 'border-cyan-300/22 bg-cyan-300/[0.07] text-cyan-100'
                  : 'border-white/[0.06] bg-black/15 hover:bg-white/[0.035]'
              )}
            >
              {size === 'compact' ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              {size}
            </button>
          ))}
        </div>
      </div>

      {terminal.running ? (
        <Button
          type="button"
          onClick={onStop}
          className="h-9 w-full justify-start gap-2 border border-red-300/20 bg-red-300/[0.08] px-2 text-xs text-red-100 hover:bg-red-300/[0.12]"
        >
          <Square size={14} />
          Stop Codex
        </Button>
      ) : (
        <Button
          type="button"
          onClick={primaryRecovery.action === 'resume' ? onResume : onStart}
          className="h-9 w-full justify-start gap-2 border border-emerald-300/20 bg-emerald-300/[0.08] px-2 text-xs text-emerald-100 hover:bg-emerald-300/[0.12] disabled:opacity-45"
        >
          {primaryRecovery.action === 'resume' ? <History size={14} /> : <Play size={14} />}
          {primaryRecovery.label}
        </Button>
      )}

      <Button
        type="button"
        variant="ghost"
        onClick={() => onUpdate({ background: !terminal.background })}
        className="h-9 w-full justify-start gap-2 border border-white/[0.07] bg-black/15 px-2 text-xs text-slate-300 hover:bg-white/[0.04]"
      >
        {terminal.background ? <ArrowUpFromLine size={14} /> : <ArrowDownToLine size={14} />}
        {terminal.background ? 'Restore from background' : 'Move to background'}
      </Button>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onRestart}
          disabled={terminal.running}
          title="Restart and keep transcript"
          className="h-8 justify-start gap-2 border border-white/[0.07] bg-black/15 px-2 text-xs text-slate-300 hover:bg-white/[0.04] disabled:opacity-45"
        >
          <RotateCcw size={13} />
          Restart
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onResume}
          disabled={terminal.running || !terminal.codexSessionId}
          title="Resume captured Codex session"
          className="h-8 justify-start gap-2 border border-cyan-300/12 bg-cyan-300/[0.04] px-2 text-xs text-cyan-100/80 hover:bg-cyan-300/[0.08] disabled:opacity-35"
        >
          <History size={13} />
          Resume
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onDuplicate}
          className="h-8 justify-start gap-2 border border-white/[0.07] bg-black/15 px-2 text-xs text-slate-300 hover:bg-white/[0.04]"
        >
          <Copy size={13} />
          Duplicate
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onFork}
          disabled={!terminal.codexSessionId}
          title="Fork captured Codex session into a new pane"
          className="h-8 justify-start gap-2 border border-white/[0.07] bg-black/15 px-2 text-xs text-slate-300 hover:bg-white/[0.04] disabled:opacity-35"
        >
          <GitBranch size={13} />
          Fork
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => onSplit('right')}
          className="h-8 justify-start gap-2 border border-white/[0.07] bg-black/15 px-2 text-xs text-slate-300 hover:bg-white/[0.04]"
        >
          <Columns2 size={13} />
          Split right
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onSplit('down')}
          className="h-8 justify-start gap-2 border border-white/[0.07] bg-black/15 px-2 text-xs text-slate-300 hover:bg-white/[0.04]"
        >
          <Rows2 size={13} />
          Split down
        </Button>
      </div>

      <Button
        type="button"
        variant="ghost"
        onClick={onRemove}
        disabled={terminal.running}
        className="h-9 w-full justify-start gap-2 border border-red-300/18 bg-red-300/[0.045] px-2 text-xs text-red-100 hover:bg-red-300/[0.08] disabled:opacity-45"
      >
        <X size={14} />
        Close terminal
      </Button>
    </div>
  );
}

function terminalStatusLabel(terminal: AgentTerminal): string {
  const lifecycle = agentLifecycleState(terminal);
  if (lifecycle === 'detached') return 'Detached';
  if (lifecycle === 'resumable') return 'Recoverable';
  if (lifecycle === 'stopped') return 'Stopped';
  if (terminal.status === 'yellow') {
    return terminal.statusReason.startsWith('No terminal output') ? 'Stalled' : 'Needs input';
  }
  return statusMeta[terminal.status].label;
}

function terminalUpdatedLabel(terminal: AgentTerminal): string {
  if (!terminal.started && terminal.status === 'white') return '';
  return terminal.updatedAt;
}

function terminalSignalLabel(terminal: AgentTerminal): string {
  if (!terminal.started) return 'not started';
  if (terminal.structuredEventsActive) return 'codex-warp';
  if (terminal.lastAgentEventSource === 'codex-osc9') return 'codex-osc9';
  return 'terminal';
}

function terminalSignalClass(terminal: AgentTerminal): string {
  if (terminal.structuredEventsActive) return 'text-emerald-200/80';
  if (terminal.lastAgentEventSource === 'codex-osc9') return 'text-cyan-200/75';
  return terminal.started ? 'text-amber-200/70' : 'text-slate-500';
}

function agentLifecycleState(terminal: AgentTerminal): AgentLifecycleState {
  if (!terminal.started) return 'ready';
  if (terminal.running) {
    if (terminal.status === 'yellow') return 'waiting';
    if (terminal.status === 'red') return 'failed';
    if (isDetachedTerminal(terminal)) return 'detached';
    return 'live';
  }
  if (terminal.status === 'red') return 'failed';
  if (terminal.codexSessionId) return 'resumable';
  return 'stopped';
}

function agentLifecycleLabel(terminal: AgentTerminal): string {
  switch (agentLifecycleState(terminal)) {
    case 'ready':
      return 'ready';
    case 'live':
      return 'live';
    case 'waiting':
      return 'waiting';
    case 'failed':
      return 'failed';
    case 'resumable':
      return 'resumable';
    case 'stopped':
      return 'stopped';
    case 'detached':
      return 'detached';
  }
}

function agentLifecycleClass(terminal: AgentTerminal): string {
  switch (agentLifecycleState(terminal)) {
    case 'live':
      return 'border-emerald-300/14 bg-emerald-300/[0.055] text-emerald-100/75';
    case 'waiting':
      return 'border-amber-300/16 bg-amber-300/[0.06] text-amber-100/80';
    case 'failed':
      return 'border-red-300/16 bg-red-300/[0.055] text-red-100/80';
    case 'resumable':
      return 'border-cyan-300/14 bg-cyan-300/[0.055] text-cyan-100/75';
    case 'detached':
      return 'border-violet-300/14 bg-violet-300/[0.055] text-violet-100/75';
    case 'stopped':
    case 'ready':
      return 'border-white/[0.06] bg-white/[0.025] text-slate-500';
  }
}

function isDetachedTerminal(terminal: AgentTerminal): boolean {
  if (!terminal.running || terminal.lastHeartbeatAt == null) return false;
  return Date.now() - terminal.lastHeartbeatAt > STALL_AFTER_MS * 2;
}

function attentionActionTitle(reason: string): string {
  const normalized = reason.toLowerCase();
  if (normalized.includes('hook')) return 'Hook review waiting';
  if (normalized.includes('approval') || normalized.includes('permission')) {
    return 'Approval waiting';
  }
  if (normalized.includes('confirm')) return 'Confirmation waiting';
  if (normalized.includes('silent') || normalized.includes('quiet')) return 'Agent is quiet';
  return 'Codex needs attention';
}

function isTerminalStartable(terminal: AgentTerminal): boolean {
  return !terminal.running;
}

function isAttentionTerminal(terminal: AgentTerminal): boolean {
  const lifecycle = agentLifecycleState(terminal);
  return lifecycle === 'waiting' || lifecycle === 'failed' || lifecycle === 'detached';
}

function sortAttentionTerminals(terminals: AgentTerminal[]): AgentTerminal[] {
  return terminals.filter(isAttentionTerminal).sort((left, right) => {
    const priority = attentionPriority(right) - attentionPriority(left);
    if (priority !== 0) return priority;
    const waiting =
      (left.waitingSince ?? Number.MAX_SAFE_INTEGER) -
      (right.waitingSince ?? Number.MAX_SAFE_INTEGER);
    if (waiting !== 0) return waiting;
    return left.name.localeCompare(right.name);
  });
}

function nextAttentionTerminal(
  attentionTerminals: AgentTerminal[],
  selectedId: string | null
): AgentTerminal | null {
  if (attentionTerminals.length === 0) return null;
  const selectedIndex = attentionTerminals.findIndex((terminal) => terminal.id === selectedId);
  if (selectedIndex < 0) return attentionTerminals[0] ?? null;
  return attentionTerminals[(selectedIndex + 1) % attentionTerminals.length] ?? null;
}

function attentionPriority(terminal: AgentTerminal): number {
  const lifecycle = agentLifecycleState(terminal);
  if (lifecycle === 'failed') return 3;
  if (lifecycle === 'detached') return 2;
  if (lifecycle === 'waiting') return 1;
  return 0;
}

function isRecoverableTerminal(terminal: AgentTerminal): boolean {
  const lifecycle = agentLifecycleState(terminal);
  return (
    lifecycle === 'resumable' ||
    lifecycle === 'failed' ||
    lifecycle === 'stopped' ||
    lifecycle === 'detached'
  );
}

function agentMatchesListFilter(terminal: AgentTerminal, filter: AgentListFilter): boolean {
  switch (filter) {
    case 'running':
      return terminal.running;
    case 'attention':
      return isAttentionTerminal(terminal);
    case 'background':
      return terminal.background;
    case 'recoverable':
      return isRecoverableTerminal(terminal);
    case 'all':
      return true;
  }
}

function primaryRecoveryAction(terminal: AgentTerminal): {
  action: 'start' | 'resume';
  label: string;
  reason: string;
} {
  const detached = isDetachedTerminal(terminal);
  if (terminal.codexSessionId && (!terminal.running || detached)) {
    return {
      action: 'resume',
      label: 'Resume Codex',
      reason: detached
        ? 'Backend heartbeat stopped, but a Codex session id was captured. Resume should restore continuity.'
        : terminal.status === 'red'
          ? 'Codex failed, but a session id was captured. Resume is the safest recovery path.'
          : 'A Codex session id was captured. Resume keeps continuity with the prior agent run.',
    };
  }
  if (terminal.started) {
    return {
      action: 'start',
      label: 'Start fresh',
      reason:
        'No resumable Codex session is available for this pane. Start a fresh agent in the same directory.',
    };
  }
  return {
    action: 'start',
    label: 'Start Codex',
    reason: 'This pane has not launched a Codex agent yet.',
  };
}

function launchVerb(mode: AgentLaunchMode): string {
  switch (mode) {
    case 'fork':
      return 'Forking';
    case 'resume':
      return 'Resuming';
    case 'start':
      return 'Starting';
  }
}

function launchBlockTitle(mode: AgentLaunchMode): string {
  switch (mode) {
    case 'fork':
      return 'Fork Codex';
    case 'resume':
      return 'Resume Codex';
    case 'start':
      return 'Launch Codex';
  }
}

function launchStatusReason(mode: AgentLaunchMode): string {
  switch (mode) {
    case 'fork':
      return 'Codex session forked';
    case 'resume':
      return 'Codex session resumed';
    case 'start':
      return 'Codex process started';
  }
}

function indexedSessionTitle(session: SessionRow): string {
  return (
    session.slug?.trim() ||
    session.first_message?.trim() ||
    session.cwd?.split('/').filter(Boolean).at(-1) ||
    compactSessionId(session.id)
  );
}

function indexedSessionPaneName(
  session: SessionRow,
  fallbackIndex: number,
  mode: 'resume' | 'fork'
): string {
  const title = truncateText(indexedSessionTitle(session), 28);
  return `${mode === 'resume' ? 'Resume' : 'Fork'} ${title || `Codex ${fallbackIndex}`}`;
}

function indexedSessionMeta(session: SessionRow): string {
  const parts = [
    session.model_used,
    session.cwd ? compactPathLabel(session.cwd) : null,
    session.last_message ? formatShortDate(session.last_message) : null,
  ].filter(Boolean);
  return parts.join(' · ') || compactSessionId(session.id);
}

function filterIndexedSessions(sessions: SessionRow[], query: string): SessionRow[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return sessions;
  return sessions.filter((session) => {
    const haystack = indexedSessionSearchText(session);
    return tokens.every((token) => haystack.includes(token));
  });
}

function indexedSessionSearchText(session: SessionRow): string {
  return [
    session.id,
    session.slug,
    session.first_message,
    session.last_message,
    session.cwd,
    session.git_branch,
    session.model_used,
    session.jsonl_path,
    indexedSessionTitle(session),
    indexedSessionMeta(session),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function codexLaunchCommand(
  terminal: AgentTerminal,
  options: { includeEnv?: boolean; resume?: boolean; forkSessionId?: string | null } = {}
): string {
  const resumeSessionId = options.resume ? terminal.codexSessionId?.trim() : '';
  const forkSessionId = options.forkSessionId?.trim() ?? '';
  const args = [
    'codex',
    ...(forkSessionId ? ['fork'] : resumeSessionId ? ['resume'] : []),
    '--no-alt-screen',
    '-C',
    terminal.cwd.trim() || '~',
    '-s',
    terminal.sandbox,
    '-a',
    terminal.approvalPolicy,
  ];
  const model = terminal.model.trim();
  if (model) args.push('-m', model);
  if (forkSessionId) args.push(forkSessionId);
  else if (resumeSessionId) args.push(resumeSessionId);
  const prompt = terminal.prompt.trim();
  if (prompt) args.push(prompt);

  const command = args.map(shellQuote).join(' ');
  if (options.includeEnv === false) return command;
  return [
    'env',
    'TERM=xterm-256color',
    'COLORTERM=truecolor',
    'TERM_PROGRAM=CodeVetter',
    'TERM_PROGRAM_VERSION=codevetter-agent-panel-0.1',
    'CODEVETTER_AGENT_PANEL=1',
    'WARP_CLI_AGENT_PROTOCOL_VERSION=1',
    'WARP_CLIENT_VERSION=codevetter-agent-panel-0.1',
    command,
  ].join(' ');
}

function shellQuote(value: string): string {
  if (!value) return "''";
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function isFormTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('.xterm')) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
  );
}

function focusTerminalPane(id: string) {
  window.requestAnimationFrame(() => {
    terminalFocusBus.dispatchEvent(
      new CustomEvent<TerminalFocusEvent>('focus', { detail: { id } })
    );
  });
}

function isConcreteRepoPath(path: string): boolean {
  const trimmed = path.trim();
  return Boolean(trimmed && trimmed !== '~' && !trimmed.startsWith('~'));
}

function appendActivity(
  terminal: AgentTerminal,
  entry: Omit<AgentActivityEntry, 'id' | 'at'> & { at?: number }
): AgentTerminal {
  const at = entry.at ?? Date.now();
  return {
    ...terminal,
    activities: [
      {
        id: `${terminal.id}-${at}-${terminal.activities.length}`,
        at,
        kind: entry.kind,
        label: entry.label,
        detail: entry.detail,
      },
      ...terminal.activities,
    ].slice(0, ACTIVITY_LIMIT),
  };
}

function appendBlock(
  terminal: AgentTerminal,
  entry: Omit<AgentBlockEntry, 'id' | 'at'> & { at?: number; id?: string }
): AgentTerminal {
  const at = entry.at ?? Date.now();
  return {
    ...terminal,
    blocks: [
      {
        id: entry.id ?? `${terminal.id}-block-${at}-${terminal.blocks.length}`,
        at,
        kind: entry.kind,
        status: entry.status,
        title: entry.title,
        detail: entry.detail,
        output: entry.output,
        cwd: entry.cwd,
        exitCode: entry.exitCode,
        durationMs: entry.durationMs,
      },
      ...terminal.blocks,
    ].slice(0, BLOCK_LIMIT),
  };
}

function updateAgentBlock(
  terminal: AgentTerminal,
  blockId: string,
  patch: Partial<Omit<AgentBlockEntry, 'id' | 'at' | 'kind' | 'detail'>>
): AgentTerminal {
  return {
    ...terminal,
    blocks: terminal.blocks.map((block) =>
      block.id === blockId
        ? {
            ...block,
            ...patch,
          }
        : block
    ),
  };
}

function loadSavedAgentWorkspace(): SavedAgentWorkspace | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AGENT_WORKSPACE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedAgentWorkspace>;
    if (parsed.version !== 1 || !Array.isArray(parsed.terminals)) return null;
    const terminals = parsed.terminals
      .filter(isSavedAgentTerminal)
      .map(normalizeSavedAgentTerminal);
    const selectedId =
      typeof parsed.selectedId === 'string' &&
      terminals.some((terminal) => terminal.id === parsed.selectedId)
        ? parsed.selectedId
        : (terminals[0]?.id ?? '');
    return {
      version: 1,
      layout: isAgentLayout(parsed.layout) ? parsed.layout : 'focus',
      selectedId,
      terminals,
    };
  } catch {
    return null;
  }
}

function serializeAgentWorkspace({
  layout,
  selectedId,
  terminals,
}: {
  layout: AgentLayout;
  selectedId: string;
  terminals: AgentTerminal[];
}): string {
  const payload: SavedAgentWorkspace = {
    version: 1,
    layout,
    selectedId,
    terminals: terminals.map((terminal) => ({
      id: terminal.id,
      name: terminal.name,
      cwd: terminal.cwd,
      prompt: terminal.prompt,
      model: terminal.model,
      sandbox: terminal.sandbox,
      approvalPolicy: terminal.approvalPolicy,
      size: terminal.size,
      background: terminal.background,
      status: terminal.status,
      started: terminal.started,
      updatedAt: terminal.updatedAt,
      statusReason: terminal.statusReason,
      structuredEventsActive: terminal.structuredEventsActive,
      lastAgentEvent: terminal.lastAgentEvent,
      lastAgentEventSource: terminal.lastAgentEventSource,
      lastAgentEventAt: terminal.lastAgentEventAt,
      lastStructuredEventSeq: terminal.lastStructuredEventSeq,
      structuredEventLog: terminal.structuredEventLog.slice(0, STRUCTURED_EVENT_LOG_LIMIT),
      activities: terminal.activities.slice(0, ACTIVITY_LIMIT),
      blocks: terminal.blocks.slice(0, BLOCK_LIMIT),
      composerDraft: terminal.composerDraft,
      composerMode: terminal.composerMode,
      composerHistory: terminal.composerHistory.slice(0, PROMPT_HISTORY_LIMIT),
      codexSessionId: terminal.codexSessionId,
      transcriptPath: terminal.transcriptPath,
    })),
  };
  return JSON.stringify(payload);
}

function saveAgentWorkspace(serializedWorkspace: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AGENT_WORKSPACE_STORAGE_KEY, serializedWorkspace);
  } catch {
    // Ignore disabled or quota-limited storage; the terminal manager remains authoritative.
  }
}

function agentPaneLayoutStorageKey(layout: AgentLayout, paneIds: string): string {
  return `${AGENT_PANEL_LAYOUT_STORAGE_PREFIX}:${layout}:${paneIds}`;
}

function loadAgentPaneLayout(
  storageKey: string,
  terminals: Pick<AgentTerminal, 'id'>[]
): PanelLayout | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const record = parsed as Record<string, unknown>;
    const terminalIds = new Set(terminals.map((terminal) => terminal.id));
    const layout: PanelLayout = {};
    for (const terminal of terminals) {
      const value = record[terminal.id];
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return undefined;
      }
      layout[terminal.id] = value;
    }
    if (Object.keys(record).some((id) => !terminalIds.has(id))) return undefined;
    return layout;
  } catch {
    return undefined;
  }
}

function saveAgentPaneLayout(storageKey: string, layout: PanelLayout) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    // Pane sizing is a convenience; ignore storage failures.
  }
}

function repoStatusPathSignature(terminals: AgentTerminal[]): string {
  return Array.from(
    new Set(terminals.map((terminal) => terminal.cwd.trim()).filter(isConcreteRepoPath))
  )
    .sort()
    .join('\n');
}

function liveRepoStatusPathSignature(terminals: AgentTerminal[], selectedId: string): string {
  return Array.from(
    new Set(
      terminals
        .filter((terminal) => terminal.running || terminal.id === selectedId)
        .map((terminal) => terminal.cwd.trim())
        .filter(isConcreteRepoPath)
    )
  )
    .sort()
    .join('\n');
}

function repoStatusPathsFromSignature(signature: string): string[] {
  return signature ? signature.split('\n') : [];
}

function agentBroadcastTargets(
  terminals: AgentTerminal[],
  scope: AgentBroadcastScope
): AgentTerminal[] {
  return terminals.filter((terminal) => {
    if (!terminal.running) return false;
    if (scope === 'all') return true;
    if (scope === 'foreground') return !terminal.background;
    return isAttentionTerminal(terminal);
  });
}

function createAgentTerminal({
  id,
  index,
  cwd,
  prompt = '',
  background = false,
  name,
}: {
  id: string;
  index: number;
  cwd: string;
  prompt?: string;
  background?: boolean;
  name?: string;
}): AgentTerminal {
  return {
    id,
    name: name ?? `Codex ${index}`,
    cwd,
    prompt,
    model: '',
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    status: 'white',
    size: 'compact',
    background,
    running: false,
    started: false,
    updatedAt: 'initialized',
    statusReason: 'Ready to start',
    idleMs: null,
    lastOutputAt: null,
    lastHeartbeatAt: null,
    waitingSince: null,
    structuredEventsActive: false,
    lastAgentEvent: null,
    lastAgentEventSource: null,
    lastAgentEventAt: null,
    lastStructuredEventSeq: null,
    structuredEventLog: [],
    activities: [],
    blocks: [],
    composerDraft: '',
    composerMode: 'prompt',
    composerHistory: [],
    outputTail: '',
    pid: null,
    codexSessionId: null,
    transcriptPath: null,
  };
}

function repoProjectName(projects: RepoProject[], repoPath: string): string | null {
  return projects.find((project) => project.repo_path === repoPath)?.display_name ?? null;
}

function terminalFromSaved(saved: SavedAgentTerminal): AgentTerminal {
  return {
    id: saved.id,
    name: saved.name,
    cwd: saved.cwd,
    prompt: saved.prompt,
    model: saved.model,
    sandbox: saved.sandbox,
    approvalPolicy: saved.approvalPolicy,
    status: saved.status ?? 'white',
    size: saved.size,
    background: saved.background,
    running: false,
    started: saved.started ?? false,
    updatedAt: saved.updatedAt ?? 'restored',
    statusReason: saved.statusReason ?? 'Ready to start',
    idleMs: null,
    lastOutputAt: null,
    lastHeartbeatAt: null,
    waitingSince: null,
    structuredEventsActive: saved.structuredEventsActive ?? false,
    lastAgentEvent: saved.lastAgentEvent ?? null,
    lastAgentEventSource: saved.lastAgentEventSource ?? null,
    lastAgentEventAt: saved.lastAgentEventAt ?? null,
    lastStructuredEventSeq: saved.lastStructuredEventSeq ?? null,
    structuredEventLog: saved.structuredEventLog ?? [],
    activities: saved.activities ?? [],
    blocks: saved.blocks ?? [],
    composerDraft: saved.composerDraft ?? '',
    composerMode: saved.composerMode ?? 'prompt',
    composerHistory: saved.composerHistory ?? [],
    outputTail: '',
    pid: null,
    codexSessionId: saved.codexSessionId ?? null,
    transcriptPath: saved.transcriptPath ?? null,
  };
}

function terminalFromSnapshot(
  snapshot: CodexAgentTerminalSnapshot,
  fallbackIndex: number
): AgentTerminal {
  const outputTail = hydrateSnapshotOutput(snapshot);
  return applySnapshotAgentEvent(
    {
      id: snapshot.session_id,
      name: `Codex ${fallbackIndex}`,
      cwd: snapshot.cwd,
      prompt: '',
      model: '',
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
      status: 'green',
      size: 'compact',
      background: false,
      running: snapshot.running,
      started: true,
      updatedAt: 'reattached',
      statusReason: 'Attached to running Codex process',
      idleMs: null,
      lastOutputAt: null,
      lastHeartbeatAt: Date.now(),
      waitingSince: null,
      structuredEventsActive: false,
      lastAgentEvent: null,
      lastAgentEventSource: null,
      lastAgentEventAt: null,
      lastStructuredEventSeq: null,
      structuredEventLog: [],
      activities: [
        {
          id: `${snapshot.session_id}-reattached-${Date.now()}`,
          at: Date.now(),
          kind: 'info',
          label: 'Attached to running process',
          detail: snapshot.pid ? `pid ${snapshot.pid}` : undefined,
        },
      ],
      blocks: [
        {
          id: `${snapshot.session_id}-block-reattached-${Date.now()}`,
          at: Date.now(),
          kind: 'launch',
          status: 'green',
          title: 'Reattached',
          detail: snapshot.pid ? `pid ${snapshot.pid}` : 'Running Codex process',
        },
      ],
      composerDraft: '',
      composerMode: 'prompt',
      composerHistory: [],
      outputTail,
      pid: snapshot.pid ?? null,
      codexSessionId: snapshot.codex_session_id ?? null,
      transcriptPath: snapshot.transcript_path ?? null,
    },
    snapshot
  );
}

function mergeTerminalSnapshot(
  terminal: AgentTerminal,
  snapshot: CodexAgentTerminalSnapshot
): AgentTerminal {
  const snapshotOutputTail = hydrateSnapshotOutput(snapshot, terminal.id);
  const next = {
    ...terminal,
    cwd: snapshot.cwd || terminal.cwd,
    running: snapshot.running,
    started: true,
    status: snapshot.running ? 'green' : terminal.status,
    updatedAt: snapshot.running ? 'reattached' : terminal.updatedAt,
    statusReason: snapshot.running ? 'Attached to running Codex process' : terminal.statusReason,
    lastHeartbeatAt: Date.now(),
    pid: snapshot.pid ?? terminal.pid,
    codexSessionId: snapshot.codex_session_id ?? terminal.codexSessionId,
    transcriptPath: snapshot.transcript_path ?? terminal.transcriptPath,
    outputTail: snapshotOutputTail || terminal.outputTail,
  };
  const hydrated = applySnapshotAgentEvent(next, snapshot);
  return snapshot.running && !terminal.running
    ? appendActivity(hydrated, {
        kind: 'info',
        label: 'Attached to running process',
        detail: snapshot.pid ? `pid ${snapshot.pid}` : undefined,
      })
    : hydrated;
}

function applySnapshotAgentEvent(
  terminal: AgentTerminal,
  snapshot: CodexAgentTerminalSnapshot
): AgentTerminal {
  const events = snapshot.agent_events?.length
    ? [...snapshot.agent_events]
        .filter((event) => typeof event.data === 'string' && event.data.trim().length > 0)
        .filter((event) => isNewStructuredEvent(terminal.lastStructuredEventSeq, event.seq))
        .sort((a, b) => a.seq - b.seq || a.at_ms - b.at_ms)
    : snapshot.last_agent_event && terminal.lastStructuredEventSeq == null
      ? [{ seq: 0, at_ms: Date.now(), data: snapshot.last_agent_event }]
      : [];

  return events.reduce((current, event) => {
    const payload = parseCodexCliAgentPayload(event.data);
    if (!payload) return current;
    return applySnapshotStructuredAgentEvent(
      current,
      snapshot,
      payload,
      event.seq,
      event.at_ms || Date.now()
    );
  }, terminal);
}

function applySnapshotStructuredAgentEvent(
  terminal: AgentTerminal,
  snapshot: CodexAgentTerminalSnapshot,
  payload: CodexCliAgentPayload,
  eventSeq: number,
  at: number
): AgentTerminal {
  if (!payload) return terminal;
  const patch = terminalPatchForCodexEvent(payload);
  const eventSource = codexPayloadEventSource(payload);

  return appendActivity(
    appendBlock(
      {
        ...terminal,
        ...patch,
        running: snapshot.running,
        started: true,
        structuredEventsActive: terminal.structuredEventsActive || eventSource === 'codex-warp',
        lastAgentEventSource: eventSource,
        lastAgentEventAt: at,
        lastStructuredEventSeq: maxStructuredEventSeq(terminal.lastStructuredEventSeq, eventSeq),
        structuredEventLog: appendStructuredEventLog(terminal.structuredEventLog, {
          terminalId: terminal.id,
          payload,
          source: eventSource,
          seq: eventSeq,
          at,
          status: patch.status ?? terminal.status,
          detail: patch.statusReason,
        }),
        waitingSince: patch.status === 'yellow' ? (terminal.waitingSince ?? at) : null,
      },
      {
        kind: codexBlockKindForStatus(patch.status),
        status: patch.status ?? terminal.status,
        title: codexEventBlockTitle(payload, patch),
        detail: codexEventBlockDetail(payload, patch),
        at,
      }
    ),
    {
      kind: codexActivityKindForStatus(patch.status),
      label: payload.event ?? 'Codex event',
      detail: patch.statusReason,
      at,
    }
  );
}

function isNewStructuredEvent(lastSeq: number | null, eventSeq: number): boolean {
  return Number.isFinite(eventSeq) && (lastSeq == null || eventSeq > lastSeq);
}

function maxStructuredEventSeq(lastSeq: number | null, eventSeq: number | null): number | null {
  if (eventSeq == null || !Number.isFinite(eventSeq)) return lastSeq;
  return lastSeq == null ? eventSeq : Math.max(lastSeq, eventSeq);
}

function appendStructuredEventLog(
  entries: AgentStructuredEventEntry[],
  event: {
    terminalId: string;
    payload: CodexCliAgentPayload;
    source: AgentEventSource;
    seq: number | null;
    at: number;
    status: AgentStatus;
    detail?: string;
  }
): AgentStructuredEventEntry[] {
  const eventName = event.payload.event ?? 'codex_event';
  const id = `${event.terminalId}-structured-${event.seq ?? event.at}-${eventName}`;
  if (entries.some((entry) => entry.id === id)) return entries;
  return [
    {
      id,
      seq: event.seq,
      at: event.at,
      source: event.source,
      event: eventName,
      status: event.status,
      title: codexStructuredEventTitle(event.payload),
      detail: event.detail ?? codexStructuredEventDetail(event.payload),
    },
    ...entries,
  ].slice(0, STRUCTURED_EVENT_LOG_LIMIT);
}

function codexStructuredEventTitle(payload: CodexCliAgentPayload): string {
  if (payload.event === 'tool_start' && payload.tool_name) return `tool: ${payload.tool_name}`;
  if (payload.event === 'tool_complete' && payload.tool_name)
    return `tool done: ${payload.tool_name}`;
  if (payload.event === 'permission_request') return 'permission request';
  if (payload.event === 'ask_user') return 'question';
  if (payload.event === 'stop') return 'turn complete';
  if (payload.event === 'error') return 'error';
  return payload.event ?? 'Codex event';
}

function codexStructuredEventDetail(payload: CodexCliAgentPayload): string | undefined {
  if (payload.summary) return payload.summary;
  if (payload.query) return payload.query;
  if (payload.response) return payload.response;
  if (payload.tool_input && typeof payload.tool_input === 'object') {
    const command =
      'command' in payload.tool_input && typeof payload.tool_input.command === 'string'
        ? payload.tool_input.command
        : null;
    const filePath =
      'file_path' in payload.tool_input && typeof payload.tool_input.file_path === 'string'
        ? payload.tool_input.file_path
        : null;
    return command ?? filePath ?? undefined;
  }
  return undefined;
}

function hydrateSnapshotOutput(
  snapshot: CodexAgentTerminalSnapshot,
  id = snapshot.session_id
): string {
  const output = snapshot.output_tail ?? '';
  if (!output || getTerminalOutput(id)) return '';
  setTerminalOutput(id, output);
  return output.slice(-OUTPUT_TAIL_CHARS);
}

function latestActivityLabel(terminal: AgentTerminal): string {
  return terminal.activities[0]?.label ?? terminalStatusLabel(terminal);
}

function terminalSidebarLabel(
  terminal: AgentTerminal,
  repoStatus: RepoProjectGitStatus | null
): string {
  const lifecycle = agentLifecycleLabel(terminal);
  if (terminal.background) return `bg · ${lifecycle} · ${terminalStatusLabel(terminal)}`;
  if (terminal.activities.length > 0) return `${lifecycle} · ${latestActivityLabel(terminal)}`;
  return `${lifecycle} · ${repoContextLabel(terminal, repoStatus)}`;
}

function repoContextLabel(
  terminal: AgentTerminal,
  repoStatus: RepoProjectGitStatus | null
): string {
  const cwd = compactPathLabel(terminal.cwd);
  if (!repoStatus) return cwd;
  const branch = repoStatus.branch ?? 'detached';
  const dirty = repoStatus.changed_files > 0 ? ` +${repoStatus.changed_files}` : '';
  return `${cwd} · ${branch}${dirty}`;
}

function repoGitStatusLabel(status: RepoProjectGitStatus): string {
  const branch = status.branch ?? 'detached';
  return status.changed_files > 0
    ? `${branch} · ${status.changed_files} changed`
    : `${branch} · clean`;
}

function resourceSampleForTerminal(
  terminal: AgentTerminal,
  samplesByPid: AgentResourceSamplesByPid
): ResourceProcessSample | null {
  if (terminal.pid == null || !terminal.running) return null;
  return samplesByPid[terminal.pid] ?? null;
}

function resourceSampleLabel(sample: ResourceProcessSample): string {
  return `cpu ${formatCpuPercent(sample.cpu_percent)} · ram ${formatBytesCompact(sample.ram_bytes)}`;
}

function formatCpuPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  const clamped = Math.max(0, value);
  return clamped < 10 ? `${clamped.toFixed(1)}%` : `${Math.round(clamped)}%`;
}

function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function compactPathLabel(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '~';
  if (trimmed === '~') return '~';
  return trimmed.split('/').filter(Boolean).at(-1) ?? trimmed;
}

function compactSessionId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

function activityTextClass(kind: AgentActivityKind): string {
  switch (kind) {
    case 'attention':
      return 'text-amber-200';
    case 'error':
      return 'text-red-200';
    case 'exit':
      return 'text-slate-300';
    case 'event':
      return 'text-cyan-100';
    case 'input':
      return 'text-emerald-200/85';
    default:
      return 'text-slate-300';
  }
}

function blockKindLabel(kind: AgentBlockKind): string {
  switch (kind) {
    case 'launch':
      return 'launch';
    case 'prompt':
      return 'prompt';
    case 'shell':
      return 'shell';
    case 'event':
      return 'event';
    case 'attention':
      return 'wait';
    case 'exit':
      return 'exit';
  }
}

function blockKindIcon(kind: AgentBlockKind) {
  switch (kind) {
    case 'launch':
      return <Play size={10} />;
    case 'prompt':
      return <SendHorizontal size={10} />;
    case 'shell':
      return <TerminalIcon size={10} />;
    case 'event':
      return <Activity size={10} />;
    case 'attention':
      return <Bot size={10} />;
    case 'exit':
      return <Square size={9} />;
  }
}

function blockIconClass(block: AgentBlockEntry): string {
  if (block.kind === 'shell') return 'text-cyan-100/80';
  return statusMeta[block.status].text;
}

function isReplayableBlock(block: AgentBlockEntry): boolean {
  return Boolean(block.detail && (block.kind === 'prompt' || block.kind === 'shell'));
}

function isSendableShellContextBlock(block: AgentBlockEntry): boolean {
  return Boolean(block.kind === 'shell' && block.detail && block.output);
}

function isExpandableBlock(block: AgentBlockEntry): boolean {
  return Boolean(block.detail || block.output);
}

function blockPreviewText(block: AgentBlockEntry): string {
  if (block.kind === 'shell') return shellBlockMeta(block) || block.detail || '';
  return block.detail ?? '';
}

function shellBlockMeta(block: AgentBlockEntry): string {
  const parts = [
    block.cwd ? `cwd: ${compactPathLabel(block.cwd)}` : '',
    typeof block.exitCode === 'number' ? `exit ${block.exitCode}` : '',
    typeof block.durationMs === 'number' ? formatDuration(block.durationMs) : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function blockCopyText(block: AgentBlockEntry): string {
  const parts = [`${blockKindLabel(block.kind)}: ${block.title}`];
  if (block.detail) parts.push(block.kind === 'shell' ? `!${block.detail}` : block.detail);
  const meta = shellBlockMeta(block);
  if (meta) parts.push(meta);
  if (block.output) parts.push(stripAnsi(block.output).trimEnd());
  parts.push(`status: ${statusMeta[block.status].label}`);
  return parts.join('\n');
}

function shellBlockContextPrompt(block: AgentBlockEntry): string {
  const command = block.detail ?? 'shell command';
  const output = stripAnsi(block.output ?? '').trimEnd();
  const boundedOutput =
    output.length > SHELL_CONTEXT_OUTPUT_CHARS
      ? `${output.slice(0, SHELL_CONTEXT_OUTPUT_CHARS)}\n[output truncated: ${(
          output.length - SHELL_CONTEXT_OUTPUT_CHARS
        ).toLocaleString()} chars omitted]`
      : output;
  return [
    'Use this shell command result as context for the current task.',
    '',
    `Command: ${command}`,
    block.cwd ? `Directory: ${block.cwd}` : '',
    typeof block.exitCode === 'number' ? `Exit code: ${block.exitCode}` : '',
    typeof block.durationMs === 'number' ? `Duration: ${formatDuration(block.durationMs)}` : '',
    '',
    'Output:',
    '```text',
    boundedOutput || '(no output)',
    '```',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function terminalOutputContextPrompt({
  text,
  source,
}: {
  text: string;
  source: 'selection' | 'recent output';
}): string {
  const output = stripAnsi(text).trimEnd();
  const boundedOutput =
    output.length > TERMINAL_CONTEXT_OUTPUT_CHARS
      ? `${output.slice(-TERMINAL_CONTEXT_OUTPUT_CHARS)}\n[output truncated: ${(
          output.length - TERMINAL_CONTEXT_OUTPUT_CHARS
        ).toLocaleString()} leading chars omitted]`
      : output;
  return [
    `Use this terminal ${source} as context for the current task.`,
    '',
    'Terminal context:',
    '```text',
    boundedOutput || '(no terminal text)',
    '```',
  ].join('\n');
}

function formatShellCommandOutput(result: AgentTerminalCommandResult): string {
  const parts = [
    result.stdout,
    result.stderr,
    result.stdout_truncated ? '\n[stdout truncated]\n' : '',
    result.stderr_truncated ? '\n[stderr truncated]\n' : '',
    `\r\n[exit ${result.exit_code}${result.timed_out ? ' · timed out' : ''} · ${formatDuration(result.duration_ms)}]\r\n`,
  ].filter(Boolean);
  return parts.join('');
}

function shellCommandFailureReason(result: AgentTerminalCommandResult): string {
  if (result.timed_out) return `Command timed out after ${formatDuration(result.timeout_ms)}`;
  return `Command exited ${result.exit_code}`;
}

function shellCommandBlockDetail(result: AgentTerminalCommandResult): string {
  const detail = [
    result.command,
    `cwd: ${result.cwd}`,
    `exit: ${result.exit_code}`,
    `duration: ${formatDuration(result.duration_ms)}`,
    result.timed_out ? 'timed out' : '',
    result.stdout_truncated ? 'stdout truncated' : '',
    result.stderr_truncated ? 'stderr truncated' : '',
  ].filter(Boolean);
  return detail.join(' · ');
}

function buildTerminalTranscript(terminal: AgentTerminal, output: string): string {
  const blocks = [...terminal.blocks]
    .reverse()
    .map((block) =>
      [
        `- ${new Date(block.at).toISOString()} [${blockKindLabel(block.kind)}:${block.status}] ${block.title}`,
        block.detail ? `  ${block.detail}` : '',
        shellBlockMeta(block) ? `  ${shellBlockMeta(block)}` : '',
        block.output ? `  output:\n${indentLines(stripAnsi(block.output).trimEnd(), 4)}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    );
  const activities = [...terminal.activities]
    .reverse()
    .map((entry) =>
      [
        `- ${new Date(entry.at).toISOString()} [${entry.kind}] ${entry.label}`,
        entry.detail ? `  ${entry.detail}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    );
  const cleanedOutput = stripAnsi(output).trimEnd();
  return [
    `# ${terminal.name} Codex Session`,
    '',
    '## Agent',
    `- Status: ${terminalStatusLabel(terminal)}`,
    `- Reason: ${terminal.statusReason}`,
    `- Working directory: ${terminal.cwd || '~'}`,
    `- Model: ${terminal.model.trim() || 'default'}`,
    `- Sandbox: ${terminal.sandbox}`,
    `- Approvals: ${terminal.approvalPolicy}`,
    `- Signal: ${terminalSignalLabel(terminal)}`,
    terminal.lastAgentEvent
      ? `- Last event: ${terminal.lastAgentEvent} (${terminal.lastAgentEventSource ?? 'unknown'})`
      : '- Last event: none',
    terminal.pid != null ? `- PID: ${terminal.pid}` : '- PID: none',
    terminal.codexSessionId
      ? `- Codex session: ${terminal.codexSessionId}`
      : '- Codex session: none',
    terminal.transcriptPath
      ? `- Codex transcript: ${terminal.transcriptPath}`
      : '- Codex transcript: none',
    '',
    '## Launch',
    '```sh',
    codexLaunchCommand(terminal),
    '```',
    '',
    '## Blocks',
    blocks.length > 0 ? blocks.join('\n') : 'No blocks recorded.',
    '',
    '## Activity',
    activities.length > 0 ? activities.join('\n') : 'No activity recorded.',
    '',
    '## Terminal Output',
    '```text',
    cleanedOutput || 'No terminal output recorded.',
    '```',
    '',
  ].join('\n');
}

function downloadTextFile(content: string, filename: string, mime: string) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function indentLines(value: string, spaces: number): string {
  const indent = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');
}

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'codex-session'
  );
}

function formatFileTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function blockBorderClass(status: AgentStatus): string {
  switch (status) {
    case 'white':
      return 'border-white/10';
    case 'green':
      return 'border-emerald-300/16';
    case 'yellow':
      return 'border-amber-300/20';
    case 'red':
      return 'border-red-300/20';
  }
}

function formatActivityTime(value: number): string {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (elapsedSeconds < 5) return 'now';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function isSavedAgentTerminal(value: unknown): value is SavedAgentTerminal {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.cwd === 'string' &&
    typeof record.prompt === 'string' &&
    typeof record.model === 'string' &&
    isSandbox(record.sandbox) &&
    isApprovalPolicy(record.approvalPolicy) &&
    isAgentSize(record.size) &&
    typeof record.background === 'boolean'
  );
}

function normalizeSavedAgentTerminal(saved: SavedAgentTerminal): SavedAgentTerminal {
  const record = saved as unknown as Record<string, unknown>;
  return {
    id: saved.id,
    name: saved.name,
    cwd: saved.cwd,
    prompt: saved.prompt,
    model: saved.model,
    sandbox: saved.sandbox,
    approvalPolicy: saved.approvalPolicy,
    size: saved.size,
    background: saved.background,
    status: isAgentStatus(record.status) ? record.status : undefined,
    started: typeof record.started === 'boolean' ? record.started : undefined,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
    statusReason: typeof record.statusReason === 'string' ? record.statusReason : undefined,
    structuredEventsActive:
      typeof record.structuredEventsActive === 'boolean'
        ? record.structuredEventsActive
        : undefined,
    lastAgentEvent:
      typeof record.lastAgentEvent === 'string' || record.lastAgentEvent === null
        ? record.lastAgentEvent
        : undefined,
    lastAgentEventSource:
      isAgentEventSource(record.lastAgentEventSource) || record.lastAgentEventSource === null
        ? record.lastAgentEventSource
        : undefined,
    lastAgentEventAt: finiteNumberOrNull(record.lastAgentEventAt),
    lastStructuredEventSeq: finiteNumberOrNull(record.lastStructuredEventSeq),
    structuredEventLog: normalizeSavedStructuredEventLog(record.structuredEventLog),
    activities: normalizeSavedActivities(record.activities),
    blocks: normalizeSavedBlocks(record.blocks),
    composerDraft: typeof record.composerDraft === 'string' ? record.composerDraft : undefined,
    composerMode: isComposerMode(record.composerMode) ? record.composerMode : undefined,
    composerHistory: normalizeSavedComposerHistory(record.composerHistory),
    codexSessionId:
      typeof record.codexSessionId === 'string' || record.codexSessionId === null
        ? record.codexSessionId
        : undefined,
    transcriptPath:
      typeof record.transcriptPath === 'string' || record.transcriptPath === null
        ? record.transcriptPath
        : undefined,
  };
}

function isAgentLayout(value: unknown): value is AgentLayout {
  return value === 'focus' || value === 'columns' || value === 'rows' || value === 'grid';
}

function isAgentStatus(value: unknown): value is AgentStatus {
  return value === 'white' || value === 'green' || value === 'yellow' || value === 'red';
}

function isAgentSize(value: unknown): value is AgentSize {
  return value === 'compact' || value === 'wide' || value === 'tall';
}

function isAgentActivityKind(value: unknown): value is AgentActivityKind {
  return (
    value === 'info' ||
    value === 'event' ||
    value === 'input' ||
    value === 'attention' ||
    value === 'error' ||
    value === 'exit'
  );
}

function isAgentBlockKind(value: unknown): value is AgentBlockKind {
  return (
    value === 'launch' ||
    value === 'prompt' ||
    value === 'shell' ||
    value === 'event' ||
    value === 'attention' ||
    value === 'exit'
  );
}

function isAgentEventSource(value: unknown): value is AgentEventSource {
  return value === 'codex-warp' || value === 'codex-osc9' || value === 'terminal';
}

function isComposerMode(value: unknown): value is AgentComposerMode {
  return value === 'prompt' || value === 'shell';
}

function finiteNumberOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeSavedComposerHistory(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const history = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, PROMPT_HISTORY_LIMIT);
  return history.length > 0 ? history : undefined;
}

function normalizeSavedActivities(value: unknown): AgentActivityEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const activities = value.filter(isSavedActivityEntry).slice(0, ACTIVITY_LIMIT);
  return activities.length > 0 ? activities : undefined;
}

function normalizeSavedStructuredEventLog(value: unknown): AgentStructuredEventEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const events = value.filter(isSavedStructuredEventEntry).slice(0, STRUCTURED_EVENT_LOG_LIMIT);
  return events.length > 0 ? events : undefined;
}

function isSavedStructuredEventEntry(value: unknown): value is AgentStructuredEventEntry {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    (record.seq === null || (typeof record.seq === 'number' && Number.isFinite(record.seq))) &&
    typeof record.at === 'number' &&
    Number.isFinite(record.at) &&
    isAgentEventSource(record.source) &&
    typeof record.event === 'string' &&
    isAgentStatus(record.status) &&
    typeof record.title === 'string' &&
    (record.detail === undefined || typeof record.detail === 'string')
  );
}

function isSavedActivityEntry(value: unknown): value is AgentActivityEntry {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.at === 'number' &&
    Number.isFinite(record.at) &&
    isAgentActivityKind(record.kind) &&
    typeof record.label === 'string' &&
    (record.detail === undefined || typeof record.detail === 'string')
  );
}

function normalizeSavedBlocks(value: unknown): AgentBlockEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const blocks = value.filter(isSavedBlockEntry).slice(0, BLOCK_LIMIT);
  return blocks.length > 0 ? blocks : undefined;
}

function isSavedBlockEntry(value: unknown): value is AgentBlockEntry {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.at === 'number' &&
    Number.isFinite(record.at) &&
    isAgentBlockKind(record.kind) &&
    isAgentStatus(record.status) &&
    typeof record.title === 'string' &&
    (record.detail === undefined || typeof record.detail === 'string') &&
    (record.output === undefined || typeof record.output === 'string') &&
    (record.cwd === undefined || typeof record.cwd === 'string') &&
    (record.exitCode === undefined ||
      (typeof record.exitCode === 'number' && Number.isFinite(record.exitCode))) &&
    (record.durationMs === undefined ||
      (typeof record.durationMs === 'number' && Number.isFinite(record.durationMs)))
  );
}

function isSandbox(value: unknown): value is AgentTerminal['sandbox'] {
  return value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access';
}

function isApprovalPolicy(value: unknown): value is AgentTerminal['approvalPolicy'] {
  return value === 'untrusted' || value === 'on-request' || value === 'never';
}

function codexPluginReady(status: CodexWarpPluginStatus | null): boolean {
  return Boolean(
    status?.codex_available &&
      status.marketplace_installed &&
      status.warp_plugin_installed &&
      status.warp_plugin_enabled &&
      status.structured_env_enabled
  );
}

function codexPayloadEventSource(payload: CodexCliAgentPayload): AgentEventSource {
  return payload.fallback === 'osc9' ? 'codex-osc9' : 'codex-warp';
}

function codexBlockKindForStatus(status: AgentStatus | undefined): AgentBlockKind {
  if (status === 'yellow') return 'attention';
  if (status === 'red') return 'exit';
  return 'event';
}

function codexActivityKindForStatus(status: AgentStatus | undefined): AgentActivityKind {
  if (status === 'yellow') return 'attention';
  if (status === 'red') return 'error';
  return 'event';
}

function codexEventBlockTitle(payload: CodexCliAgentPayload, patch: CodexAgentEventPatch): string {
  if (isCodexFailureEvent(payload.event)) return 'Codex failure';
  switch (payload.event) {
    case 'prompt_submit':
      return 'Prompt submitted';
    case 'permission_request':
      return 'Permission request';
    case 'question_asked':
      return 'Question asked';
    case 'permission_replied':
      return 'Permission replied';
    case 'tool_complete':
      return payload.tool_name ? `Tool complete: ${payload.tool_name}` : 'Tool complete';
    case 'stop':
      return 'Turn complete';
    case 'session_start':
      return 'Session started';
    case 'idle_prompt':
      return 'Idle prompt';
    default:
      return payload.event ?? patch.lastAgentEvent;
  }
}

function codexEventBlockDetail(payload: CodexCliAgentPayload, patch: CodexAgentEventPatch): string {
  const toolPreview = codexToolInputPreview(payload.tool_input);
  if (payload.event === 'prompt_submit' && payload.query) return truncateText(payload.query, 220);
  if (payload.event === 'stop' && (payload.response || payload.query)) {
    return truncateText(payload.response ?? payload.query ?? '', 220);
  }
  if (payload.event === 'stop' && payload.transcript_path) {
    return `Transcript: ${truncateText(payload.transcript_path, 200)}`;
  }
  if (toolPreview) return toolPreview;
  const details = [
    patch.statusReason ?? payload.summary ?? payload.event ?? 'Codex event',
    payload.transcript_path ? `transcript: ${payload.transcript_path}` : '',
    payload.session_id ? `session: ${payload.session_id}` : '',
  ].filter(Boolean);
  return truncateText(details.join(' · '), 220);
}

function codexToolInputPreview(toolInput: CodexCliAgentPayload['tool_input']): string | null {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const command = 'command' in toolInput ? toolInput.command : undefined;
  if (typeof command === 'string' && command.trim()) return truncateText(command, 220);
  const filePath = 'file_path' in toolInput ? toolInput.file_path : undefined;
  if (typeof filePath === 'string' && filePath.trim()) return truncateText(filePath, 220);
  return null;
}

function getTerminalOutput(id: string): string {
  return outputBuffers.get(id) ?? '';
}

function getTerminalOutputTail(id: string): string {
  return outputTails.get(id) ?? '';
}

function isDuplicateTerminalOutput(id: string, seq: number | null): boolean {
  if (seq == null) return false;
  const last = outputSequences.get(id);
  if (last != null && seq <= last) return true;
  outputSequences.set(id, seq);
  return false;
}

function appendTerminalOutput(id: string, chunk: string): string {
  const raw = `${outputBuffers.get(id) ?? ''}${chunk}`;
  const next = raw.length > OUTPUT_BUFFER_CHARS ? raw.slice(raw.length - OUTPUT_BUFFER_CHARS) : raw;
  const tail = next.slice(-OUTPUT_TAIL_CHARS);
  outputBuffers.set(id, next);
  outputTails.set(id, tail);
  emitTerminalOutput({ id, chunk });
  return tail;
}

function setTerminalOutput(id: string, output: string): string {
  const next =
    output.length > OUTPUT_BUFFER_CHARS
      ? output.slice(output.length - OUTPUT_BUFFER_CHARS)
      : output;
  const tail = next.slice(-OUTPUT_TAIL_CHARS);
  outputBuffers.set(id, next);
  outputTails.set(id, tail);
  emitTerminalOutput({ id, chunk: next, clear: true });
  return tail;
}

function clearTerminalOutput(id: string) {
  outputBuffers.delete(id);
  outputTails.delete(id);
  outputSequences.delete(id);
  emitTerminalOutput({ id, chunk: '', clear: true });
}

function subscribeTerminalOutput(id: string, subscriber: TerminalOutputSubscriber): () => void {
  const subscribers = outputSubscribers.get(id) ?? new Set<TerminalOutputSubscriber>();
  subscribers.add(subscriber);
  outputSubscribers.set(id, subscribers);
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) outputSubscribers.delete(id);
  };
}

function emitTerminalOutput(event: TerminalOutputEvent) {
  const subscribers = outputSubscribers.get(event.id);
  if (!subscribers) return;
  for (const subscriber of subscribers) {
    subscriber(event);
  }
}

function loadWebglRenderer(term: XTerm): { dispose: () => void } | null {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return null;

  let disposed = false;
  let contextLossDisposable: { dispose: () => void } | null = null;

  void import('@xterm/addon-webgl')
    .then(({ WebglAddon }) => {
      if (disposed) return;
      const addon = new WebglAddon();
      contextLossDisposable = addon.onContextLoss(() => {
        contextLossDisposable?.dispose();
        contextLossDisposable = null;
      });
      term.loadAddon(addon);
      if (disposed) {
        contextLossDisposable?.dispose();
        contextLossDisposable = null;
        return;
      }
    })
    .catch(() => {
      // Keep the default xterm renderer if WebGL is unavailable in this webview.
    });

  return {
    dispose: () => {
      disposed = true;
      contextLossDisposable?.dispose();
      contextLossDisposable = null;
    },
  };
}

function isXtermAtBottom(term: XTerm): boolean {
  return term.buffer.active.viewportY >= term.buffer.active.baseY;
}

async function copyText(value: string): Promise<void> {
  if (!value || typeof navigator === 'undefined' || !navigator.clipboard) return;
  await navigator.clipboard.writeText(value);
}

function fitTerminal(
  fit: FitAddon,
  onResizeRef: { current: (cols: number, rows: number) => void },
  lastResizeRef: { current: { cols: number; rows: number } | null }
) {
  fit.fit();
  const dims = fit.proposeDimensions();
  if (!dims) return;
  const last = lastResizeRef.current;
  if (last?.cols === dims.cols && last.rows === dims.rows) return;
  lastResizeRef.current = dims;
  onResizeRef.current(dims.cols, dims.rows);
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function stripAnsi(value: string): string {
  const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
  return value.replace(ansiEscapePattern, '');
}

function codexBlockedReason(chunk: string): string | null {
  const plain = stripAnsi(chunk).replace(/\s+/g, ' ').toLowerCase();
  const signals: Array<[string, string]> = [
    ['requires approval', 'approval requested'],
    ['approval required', 'approval requested'],
    ['allow command', 'approval requested'],
    ['allow this command', 'approval requested'],
    ['enter to review hooks', 'hook review needed'],
    ['hooks need review', 'hook review needed'],
    ['review hooks', 'hook review needed'],
    ['press enter', 'waiting for Enter'],
    ['continue?', 'waiting for confirmation'],
    ['waiting for', 'waiting'],
    ['y/n', 'waiting for confirmation'],
  ];
  return signals.find(([needle]) => plain.includes(needle))?.[1] ?? null;
}
