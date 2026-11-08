export type StrategyKind = 'each' | 'window' | 'priority';

export const STRATEGY_KINDS: readonly StrategyKind[] = ['each', 'window', 'priority'];

export const STRATEGY_KIND_LABELS: Record<StrategyKind, string> = {
  each: '逐条回复',
  window: '时间窗口合并',
  priority: '优先级筛选',
};

export interface PriorityWeights {
  question: number;
  mention: number;
  gift: number;
  newViewer: number;
}

export interface ReplyStrategy {
  kind: StrategyKind;
  mergeWindowSec: number;
  maxBatch: number;
  minGapSec: number;
  /** 0 表示不主动发言 */
  idleProactiveSec: number;
  weights: PriorityWeights;
  llmSelect: boolean;
}

export const DEFAULT_STRATEGY: ReplyStrategy = {
  kind: 'window',
  mergeWindowSec: 3,
  maxBatch: 3,
  minGapSec: 2,
  idleProactiveSec: 60,
  weights: { question: 2, mention: 3, gift: 5, newViewer: 1 },
  llmSelect: false,
};

export interface Danmaku {
  id: number;
  speaker: string;
  text: string;
  ts: number;
}

export interface DanmakuSignals {
  question: boolean;
  mention: boolean;
  gift: boolean;
}

const QUESTION_RE = /[?？]|吗|呢|什么|怎么|为什么|为啥|咋|多少|哪|谁|是不是|能不能|可不可以|有没有/;
const GIFT_RE = /礼物|嘉年华|火箭|打赏|小心心|送(了|你|给)/;
const MENTION_RE = /主播|@/;

export function detectSignals(text: string, anchorName?: string): DanmakuSignals {
  return {
    question: QUESTION_RE.test(text),
    mention: MENTION_RE.test(text) || Boolean(anchorName && text.includes(anchorName)),
    gift: GIFT_RE.test(text),
  };
}

export function scoreDanmaku(d: Danmaku, weights: PriorityWeights, seenSpeakers: ReadonlySet<string>, anchorName?: string): number {
  const s = detectSignals(d.text, anchorName);
  return (
    (s.question ? weights.question : 0) +
    (s.mention ? weights.mention : 0) +
    (s.gift ? weights.gift : 0) +
    (seenSpeakers.has(d.speaker) ? 0 : weights.newViewer)
  );
}

export interface StrategyState {
  now: number;
  /** 按到达顺序排列、尚未处理的弹幕 */
  pending: readonly Danmaku[];
  lastReplyAt: number | null;
  /** 最近一次弹幕到达或主播发言的时间 */
  lastActivityAt: number;
  seenSpeakers: ReadonlySet<string>;
  anchorName?: string;
}

export type StrategyDecision =
  | { type: 'reply'; replyTo: Danmaku[]; skipped: Danmaku[] }
  | { type: 'proactive' }
  | { type: 'wait'; until: number | null };

const SEC = 1000;

/**
 * 决定主播此刻要不要说话、回哪几条：
 * - each：每条弹幕单独回复；
 * - window：最早一条弹幕等满合并窗口后一起回复，超过上限时回应最新的几条；
 * - priority：同样等窗口，超过上限时按权重打分挑选；
 * 未被选中的弹幕记为 skipped（漏回）。所有回复都受最小间隔约束。
 */
export function decideReply(strategy: ReplyStrategy, state: StrategyState): StrategyDecision {
  const { now, pending } = state;
  const gapReadyAt = state.lastReplyAt === null ? Number.NEGATIVE_INFINITY : state.lastReplyAt + strategy.minGapSec * SEC;

  const first = pending[0];
  if (!first) {
    if (strategy.idleProactiveSec <= 0) return { type: 'wait', until: null };
    const idleAt = Math.max(state.lastActivityAt + strategy.idleProactiveSec * SEC, gapReadyAt);
    return now >= idleAt ? { type: 'proactive' } : { type: 'wait', until: idleAt };
  }

  const windowReadyAt = strategy.kind === 'each' ? first.ts : first.ts + strategy.mergeWindowSec * SEC;
  const readyAt = Math.max(windowReadyAt, gapReadyAt);
  if (now < readyAt) return { type: 'wait', until: readyAt };

  if (strategy.kind === 'each') return { type: 'reply', replyTo: [first], skipped: [] };

  const limit = Math.max(1, Math.floor(strategy.maxBatch));
  if (pending.length <= limit) return { type: 'reply', replyTo: [...pending], skipped: [] };

  let chosen: Set<Danmaku>;
  if (strategy.kind === 'window') {
    chosen = new Set(pending.slice(-limit));
  } else {
    const ranked = pending
      .map((d) => ({ d, score: scoreDanmaku(d, strategy.weights, state.seenSpeakers, state.anchorName) }))
      .sort((a, b) => b.score - a.score || b.d.ts - a.d.ts || b.d.id - a.d.id);
    chosen = new Set(ranked.slice(0, limit).map((r) => r.d));
  }
  return { type: 'reply', replyTo: pending.filter((d) => chosen.has(d)), skipped: pending.filter((d) => !chosen.has(d)) };
}
