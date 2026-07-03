import {
  BookOpenText,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FolderOpen,
  GitCompare,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  type AgentMemoryDocument,
  type AgentMemorySource,
  type MemoryFileDiffResult,
  getMemoryFileGitDiff,
  isTauriAvailable,
  listAgentMemorySources,
  openInApp,
  readAgentMemorySource,
} from '@/lib/tauri-ipc';

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatModified(value: string | null): string {
  if (!value) return 'not found';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function displayPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~');
}

function sourceTone(source: AgentMemorySource): string {
  if (!source.exists) return 'border-[#1a1a1a] bg-[#0b0d12] text-slate-500';
  if (!source.readable) return 'border-red-500/25 bg-red-500/5 text-red-200';
  return 'border-[#222] bg-[#10131a] text-slate-100 hover:border-[var(--cv-accent)]/50';
}

/**
 * Compile `needle` to a RegExp.
 * - If needle is wrapped in `/…/` it is treated as a literal regex pattern.
 * - Otherwise it is escaped and used as a plain substring search (case-insensitive).
 * Returns `{ re, error }`: `error` is set when the regex is invalid.
 */
function buildSearchRegex(needle: string): { re: RegExp | null; error: string | null } {
  if (!needle) return { re: null, error: null };

  const regexMatch = needle.match(/^\/(.+)\/([gimsuy]*)$/);
  if (regexMatch) {
    try {
      const re = new RegExp(regexMatch[1], regexMatch[2] || 'gi');
      return { re, error: null };
    } catch {
      return { re: null, error: 'Invalid regex' };
    }
  }

  // Plain substring — escape and make case-insensitive.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { re: new RegExp(escaped, 'gi'), error: null };
}

/** Highlight matching spans inside a line string using a RegExp. */
function HighlightedLine({ line, re }: { line: string; re: RegExp | null }): React.ReactElement {
  if (!re) return <>{line}</>;

  const parts: React.ReactElement[] = [];
  let last = 0;
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(line)) !== null) {
    if (match.index > last) {
      parts.push(<span key={key++}>{line.slice(last, match.index)}</span>);
    }
    parts.push(
      <mark
        key={key++}
        className="rounded-sm bg-[var(--cv-accent)]/30 text-[var(--cv-accent)] not-italic"
      >
        {match[0]}
      </mark>
    );
    last = re.lastIndex;
    // Guard against zero-width matches looping forever.
    if (match[0].length === 0) re.lastIndex++;
  }
  if (last < line.length) {
    parts.push(<span key={key++}>{line.slice(last)}</span>);
  }
  return <>{parts}</>;
}

/** Render a unified diff with per-line colouring. */
function DiffView({ diff }: { diff: string }): React.ReactElement {
  return (
    <pre className="min-h-full whitespace-pre-wrap break-words p-5 font-mono text-xs leading-6">
      {diff.split('\n').map((line, i) => {
        let cls = 'text-slate-300';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-emerald-400';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-red-400';
        else if (line.startsWith('@@')) cls = 'text-sky-400';
        else if (line.startsWith('diff ') || line.startsWith('index ')) cls = 'text-slate-500';
        return (
          <span key={i} className={`block ${cls}`}>
            {line || ' '}
          </span>
        );
      })}
    </pre>
  );
}

