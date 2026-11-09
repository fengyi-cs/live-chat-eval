import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneRubric, DEFAULT_RUBRIC, type FetchLike } from '@lce/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { openDb, type Db } from '../src/db/client.ts';

const sample = readFileSync(new URL('../../../fixtures/transcripts/sample-001-chat.md', import.meta.url), 'utf8');
const roles = { 路人甲: 'viewer', 小鹿: 'anchor', 自动动作: 'action', 奶茶不加糖: 'viewer' };
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

type App = ReturnType<typeof createApp>;
type Ev = { type: string; [k: string]: any };
const send = (app: App, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res: Response | Promise<Response>) => (await res).json();
const sseText = (text: string) => new Response([`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`, 'data: [DONE]', ''].join('\n\n'));

function judge(failFirst = 0) {
  const prompts: string[] = [];
  const fetch: FetchLike = async (_url, init) => {
    const user = JSON.parse(init!.body as string).messages.at(-1).content as string;
    prompts.push(user);
    if (prompts.length <= failFirst) return sseText('nope');
    const keys = /键为：([^，。\n]+)|键必须是：([^\n]+)/.exec(user)!.slice(1).find(Boolean)!.split(',').map((k) => k.trim());
    return sseText(JSON.stringify(Object.fromEntries(keys.map((k) => [k, { score: 4, reason: '还行' }]))));
  };
  return { fetch, prompts };
}

const hanging: FetchLike = (_url, init) =>
  new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

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

async function finished(app: App, id: string) {
  for await (const ev of sse(await app.request(`/api/evals/${id}/events`))) if (ev.type === 'end' || ev.type === 'gone') break;
  return json(app.request(`/api/evals/${id}`));
}

async function setup(app: App) {
  const { sessionId } = await json(send(app, 'POST', '/api/imports', { content: sample, roles }));
  await send(app, 'PATCH', `/api/anchors/${encodeURIComponent('小鹿')}`, { personaPrompt: '你是小鹿，东北姑娘。' });
  const provider = await json(send(app, 'POST', '/api/providers', { name: '裁判', baseUrl: 'https://judge.example/v1', enabledModels: ['judge-m'] }));
  const rubric = await json(send(app, 'POST', '/api/rubrics', { name: '默认评分', rubric: DEFAULT_RUBRIC }));
  return { sessionId: sessionId as string, providerId: provider.id as string, model: 'judge-m', rubricId: rubric.id as string };
}

describe('rubrics api', () => {
  it('validates templates with readable errors and enforces unique names', async () => {
    const app = createApp(open().db);
    expect((await send(app, 'POST', '/api/rubrics', { name: '默认评分', rubric: DEFAULT_RUBRIC })).status).toBe(201);
    expect((await send(app, 'POST', '/api/rubrics', { name: '默认评分', rubric: DEFAULT_RUBRIC })).status).toBe(409);
    const bad = cloneRubric(DEFAULT_RUBRIC);
    bad.dimensions[1]!.key = bad.dimensions[0]!.key;
    bad.rules.latency.badSec = 1;
    const res = await send(app, 'POST', '/api/rubrics', { name: '坏', rubric: bad });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/重复.*；.*延迟/);
    const badKey = cloneRubric(DEFAULT_RUBRIC);
    badKey.dimensions[0]!.key = '口语';
    expect((await json(send(app, 'POST', '/api/rubrics', { name: '坏2', rubric: badKey }))).error).toContain('维度键');
  });
});

