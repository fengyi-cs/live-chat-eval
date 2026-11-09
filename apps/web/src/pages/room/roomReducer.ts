import { computeRules, type EvalItemResult, type EvalSummary, type Rubric, type RuleResult, type SimMessage, turnComposite } from '@lce/core';
import type { EvalEvent, RoomEvent, RunInfo } from '../../api.ts';

const END_LABELS = { finished: '剧本播完', stopped: '已手动结束', error: '出错结束' } as const;

export interface RoomState {
  info: RunInfo | null;
  messages: SimMessage[];
  generating: { replyTo: number[]; proactive: boolean; text: string } | null;
  skipped: Set<number>;
  unanswered: Set<number>;
  now: number;
  waitingStep: boolean;
  warnings: string[];
  ended: { reason: keyof typeof END_LABELS; error: string | null } | null;
  gone: boolean;
}

export interface LiveEvalState {
  rules: RuleResult;
  summary: EvalSummary;
  items: EvalItemResult[];
  rubric: Rubric;
}

export { END_LABELS };

export const initialRoom: RoomState = {
  info: null,
  messages: [],
  generating: null,
  skipped: new Set(),
  unanswered: new Set(),
  now: 0,
  waitingStep: false,
  warnings: [],
  ended: null,
  gone: false,
};

export function roomReducer(s: RoomState, ev: RoomEvent): RoomState {
  switch (ev.type) {
    case 'hello':
      return { ...initialRoom, info: ev.info };
    case 'danmaku':
      return { ...s, messages: [...s.messages, ev.message], now: Math.max(s.now, ev.message.at) };
    case 'thinking':
      return {
        ...s,
        generating: { replyTo: ev.replyTo, proactive: ev.proactive, text: '' },
        skipped: ev.skipped.length ? new Set([...s.skipped, ...ev.skipped]) : s.skipped,
        now: Math.max(s.now, ev.at),
        waitingStep: false,
      };
    case 'delta':
      return s.generating ? { ...s, generating: { ...s.generating, text: s.generating.text + ev.text } } : s;
    case 'reply':
      return { ...s, messages: [...s.messages, ev.message], generating: null, now: Math.max(s.now, ev.message.at) };
    case 'waiting':
      return { ...s, now: Math.max(s.now, ev.at), waitingStep: s.info?.pace?.kind === 'step' && ev.until !== null };
    case 'clock':
      return { ...s, now: Math.max(s.now, ev.at), waitingStep: false };
    case 'pace':
      return s.info ? { ...s, info: { ...s.info, pace: ev.pace }, waitingStep: ev.pace.kind === 'step' && s.waitingStep } : s;
    case 'warning':
      return { ...s, warnings: [...s.warnings, ev.message] };
    case 'end':
      return { ...s, generating: null, waitingStep: false, unanswered: new Set(ev.unanswered), ended: { reason: ev.reason, error: ev.error } };
    case 'gone':
      return { ...s, gone: true };
    default:
      return s;
  }
}

export type { RoomEvent, RunInfo, EvalEvent };

export function makeEvalSubscriber(setLiveEval: React.Dispatch<React.SetStateAction<LiveEvalState | null>>) {
  return (ev: EvalEvent) => {
    if (ev.type === 'item') {
      setLiveEval((prev) => {
        if (!prev) return prev;
        const idx = prev.items.findIndex((it) => it.seq === ev.item.seq && it.kind === ev.item.kind);
        const items: EvalItemResult[] = idx >= 0 ? prev.items.map((it, i) => (i === idx ? ev.item : it)) : [...prev.items, ev.item];
        return { ...prev, items, rules: ev.rules, summary: ev.summary };
      });
    } else if (ev.type === 'hello') {
      setLiveEval({ rules: ev.eval.rules, summary: ev.eval.summary, items: ev.eval.items, rubric: ev.eval.rubric });
    }
  };
}

export interface TurnScore {
  composite: number | null;
  ruleScore: number | null;
  llmScore: number | null;
}

export function scoreOf(liveEval: LiveEvalState | null, seq: number): TurnScore | null {
  if (!liveEval) return null;
  const item = liveEval.items.find((it) => it.kind === 'turn' && it.seq === seq && it.status === 'done');
  const turnRules = liveEval.rules.turns[seq];
  return turnComposite(liveEval.rubric, turnRules, item);
}

export { computeRules };
