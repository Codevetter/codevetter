import { Cpu, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type Props = {
  kind: 'local' | 'ai';
  className?: string;
};

/** Labels whether an unpack action runs locally or calls an AI agent. */
export function UnpackRunKindBadge({ kind, className }: Props) {
  if (kind === 'local') {
    return (
      <Badge
        variant="outline"
        className={cn(
          'gap-1 border-cyan-500/30 bg-cyan-500/10 text-[10px] font-medium uppercase tracking-wider text-cyan-200',
          className
        )}
      >
        <Cpu size={10} />
        Local · no AI
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 border-violet-500/30 bg-violet-500/10 text-[10px] font-medium uppercase tracking-wider text-violet-200',
        className
      )}
    >
      <Sparkles size={10} />
      Uses AI
    </Badge>
  );
}
