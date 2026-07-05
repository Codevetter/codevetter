import {
  AlertTriangle,
  Crosshair,
  GitBranch,
  Loader2,
  Network,
  Play,
  Search,
  Target,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';

import { DeepGraphViewer } from '@/components/deep-graph-viewer';
import { UnpackAgentStream } from '@/components/unpack-agent-stream';
import { UnpackRunKindBadge } from '@/components/unpack-workspace/UnpackRunKindBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  buildDeepGraphViewModel,
  type DeepGraphLookupMode,
  type DeepGraphViewModel,
} from '@/lib/deep-graph-parse';
import {
  isTauriAvailable,
  unpackDeepGraphAnalyze,
  unpackDeepGraphCancelAnalyze,
  unpackDeepGraphQuery,
  unpackDeepGraphStatus,
  unpackDeepGraphSymbolContext,
  unpackDeepGraphSymbolImpact,
  type UnpackDeepGraphStatus,
} from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';

type Props = {
  repoPath: string;
  disabled?: boolean;
};

function shortSha(sha?: string | null) {
  if (!sha) return '—';
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

function formatIndexedAt(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export default function UnpackDeepGraphPanel({ repoPath, disabled }: Props) {
  const streamId = useId().replace(/:/g, '');
  const [status, setStatus] = useState<UnpackDeepGraphStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState('');
  const [filePath, setFilePath] = useState('');
  const [lookupMode, setLookupMode] = useState<DeepGraphLookupMode>('context');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [viewModel, setViewModel] = useState<DeepGraphViewModel | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!repoPath || !isTauriAvailable()) return;
    setStatusLoading(true);
    try {
      const next = await unpackDeepGraphStatus(repoPath);
      setStatus(next);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleAnalyze = useCallback(async () => {
    if (!repoPath || !isTauriAvailable()) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const next = await unpackDeepGraphAnalyze(repoPath, streamId, true);
      setStatus(next);
    } catch (e) {
      setAnalyzeError(String(e));
    } finally {
      setAnalyzing(false);
      void refreshStatus();
    }
  }, [repoPath, refreshStatus, streamId]);

  const handleCancelAnalyze = useCallback(async () => {
    if (!isTauriAvailable()) return;
    await unpackDeepGraphCancelAnalyze(streamId);
  }, [streamId]);

  const runLookup = useCallback(
    async (term: string, file: string | null, mode: DeepGraphLookupMode) => {
      if (!repoPath || !term.trim() || !isTauriAvailable()) return;
      if (!status?.indexed) {
        setLookupError('Deep index required. Run Build deep index first.');
        return;
      }
      setLookupLoading(true);
      setLookupError(null);
      setViewModel(null);
      try {
        let raw: Record<string, unknown>;
        if (mode === 'context') {
          raw = await unpackDeepGraphSymbolContext(repoPath, term, file, 24);
        } else if (mode === 'impact') {
          raw = await unpackDeepGraphSymbolImpact(repoPath, term, file, 'upstream', 4, 36);
        } else {
          raw = await unpackDeepGraphQuery(repoPath, term, 12);
        }
        const model = await buildDeepGraphViewModel(mode, raw);
        setViewModel(model);
        if (!model.graph?.nodes.length && !model.hits.length) {
          setLookupError('No graph results for that query.');
        }
      } catch (e) {
        setLookupError(String(e));
      } finally {
        setLookupLoading(false);
      }
    },
    [repoPath, status?.indexed]
  );

  const handleLookup = useCallback(async () => {
    const term = symbol.trim();
    const file = filePath.trim() || null;
    await runLookup(term, file, lookupMode);
  }, [filePath, lookupMode, runLookup, symbol]);

  const handleDrillContext = useCallback(
    async (name: string, path?: string | null) => {
      setSymbol(name);
      if (path) setFilePath(path);
      setLookupMode('context');
      await runLookup(name, path ?? null, 'context');
    },
    [runLookup]
  );

  if (!repoPath) return null;

  const indexed = status?.indexed ?? false;
  const stale = status?.stale ?? false;

  return (
    <div className="rounded-md border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.06] via-transparent to-[var(--bg-raised)]/45 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            <Zap size={14} className="text-violet-400" />
            Deep graph
            <UnpackRunKindBadge kind="local" />
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--text-secondary)]">
            Call-graph indexing for this repo — explore symbol context, blast-radius impact, and
            hybrid search in an interactive graph. 100% local; stored beside the repo in the deep
            index cache.
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 border text-[10px] uppercase tracking-wider',
            indexed && !stale
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : indexed
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                : 'border-[var(--cv-line)] bg-[var(--bg-main)] text-[var(--text-muted)]'
          )}
        >
          {statusLoading
            ? 'Checking…'
            : indexed
              ? stale
                ? 'Stale index'
                : 'Indexed'
              : 'Not indexed'}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1">
          <GitBranch size={11} />
          commit {shortSha(status?.current_commit)}
        </span>
        {indexed && (
          <span>
            indexed {shortSha(status?.indexed_commit)}
            {status?.indexed_at ? ` · ${formatIndexedAt(status.indexed_at)}` : ''}
          </span>
        )}
        {status?.stats?.nodes != null && (
          <span>
            {status.stats.nodes.toLocaleString()} symbols ·{' '}
            {(status.stats.edges ?? 0).toLocaleString()} edges
          </span>
        )}
        {status?.engine_available ? (
          <span className="text-emerald-300/80">Engine {status.engine_version ?? 'ready'}</span>
        ) : (
          <span className="text-amber-200/90">Engine install pending (Node 22+)</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || analyzing}
          onClick={() => void handleAnalyze()}
        >
          {analyzing ? (
            <Loader2 size={14} className="mr-1.5 animate-spin" />
          ) : (
            <Play size={14} className="mr-1.5" />
          )}
          Build deep index
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || statusLoading}
          onClick={() => void refreshStatus()}
        >
          Refresh status
        </Button>
      </div>

      {analyzeError && (
        <div className="mt-2 rounded border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          {analyzeError}
        </div>
      )}

      {analyzing && (
        <div className="mt-3">
          <UnpackAgentStream
            repoPath={repoPath}
            activeReportId={streamId}
            running={analyzing}
            onCancel={() => void handleCancelAnalyze()}
          />
        </div>
      )}

      <div className="mt-4 border-t border-[var(--cv-line)] pt-3">
        <div className="cv-label mb-2 flex items-center gap-1.5">
          <Network size={12} className="text-violet-300" />
          Graph explorer
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['context', 'Context', Target],
              ['impact', 'Impact', Crosshair],
              ['query', 'Query', Search],
            ] as const
          ).map(([mode, label, Icon]) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={lookupMode === mode ? 'default' : 'outline'}
              className="h-7 text-[11px]"
              onClick={() => setLookupMode(mode)}
            >
              <Icon size={12} className="mr-1" />
              {label}
            </Button>
          ))}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder={lookupMode === 'query' ? 'Search query' : 'Symbol name'}
            className="h-8 text-xs"
            disabled={disabled || lookupLoading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && symbol.trim()) void handleLookup();
            }}
          />
          <Input
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder="File path (optional, disambiguates)"
            className="h-8 text-xs"
            disabled={disabled || lookupLoading || lookupMode === 'query'}
          />
          <Button
            type="button"
            size="sm"
            disabled={disabled || lookupLoading || !symbol.trim()}
            onClick={() => void handleLookup()}
          >
            {lookupLoading ? <Loader2 size={14} className="animate-spin" /> : 'Explore'}
          </Button>
        </div>
        {!indexed && (
          <div className="mt-2 flex items-start gap-2 text-[11px] text-amber-200/90">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            Run Build deep index once per repo. Requires Node 22+ for the local graph engine.
          </div>
        )}
        {lookupError && (
          <div className="mt-2 rounded border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-100">
            {lookupError}
          </div>
        )}

        {viewModel?.graph && viewModel.graph.nodes.length > 0 && (
          <div className="mt-3">
            <DeepGraphViewer
              graph={viewModel.graph}
              mode={viewModel.mode}
              hits={viewModel.hits}
              summary={viewModel.summary}
              repoPath={repoPath}
              onDrillContext={(name, path) => void handleDrillContext(name, path)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
