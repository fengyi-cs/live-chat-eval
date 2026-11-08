import { describe, expect, it } from 'vitest';
import {
  buildSessionJudgeMessages,
  buildTurnJudgeMessages,
  computeRules,
  DEFAULT_RUBRIC,
  JudgeFailedError,
  JudgeParseError,
  parseJudgeOutput,
  runJudge,
  summarize,
  turnLlmScore,
  type Dimension,
  type EvalItemResult,
  type EvalMessage,
  type EvalSession,
  type Generate,
  type Rubric,
  type RuleConfig,
} from '../src/index.ts';

const msg = (seq: number, role: EvalMessage['role'], speaker: string, text: string, extra: Partial<EvalMessage> = {}): EvalMessage => ({
  seq,
  role,
  speaker,
  text,
  time: `2026-01-05T20:00:${String(seq).padStart(2, '0')}`,
  repliesTo: null,
  latencyMs: null,
  proactive: null,
  ...extra,
});

const session: EvalSession = {
  anchorName: '小鹿',
  personaPrompt: '你是小鹿，东北姑娘。',
  unanswered: [4],
  messages: [
    msg(0, 'viewer', '卡文', '主播晚上好'),
    msg(1, 'anchor', '小鹿', '晚上好呀卡文', { repliesTo: [0], latencyMs: 2000, proactive: false }),
    msg(2, 'viewer', '奶茶', '几点下播'),
    msg(3, 'anchor', '小鹿', '首先，下播时间大概是十点。其次，希望对你有帮助哈', { repliesTo: [2], latencyMs: 9000, proactive: false }),
    msg(4, 'viewer', '路人', '在吗'),
    msg(5, 'anchor', '小鹿', '晚上好呀卡文', { repliesTo: [], proactive: true }),
    msg(6, 'action', '自动动作', '（动作）挥手'),
  ],
};

const rules: RuleConfig = {
  latency: { enabled: true, weight: 1, goodSec: 3, badSec: 15 },
  missRate: { enabled: true, weight: 1 },
  length: { enabled: true, weight: 1, minChars: 2, maxChars: 20 },
  repetition: { enabled: true, weight: 1, window: 5 },
  aiPhrases: { enabled: true, weight: 2, phrases: ['首先', '其次', '希望对你有帮助'], penaltyPerHit: 25 },
};

describe('computeRules', () => {
  it('scores latency, length, repetition and AI phrases per turn and aggregates with weights', () => {
    const r = computeRules(session, rules);
    expect(r.turns[1]).toEqual({
      latency: { score: 100, value: 2000 },
      length: { score: 100, value: 6 },
      repetition: { score: 100, value: 0 },
      aiPhrases: { score: 100, value: 0, hits: [] },
    });
    expect(r.turns[3]).toEqual({
      latency: { score: 50, value: 9000 },
      length: { score: 80, value: 24 },
      repetition: { score: 100, value: 0 },
      aiPhrases: { score: 25, value: 3, hits: ['首先', '其次', '希望对你有帮助'] },
    });
    expect(r.turns[5]).toEqual({
      length: { score: 100, value: 6 },
      repetition: { score: 0, value: 100 },
      aiPhrases: { score: 100, value: 0, hits: [] },
    });
    expect(r.session).toEqual({
      latency: { score: 75, value: 5500 },
      missRate: { score: 66.7, value: 33.3 },
      length: { score: 93.3, value: 12 },
      repetition: { score: 66.7, value: 33.3 },
      aiPhrases: { score: 75, value: 3, hits: ['首先', '其次', '希望对你有帮助'] },
    });
    expect(r.score).toBe(75.3);
  });

  it('only uses enabled rules', () => {
    const only: RuleConfig = {
      ...rules,
      latency: { ...rules.latency, enabled: false },
      missRate: { enabled: false, weight: 1 },
      length: { ...rules.length, enabled: false },
      repetition: { ...rules.repetition, enabled: false },
    };
    const r = computeRules(session, only);
    expect(Object.keys(r.session)).toEqual(['aiPhrases']);
    expect(Object.keys(r.turns[1]!)).toEqual(['aiPhrases']);
    expect(r.score).toBe(75);
  });
});

const dims = (o: Partial<Dimension>[]): Dimension[] =>
  o.map((d, i) => ({ key: `d${i}`, name: `D${i}`, description: '', anchors: ['1', '2', '3', '4', '5'], weight: 1, scope: 'turn', enabled: true, skipProactive: false, ...d }));

