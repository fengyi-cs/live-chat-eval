import { formatOffset } from '@lce/core';
import { useLayoutEffect, useRef } from 'react';
import type { RunInfo } from '../../api.ts';
import type { SimMessage } from '@lce/core';
import { END_LABELS, type RoomState, type TurnScore, scoreOf, type LiveEvalState } from './roomReducer.ts';
import { MessageBubble, type TurnEvalDetail } from '../MessageBubble.tsx';

function evalDetailOf(liveEval: LiveEvalState | null, seq: number): TurnEvalDetail | null {
  if (!liveEval) return null;
  const item = liveEval.items.find((it) => it.kind === 'turn' && it.seq === seq);
  if (!item) return null;
  const turnRules = liveEval.rules.turns[seq];
  const dimensions = liveEval.rubric.dimensions
    .filter((d) => item.scores?.[d.key])
    .map((d) => ({ name: d.name, score: item.scores![d.key]!.score, reason: item.scores![d.key]!.reason }));
  return {
    dimensions,
    aiPhraseHits: turnRules?.aiPhrases?.hits,
    latencyMs: turnRules?.latency?.value ?? null,
    evalError: item.status === 'error' ? (item as { error?: string }).error ?? null : null,
  };
}

interface Props {
  room: RoomState;
  info: RunInfo;
  liveEval: LiveEvalState | null;
}

export function ChatArea({ room, info, liveEval }: Props) {
  const scroller = useRef<HTMLUListElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [room.messages.length, room.generating?.text]);

  const bySeq = new Map(room.messages.map((m) => [m.seq, m]));
  const quote = (seq: number) => {
    const m = bySeq.get(seq);
    return m && `${m.speaker}：${m.text}`;
  };
  const replying = new Set(room.generating?.replyTo);
  const running = !room.ended;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ul
        ref={scroller}
        className="flex-1 space-y-3 overflow-y-auto px-1 py-3"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {room.messages.length === 0 && !room.generating && (
          <li className="flex h-32 items-center justify-center text-sm text-neutral-400">
            {info.mode === 'live' ? '在下面发一条弹幕开始聊天' : '等待第一条弹幕…'}
          </li>
        )}
        {room.messages.map((m: SimMessage) => (
          <MessageBubble
            key={m.seq}
            m={{ ...m, time: formatOffset(m.at), genTotalMs: m.genTotalMs }}
            quote={quote}
            highlighted={replying.has(m.seq)}
            unanswered={room.ended ? room.unanswered.has(m.seq) : room.skipped.has(m.seq)}
            score={m.role === 'anchor' ? scoreOf(liveEval, m.seq) : null}
            evalDetail={m.role === 'anchor' ? evalDetailOf(liveEval, m.seq) : null}
          />
        ))}
        {room.generating && (
          <MessageBubble
            pending
            m={{
              seq: -1,
              role: 'anchor',
              speaker: info.anchorName,
              time: formatOffset(room.now),
              text: room.generating.text,
              repliesTo: room.generating.replyTo,
              proactive: room.generating.proactive,
              latencyMs: null,
            }}
            quote={quote}
          />
        )}
      </ul>

      {room.ended && (
        <p className={`px-1 pb-1 text-xs ${room.ended.error ? 'text-red-600' : 'text-neutral-500'}`}>
          {room.ended.error ?? '这场直播已保存到「场次库」，可以在那里查看和删除。'}
        </p>
      )}
    </div>
  );
}

export { END_LABELS };
export type { TurnScore };
