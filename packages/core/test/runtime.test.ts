import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROACTIVE_PROMPT,
  DEFAULT_STRATEGY,
  formatOffset,
  LiveClock,
  LiveRoomEngine,
  parseScript,
  parseSelection,
  scriptStats,
  SimStateError,
  VirtualClock,
  type AnchorPromptConfig,
  type ChatMessage,
  type Generate,
  type ReplyStrategy,
  type SimEvent,
  type SimMessage,
} from '../src/index.ts';

const prompt: AnchorPromptConfig = { anchorName: '小鹿', personaPrompt: '你是小鹿。', replyRules: '', proactivePrompt: '', contextTurns: 10 };
const strategy = (o: Partial<ReplyStrategy>): ReplyStrategy => ({ ...DEFAULT_STRATEGY, idleProactiveSec: 0, minGapSec: 0, ...o });
const isSelection = (messages: ChatMessage[]) => messages[0]!.content.includes('挑选');

function fakeGenerate(latency: (messages: ChatMessage[]) => number, reply: (messages: ChatMessage[]) => string = (m) => `回：${m.at(-1)!.content}`) {
  const calls: ChatMessage[][] = [];
  const gen: Generate = async (messages, opts) => {
    calls.push(messages);
    const text = reply(messages);
    opts?.onDelta?.(text);
    const ms = latency(messages);
    return { text, firstTokenMs: Math.min(10, ms), totalMs: ms };
  };
  return { gen, calls };
}

function eventBus() {
  const events: SimEvent[] = [];
  const waiters: { match: (e: SimEvent) => boolean; resolve: (e: SimEvent) => void }[] = [];
  return {
    events,
    onEvent(e: SimEvent) {
      events.push(e);
      for (const w of [...waiters]) {
        if (!w.match(e)) continue;
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(e);
      }
    },
    next(match: (e: SimEvent) => boolean) {
      return new Promise<SimEvent>((resolve) => waiters.push({ match, resolve }));
    },
  };
}

function scriptEngine(text: string, s: ReplyStrategy, gen: Generate, onEvent: (e: SimEvent) => void = () => {}, p = prompt) {
  const { events: script, issues } = parseScript(text);
  expect(issues).toEqual([]);
  return new LiveRoomEngine({ mode: 'script', clock: new VirtualClock({ kind: 'instant' }), strategy: s, prompt: p, generate: gen, script, onEvent });
}

const summary = (t: SimMessage[]) => t.map((m) => [m.seq, m.role, m.at, m.repliesTo, m.latencyMs]);

describe('parseScript', () => {
  it('parses absolute, relative and default-gap times, sorts stably and reports bad lines', () => {
    const { events, issues } = parseScript(
      [
        '# 开场',
        '0:02 卡文：主播晚上好',
        '+1.5 奶茶：几点下播',
        '路人：来了',
        '',
        '0:01 早到的：我先来',
        '+2 早到的：再来一条',
        '1:02:03 晚到：很晚',
        '5s 秒数：五秒',
        '没有冒号的一行',
        '0:75 坏时间：x',
      ].join('\n'),
    );
    expect(events.map((e) => [e.at, e.speaker, e.text, e.line])).toEqual([
      [1000, '早到的', '我先来', 6],
      [2000, '卡文', '主播晚上好', 2],
      [3000, '早到的', '再来一条', 7],
      [3500, '奶茶', '几点下播', 3],
      [5000, '秒数', '五秒', 9],
      [6500, '路人', '来了', 4],
      [3723000, '晚到', '很晚', 8],
    ]);
    expect(issues).toEqual([
      { line: 10, message: '需要「昵称：内容」格式' },
      { line: 11, message: '时间「0:75」不合法' },
    ]);
    expect(scriptStats(events)).toMatchObject({ eventCount: 7, durationMs: 3723000 });
    expect(scriptStats(events).speakers.find((s) => s.name === '早到的')).toEqual({ name: '早到的', count: 2 });
    expect([formatOffset(3723000), formatOffset(65_400), formatOffset(0)]).toEqual(['1:02:03', '1:05', '0:00']);
  });
});

describe('parseSelection', () => {
  it('returns unique in-range zero-based indices up to the limit', () => {
    expect(parseSelection('选 2 和 5，还有 2', 5, 3)).toEqual([1, 4]);
    expect(parseSelection('1,2,3,4', 4, 2)).toEqual([0, 1]);
    expect(parseSelection('9', 3, 2)).toBeNull();
    expect(parseSelection('都不错', 3, 2)).toBeNull();
  });
});

