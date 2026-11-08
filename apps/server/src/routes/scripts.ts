import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { createScript, deleteScript, getScript, listScripts, updateScript } from '../services/scripts.ts';

const MAX_SCRIPT_CHARS = 1_000_000;

const scriptSchema = z.object({
  name: z.string().trim().min(1).max(100),
  content: z.string().max(MAX_SCRIPT_CHARS),
  defaultGapSec: z.number().min(0).max(3600).optional(),
});

export function scriptRoutes(db: Db) {
  return new Hono()
    .get('/', (c) => c.json(listScripts(db)))
    .post('/', zValidator('json', scriptSchema), (c) => c.json(createScript(db, c.req.valid('json')), 201))
    .get('/:id', (c) => c.json(getScript(db, c.req.param('id'))))
    .patch('/:id', zValidator('json', scriptSchema.partial()), (c) => c.json(updateScript(db, c.req.param('id'), c.req.valid('json'))))
    .delete('/:id', (c) => {
      deleteScript(db, c.req.param('id'));
      return c.body(null, 204);
    });
}
