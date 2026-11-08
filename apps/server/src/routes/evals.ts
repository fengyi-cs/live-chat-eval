import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { evals } from '../db/schema.ts';
import { getEvalDetail, listEvals, type EvalEvent, type EvalManager } from '../services/evals.ts';
import { NotFoundError } from '../services/errors.ts';
import { createRubric, deleteRubric, getRubric, listRubrics, updateRubric } from '../services/rubrics.ts';

const nameSchema = z.string().trim().min(1).max(40);

export function rubricRoutes(db: Db) {
  return new Hono()
    .get('/', (c) => c.json(listRubrics(db)))
    .post('/', zValidator('json', z.object({ name: nameSchema, rubric: z.unknown() })), (c) => c.json(createRubric(db, c.req.valid('json')), 201))
    .get('/:id', (c) => c.json(getRubric(db, c.req.param('id'))))
    .patch('/:id', zValidator('json', z.object({ name: nameSchema.optional(), rubric: z.unknown().optional() })), (c) =>
      c.json(updateRubric(db, c.req.param('id'), c.req.valid('json'))),
    )
    .delete('/:id', (c) => {
      deleteRubric(db, c.req.param('id'));
      return c.body(null, 204);
    });
}

const startSchema = z.object({
  sessionId: z.string().min(1),
  rubricId: z.string().min(1),
  providerId: z.string().min(1).optional(),
  model: z.string().trim().max(300).optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  samples: z.number().int().min(1).max(3).optional(),
  attempts: z.number().int().min(1).max(5).optional(),
});

export function evalRoutes(db: Db, manager: EvalManager) {
  return new Hono()
    .get('/', (c) => c.json(listEvals(db, c.req.query('sessionId') || undefined)))
    .post('/', zValidator('json', startSchema), (c) => c.json(manager.start(c.req.valid('json')), 201))
    .get('/:id', (c) => c.json(getEvalDetail(db, c.req.param('id'))))
    .post('/:id/stop', (c) => {
      manager.stop(c.req.param('id'));
      return c.body(null, 204);
    })
    .delete('/:id', (c) => {
      const id = c.req.param('id');
      if (manager.has(id)) manager.stop(id);
      if (!db.delete(evals).where(eq(evals.id, id)).run().changes) throw new NotFoundError('评估不存在');
      return c.body(null, 204);
    })
    .get('/:id/events', (c) => {
      const id = c.req.param('id');
      if (!manager.has(id) && !db.select({ id: evals.id }).from(evals).where(eq(evals.id, id)).get()) return c.json({ error: '评估不存在' }, 404);
      return streamSSE(c, async (stream) => {
        const queue: EvalEvent[] = [];
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
