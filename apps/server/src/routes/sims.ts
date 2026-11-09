import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { sessions } from '../db/schema.ts';
import type { RoomEvent, SimulationManager } from '../services/sims.ts';
import { judgeSchema } from './evals.ts';

const MAX_SPEED = 100;

const paceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('speed'), speed: z.number().min(0.1).max(MAX_SPEED) }),
  z.object({ kind: z.literal('instant') }),
  z.object({ kind: z.literal('step') }),
]);

const startBase = { anchorName: z.string().trim().min(1).max(100), configId: z.string().min(1), liveEval: judgeSchema.optional(), resumeSessionId: z.string().optional() };

const startSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('live'), ...startBase }),
  z.object({ mode: z.literal('script'), ...startBase, scriptId: z.string().min(1), pace: paceSchema }),
]);

const danmakuSchema = z.object({ speaker: z.string().trim().min(1).max(100), text: z.string().trim().min(1).max(2000) });

export function simRoutes(db: Db, manager: SimulationManager) {
  return new Hono()
    .get('/', (c) => c.json(manager.list()))
    .post('/', zValidator('json', startSchema), (c) => c.json(manager.start(c.req.valid('json')), 201))
    .post('/:id/danmaku', zValidator('json', danmakuSchema), (c) => {
      const { speaker, text } = c.req.valid('json');
      return c.json(manager.inject(c.req.param('id'), speaker, text), 201);
    })
    .post('/:id/pace', zValidator('json', paceSchema), (c) => {
      manager.setPace(c.req.param('id'), c.req.valid('json'));
      return c.body(null, 204);
    })
    .post('/:id/step', (c) => {
      manager.step(c.req.param('id'));
      return c.body(null, 204);
    })
    .post('/:id/stop', (c) => {
      manager.stop(c.req.param('id'));
      return c.body(null, 204);
    })
    .get('/:id/events', (c) => {
      const id = c.req.param('id');
      if (!manager.has(id) && !db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id)).get()) {
        return c.json({ error: '会话不存在' }, 404);
      }
      return streamSSE(c, async (stream) => {
        const queue: RoomEvent[] = [];
        let wake: (() => void) | null = null;
        const unsubscribe = manager.subscribe(id, (ev) => {
          queue.push(ev);
          wake?.();
        });
        if (!unsubscribe) {
          await stream.writeSSE({ data: JSON.stringify({ type: 'gone' }) });
          return;
        }
        let closed = false;
        stream.onAbort(() => {
          closed = true;
          wake?.();
        });
        try {
          while (!closed) {
            if (queue.length === 0) await new Promise<void>((r) => (wake = r));
            wake = null;
            for (const ev of queue.splice(0)) {
              await stream.writeSSE({ data: JSON.stringify(ev) });
              if (ev.type === 'end') return;
            }
          }
        } finally {
          unsubscribe();
        }
      });
    });
}
