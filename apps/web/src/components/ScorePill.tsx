export const fmtScore = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : n.toFixed(0);

export function scoreTone(n: number | null): string {
  if (n === null) return 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400';
  if (n >= 80) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300';
  if (n >= 60) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300';
  return 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300';
}

interface ScorePillProps {
  score: number | null;
  label?: string;
  onClick?: () => void;
  expanded?: boolean;
  pending?: boolean;
  className?: string;
}

export function ScorePill({ score, label, onClick, expanded, pending, className = '' }: ScorePillProps) {
  const tone = scoreTone(score);
  const display = pending ? '评估中…' : (label ?? fmtScore(score));

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-expanded={expanded}
        aria-label={pending ? '评估中' : `${label ?? `综合评分 ${fmtScore(score)}/100`}${expanded === undefined ? '' : expanded ? '，收起详情' : '，展开详情'}`}
        className={`rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums transition-colors ${tone} cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-current/40 ${className}`}
      >
        {display}{expanded !== undefined ? (expanded ? ' ▲' : ' ▼') : ''}
      </button>
    );
  }

  return (
    <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums ${tone} ${className}`}>
      {display}
    </span>
  );
}
