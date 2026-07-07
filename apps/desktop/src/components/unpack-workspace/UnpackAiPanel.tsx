import { Loader2, MessageCircleQuestion, Sparkles } from 'lucide-react';
import { startTransition } from 'react';

import { UnpackModelField } from '@/components/unpack-model-field';
import { UnpackRunKindBadge } from '@/components/unpack-workspace/UnpackRunKindBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CLI_SYNTHESIS_AGENTS } from '@/lib/cli-agents';
import { UNPACK_ASK_PRESETS } from '@/lib/unpack-ask-presets';
import { cn } from '@/lib/utils';

export type UnpackAskEntry = {
  id: string;
  question: string;
  answer: string;
  agent: string;
  createdAt: string;
};

type Props = {
  canRun: boolean;
  isSummarizing: boolean;
  isAsking: boolean;
  agent: string;
  model: string;
  question: string;
  answers: UnpackAskEntry[];
  onAgentChange: (agent: string) => void;
  onModelChange: (model: string) => void;
  onSummarize: () => void;
  onQuestionChange: (question: string) => void;
  onAsk: () => void;
};

export function UnpackAiPanel({
  canRun,
  isSummarizing,
  isAsking,
  agent,
  model,
  question,
  answers,
  onAgentChange,
  onModelChange,
  onSummarize,
  onQuestionChange,
  onAsk,
}: Props) {
  const busy = isSummarizing || isAsking;

  return (
    <div
      className={cn(
        'flex w-full flex-col gap-4 rounded-xl border px-4 py-4',
        canRun
          ? 'border-[var(--cv-line)] bg-white/[0.018]'
          : 'border-[var(--cv-line)] bg-[var(--bg-main)]/40 opacity-80'
      )}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(240px,320px),1fr]">
        <div>
          <div className="flex items-center gap-2">
            <UnpackRunKindBadge kind="ai" />
            <span className="text-sm font-medium text-[var(--text-primary)]">
              Add interpretation when needed
            </span>
          </div>
          <p className="mt-2 max-w-md text-xs leading-5 text-[var(--text-secondary)]">
            Generate a narrative brief or ask one focused repository question against this exact
            local snapshot.
          </p>
        </div>

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="cv-label">Agent</span>
            <select
              value={agent}
              onChange={(e) => startTransition(() => onAgentChange(e.target.value))}
              disabled={!canRun || busy}
              className="h-9 rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] px-2 font-mono text-xs"
            >
              {CLI_SYNTHESIS_AGENTS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <span className="cv-label">Model</span>
            <UnpackModelField
              agent={agent}
              value={model}
              disabled={!canRun || busy}
              onChange={onModelChange}
            />
            <Button
              type="button"
              size="sm"
              className="h-9"
              disabled={!canRun || busy}
              onClick={onSummarize}
            >
              {isSummarizing ? (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              ) : (
                <Sparkles size={14} className="mr-1.5" />
              )}
              Analyze
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <MessageCircleQuestion size={14} className="shrink-0 text-cyan-200/75" />
            <Input
              value={question}
              onChange={(e) => onQuestionChange(e.target.value)}
              placeholder="Ask a repository question, e.g. Where is auth handled?"
              disabled={!canRun || busy}
              className="h-10 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onAsk();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10 px-4"
              disabled={!canRun || busy || !question.trim()}
              onClick={onAsk}
            >
              {isAsking ? <Loader2 size={14} className="animate-spin" /> : 'Ask'}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {UNPACK_ASK_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={!canRun || busy}
            onClick={() => onQuestionChange(preset)}
            className="rounded-full border border-[var(--cv-line)] bg-white/[0.018] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-cyan-500/25 hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            {preset}
          </button>
        ))}
      </div>

      {answers.length > 0 ? (
        <div className="max-h-64 space-y-2 overflow-y-auto border-t border-[var(--cv-line)] pt-2">
          {answers.map((entry) => (
            <div
              key={entry.id}
              className="rounded border border-[var(--cv-line)] bg-[var(--bg-main)]/60 p-2"
            >
              <div className="text-[10px] font-medium text-cyan-100/90">{entry.question}</div>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">
                {entry.answer}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
