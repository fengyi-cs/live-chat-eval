import type { ActionEvent, SpeakerRole } from '@lce/core';
import { formatLatency } from '../labels.ts';

export interface TurnScore {
  composite: number | null;
  ruleScore: number | null;
  llmScore: number | null;
}

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
  score?: TurnScore | null;
}

const fmtScore = (n: number | null) => (n === null ? '—' : n.toFixed(0));

function scoreTone(n: number | null): string {
  if (n === null) return 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400';
  if (n >= 80) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300';
  if (n >= 60) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300';
  return 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300';
}

function SpeakerAvatar({ name, isAnchor }: { name: string; isAnchor: boolean }) {
  const ch = [...name].find((c) => /\S/.test(c)) ?? '?';
  return (
    <span
      className={`flex size-7 shrink-0 items-center justify-center self-end rounded-full text-xs font-semibold select-none ${
        isAnchor
          ? 'bg-sky-200 text-sky-800 dark:bg-sky-800 dark:text-sky-200'
          : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200'
      }`}
      aria-hidden
    >
      {ch}
    </span>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 px-0.5" aria-label="正在输入">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="typing-dot size-1.5 rounded-full bg-sky-400 dark:bg-sky-500"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}

export function MessageBubble({ m, quote, unanswered, highlighted, pending, score }: Props) {
  if (m.role === 'action' || m.role === 'ignore') return null;
  const isAnchor = m.role === 'anchor';
  const quoted = isAnchor && m.repliesTo?.length ? m.repliesTo.map((s) => quote?.(s)).filter(Boolean) : [];

  return (
    <li className={`animate-message-in flex items-end gap-1.5 ${isAnchor ? 'flex-row-reverse' : 'flex-row'}`}>
      <SpeakerAvatar name={m.speaker} isAnchor={isAnchor} />

      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 sm:max-w-[68%] ${
          isAnchor
            ? `rounded-br-sm bg-sky-50 dark:bg-sky-950/60 ${
                highlighted
                  ? 'ring-2 ring-sky-400/60 shadow-sky-100 shadow-sm dark:shadow-sky-900/30'
                  : 'shadow-xs'
              }`
            : 'rounded-bl-sm bg-white shadow-xs dark:bg-neutral-900'
        } ${
          highlighted
            ? 'border border-sky-300 dark:border-sky-700'
            : 'border border-neutral-200/80 dark:border-neutral-800'
        }`}
      >
        <div className={`mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-neutral-500 ${isAnchor ? 'flex-row-reverse' : ''}`}>
          <span className="font-semibold text-neutral-700 dark:text-neutral-300">{m.speaker}</span>
          <span className="opacity-70">{m.time}</span>

          {pending && (
            <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300">
              回复中
            </span>
          )}
          {isAnchor && m.proactive && (
            <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-violet-700 dark:bg-violet-900/60 dark:text-violet-300">
              主动
            </span>
          )}
          {isAnchor && m.latencyMs !== null && (
            <span className="opacity-70">延迟 {formatLatency(m.latencyMs)}</span>
          )}
          {isAnchor && m.genTotalMs != null && (
            <span className="opacity-70">生成 {formatLatency(m.genTotalMs)}</span>
          )}
          {unanswered && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
              未回应
            </span>
          )}
          {score && (
            <span
              className={`rounded-full px-1.5 py-0.5 font-medium tabular-nums cursor-default ${scoreTone(score.composite)}`}
              title={`综合 ${fmtScore(score.composite)} · 规则 ${fmtScore(score.ruleScore)} · LLM ${fmtScore(score.llmScore)}`}
            >
              {fmtScore(score.composite)}
            </span>
          )}
        </div>

        {quoted.length > 0 && (
          <div className={`mb-1.5 border-l-2 border-sky-300/80 pl-2 text-xs text-neutral-500 dark:border-sky-600/60 ${isAnchor ? 'text-right border-l-0 border-r-2 pr-2 pl-0' : ''}`}>
            {quoted.join(' / ')}
          </div>
        )}

        <p className={`whitespace-pre-wrap text-sm leading-relaxed ${isAnchor ? 'text-right' : ''}`}>
          {pending && !m.text ? <TypingDots /> : (m.text || (pending ? <TypingDots /> : ''))}
        </p>

        {m.actions?.map((a) => (
          <p key={a.seq} className={`mt-1 text-xs text-emerald-700 dark:text-emerald-400 ${isAnchor ? 'text-right' : ''}`}>
            [动作] {a.text}
          </p>
        ))}
      </div>
    </li>
  );
}
