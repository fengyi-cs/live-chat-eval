import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { openDb, type Db } from '../src/db/client.ts';

const sample = readFileSync(new URL('../../../fixtures/transcripts/sample-001-chat.md', import.meta.url), 'utf8');
const roles = { 路人甲: 'viewer', 小鹿: 'anchor', 自动动作: 'action', 奶茶不加糖: 'viewer' };
const dirs: string[] = [];
const dbs: Db[] = [];

function freshDb(path = tempDbPath()) {
  const db = openDb(path);
  dbs.push(db);
  return db;
}

function tempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), 'lce-'));
  dirs.push(dir);
  return join(dir, 'app.db');
}

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('import api', () => {
  it('previews, commits, persists across reopen and recognizes the anchor next time', async () => {
    const path = tempDbPath();
    const db1 = openDb(path);
    const app1 = createApp(db1);

    const preview = await (await post(app1, '/api/imports/preview', { content: sample })).json();
    expect(preview).toMatchObject({ messageCount: 11, knownAnchor: null, duplicateSessionId: null });
    expect(preview.speakers.find((s: { name: string }) => s.name === '小鹿').suggestedRole).toBe('anchor');

    const created = await post(app1, '/api/imports', { content: sample, roles });
    expect(created.status).toBe(201);
    const { sessionId } = await created.json();
    db1.close();

    const app2 = createApp(freshDb(path));
    const detail = await (await app2.request(`/api/sessions/${sessionId}`)).json();
    expect(detail).toMatchObject({ externalId: '9001', anchorName: '小鹿', unanswered: [10] });
    expect(detail.messages[5]).toMatchObject({ role: 'anchor', repliesTo: [3, 4], latencyMs: 7000, proactive: false });
    expect(detail.messages[8].actions).toEqual([{ seq: 9, time: '2026-01-05T20:04:07', text: '凑近镜头指了指自己的眼睛' }]);

    expect(await (await app2.request('/api/anchors')).json()).toMatchObject([{ name: '小鹿', code: 'B001' }]);

    const again = await (await post(app2, '/api/imports/preview', { content: sample })).json();
    expect(again).toMatchObject({ knownAnchor: '小鹿', duplicateSessionId: sessionId });
  });

  it('rejects duplicates unless replace is set', async () => {
    const app = createApp(freshDb());
    expect((await post(app, '/api/imports', { content: sample, roles })).status).toBe(201);
    expect((await post(app, '/api/imports', { content: sample, roles })).status).toBe(409);
    expect((await post(app, '/api/imports', { content: sample, roles, replace: true })).status).toBe(201);
    expect(await (await app.request('/api/sessions')).json()).toMatchObject([{ externalId: '9001', messageCount: 11 }]);
  });

  it('requires exactly one anchor, every speaker assigned, and parseable content', async () => {
    const app = createApp(freshDb());
    const twoAnchors = await post(app, '/api/imports', { content: sample, roles: { ...roles, 路人甲: 'anchor' } });
    expect(twoAnchors.status).toBe(400);
    const missing = await post(app, '/api/imports', { content: sample, roles: { 小鹿: 'anchor' } });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toContain('路人甲');
    expect((await post(app, '/api/imports/preview', { content: '没有消息' })).status).toBe(400);
    expect((await post(app, '/api/imports', { content: sample, roles: { ...roles, 小鹿: 'boss' } })).status).toBe(400);
  });
});
