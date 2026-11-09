import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_REPLY_RULES, DEFAULT_STRATEGY, type FetchLike } from '@lce/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { openDb, type Db } from '../src/db/client.ts';

const sample = readFileSync(new URL('../../../fixtures/transcripts/sample-001-chat.md', import.meta.url), 'utf8');
const sampleRoles = { 路人甲: 'viewer', 小鹿: 'anchor', 自动动作: 'action', 奶茶不加糖: 'viewer' };

const dirs: string[] = [];
const dbs: Db[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freshApp(fetchImpl?: FetchLike) {
  const dir = mkdtempSync(join(tmpdir(), 'lce-'));
  dirs.push(dir);
  const db = openDb(join(dir, 'app.db'));
  dbs.push(db);
  return createApp(db, { fetch: fetchImpl });
}

const send = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res: Response | Promise<Response>) => (await res).json();
const anchorPath = (name: string) => `/api/anchors/${encodeURIComponent(name)}`;

describe('anchor api', () => {
  it('creates, edits persona, counts sessions and blocks deleting an anchor that has sessions', async () => {
    const app = freshApp();
    expect(await json(send(app, 'POST', '/api/anchors', { name: '阿灵', personaPrompt: '你是阿灵' }))).toMatchObject({ source: 'manual' });
    expect((await send(app, 'POST', '/api/anchors', { name: '阿灵' })).status).toBe(409);

    expect(await json(send(app, 'PATCH', anchorPath('阿灵'), { personaPrompt: '你是阿灵，东北姑娘', code: 'A065' }))).toMatchObject({
      name: '阿灵',
      code: 'A065',
      personaPrompt: '你是阿灵，东北姑娘',
    });

    await send(app, 'POST', '/api/imports', { content: sample, roles: sampleRoles });
    expect(await json(app.request('/api/anchors'))).toMatchObject([
      { name: '小鹿', code: 'B001', source: 'import', sessionCount: 1 },
      { name: '阿灵', code: 'A065', source: 'manual', sessionCount: 0 },
    ]);

    const blocked = await send(app, 'DELETE', anchorPath('小鹿'));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toContain('1 个会话');
    expect((await send(app, 'DELETE', anchorPath('阿灵'))).status).toBe(204);
    expect((await send(app, 'GET', anchorPath('阿灵'))).status).toBe(404);
  });

  it('creates anchor-independent configs with defaults, merges strategy patches and validates input', async () => {
    const app = freshApp();
    await send(app, 'POST', '/api/anchors', { name: '阿灵' });

    const created = await send(app, 'POST', '/api/anchor-configs', { name: '默认', strategy: { kind: 'priority', weights: { gift: 9 } } });
    expect(created.status).toBe(201);
    const cfg = await created.json();
    expect(cfg).not.toHaveProperty('anchorName');
    expect(cfg).toMatchObject({
      providerId: null,
      contextTurns: 10,
      replyRules: DEFAULT_REPLY_RULES,
      strategy: { ...DEFAULT_STRATEGY, kind: 'priority', weights: { ...DEFAULT_STRATEGY.weights, gift: 9 } },
    });

    const patched = await json(send(app, 'PATCH', `/api/anchor-configs/${cfg.id}`, { strategy: { maxBatch: 5, weights: { question: 4 } }, contextTurns: 0 }));
    expect(patched.strategy).toMatchObject({ kind: 'priority', maxBatch: 5, weights: { gift: 9, question: 4, mention: 3 } });
    expect(patched.contextTurns).toBe(0);

    expect((await send(app, 'POST', '/api/anchor-configs', { name: '默认' })).status).toBe(409);
    expect((await send(app, 'POST', '/api/anchor-configs', { name: 'x', strategy: { kind: 'random' } })).status).toBe(400);
    expect((await send(app, 'POST', '/api/anchor-configs', { name: 'x', providerId: 'missing' })).status).toBe(404);

    const provider = await json(send(app, 'POST', '/api/providers', { name: 'P', baseUrl: 'https://llm.example/v1', enabledModels: ['m1', ' m1 ', 'm2'] }));
    expect(provider.enabledModels).toEqual(['m1', 'm2']);
    const outside = await send(app, 'POST', '/api/anchor-configs', { name: 'x', providerId: provider.id, model: 'not-enabled' });
    expect(outside.status).toBe(400);
    expect((await outside.json()).error).toContain('模型池');
    await send(app, 'PATCH', `/api/anchor-configs/${cfg.id}`, { providerId: provider.id, model: 'm2' });
    expect(await json(app.request('/api/anchor-configs'))).toMatchObject([{ id: cfg.id, providerName: 'P', model: 'm2', modelAvailable: true }]);
    await send(app, 'PATCH', `/api/providers/${provider.id}`, { enabledModels: ['m1'] });
    expect(await json(app.request('/api/anchor-configs'))).toMatchObject([{ id: cfg.id, modelAvailable: false }]);
    expect((await send(app, 'PATCH', `/api/anchor-configs/${cfg.id}`, { contextTurns: 3 })).status).toBe(200);

    await send(app, 'DELETE', anchorPath('阿灵'));
    expect((await send(app, 'PATCH', `/api/anchor-configs/${cfg.id}`, { name: 'y' })).status).toBe(200);
  });

  it('builds the prompt from persona + config and streams a trial reply through the bound provider', async () => {
    const calls: { url: string; body: { model: string; temperature?: number; messages: { role: string; content: string }[] } }[] = [];
    const upstream: FetchLike = async (url, init) => {
      calls.push({ url, body: JSON.parse(init!.body as string) });
      return new Response(['data: {"choices":[{"delta":{"content":"来啦来啦"}}]}', 'data: [DONE]', ''].join('\n\n'));
    };
    const app = freshApp(upstream);
    await send(app, 'POST', '/api/anchors', { name: '阿灵', personaPrompt: '你是阿灵。' });
    const provider = await json(send(app, 'POST', '/api/providers', { name: 'P', baseUrl: 'https://llm.example/v1', enabledModels: ['m-pool'] }));
    const cfg = await json(send(app, 'POST', '/api/anchor-configs', { name: 'c', replyRules: '说口语。', temperature: 0.9, contextTurns: 1 }));

    expect((await send(app, 'POST', `/api/anchor-configs/${cfg.id}/chat`, { anchorName: '阿灵', input: { kind: 'proactive' } })).status).toBe(400);
    await send(app, 'PATCH', `/api/anchor-configs/${cfg.id}`, { providerId: provider.id, model: 'm-pool' });

    const trial = {
      anchorName: '阿灵',
      input: { kind: 'danmaku', danmaku: [{ speaker: '卡文', text: '在吗' }] },
      history: [
        { input: { kind: 'proactive' }, reply: '很早的话' },
        { input: { kind: 'danmaku', danmaku: [{ speaker: '卡文', text: '晚上好' }] }, reply: '晚上好呀' },
      ],
    };
    const prompt = await json(send(app, 'POST', `/api/anchor-configs/${cfg.id}/prompt`, trial));
    expect(prompt).toEqual([
      { role: 'system', content: '你是阿灵。\n\n说口语。' },
      { role: 'user', content: '卡文：晚上好' },
      { role: 'assistant', content: '晚上好呀' },
      { role: 'user', content: '卡文：在吗' },
    ]);

    const res = await send(app, 'POST', `/api/anchor-configs/${cfg.id}/chat`, trial);
    const text = await res.text();
    expect(text).toContain('event: delta\ndata: {"text":"来啦来啦"}');
    expect(text).toContain('event: done');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ model: 'm-pool', temperature: 0.9, messages: prompt });

    await send(app, 'DELETE', `/api/providers/${provider.id}`);
    expect((await json(app.request('/api/anchor-configs')))[0]).toMatchObject({ providerId: null, modelAvailable: false });
  });
});
