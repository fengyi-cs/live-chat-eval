import { ProviderError, SPEAKER_ROLES, TranscriptParseError, type FetchLike } from '@lce/core';
import { zValidator } from '@hono/zod-validator';
import { asc, count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from './db/client.ts';
import { anchors, messages, sessions } from './db/schema.ts';
import { providerRoutes } from './routes/providers.ts';
import { commitImport, ImportError, previewImport } from './services/imports.ts';
import { ProviderConflictError, ProviderNotFoundError } from './services/providers.ts';

const MAX_TRANSCRIPT_CHARS = 5_000_000;
const contentSchema = z.string().min(1).max(MAX_TRANSCRIPT_CHARS);
const roleSchema = z.enum(SPEAKER_ROLES as [string, ...string[]]);

export interface AppDeps {
  fetch?: FetchLike;
}

export function createApp(db: Db, deps: AppDeps = {}) {
  const api = new Hono()
    .route('/providers', providerRoutes(db, deps.fetch))
    .get('/health', (c) => c.json({ ok: true }))
    .post('/imports/preview', zValidator('json', z.object({ content: contentSchema })), (c) =>
      c.json(previewImport(db, c.req.valid('json').content)),
    )
    .post(
      '/imports',
      zValidator(
        'json',
        z.object({
          content: contentSchema,
          roles: z.record(z.string(), roleSchema),
          replace: z.boolean().default(false),
        }),
      ),
      (c) => {
        const { content, roles, replace } = c.req.valid('json');
        return c.json(commitImport(db, content, roles as Parameters<typeof commitImport>[2], replace), 201);
      },
    )
    .get('/anchors', (c) => c.json(db.select().from(anchors).orderBy(asc(anchors.name)).all()))
    .get('/sessions', (c) => {
      const rows = db
        .select({
          id: sessions.id,
          externalId: sessions.externalId,
          anchorName: sessions.anchorName,
          title: sessions.title,
          startedAt: sessions.startedAt,
          endedAt: sessions.endedAt,
          messageCount: count(messages.id),
        })
        .from(sessions)
        .leftJoin(messages, eq(messages.sessionId, sessions.id))
        .groupBy(sessions.id)
        .orderBy(desc(sessions.createdAt))
        .all();
      return c.json(rows);
    })
    .get('/sessions/:id', (c) => {
      const id = c.req.param('id');
      const session = db.select().from(sessions).where(eq(sessions.id, id)).get();
      if (!session) return c.json({ error: '会话不存在' }, 404);
      const msgs = db.select().from(messages).where(eq(messages.sessionId, id)).orderBy(asc(messages.seq)).all();
      return c.json({ ...session, messages: msgs });
    })
    .delete('/sessions/:id', (c) => {
      const res = db.delete(sessions).where(eq(sessions.id, c.req.param('id'))).run();
      return res.changes ? c.body(null, 204) : c.json({ error: '会话不存在' }, 404);
    });

  const app = new Hono().route('/api', api);
  app.onError((err, c) => {
    if (err instanceof ImportError) return c.json({ error: err.message }, err.status);
    if (err instanceof TranscriptParseError) return c.json({ error: err.message }, 400);
    if (err instanceof ProviderNotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ProviderConflictError) return c.json({ error: err.message }, 409);
    if (err instanceof ProviderError) return c.json({ error: err.message, upstreamStatus: err.status ?? null }, 502);
    console.error(err);
    return c.json({ error: '服务器内部错误' }, 500);
  });
  return app;
}

export type ApiApp = ReturnType<typeof createApp>;