describe('summarize', () => {
  const rubric: Rubric = {
    ...DEFAULT_RUBRIC,
    ruleWeight: 30,
    llmWeight: 70,
    dimensions: dims([
      { key: 'a', weight: 2 },
      { key: 'b', weight: 1, skipProactive: true },
      { key: 's', weight: 1, scope: 'session' },
      { key: 'off', enabled: false },
    ]),
  };
  const sc = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, score]) => [k, { score, reason: '' }]));
  const items: EvalItemResult[] = [
    { kind: 'turn', seq: 1, proactive: false, status: 'done', scores: sc({ a: 5, b: 3, off: 1 }) },
    { kind: 'turn', seq: 3, proactive: false, status: 'done', scores: sc({ a: 3, b: 1 }) },
    { kind: 'turn', seq: 5, proactive: true, status: 'done', scores: sc({ a: 4, b: 5 }) },
    { kind: 'turn', seq: 7, proactive: false, status: 'error', scores: null },
    { kind: 'session', seq: null, proactive: false, status: 'done', scores: sc({ s: 4 }) },
  ];

  it('averages each dimension over applicable items, then weights into the LLM score and composite', () => {
    const s = summarize(rubric, { session: {}, turns: {}, score: 80 }, items);
    expect(s.dimensions.map(({ key, mean, score100, count }) => ({ key, mean, score100, count }))).toEqual([
      { key: 'a', mean: 4, score100: 75, count: 3 },
      { key: 'b', mean: 2, score100: 25, count: 2 },
      { key: 's', mean: 4, score100: 75, count: 1 },
    ]);
    expect(s).toMatchObject({ llmScore: 62.5, ruleScore: 80, composite: 67.8, turnCount: 4, judged: 4, failed: 1, pending: 0 });
  });

  it('falls back to whichever side has data', () => {
    expect(summarize(rubric, { session: {}, turns: {}, score: 80 }, []).composite).toBe(80);
    expect(summarize(rubric, { session: {}, turns: {}, score: null }, items).composite).toBe(62.5);
  });

  it('turnLlmScore weights the dimensions that apply to the turn', () => {
    expect(turnLlmScore(rubric, items[0]!)).toBe(83.3);
    expect(turnLlmScore(rubric, items[2]!)).toBe(75);
    expect(turnLlmScore(rubric, items[3]!)).toBeNull();
  });
});

describe('judge prompt and parsing', () => {
  it('parses fenced, wrapped and string scores', () => {
    expect(parseJudgeOutput('```json\n{"a":{"score":4,"reason":"自然"},"b":{"score":"2","reason":"x"}}\n```', ['a', 'b'])).toEqual({
      a: { score: 4, reason: '自然' },
      b: { score: 2, reason: 'x' },
    });
    expect(parseJudgeOutput('好的：{"scores":{"a":5,"b":{"score":1}},"extra":1}', ['a', 'b'])).toEqual({
      a: { score: 5, reason: '' },
      b: { score: 1, reason: '' },
    });
  });

  it.each([
    ['{"a":{"score":4}}', '缺少维度 b'],
    ['{"a":6,"b":3}', '不在'],
    ['ok', '没有 JSON'],
    ['{"a":', '没有 JSON'],
  ])('rejects %s', (text, message) => {
    expect(() => parseJudgeOutput(text, ['a', 'b'])).toThrow(JudgeParseError);
    expect(() => parseJudgeOutput(text, ['a', 'b'])).toThrow(message);
  });

  it('turn prompt carries the persona, the replied danmaku, the reply, the last N visible messages and every dimension key', () => {
    const user = buildTurnJudgeMessages(session, 3, dims([{ key: 'colloquial' }, { key: 'relevance' }]), 2)[1]!.content;
    expect(user).toContain('你是小鹿，东北姑娘。');
    expect(user).toContain('【观众 奶茶】几点下播');
    expect(user).toContain('首先，下播时间大概是十点');
    expect(user).toContain('【主播 小鹿】晚上好呀卡文');
    expect(user).not.toContain('【观众 卡文】主播晚上好');
    expect(user).toContain('colloquial');
    expect(user).toContain('relevance');
    expect(() => buildTurnJudgeMessages(session, 2, dims([{}]))).toThrow('#2');
  });

  it('session prompt keeps the latest lines within the budget and drops actions', () => {
    const user = buildSessionJudgeMessages(session, dims([{ key: 'session_x', scope: 'session' }]), 30)[1]!.content;
    expect(user).toContain('【观众 路人】在吗');
    expect(user).not.toContain('主播晚上好');
    expect(user).not.toContain('挥手');
    expect(user).toContain('session_x');
  });
});

describe('runJudge', () => {
  const scripted = (outputs: (string | Error)[]) => {
    const calls: Parameters<Generate>[0][] = [];
    const gen: Generate = async (messages) => {
      calls.push(messages);
      const out = outputs[Math.min(calls.length - 1, outputs.length - 1)]!;
      if (out instanceof Error) throw out;
      return { text: out, firstTokenMs: 1, totalMs: 1 };
    };
    return { gen, calls };
  };
  const base = [
    { role: 'system' as const, content: 'S' },
    { role: 'user' as const, content: 'U' },
  ];

  it('feeds the parse error back and retries', async () => {
    const { gen, calls } = scripted(['ok', '{"a":{"score":4,"reason":"r"}}']);
    const res = await runJudge(gen, base, ['a'], { retryDelayMs: 0 });
    expect(res).toMatchObject({ calls: 2, scores: { a: { score: 4, reason: 'r' } } });
    expect(calls[1]!.slice(0, 3)).toEqual([...base, { role: 'assistant', content: 'ok' }]);
    expect(calls[1]).toHaveLength(4);
  });

  it('retries upstream errors, averages samples, and gives up after the attempt budget', async () => {
    const flaky = scripted([new Error('502'), '{"a":5}', '{"a":2}']);
    expect(await runJudge(flaky.gen, base, ['a'], { retryDelayMs: 0, samples: 2 })).toMatchObject({ calls: 3, scores: { a: { score: 3.5 } } });

    const broken = scripted(['nope']);
    const err = await runJudge(broken.gen, base, ['a'], { retryDelayMs: 0, attempts: 2 }).catch((e) => e);
    expect(err).toBeInstanceOf(JudgeFailedError);
    expect(err.calls).toBe(2);

    const ctrl = new AbortController();
    ctrl.abort();
    expect(await runJudge(broken.gen, base, ['a'], { signal: ctrl.signal }).catch((e) => e)).toMatchObject({ calls: 0 });
  });
});
