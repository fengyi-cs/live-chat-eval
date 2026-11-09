import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_RUBRIC, type FetchLike } from '@lce/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { openDb, type Db } from '../src/db/client.ts';

const dirs: string[] = [];
const dbs: Db[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function open(path?: string) {
  if (!path) {
    const dir = mkdtempSync(join(tmpdir(), 'lce-'));
    dirs.push(dir);
    path = join(dir, 'app.db');
  }
  const db = openDb(path);
  dbs.push(db);
  return { db, path };
}

const sseText = (text: string) => new Response([`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`, 'data: [DONE]', ''].join('\n\n'));

const echoUpstream: FetchLike = async (_url, init) => sseText(`回：${JSON.parse(init!.body as string).messages.at(-1).content}`);

/** 主播回复用回声；裁判请求（系统提示是直播内容评审）按要求的键返回 4 分 */
const anchorAndJudge: FetchLike = async (url, init) => {
  const msgs = JSON.parse(init!.body as string).messages as { role: string; content: string }[];
  if (!msgs[0]!.content.startsWith('你是直播内容评审')) return echoUpstream(url, init);
  const keys = /键必须是：([^\n]+)/.exec(msgs.at(-1)!.content)![1]!.split(',').map((k) => k.trim());
  return sseText(JSON.stringify(Object.fromEntries(keys.map((k) => [k, { score: 4, reason: '还行' }]))));
};

type App = ReturnType<typeof createApp>;
type Ev = { type: string; [k: string]: any };

const send = (app: App, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res: Response | Promise<Response>) => (await res).json();

async function setup(app: App, anchor = '阿灵') {
  await send(app, 'POST', '/api/anchors', { name: anchor, personaPrompt: `你是${anchor}。` });
  const provider = await json(send(app, 'POST', '/api/providers', { name: `P-${anchor}`, baseUrl: 'https://llm.example/v1', enabledModels: ['m'] }));
  const cfg = await json(
    send(app, 'POST', '/api/anchor-configs', {
      name: `默认-${anchor}`,
      providerId: provider.id,
      model: 'm',
      strategy: { kind: 'each', minGapSec: 0, idleProactiveSec: 0 },
    }),
  );
  return { anchorName: anchor, configId: cfg.id as string, providerId: provider.id as string };
}

async function* sse(res: Response): AsyncGenerator<Ev> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const data = /^data: (.*)$/m.exec(buf.slice(0, i))?.[1];
      buf = buf.slice(i + 2);
      if (data) yield JSON.parse(data);
    }
  }
}

async function until(stream: AsyncGenerator<Ev>, type: string, seen: Ev[] = []) {
  for (;;) {
    const { value, done } = await stream.next();
    if (done) throw new Error(`stream ended before "${type}"`);
    seen.push(value);
    if (value.type === type) return value;
  }
}

