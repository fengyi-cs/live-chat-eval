import type { ActionEvent, SpeakerRole } from '@lce/core';
import { formatLatency } from '../labels.ts';

export interface BubbleMessage {
  seq: number;
  role: SpeakerRole;
  speaker: string;
  time: string;
  text: string;
  repliesTo: number[] | null;
  proactive: boolean | null;
  latencyMs: number | null;
  genTotalMs?: number | null;
  actions?: ActionEvent[] | null;
}

interface Props {
  m: BubbleMessage;
  quote?: (seq: number) => string | undefined;
  unanswered?: boolean;
  highlighted?: boolean;
  pending?: boolean;
}

const badge = 'rounded px-1';

export function MessageBubble({ m, quote, unanswered, highlighted, pending }: Props) {
  if (m.role === 'action' || m.role === 'ignore') return null;
  const isAnchor = m.role === 'anchor';
  const quoted = isAnchor && m.repliesTo?.length ? m.repliesTo.map((s) => quote?.(s)).filter(Boolean) : [];
  return (
    <li className={`flex ${isAnchor ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg border px-3 py-2 sm:max-w-[70%] ${
          isAnchor ? 'bg-sky-50 dark:bg-sky-950' : 'bg-white dark:bg-neutral-900'
        } ${highlighted ? 'border-sky-400 ring-1 ring-sky-300' : 'border-neutral-200 dark:border-neutral-800'}`}
      >
        <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
          <span className="font-medium text-neutral-700 dark:text-neutral-300">{m.speaker}</span>
          <span>{m.time}</span>
          {pending && <span className={`${badge} bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200`}>正在回复…</span>}
          {isAnchor && m.proactive && <span className={`${badge} bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-200`}>主动发言</span>}
          {isAnchor && m.latencyMs !== null && <span>延迟 {formatLatency(m.latencyMs)}</span>}
          {isAnchor && m.genTotalMs != null && <span>生成 {formatLatency(m.genTotalMs)}</span>}
          {unanswered && <span className={`${badge} bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200`}>未回应</span>}
        </div>
        {quoted.length > 0 && <div className="mb-1 border-l-2 border-sky-300 pl-2 text-xs text-neutral-500">回应：{quoted.join(' / ')}</div>}
        <p className="whitespace-pre-wrap text-sm">{m.text || (pending ? '…' : '')}</p>
        {m.actions?.map((a) => (
          <p key={a.seq} className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
            [动作] {a.text}
          </p>
        ))}
      </div>
    </li>
  );
}
