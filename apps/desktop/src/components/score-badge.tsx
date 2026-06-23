interface ScoreBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
}

function getScoreColor(score: number): {
  bg: string;
  text: string;
  ring: string;
} {
  if (score >= 80)
    return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'ring-emerald-500/20' };
  if (score >= 60)
    return { bg: 'bg-yellow-500/10', text: 'text-yellow-400', ring: 'ring-yellow-500/20' };
  if (score >= 40)
    return { bg: 'bg-orange-500/10', text: 'text-orange-400', ring: 'ring-orange-500/20' };
  return { bg: 'bg-red-500/10', text: 'text-red-400', ring: 'ring-red-500/20' };
}

function getLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Needs Work';
}

const sizeClasses = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-12 w-12 text-sm',
  lg: 'h-16 w-16 text-lg',
};

export default function ScoreBadge({ score, size = 'md' }: ScoreBadgeProps) {
  const colors = getScoreColor(score);

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`flex items-center justify-center rounded-full font-bold ring-1 ${colors.bg} ${colors.text} ${colors.ring} ${sizeClasses[size]}`}
      >
        {score}
      </div>
      {size !== 'sm' && (
        <span className={`text-[10px] font-medium ${colors.text}`}>{getLabel(score)}</span>
      )}
    </div>
  );
}