export default function AgentMemories() {
  const [sources, setSources] = useState<AgentMemorySource[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [document, setDocument] = useState<AgentMemoryDocument | null>(null);

  // ── Source-list search ────────────────────────────────────────────────────
  const [query, setQuery] = useState('');

  // ── Within-viewer search ──────────────────────────────────────────────────
  const [viewerSearch, setViewerSearch] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [copyMdFeedback, setCopyMdFeedback] = useState(false);

  // ── Git diff state ────────────────────────────────────────────────────────
  const [diffResult, setDiffResult] = useState<MemoryFileDiffResult | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);

  // ── Loading / error ───────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copyMdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSources = useCallback(async () => {
    if (!isTauriAvailable()) {
      setError('Agent Memories requires the desktop app.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await listAgentMemorySources();
      const sorted = [...next].sort((a, b) => {
        if (a.exists !== b.exists) return a.exists ? -1 : 1;
        if (a.tool !== b.tool) return a.tool.localeCompare(b.tool);
        return a.path.localeCompare(b.path);
      });
      setSources(sorted);
      const firstReadable = sorted.find((source) => source.readable);
      if (!selectedPath && firstReadable) {
        setSelectedPath(firstReadable.path);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedPath]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  // Load document when selection changes.
  useEffect(() => {
    if (!selectedPath) return;

    const selected = sources.find((source) => source.path === selectedPath);
    if (!selected?.readable) {
      setDocument(null);
      setDiffResult(null);
      return;
    }

    let cancelled = false;
    setReading(true);
    setError(null);
    setDiffResult(null);
    setDiffOpen(false);
    setViewerSearch('');

    void (async () => {
      try {
        const next = await readAgentMemorySource(selectedPath);
        if (!cancelled) {
          setDocument(next);
        }
      } catch (err) {
        if (cancelled) return;
        setDocument(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) {
          setReading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedPath, sources]);

  // Fetch git diff whenever the document changes.
  useEffect(() => {
    if (!document || !isTauriAvailable()) return;

    let cancelled = false;
    setDiffLoading(true);

    void (async () => {
      try {
        const result = await getMemoryFileGitDiff(document.source.path);
        if (!cancelled) setDiffResult(result);
      } catch {
        // Non-fatal — diff affordance just stays hidden.
        if (!cancelled) setDiffResult(null);
      } finally {
        if (!cancelled) setDiffLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [document]);

  // ── Viewer search: compile regex ──────────────────────────────────────────
  const { re: viewerRe, error: viewerReError } = useMemo(
    () => buildSearchRegex(viewerSearch.trim()),
    [viewerSearch]
  );

  // Annotate each line with whether it matches the viewer search.
  const viewerLines = useMemo(() => {
    if (!document) return [];
    const lines = document.content.split('\n');
    if (!viewerRe) return lines.map((text, i) => ({ text, i, match: false }));
    return lines.map((text, i) => {
      viewerRe.lastIndex = 0;
      return { text, i, match: viewerRe.test(text) };
    });
  }, [document, viewerRe]);

  const matchingLineCount = useMemo(() => viewerLines.filter((l) => l.match).length, [viewerLines]);

  const shouldFilter = viewerSearch.trim().length > 0 && !viewerReError;

  // ── Copy plain content ────────────────────────────────────────────────────
  const handleCopyRaw = useCallback(async () => {
    if (!document) return;
    try {
      await navigator.clipboard.writeText(document.content);
      setCopyFeedback(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopyFeedback(false), 1500);
    } catch {
      // clipboard unavailable — fail silently
    }
  }, [document]);

  // ── Copy as Markdown ──────────────────────────────────────────────────────
  const handleCopyMarkdown = useCallback(async () => {
    if (!document) return;
    const fetchedAt = new Date().toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    const md = [
      `## ${document.source.label}`,
      ``,
      `**Source:** \`${displayPath(document.source.path)}\`  `,
      `**Fetched at:** ${fetchedAt}  `,
      `**Modified:** ${formatModified(document.source.modified_at)}`,
      ``,
      '```',
      document.content,
      '```',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(md);
      setCopyMdFeedback(true);
      if (copyMdTimeoutRef.current) clearTimeout(copyMdTimeoutRef.current);
      copyMdTimeoutRef.current = setTimeout(() => setCopyMdFeedback(false), 1500);
    } catch {
      // clipboard unavailable — fail silently
    }
  }, [document]);

  const filteredSources = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sources;
    return sources.filter((source) => {
      const haystack = [source.tool, source.label, source.path, source.preview, source.note]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, sources]);

  const existingCount = sources.filter((source) => source.exists).length;
  const toolCounts = sources.reduce<Record<string, number>>((acc, source) => {
    if (source.exists) acc[source.tool] = (acc[source.tool] ?? 0) + 1;
    return acc;
  }, {});

  // Show the git diff indicator only when the file is tracked.
  const showDiffAffordance =
    diffResult !== null && diffResult.status !== 'not_a_repo' && !diffLoading;

  return (
    <div className="min-h-screen bg-[var(--bg-main)] px-6 py-16 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--cv-accent)]/30 bg-[var(--cv-accent)]/10 text-[var(--cv-accent)]">
                <BookOpenText size={20} />
              </div>
              <div>
                <p className="cv-label text-slate-500">agent context</p>
                <h1 className="text-2xl font-semibold tracking-tight">Agent Memories</h1>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              Read local memory and instruction files from Claude, Codex, and Grok profiles.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(toolCounts).map(([tool, count]) => (
              <Badge
                key={tool}
                variant="secondary"
                className="border-[#242424] bg-[#10131a] text-slate-300"
              >
                {tool} {count}
              </Badge>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="border-[#262626] bg-[#08090a] text-slate-300 hover:bg-[#111318]"
              onClick={() => void loadSources()}
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </Button>
          </div>
        </header>

        {error && (
          <div className="rounded-md border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid min-h-[620px] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          {/* ── Source list ────────────────────────────────────────────────── */}
          <Card className="overflow-hidden border-[#1a1a1a] bg-[#0b0d12] shadow-none">
            <div className="border-b border-[#1a1a1a] p-3">
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search sources"
                  className="h-9 border-[#242424] bg-[#08090a] pl-8 text-sm text-slate-100"
                />
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                {existingCount} readable source{existingCount === 1 ? '' : 's'} found
              </p>
            </div>
            <div className="max-h-[560px] overflow-y-auto p-2">
              {filteredSources.map((source) => {
                const active = source.path === selectedPath;
                return (
                  <button
                    key={source.id}
                    type="button"
                    disabled={!source.readable}
                    onClick={() => setSelectedPath(source.path)}
                    className={`mb-2 w-full rounded-md border p-3 text-left transition-colors ${sourceTone(source)} ${
                      active ? 'ring-1 ring-[var(--cv-accent)]/60' : ''
                    }`}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{source.label}</span>
                          <span className="rounded-sm bg-black/25 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                            {source.tool}
                          </span>
                        </div>
                        <p className="mt-1 truncate font-mono text-[11px] text-slate-500">
                          {displayPath(source.path)}
                        </p>
                      </div>
                      <span className="shrink-0 text-[10px] text-slate-500">
                        {formatBytes(source.file_size_bytes)}
                      </span>
                    </div>
                    <p className="mt-2 max-h-10 overflow-hidden text-xs leading-5 text-slate-400">
                      {source.exists
                        ? source.preview || source.note
                        : 'Not present on this machine.'}
                    </p>
                  </button>
                );
              })}
              {filteredSources.length === 0 && (
                <div className="p-6 text-center text-sm text-slate-500">No sources match.</div>
              )}
            </div>
          </Card>

          {/* ── Viewer ─────────────────────────────────────────────────────── */}
          <Card className="flex min-w-0 flex-col overflow-hidden border-[#1a1a1a] bg-[#0b0d12] shadow-none">
            {/* Header row */}
            <div className="flex min-h-14 items-center justify-between gap-3 border-b border-[#1a1a1a] px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {document?.source.label ?? 'Select a memory source'}
                </div>
                <div className="truncate font-mono text-[11px] text-slate-500">
                  {document ? displayPath(document.source.path) : 'Read-only local source viewer'}
                </div>
              </div>
              {document && (
                <div className="flex shrink-0 items-center gap-1">
                  {/* Git diff indicator */}
                  {showDiffAffordance && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-8 gap-1 px-2 text-xs ${
                        diffResult?.has_changes
                          ? 'text-amber-400 hover:text-amber-300'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                      onClick={() => setDiffOpen((prev) => !prev)}
                      title={
                        diffResult?.has_changes
                          ? 'This file has uncommitted changes — click to view diff'
                          : 'No changes since last commit'
                      }
                    >
                      <GitCompare size={13} />
                      <span className="hidden sm:inline">
                        {diffResult?.has_changes ? 'changed' : 'clean'}
                      </span>
                      {diffOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </Button>
                  )}
                  {/* Copy as Markdown */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 px-2 text-xs text-slate-400 hover:text-slate-100"
                    onClick={() => void handleCopyMarkdown()}
                    title="Copy as Markdown (with source path + fetched-at header)"
                  >
                    <Copy size={13} />
                    <span className="hidden sm:inline">
                      {copyMdFeedback ? 'Copied!' : 'Copy MD'}
                    </span>
                  </Button>
                  {/* Copy raw */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-slate-400 hover:text-slate-100"
                    onClick={() => void handleCopyRaw()}
                    title={copyFeedback ? 'Copied!' : 'Copy raw content'}
                  >
                    {copyFeedback ? (
                      <span className="text-xs text-emerald-400">Copied</span>
                    ) : (
                      <Copy size={14} />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-slate-400 hover:text-slate-100"
                    onClick={() => void openInApp('finder', document.source.path)}
                  >
                    <FolderOpen size={14} />
                  </Button>
                </div>
              )}
            </div>

            {/* Meta row */}
            {document && (
              <div className="flex flex-wrap items-center gap-2 border-b border-[#1a1a1a] px-4 py-2 text-[11px] text-slate-500">
                <span>{formatModified(document.source.modified_at)}</span>
                <span>/</span>
                <span>{document.extraction_note}</span>
                {document.truncated && (
                  <>
                    <span>/</span>
                    <span className="text-amber-300">truncated</span>
                  </>
                )}
              </div>
            )}

            {/* Git diff panel */}
            {showDiffAffordance && diffOpen && (
              <div className="border-b border-[#1a1a1a]">
                {diffResult?.has_changes ? (
                  <div className="max-h-64 overflow-auto bg-[#09090d]">
                    <DiffView diff={diffResult.diff} />
                  </div>
                ) : (
                  <p className="px-4 py-3 text-xs text-slate-500">
                    No changes since the last commit.
                  </p>
                )}
              </div>
            )}

            {/* Within-viewer search bar (only when document is loaded) */}
            {document && (
              <div className="border-b border-[#1a1a1a] px-4 py-2">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search
                      size={12}
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
                    />
                    <Input
                      value={viewerSearch}
                      onChange={(e) => setViewerSearch(e.target.value)}
                      placeholder="Search lines — /regex/ or plain text"
                      className="h-7 border-[#2a2a2a] bg-[#08090a] pl-7 text-xs text-slate-100 focus-visible:ring-[var(--cv-accent)]/40"
                    />
                  </div>
                  {viewerSearch && !viewerReError && (
                    <span className="shrink-0 text-[11px] text-slate-500">
                      {matchingLineCount} line{matchingLineCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                {viewerReError && <p className="mt-1 text-[11px] text-red-400">{viewerReError}</p>}
              </div>
            )}

            {/* Content area */}
            <div className="min-h-0 flex-1 overflow-auto">
              {reading ? (
                <div className="flex h-full min-h-[420px] items-center justify-center text-sm text-slate-500">
                  Reading source...
                </div>
              ) : document ? (
                <pre className="min-h-full whitespace-pre-wrap break-words p-5 font-mono text-xs leading-6">
                  {viewerLines.map(({ text, i, match }) => {
                    const dimmed = shouldFilter && !match;
                    return (
                      <span key={i} className={`block ${dimmed ? 'opacity-25' : ''}`}>
                        <HighlightedLine line={text} re={viewerRe} />
                      </span>
                    );
                  })}
                </pre>
              ) : (
                <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 text-center text-slate-500">
                  <ExternalLink size={20} />
                  <p className="max-w-sm text-sm">Pick a readable source from the left.</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
