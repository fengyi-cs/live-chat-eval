import type { ActionEvent, SpeakerRole } from '@lce/core';
import { useState } from 'react';
import { formatLatency } from '../labels.ts';
import { fmtScore, ScorePill } from '../components/ScorePill.tsx';

export interface TurnScore {
  composite: number | null;
  ruleScore: number | null;
  llmScore: number | null;
}

export interface TurnEvalDetail {
  dimensions: { name: string; score: number; reason: string }[];
  aiPhraseHits?: string[];
  latencyMs?: number | null;
  evalError?: string | null;
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
  evalDetail?: TurnEvalDetail | null;
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

export function MessageBubble({ m, quote, unanswered, highlighted, pending, score, evalDetail }: Props) {
  if (m.role === 'action' || m.role === 'ignore') return null;
  const isAnchor = m.role === 'anchor';
  const quoted = isAnchor && m.repliesTo?.length ? m.repliesTo.map((s) => quote?.(s)).filter(Boolean) : [];
  const [showDetail, setShowDetail] = useState(false);

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
            <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300">
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
            <ScorePill
              score={score.composite}
              onClick={evalDetail ? () => setShowDetail((v) => !v) : undefined}
              expanded={evalDetail ? showDetail : undefined}
            />
          )}
        </div>

        {quoted.length > 0 && (
          <div className={`mb-1.5 border-l-2 border-sky-300/80 pl-2 text-xs text-neutral-500 dark:border-sky-600/60 ${isAnchor ? 'text-right border-l-0 border-r-2 pr-2 pl-0' : ''}`}>
            {quoted.join(' / ')}
          </div>
        )}

        <p className={`whitespace-pre-wrap text-sm leading-relaxed ${isAnchor ? 'text-left' : ''}`}>
          {pending && !m.text ? <TypingDots /> : (m.text || (pending ? <TypingDots /> : ''))}
        </p>

                {showDetail && evalDetail && (
          <div className="mt-2 space-y-1 border-t border-sky-100 pt-2 text-xs dark:border-sky-800/40">
            {evalDetail.dimensions.map((d) => (
              <div key={d.name}>
                <span className="font-medium">{d.name} {d.score}</span>
                <span className="text-neutral-500"> · {d.reason}</span>
              </div>
            ))}
            {evalDetail.aiPhraseHits?.length ? (
              <div className="text-amber-600">AI 腔命中：{evalDetail.aiPhraseHits.join('、')}</div>
            ) : null}
            {evalDetail.latencyMs !== null && evalDetail.latencyMs !== undefined && (
              <div className="text-neutral-500">延迟 {(evalDetail.latencyMs / 1000).toFixed(1)}s</div>
            )}
            {evalDetail.evalError && <div className="text-red-600">打分失败：{evalDetail.evalError}</div>}
            <div className="flex gap-3 text-neutral-400">
              <span>规则 {fmtScore(score?.ruleScore ?? null)}</span>
              <span>LLM {fmtScore(score?.llmScore ?? null)}</span>
            </div>
          </div>
        )}

        {m.actions?.map((a) => (
          <p key={a.seq} className={`mt-1 text-xs text-emerald-700 dark:text-emerald-400 ${isAnchor ? 'text-right' : ''}`}>
            [动作] {a.text}
          </p>
        ))}
      </div>
    </li>
  );
}