describe('evals api', () => {
  it('judges every anchor turn and the whole session, retries unparseable output and aggregates a composite', async () => {
    const j = judge(1);
    const app = createApp(open().db, { fetch: j.fetch });
    const ids = await setup(app);
    const started = await json(send(app, 'POST', '/api/evals', { ...ids, temperature: 0 }));
    expect(started).toMatchObject({ status: 'running', providerName: '裁判', model: 'judge-m', rubricName: '默认评分' });

    const done = await finished(app, started.id);
    expect(done).toMatchObject({ status: 'done', error: null, calls: 6 });
    expect(done.items.map((it: Ev) => [it.kind, it.seq, it.status])).toEqual([
      ['turn', 1, 'done'],
      ['turn', 5, 'done'],
      ['turn', 6, 'done'],
      ['turn', 8, 'done'],
      ['session', null, 'done'],
    ]);
    expect(done.items[0]).toMatchObject({ calls: 2, text: expect.stringContaining('晚上好呀'), scores: { colloquial: { score: 4 } } });
    expect(Object.keys(done.items[4].scores)).toEqual(['session_consistency', 'session_engagement']);
    expect(j.prompts[0]).toContain('你是小鹿，东北姑娘。');
    expect(j.prompts[0]).toContain('【观众 路人甲】主播晚上好');
    expect(j.prompts[1]).toContain('无法解析');

    const rule = done.rules.score as number;
    expect(done.summary).toMatchObject({ llmScore: 75, ruleScore: rule, judged: 5, failed: 0, pending: 0 });
    expect(done.summary.composite).toBeCloseTo((rule * 30 + 75 * 70) / 100, 1);
    expect(await json(app.request(`/api/evals?sessionId=${ids.sessionId}`))).toMatchObject([{ id: started.id, status: 'done', composite: done.summary.composite }]);

    await send(app, 'DELETE', `/api/rubrics/${ids.rubricId}`);
    expect(await json(app.request(`/api/evals/${started.id}`))).toMatchObject({ rubricId: null, rubricName: '默认评分' });
    expect((await send(app, 'DELETE', `/api/sessions/${ids.sessionId}`)).status).toBe(204);
    expect((await app.request(`/api/evals/${started.id}`)).status).toBe(404);
  });

  it('finishes rules-only templates immediately without calling a model', async () => {
    const j = judge();
    const app = createApp(open().db, { fetch: j.fetch });
    const ids = await setup(app);
    const rulesOnly = cloneRubric(DEFAULT_RUBRIC);
    for (const d of rulesOnly.dimensions) d.enabled = false;
    const r = await json(send(app, 'POST', '/api/rubrics', { name: '只看规则', rubric: rulesOnly }));
    const res = await json(send(app, 'POST', '/api/evals', { sessionId: ids.sessionId, rubricId: r.id }));
    expect(res).toMatchObject({ status: 'done', providerName: null, calls: 0 });
    expect(res.items.every((it: Ev) => it.status === 'skipped')).toBe(true);
    expect(res.summary.composite).toBe(res.rules.score);
    expect(j.prompts).toEqual([]);
  });

  it('stops on request, recovers interrupted runs after restart and validates input', async () => {
    const { db, path } = open();
    const app = createApp(db, { fetch: hanging });
    const ids = await setup(app);
    expect((await send(app, 'POST', '/api/evals', { sessionId: ids.sessionId, rubricId: ids.rubricId })).status).toBe(400);
    expect((await send(app, 'POST', '/api/evals', { ...ids, sessionId: 'nope' })).status).toBe(404);

    const run = await json(send(app, 'POST', '/api/evals', ids));
    expect((await send(app, 'POST', '/api/evals', ids)).status).toBe(409);
    const reopened = createApp(open(path).db);
    expect(await json(reopened.request(`/api/evals/${run.id}`))).toMatchObject({ status: 'stopped', error: expect.stringContaining('中断') });

    const events = sse(await app.request(`/api/evals/${run.id}/events`));
    expect((await events.next()).value).toMatchObject({ type: 'hello' });
    expect((await send(app, 'POST', `/api/evals/${run.id}/stop`)).status).toBe(204);
    let end: Ev | undefined;
    for await (const ev of events) if (ev.type === 'end') end = ev;
    expect(end).toMatchObject({ status: 'stopped' });
    const after = await json(app.request(`/api/evals/${run.id}`));
    expect(after.items.every((it: Ev) => it.status === 'pending')).toBe(true);
    expect(after.summary.pending).toBe(5);
    expect((await send(app, 'POST', `/api/evals/${run.id}/stop`)).status).toBe(404);
  });
});
