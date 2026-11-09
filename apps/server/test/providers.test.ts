import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchLike } from '@lce/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { openDb, type Db } from '../src/db/client.ts';

const dirs: string[] = [];
const dbs: Db[] = [];

function freshDb(path?: string) {
  if (!path) {
    const dir = mkdtempSync(join(tmpdir(), 'lce-'));
    dirs.push(dir);
    path = join(dir, 'app.db');
  }
  const db = openDb(path);
  dbs.push(db);
  return { db, path };
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const send = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

const KEY = 'sk-abcdefgh12345678';

const v1OnlyUpstream: FetchLike = async (url, init) => {
  const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
  if (auth !== `Bearer ${KEY}`) return new Response('{"error":"bad key"}', { status: 401 });
  if (url === 'https://llm.example/v1/models') return Response.json({ data: [{ id: 'model-b' }, { id: 'model-a' }] });
  if (url === 'https://llm.example/v1/chat/completions') {
    const body = JSON.parse(init!.body as string);
    if (body.model === 'broken') return new Response('model not found', { status: 404 });
    return new Response(
      [`data: {"choices":[{"delta":{"content":"收到${body.messages.at(-1).content}"}}]}`, 'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}', 'data: [DONE]', ''].join('\n\n'),
    );
  }
  return new Response('not found', { status: 404 });
};

function parseSse(text: string) {
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      return { event, data: data ? JSON.parse(data) : null };
    });
}

