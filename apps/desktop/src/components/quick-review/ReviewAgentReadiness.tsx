import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';

import {
  getMcpRepositorySettings,
  isTauriAvailable,
  type McpRepositorySettings,
} from '@/lib/tauri-ipc';

export default function ReviewAgentReadiness({
  repoPath,
  diffRange,
}: {
  repoPath: string;
  diffRange: string;
}) {
  const [settings, setSettings] = useState<McpRepositorySettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setSettings(null);
    setLoaded(false);
    setLoadFailed(false);
    if (!repoPath || !isTauriAvailable()) {
      setLoaded(true);
      return () => {
        active = false;
      };
    }
    void getMcpRepositorySettings(repoPath)
      .then((next) => {
        if (active) setSettings(next);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [repoPath]);

  const hasTool = settings?.tool_names.includes('prepare_review') ?? false;
  const ready = Boolean(settings?.enabled && settings.indexed && hasTool);
  const localCheckCommand = diffRange
    ? `codevetter check --repo ${shellQuote(repoPath)} --range ${shellQuote(diffRange)} --task '<describe expected behavior>' --json`
    : '';
  const message = readinessMessage({
    loaded,
    loadFailed,
    diffRange,
    ready,
    stale: settings?.stale ?? false,
    indexed: settings?.indexed ?? false,
    hasTool,
  });

  return (
    <div className="border border-[var(--cv-line)] bg-[var(--cv-canvas)] px-3 py-2.5 text-[11px] leading-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0" role="status" aria-live="polite">
          <p className={ready ? 'font-medium text-emerald-400' : 'font-medium text-slate-300'}>
            {ready ? 'Review agent ready' : 'Review agent setup'}
          </p>
          <p className="text-[var(--cv-text-muted)]">{message}</p>
        </div>
        <Link
          to="/settings?section=mcp"
          className="inline-flex min-h-10 shrink-0 items-center self-start text-[var(--cv-accent)] hover:text-amber-300"
        >
          Agent MCP
        </Link>
      </div>
      {localCheckCommand ? (
        <div className="mt-2.5 border-t border-[var(--cv-line)] pt-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <p className="font-medium text-slate-300">Run the full local check</p>
              <p className="text-[var(--cv-text-muted)]">
                Requires a clean checkout of this change. CodeVetter records evidence but never
                edits, pushes, merges, or deploys it.
              </p>
              <p className="text-[var(--cv-text-secondary)]">
                Replace the task text, then run the command in Terminal.
              </p>
            </div>
            <CopyLocalCheck command={localCheckCommand} />
          </div>
          <code className="mt-2 block overflow-x-auto whitespace-nowrap bg-black/25 px-2 py-1.5 font-mono text-[10px] text-slate-400">
            {localCheckCommand}
          </code>
        </div>
      ) : null}
    </div>
  );
}

function CopyLocalCheck({ command }: { command: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1600);
    } catch {
      setCopyState('failed');
    }
  }

  const copied = copyState === 'copied';
  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={() => void copyCommand()}
        className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--cv-line-strong)] bg-[var(--bg-raised)] px-3 font-medium text-slate-200 transition-colors hover:border-[var(--cv-accent)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cv-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--cv-canvas)] sm:w-auto"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : copyState === 'failed' ? 'Try copy again' : 'Copy command template'}
      </button>
      <p className={copyState === 'failed' ? 'mt-1 text-rose-300' : 'sr-only'} aria-live="polite">
        {copied
          ? 'Local check command template copied.'
          : copyState === 'failed'
            ? 'Copy failed. Select the command below and copy it manually.'
            : ''}
      </p>
    </div>
  );
}

function readinessMessage({
  loaded,
  loadFailed,
  diffRange,
  ready,
  stale,
  indexed,
  hasTool,
}: {
  loaded: boolean;
  loadFailed: boolean;
  diffRange: string;
  ready: boolean;
  stale: boolean;
  indexed: boolean;
  hasTool: boolean;
}): string {
  if (!loaded) return 'Checking Agent MCP readiness…';
  if (loadFailed)
    return 'CodeVetter could not read Agent MCP readiness. Open settings and try again.';
  if (!diffRange) return 'Choose a branch or pull request to give a review agent an exact change.';
  if (ready && stale) {
    return 'External review agents can prepare this range with stale context clearly marked.';
  }
  if (ready) return 'External review agents can prepare this exact range before reviewing it.';
  if (!indexed)
    return 'Build repository history, then enable Agent MCP for external review agents.';
  if (!hasTool) return 'Update CodeVetter to expose prepare_review to external review agents.';
  return 'Enable Agent MCP for this repository to authorize external review preparation.';
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9/._:-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