describe('simulation api', () => {
  it('runs a script, persists the transcript with a config snapshot, and reports finished runs as gone', async () => {
    const app = createApp(open().db, { fetch: echoUpstream });
    const start = await setup(app);
    const { configId } = start;
    expect(await json(app.request('/api/anchor-configs'))).toMatchObject([{ id: configId, providerName: 'P-阿灵', model: 'm', modelAvailable: true }]);

    const script = await json(send(app, 'POST', '/api/scripts', { name: '开场', content: '0:00 卡文：晚上好\n0:05 奶茶：几点下播' }));
    expect(script).toMatchObject({ eventCount: 2, durationMs: 5000, speakerCount: 2, issueCount: 0 });

    const started = await send(app, 'POST', '/api/sims', { mode: 'script', anchorName: start.anchorName, configId, scriptId: script.id, pace: { kind: 'step' } });
    expect(started.status).toBe(201);
    const info = await started.json();
    expect(info).toMatchObject({ mode: 'script', anchorName: '阿灵', configName: '默认-阿灵', scriptName: '开场', scriptDurationMs: 5000, pace: { kind: 'step' }, evalId: null });
    expect(await json(app.request('/api/sims'))).toMatchObject([{ sessionId: info.sessionId }]);

    const stream = sse(await app.request(`/api/sims/${info.sessionId}/events`));
    const seen: Ev[] = [];
    expect(await until(stream, 'hello', seen)).toMatchObject({ info: { sessionId: info.sessionId } });
    expect((await send(app, 'POST', `/api/sims/${info.sessionId}/pace`, { kind: 'instant' })).status).toBe(204);
    await until(stream, 'end', seen);
    expect((await stream.next()).done).toBe(true);

    expect(
      seen
        .filter((e) => ['danmaku', 'reply', 'end'].includes(e.type))
        .map((e) => (e.type === 'end' ? ['end', e.reason, e.unanswered] : [e.type, e.message.seq, e.message.text])),
    ).toEqual([
      ['danmaku', 0, '晚上好'],
      ['reply', 1, '回：卡文：晚上好'],
      ['danmaku', 2, '几点下播'],
      ['reply', 3, '回：奶茶：几点下播'],
      ['end', 'finished', []],
    ]);

    const detail = await json(app.request(`/api/sessions/${info.sessionId}`));
    expect(detail).toMatchObject({
      source: 'script',
      status: 'done',
      error: null,
      title: '默认-阿灵 · 开场',
      unanswered: [],
      snapshot: { configName: '默认-阿灵', providerName: 'P-阿灵', model: 'm', personaPrompt: '你是阿灵。', scriptName: '开场', mode: 'script' },
    });
    expect(detail.messages.map((m: Ev) => [m.seq, m.role, m.speaker, m.repliesTo])).toEqual([
      [0, 'viewer', '卡文', null],
      [1, 'anchor', '阿灵', [0]],
      [2, 'viewer', '奶茶', null],
      [3, 'anchor', '阿灵', [2]],
    ]);
    expect(Date.parse(detail.messages[2].time) - Date.parse(detail.startedAt)).toBe(5000);
    expect(detail.messages[1].genTotalMs).toBeTypeOf('number');
    expect(detail.endedAt).toBeTruthy();

    expect(await json(app.request('/api/sims'))).toEqual([]);
    expect(await json(app.request('/api/sessions'))).toMatchObject([{ id: info.sessionId, source: 'script', status: 'done', messageCount: 4 }]);
    const late = sse(await app.request(`/api/sims/${info.sessionId}/events`));
    expect((await late.next()).value).toEqual({ type: 'gone' });
  });

  it('drives a live session through injected danmaku and stop', async () => {
    const app = createApp(open().db, { fetch: echoUpstream });
    const info = await json(send(app, 'POST', '/api/sims', { mode: 'live', ...(await setup(app)) }));
    expect(info).toMatchObject({ mode: 'live', pace: null, scriptName: null });

    const stream = sse(await app.request(`/api/sims/${info.sessionId}/events`));
    await until(stream, 'hello');
    const injected = await send(app, 'POST', `/api/sims/${info.sessionId}/danmaku`, { speaker: '我', text: '在吗' });
    expect(injected.status).toBe(201);
    expect(await injected.json()).toMatchObject({ seq: 0, role: 'viewer', speaker: '我', text: '在吗' });
    expect(await until(stream, 'reply')).toMatchObject({ message: { seq: 1, text: '回：我：在吗', repliesTo: [0] } });

    expect((await send(app, 'POST', `/api/sims/${info.sessionId}/pace`, { kind: 'instant' })).status).toBe(400);
    expect((await send(app, 'POST', `/api/sims/${info.sessionId}/stop`)).status).toBe(204);
    expect(await until(stream, 'end')).toMatchObject({ reason: 'stopped', unanswered: [] });
    expect((await send(app, 'POST', `/api/sims/${info.sessionId}/danmaku`, { speaker: '我', text: '还在吗' })).status).toBe(404);
    expect(await json(app.request(`/api/sessions/${info.sessionId}`))).toMatchObject({ source: 'live', status: 'stopped', title: '默认-阿灵 · 单人实时' });
  });

  it('validates starts and control calls, recovers interrupted runs and stops a run when its session is deleted', async () => {
    const { db, path } = open();
    const app = createApp(db, { fetch: echoUpstream });
    await send(app, 'POST', '/api/anchors', { name: '阿灵' });
    const bare = await json(send(app, 'POST', '/api/anchor-configs', { name: '没绑模型' }));
    expect(await json(send(app, 'POST', '/api/sims', { mode: 'live', anchorName: '阿灵', configId: bare.id }))).toEqual({ error: '还没有选择这个配置的模型' });

    const bad = await send(app, 'POST', '/api/scripts', { name: '坏', content: '0:00 卡文：好\n没有冒号' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain('第 2 行');
    const empty = await json(send(app, 'POST', '/api/scripts', { name: '空', content: '# 只有注释' }));
    expect((await send(app, 'POST', '/api/scripts', { name: '空', content: '' })).status).toBe(409);

    const start = await setup(app, '小鹿');
    expect(await json(send(app, 'POST', '/api/sims', { mode: 'script', ...start, scriptId: empty.id, pace: { kind: 'instant' } }))).toEqual({
      error: '剧本里没有弹幕',
    });
    expect((await send(app, 'POST', '/api/sims/nope/step')).status).toBe(404);
    expect((await app.request('/api/sims/nope/events')).status).toBe(404);

    const script = await json(send(app, 'POST', '/api/scripts', { name: '长', content: '0:00 a：一\n0:30 b：二' }));
    const info = await json(send(app, 'POST', '/api/sims', { mode: 'script', ...start, scriptId: script.id, pace: { kind: 'step' } }));
    expect((await send(app, 'POST', `/api/sims/${info.sessionId}/danmaku`, { speaker: 'x', text: 'y' })).status).toBe(400);

    const reopened = createApp(open(path).db, { fetch: echoUpstream });
    expect(await json(reopened.request(`/api/sessions/${info.sessionId}`))).toMatchObject({ status: 'stopped', error: expect.stringContaining('中断') });

    const stream = sse(await app.request(`/api/sims/${info.sessionId}/events`));
    await until(stream, 'hello');
    expect((await send(app, 'DELETE', `/api/sessions/${info.sessionId}`)).status).toBe(204);
    expect(await until(stream, 'end')).toMatchObject({ reason: 'stopped' });
    expect((await app.request(`/api/sessions/${info.sessionId}`)).status).toBe(404);
  });
it('scores each anchor reply while the room is running and finishes the live eval with the whole session', async () => {
    const app = createApp(open().db, { fetch: anchorAndJudge });
    const start = await setup(app);
    const rubric = await json(send(app, 'POST', '/api/rubrics', { name: '默认评分', rubric: DEFAULT_RUBRIC }));
    // 第一条弹幕在 0:01，单步模式会在它之前停住，订阅评估事件之后才开始打分
    const script = await json(send(app, 'POST', '/api/scripts', { name: '开场', content: '0:01 卡文：晚上好\n0:05 奶茶：几点下播' }));

    const notInPool = await send(app, 'POST', '/api/sims', {
      mode: 'live',
      ...start,
      liveEval: { rubricId: rubric.id, providerId: start.providerId, model: 'not-enabled' },
    });
    expect(notInPool.status).toBe(400);
    expect(await json(app.request('/api/sessions'))).toEqual([]);

    const info = await json(
      send(app, 'POST', '/api/sims', {
        mode: 'script',
        ...start,
        scriptId: script.id,
        pace: { kind: 'step' },
        liveEval: { rubricId: rubric.id, providerId: start.providerId, model: 'm' },
      }),
    );
    expect(info.evalId).toEqual(expect.any(String));
    const evalEvents = sse(await app.request(`/api/evals/${info.evalId}/events`));
    expect(await until(evalEvents, 'hello')).toMatchObject({ eval: { status: 'running', items: [] } });

    expect((await send(app, 'POST', `/api/sims/${info.sessionId}/pace`, { kind: 'instant' })).status).toBe(204);
    const seen: Ev[] = [];
    expect(await until(evalEvents, 'end', seen)).toMatchObject({ status: 'done', error: null });
    const scored = seen.filter((e) => e.type === 'item' && e.item.status === 'done').map((e) => [e.item.kind, e.item.seq]);
    expect(scored).toEqual([
      ['turn', 1],
      ['turn', 3],
      ['session', null],
    ]);

    const detail = await json(app.request(`/api/evals/${info.evalId}`));
    expect(detail).toMatchObject({ status: 'done', sessionId: info.sessionId, model: 'm', summary: { llmScore: 75, judged: 3, failed: 0, pending: 0 } });
    expect(Object.keys(detail.rules.turns)).toEqual(['1', '3']);
    expect(detail.items[0]).toMatchObject({ kind: 'turn', seq: 1, text: '回：卡文：晚上好', scores: { colloquial: { score: 4 } } });
  });
});
