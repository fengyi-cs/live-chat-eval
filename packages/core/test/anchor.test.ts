import { describe, expect, it } from 'vitest';
import {
  buildAnchorMessages,
  decideReply,
  DEFAULT_PROACTIVE_PROMPT,
  DEFAULT_STRATEGY,
  detectSignals,
  type AnchorPromptConfig,
  type Danmaku,
  type ReplyStrategy,
  type StrategyState,
} from '../src/index.ts';

const S = 1000;
const dm = (id: number, sec: number, speaker: string, text: string): Danmaku => ({ id, speaker, text, ts: sec * S });

function state(overrides: Partial<StrategyState>): StrategyState {
  return { now: 0, pending: [], lastReplyAt: null, lastActivityAt: 0, seenSpeakers: new Set(), anchorName: '小鹿', ...overrides };
}

const strategy = (overrides: Partial<ReplyStrategy>): ReplyStrategy => ({ ...DEFAULT_STRATEGY, ...overrides });
const ids = (d: { replyTo?: Danmaku[]; skipped?: Danmaku[] }, key: 'replyTo' | 'skipped') => d[key]?.map((x) => x.id);

describe('detectSignals', () => {
  it('flags questions, mentions of the anchor and gifts', () => {
    expect(detectSignals('今天吃的啥？', '小鹿')).toEqual({ question: true, mention: false, gift: false });
    expect(detectSignals('小鹿看这里', '小鹿')).toEqual({ question: false, mention: true, gift: false });
    expect(detectSignals('主播我给你送了嘉年华', '小鹿')).toEqual({ question: false, mention: true, gift: true });
    expect(detectSignals('哈哈哈', '小鹿')).toEqual({ question: false, mention: false, gift: false });
  });
});

describe('decideReply', () => {
  it('each: replies to the oldest message once the min gap has passed', () => {
    const s = strategy({ kind: 'each', minGapSec: 2 });
    const pending = [dm(1, 10, 'a', 'x'), dm(2, 11, 'b', 'y')];
    expect(decideReply(s, state({ now: 11 * S, pending, lastReplyAt: 10 * S }))).toEqual({ type: 'wait', until: 12 * S });
    const d = decideReply(s, state({ now: 12 * S, pending, lastReplyAt: 10 * S }));
    expect(d.type === 'reply' && [ids(d, 'replyTo'), ids(d, 'skipped')]).toEqual([[1], []]);
  });

  it('window: waits for the merge window, then batches; overflow keeps the newest', () => {
    const s = strategy({ kind: 'window', mergeWindowSec: 3, maxBatch: 2, minGapSec: 0 });
    const pending = [dm(1, 10, 'a', '1'), dm(2, 11, 'b', '2'), dm(3, 12, 'c', '3')];
    expect(decideReply(s, state({ now: 12 * S, pending }))).toEqual({ type: 'wait', until: 13 * S });
    const d = decideReply(s, state({ now: 13 * S, pending }));
    expect(d.type === 'reply' && [ids(d, 'replyTo'), ids(d, 'skipped')]).toEqual([[2, 3], [1]]);
  });

  it('priority: picks the highest scored messages and keeps chronological order', () => {
    const s = strategy({ kind: 'priority', mergeWindowSec: 0, maxBatch: 2, minGapSec: 0 });
    const pending = [dm(1, 10, '老粉', '主播送了你个小心心'), dm(2, 10, '老粉', '哈哈'), dm(3, 10, '新人', '你几点下播呀？'), dm(4, 10, '老粉', '666')];
    const d = decideReply(s, state({ now: 10 * S, pending, seenSpeakers: new Set(['老粉']) }));
    expect(d.type === 'reply' && [ids(d, 'replyTo'), ids(d, 'skipped')]).toEqual([
      [1, 3],
      [2, 4],
    ]);
  });

  it('replies to everything when within the batch limit', () => {
    const d = decideReply(strategy({ kind: 'priority', mergeWindowSec: 1, maxBatch: 3 }), state({ now: 20 * S, pending: [dm(1, 18, 'a', 'x'), dm(2, 19, 'b', 'y')] }));
    expect(d.type === 'reply' && [ids(d, 'replyTo'), ids(d, 'skipped')]).toEqual([[1, 2], []]);
  });

  it('speaks proactively after the idle threshold, or never when disabled', () => {
    const s = strategy({ idleProactiveSec: 30, minGapSec: 5 });
    expect(decideReply(s, state({ now: 20 * S, lastActivityAt: 0 }))).toEqual({ type: 'wait', until: 30 * S });
    expect(decideReply(s, state({ now: 30 * S, lastActivityAt: 0 }))).toEqual({ type: 'proactive' });
    expect(decideReply(s, state({ now: 31 * S, lastActivityAt: 0, lastReplyAt: 28 * S }))).toEqual({ type: 'wait', until: 33 * S });
    expect(decideReply(strategy({ idleProactiveSec: 0 }), state({ now: 999 * S }))).toEqual({ type: 'wait', until: null });
  });
});

describe('buildAnchorMessages', () => {
  const cfg: AnchorPromptConfig = { anchorName: '小鹿', personaPrompt: '你是小鹿，东北姑娘。', replyRules: '用口语。', proactivePrompt: '', contextTurns: 1 };

  it('combines persona and rules, keeps the last N turns and formats danmaku lines', () => {
    const msgs = buildAnchorMessages(
      cfg,
      [
        { input: { kind: 'danmaku', danmaku: [{ speaker: 'a', text: '旧的' }] }, reply: '旧回复' },
        { input: { kind: 'proactive' }, reply: '我来唠唠' },
      ],
      { kind: 'danmaku', danmaku: [{ speaker: '路人甲', text: '晚上好' }, { speaker: '奶茶', text: '几点下播' }] },
    );
    expect(msgs).toEqual([
      { role: 'system', content: '你是小鹿，东北姑娘。\n\n用口语。' },
      { role: 'user', content: `[系统] ${DEFAULT_PROACTIVE_PROMPT}` },
      { role: 'assistant', content: '我来唠唠' },
      { role: 'user', content: '路人甲：晚上好\n奶茶：几点下播' },
    ]);
  });

  it('falls back to a minimal persona and drops history when contextTurns is 0', () => {
    const msgs = buildAnchorMessages({ ...cfg, personaPrompt: '  ', replyRules: '', proactivePrompt: '聊聊天气', contextTurns: 0 }, [{ input: { kind: 'proactive' }, reply: 'x' }], { kind: 'proactive' });
    expect(msgs).toEqual([
      { role: 'system', content: '你是直播间主播「小鹿」。' },
      { role: 'user', content: '[系统] 聊聊天气' },
    ]);
  });
});
