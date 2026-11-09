import { LightbulbIcon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { usePersistentState } from '../usePersistentState.ts';

interface Props {
  storageKey: string;
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  tone?: 'info' | 'tip';
}

export function HintBubble({ storageKey, icon, title, children, action, tone = 'tip' }: Props) {
  const [dismissed, setDismissed] = usePersistentState(storageKey, false);
  if (dismissed) return null;

  const toneClasses = tone === 'info'
    ? 'border-sky-200 bg-sky-50/80 text-sky-800 dark:border-sky-800/50 dark:bg-sky-950/20 dark:text-sky-300'
    : 'border-amber-200 bg-amber-50/80 text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-300';

  return (
    <div className={`relative flex items-start gap-2.5 rounded-xl border p-3 ${toneClasses}`}>
      <span className="mt-0.5 shrink-0">
        {icon ?? <LightbulbIcon className="size-4" />}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-semibold">{title}</p>
        <div className="text-xs leading-relaxed opacity-90">{children}</div>
        {action && <div className="pt-0.5">{action}</div>}
      </div>
      <button
        type="button"
        className="shrink-0 rounded p-0.5 opacity-50 transition-opacity hover:opacity-100"
        onClick={() => setDismissed(true)}
        aria-label="知道了"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
