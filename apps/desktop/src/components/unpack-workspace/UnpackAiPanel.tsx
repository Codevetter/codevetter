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
        'flex w-full flex-col gap-2 rounded-md border px-3 py-2',
        canRun
          ? 'border-violet-500/20 bg-violet-500/[0.035]'
          : 'border-[var(--cv-line)] bg-[var(--bg-main)]/40 opacity-80'
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <UnpackRunKindBadge kind="ai" />
        <span className="cv-label">Agent</span>
        <select
          value={agent}
          onChange={(e) => startTransition(() => onAgentChange(e.target.value))}
          disabled={!canRun || busy}
          className="rounded border border-[var(--cv-line)] bg-[var(--bg-raised)] px-2 py-1 font-mono text-xs"
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
          className="h-8"
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
        <div className="ml-auto flex min-w-72 flex-1 items-center gap-2">
          <MessageCircleQuestion size={13} className="shrink-0 text-[var(--text-muted)]" />
          <Input
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            placeholder="e.g. Where is auth handled?"
            disabled={!canRun || busy}
            className="h-8 text-xs"
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
            disabled={!canRun || busy || !question.trim()}
            onClick={onAsk}
          >
            {isAsking ? <Loader2 size={14} className="animate-spin" /> : 'Ask'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {UNPACK_ASK_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={!canRun || busy}
            onClick={() => onQuestionChange(preset)}
            className="rounded border border-[var(--cv-line)] bg-[var(--bg-raised)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] transition hover:border-violet-500/30 hover:text-[var(--text-primary)] disabled:opacity-50"
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
              <div className="text-[10px] font-medium text-violet-200/90">{entry.question}</div>
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