describe('LiveRoomEngine (script mode)', () => {
  it('window strategy batches by merge window, skips overflow and measures latency to completion', async () => {
    const { gen, calls } = fakeGenerate(() => 1000);
    const events: SimEvent[] = [];
    const engine = scriptEngine(
      ['0:01 a：一', '+0.5 b：二', '+0 c：三', '0:05 a：四', '0:06 d：五'].join('\n'),
      strategy({ kind: 'window', mergeWindowSec: 2, maxBatch: 2 }),
      gen,
      (e) => events.push(e),
    );
    const result = await engine.run();

    expect(result).toMatchObject({ reason: 'finished', error: null, unanswered: [0] });
    expect(summary(result.transcript)).toEqual([
      [0, 'viewer', 1000, null, null],
      [1, 'viewer', 1500, null, null],
      [2, 'viewer', 1500, null, null],
      [3, 'anchor', 4000, [1, 2], 2500],
      [4, 'viewer', 5000, null, null],
      [5, 'viewer', 6000, null, null],
      [6, 'anchor', 8000, [4, 5], 3000],
    ]);
    expect(events.filter((e) => e.type === 'thinking')).toEqual([
      { type: 'thinking', at: 3000, replyTo: [1, 2], skipped: [0], proactive: false },
      { type: 'thinking', at: 7000, replyTo: [4, 5], skipped: [], proactive: false },
    ]);
    expect(calls[1]).toEqual([
      { role: 'system', content: '你是小鹿。' },
      { role: 'user', content: 'b：二\nc：三' },
      { role: 'assistant', content: '回：b：二\nc：三' },
      { role: 'user', content: 'a：四\nd：五' },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'end', reason: 'finished', unanswered: [0] });
  });

  it('records danmaku that arrive during generation before the reply', async () => {
    const { gen } = fakeGenerate(() => 1500);
    const result = await scriptEngine(['0:00 a：一', '0:01 b：二', '0:05 c：三'].join('\n'), strategy({ kind: 'each' }), gen).run();
    expect(summary(result.transcript)).toEqual([
      [0, 'viewer', 0, null, null],
      [1, 'viewer', 1000, null, null],
      [2, 'anchor', 1500, [0], 1500],
      [3, 'anchor', 3000, [1], 2000],
      [4, 'viewer', 5000, null, null],
      [5, 'anchor', 6500, [4], 1500],
    ]);
    expect(result.unanswered).toEqual([]);
  });

  it('speaks proactively during long silences', async () => {
    const { gen, calls } = fakeGenerate(() => 1000);
    const result = await scriptEngine(['0:00 a：一', '1:40 b：二'].join('\n'), strategy({ kind: 'each', idleProactiveSec: 30 }), gen).run();
    const proactive = result.transcript.filter((m) => m.proactive);
    expect(proactive.map((m) => [m.at, m.repliesTo, m.latencyMs])).toEqual([
      [32000, [], null],
      [63000, [], null],
      [94000, [], null],
    ]);
    expect(calls[1]!.at(-1)).toEqual({ role: 'user', content: `[系统] ${DEFAULT_PROACTIVE_PROMPT}` });
    expect(result.transcript.at(-1)).toMatchObject({ role: 'anchor', at: 101000, repliesTo: [5] });
  });

  const selectStrategy = strategy({ kind: 'priority', mergeWindowSec: 1, maxBatch: 2, llmSelect: true });
  const sameTime = ['0:00 a：一', '0:00 b：二', '0:00 c：三'].join('\n');

  it('lets the model pick which danmaku to answer and counts the selection time', async () => {
    const { gen, calls } = fakeGenerate(
      (m) => (isSelection(m) ? 500 : 1000),
      (m) => (isSelection(m) ? '3' : `回：${m.at(-1)!.content}`),
    );
    const result = await scriptEngine(sameTime, selectStrategy, gen).run();
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]!.content).toContain('最多 2 条');
    expect(calls[0]![1]!.content).toBe('1. a：一\n2. b：二\n3. c：三');
    expect(calls[1]!.at(-1)!.content).toBe('c：三');
    expect(result.transcript[3]).toMatchObject({ at: 2500, repliesTo: [2], latencyMs: 2500 });
    expect(result.unanswered).toEqual([0, 1]);
  });

  it('falls back to the rule-based pick with a warning when the selection is unparseable', async () => {
    const { gen } = fakeGenerate(
      (m) => (isSelection(m) ? 500 : 1000),
      (m) => (isSelection(m) ? '都挺好' : 'ok'),
    );
    const events: SimEvent[] = [];
    const result = await scriptEngine(sameTime, selectStrategy, gen, (e) => events.push(e)).run();
    expect(events.find((e) => e.type === 'warning')).toMatchObject({ at: 1500, message: expect.stringContaining('无法解析') });
    expect(result.transcript[3]).toMatchObject({ at: 2500, repliesTo: [1, 2] });
    expect(result.unanswered).toEqual([0]);
  });

  it('ends with an error and keeps the danmaku unanswered when generation fails', async () => {
    const gen: Generate = async () => {
      throw new Error('上游炸了');
    };
    const result = await scriptEngine('0:00 a：一', strategy({ kind: 'each' }), gen).run();
    expect(result).toMatchObject({ reason: 'error', error: '上游炸了', unanswered: [0] });
    expect(result.transcript.map((m) => m.role)).toEqual(['viewer']);
  });

  const threeBeats = parseScript(['0:00 a：一', '0:10 b：二', '0:20 c：三'].join('\n')).events;

  it('step pace waits for step() and can switch to instant mid-run', async () => {
    const bus = eventBus();
    const clock = new VirtualClock({ kind: 'step' });
    const { gen } = fakeGenerate(() => 1000);
    const engine = new LiveRoomEngine({ mode: 'script', clock, strategy: strategy({ kind: 'each' }), prompt, generate: gen, script: threeBeats, onEvent: bus.onEvent });

    let waiting = bus.next((e) => e.type === 'waiting');
    const done = engine.run();
    expect(await waiting).toEqual({ type: 'waiting', at: 1000, until: 10000 });
    expect(clock.waiting).toBe(true);
    expect(engine.transcript).toHaveLength(2);

    waiting = bus.next((e) => e.type === 'waiting');
    clock.step();
    expect(await waiting).toEqual({ type: 'waiting', at: 11000, until: 20000 });

    clock.setPace({ kind: 'instant' });
    const result = await done;
    expect(result.reason).toBe('finished');
    expect(result.transcript.map((m) => [m.role, m.at])).toEqual([
      ['viewer', 0],
      ['anchor', 1000],
      ['viewer', 10000],
      ['anchor', 11000],
      ['viewer', 20000],
      ['anchor', 21000],
    ]);
  });

  it('stop() ends a waiting run, and script runs reject manual danmaku', async () => {
    const bus = eventBus();
    const clock = new VirtualClock({ kind: 'step' });
    const { gen } = fakeGenerate(() => 1000);
    const engine = new LiveRoomEngine({ mode: 'script', clock, strategy: strategy({ kind: 'each' }), prompt, generate: gen, script: threeBeats, onEvent: bus.onEvent });
    const waiting = bus.next((e) => e.type === 'waiting');
    const done = engine.run();
    await waiting;
    expect(() => engine.inject('x', 'y')).toThrow(SimStateError);
    engine.stop();
    const result = await done;
    expect(result).toMatchObject({ reason: 'stopped', error: null, unanswered: [] });
    expect(result.transcript).toHaveLength(2);
  });
});

