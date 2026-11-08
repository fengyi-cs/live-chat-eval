import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pairTurns, parseMarkdownTranscript, suggestRoles, TranscriptParseError } from '../src/index.ts';

const sample = readFileSync(new URL('../../../fixtures/transcripts/sample-001-chat.md', import.meta.url), 'utf8');

describe('parseMarkdownTranscript', () => {
  const parsed = parseMarkdownTranscript(sample);

  it('reads meta, splitting anchor name and code', () => {
    expect(parsed.title).toBe('小鹿');
    expect(parsed.meta).toEqual({
      externalId: '9001',
      anchorName: '小鹿',
      anchorCode: 'B001',
      startedAt: '2026-01-05T20:00:00',
      endedAt: '2026-01-05T20:10:00',
    });
  });

  it('lists speakers with message counts in first-seen order', () => {
    expect(parsed.speakers).toEqual([
      { name: '路人甲', count: 3 },
      { name: '小鹿', count: 4 },
      { name: '自动动作', count: 2 },
      { name: '奶茶不加糖', count: 2 },
    ]);
    expect(parsed.messages[1]).toMatchObject({ time: '2026-01-05T20:00:15', speaker: '小鹿', text: '晚上好呀路人甲，刚开播你就来了，手速可以啊。' });
  });

  it('accepts CRLF and keeps multi-line bodies', () => {
    const crlf = '### 2026/1/5 9:00:00｜A\r\n\r\n第一行\r\n第二行\r\n';
    const p = parseMarkdownTranscript(crlf);
    expect(p.messages[0]).toMatchObject({ time: '2026-01-05T09:00:00', text: '第一行\n第二行' });
  });

  it('rejects input without message headers', () => {
    expect(() => parseMarkdownTranscript('# 随便写点\n\n没有消息')).toThrow(TranscriptParseError);
  });
});

describe('suggestRoles', () => {
  const parsed = parseMarkdownTranscript(sample);

  it('picks the meta anchor and the action speaker, others default to viewer', () => {
    expect(suggestRoles(parsed)).toEqual({ 路人甲: 'viewer', 小鹿: 'anchor', 自动动作: 'action', 奶茶不加糖: 'viewer' });
  });

  it('prefers a known anchor profile and remembered roles', () => {
    const roles = suggestRoles(
      { ...parsed, meta: { ...parsed.meta, anchorName: undefined } },
      { knownAnchors: ['小鹿'], rememberedRoles: { 路人甲: 'ignore' } },
    );
    expect(roles).toMatchObject({ 小鹿: 'anchor', 路人甲: 'ignore', 奶茶不加糖: 'viewer' });
  });
});

describe('pairTurns', () => {
  const parsed = parseMarkdownTranscript(sample);
  const result = pairTurns(parsed.messages, suggestRoles(parsed));

  it('pairs anchor replies with preceding viewer messages and computes latency', () => {
    expect(result.turns.map(({ seq, repliesTo, proactive, latencyMs }) => ({ seq, repliesTo, proactive, latencyMs }))).toEqual([
      { seq: 1, repliesTo: [0], proactive: false, latencyMs: 3000 },
      { seq: 5, repliesTo: [3, 4], proactive: false, latencyMs: 7000 },
      { seq: 6, repliesTo: [], proactive: true, latencyMs: null },
      { seq: 8, repliesTo: [7], proactive: false, latencyMs: 5000 },
    ]);
  });

  it('attaches actions to the previous anchor turn without the prefix', () => {
    expect(result.turns[0]!.actions).toEqual([{ seq: 2, time: '2026-01-05T20:00:16', text: '笑着朝镜头挥了挥手' }]);
    expect(result.turns[3]!.actions.map((a) => a.text)).toEqual(['凑近镜头指了指自己的眼睛']);
  });

  it('reports trailing viewer messages as unanswered', () => {
    expect(result.unanswered).toEqual([10]);
  });

  it('keeps actions before any anchor turn as orphans and skips ignored speakers', () => {
    const msgs = parseMarkdownTranscript(
      '### 2026/01/05 20:00:00｜自动动作\n\n（动作）挥手\n\n### 2026/01/05 20:00:01｜机器人\n\n广告\n\n### 2026/01/05 20:00:03｜小鹿\n\n嗨',
    ).messages;
    const r = pairTurns(msgs, { 自动动作: 'action', 机器人: 'ignore', 小鹿: 'anchor' });
    expect(r.orphanActions).toEqual([{ seq: 0, time: '2026-01-05T20:00:00', text: '挥手' }]);
    expect(r.turns).toEqual([{ seq: 2, repliesTo: [], proactive: true, latencyMs: null, actions: [] }]);
  });
});