describe('provider api', () => {
  it('detects, creates with masked key, refreshes models via /v1 fallback and persists', async () => {
    const { db, path } = freshDb();
    const app = createApp(db, { fetch: v1OnlyUpstream });

    expect(await (await send(app, 'POST', '/api/providers/detect', { baseUrl: 'https://api.anthropic.com/v1/messages' })).json()).toEqual({
      kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
    });

    const created = await send(app, 'POST', '/api/providers', { name: '测试服务', baseUrl: 'https://llm.example', apiKey: KEY });
    expect(created.status).toBe(201);
    const provider = await created.json();
    expect(provider).toMatchObject({ kind: 'openai', baseUrl: 'https://llm.example', apiKeyMasked: '****5678', models: [] });
    expect(JSON.stringify(provider)).not.toContain(KEY);

    const refreshed = await (await send(app, 'POST', `/api/providers/${provider.id}/models`)).json();
    expect(refreshed).toMatchObject({ baseUrl: 'https://llm.example/v1', enabledModels: [], models: [{ id: 'model-a' }, { id: 'model-b' }] });
    expect(refreshed).not.toHaveProperty('defaultModel');

    db.close();
    dbs.splice(dbs.indexOf(db), 1);
    const reopened = createApp(freshDb(path).db, { fetch: v1OnlyUpstream });
    const list = await (await reopened.request('/api/providers')).json();
    expect(list).toMatchObject([{ name: '测试服务', baseUrl: 'https://llm.example/v1', models: [{ id: 'model-a' }, { id: 'model-b' }] }]);
    expect(JSON.stringify(list)).not.toContain(KEY);
  });

  it('probes without saving and reports upstream errors as 502', async () => {
    const app = createApp(freshDb().db, { fetch: v1OnlyUpstream });
    const ok = await (await send(app, 'POST', '/api/providers/probe', { baseUrl: 'https://llm.example', apiKey: KEY })).json();
    expect(ok).toMatchObject({ kind: 'openai', baseUrl: 'https://llm.example/v1', models: [{ id: 'model-a' }, { id: 'model-b' }] });
    const bad = await send(app, 'POST', '/api/providers/probe', { baseUrl: 'https://llm.example/v1', apiKey: 'wrong' });
    expect(bad.status).toBe(502);
    expect(await bad.json()).toMatchObject({ upstreamStatus: 401 });
    expect(await (await app.request('/api/providers')).json()).toEqual([]);
  });

  it('keeps the key on patch unless replaced, rejects duplicate names, deletes', async () => {
    const app = createApp(freshDb().db, { fetch: v1OnlyUpstream });
    const a = await (await send(app, 'POST', '/api/providers', { name: 'A', baseUrl: 'https://llm.example/v1', apiKey: KEY })).json();
    await send(app, 'POST', '/api/providers', { name: 'B', baseUrl: 'http://localhost:11434' });

    const renamed = await (await send(app, 'PATCH', `/api/providers/${a.id}`, { name: 'A2' })).json();
    expect(renamed).toMatchObject({ name: 'A2', apiKeyMasked: '****5678' });
    expect((await send(app, 'POST', `/api/providers/${a.id}/models`)).status).toBe(200);

    expect((await send(app, 'PATCH', `/api/providers/${a.id}`, { name: 'B' })).status).toBe(409);
    expect((await send(app, 'PATCH', `/api/providers/${a.id}`, { kind: 'gemini' })).status).toBe(200);

    expect((await send(app, 'DELETE', `/api/providers/${a.id}`)).status).toBe(204);
    expect((await send(app, 'DELETE', `/api/providers/${a.id}`)).status).toBe(404);
    expect(await (await app.request('/api/providers')).json()).toMatchObject([{ name: 'B', kind: 'ollama', apiKeyMasked: null }]);
  });

  it('re-detects the interface format when a gateway only serves anthropic models, and keeps the model pool', async () => {
    const gateway: FetchLike = async (url, init) => {
      const h = init!.headers as Record<string, string>;
      if (url !== 'https://gw.example/v1/models' && url !== 'https://gw.example/v1/models?limit=1000') return new Response('', { status: 404 });
      return h['anthropic-version'] ? Response.json({ data: [{ id: 'claude-x' }] }) : Response.json({ object: 'list', data: [] });
    };
    const app = createApp(freshDb().db, { fetch: gateway });
    const p = await (await send(app, 'POST', '/api/providers', { name: 'GW', baseUrl: 'https://gw.example', apiKey: KEY, enabledModels: ['manual-model'] })).json();
    expect(p).toMatchObject({ kind: 'openai', enabledModels: ['manual-model'] });

    const plain = await (await send(app, 'POST', `/api/providers/${p.id}/models`)).json();
    expect(plain).toMatchObject({ kind: 'openai', models: [], attempts: [{ kind: 'openai', count: 0 }] });

    const detected = await (await send(app, 'POST', `/api/providers/${p.id}/models?detect=1`)).json();
    expect(detected).toMatchObject({ kind: 'anthropic', baseUrl: 'https://gw.example', models: [{ id: 'claude-x' }], enabledModels: ['manual-model'] });
    expect(detected.attempts.map((a: { kind: string; count: number }) => [a.kind, a.count])).toEqual([
      ['openai', 0],
      ['anthropic', 1],
    ]);
  });

  it('streams chat as SSE with timing, and reports upstream failures as an error event', async () => {
    const app = createApp(freshDb().db, { fetch: v1OnlyUpstream });
    const p = await (await send(app, 'POST', '/api/providers', { name: 'A', baseUrl: 'https://llm.example/v1', apiKey: KEY })).json();

    expect((await send(app, 'POST', `/api/providers/${p.id}/chat`, { messages: [{ role: 'user', content: 'x' }] })).status).toBe(400);

    const res = await send(app, 'POST', `/api/providers/${p.id}/chat`, { model: 'model-a', messages: [{ role: 'user', content: '你好' }] });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = parseSse(await res.text());
    expect(events[0]).toEqual({ event: 'delta', data: { text: '收到你好' } });
    expect(events[1]).toMatchObject({ event: 'done', data: { model: 'model-a', usage: { inputTokens: 3, outputTokens: 2 } } });
    expect(events[1]!.data.firstTokenMs).toBeTypeOf('number');

    const failed = parseSse(await (await send(app, 'POST', `/api/providers/${p.id}/chat`, { model: 'broken', messages: [{ role: 'user', content: 'x' }] })).text());
    expect(failed).toEqual([{ event: 'error', data: { message: expect.stringContaining('404') } }]);
  });
});