describe('LiveRoomEngine (live mode)', () => {
  it('replies to injected danmaku, queues ones that arrive while generating, and stops on request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const gen: Generate = async (messages, opts) => {
      calls++;
      if (calls === 1) await gate;
      const text = `回：${messages.at(-1)!.content}`;
      opts?.onDelta?.(text);
      return { text, firstTokenMs: 1, totalMs: 1 };
    };
    const bus = eventBus();
    const clock = new LiveClock();
    const engine = new LiveRoomEngine({ mode: 'live', clock, strategy: strategy({ kind: 'each' }), prompt, generate: gen, onEvent: bus.onEvent });

    const idle = bus.next((e) => e.type === 'waiting');
    const done = engine.run();
    expect(await idle).toMatchObject({ until: null });

    const thinking = bus.next((e) => e.type === 'thinking');
    engine.inject('我', '在吗');
    expect(await thinking).toMatchObject({ replyTo: [0] });
    expect(engine.inject('我', '人呢').seq).toBe(1);

    const bothReplied = bus.next((e) => e.type === 'reply' && e.message.seq === 3);
    const idleAgain = bus.next((e) => e.type === 'waiting' && engine.transcript.length === 4);
    release();
    await bothReplied;
    await idleAgain;

    engine.stop();
    const result = await done;
    clock.dispose();
    expect(result).toMatchObject({ reason: 'stopped', unanswered: [] });
    expect(result.transcript.map((m) => [m.seq, m.role, m.text, m.repliesTo])).toEqual([
      [0, 'viewer', '在吗', null],
      [1, 'viewer', '人呢', null],
      [2, 'anchor', '回：我：在吗', [0]],
      [3, 'anchor', '回：我：人呢', [1]],
    ]);
    expect(result.transcript[2]!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(() => engine.inject('我', '还在吗')).toThrow(SimStateError);
  });
});
