import { chatStream, PROVIDER_KINDS, resolveModels, type FetchLike, type ProviderKind } from '@lce/core';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import {
  configOf,
  createProvider,
  deleteProvider,
  getProvider,
  listProviders,
  refreshModels,
  resolveEndpoint,
  updateProvider,
} from '../services/providers.ts';

const kindSchema = z.enum(PROVIDER_KINDS as [ProviderKind, ...ProviderKind[]]);
const baseUrlSchema = z.string().trim().min(1).max(2000);
const apiKeySchema = z.string().max(4000);

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  baseUrl: baseUrlSchema,
  kind: kindSchema.optional(),
  apiKey: apiKeySchema.optional(),
  defaultModel: z.string().max(300).nullable().optional(),
});

const probeSchema = z.object({ baseUrl: baseUrlSchema, kind: kindSchema.optional(), apiKey: apiKeySchema.optional() });

const chatSchema = z.object({
  model: z.string().min(1).max(300).optional(),
  messages: z
    .array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(200_000) }))
    .min(1)
    .max(500),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(64_000).optional(),
});

export function providerRoutes(db: Db, fetchImpl?: FetchLike) {
  return new Hono()
    .get('/', (c) => c.json(listProviders(db)))
    .post('/detect', zValidator('json', z.object({ baseUrl: baseUrlSchema })), (c) => c.json(resolveEndpoint(c.req.valid('json').baseUrl)))
    .post('/probe', zValidator('json', probeSchema), async (c) => {
      const { baseUrl, kind, apiKey } = c.req.valid('json');
      const endpoint = resolveEndpoint(baseUrl, kind);
      const result = await resolveModels({ ...endpoint, apiKey: apiKey || undefined }, { fetch: fetchImpl, signal: c.req.raw.signal });
      return c.json({ kind: endpoint.kind, ...result });
    })
    .post('/', zValidator('json', createSchema), (c) => c.json(createProvider(db, c.req.valid('json')), 201))
    .patch('/:id', zValidator('json', createSchema.partial()), (c) => c.json(updateProvider(db, c.req.param('id'), c.req.valid('json'))))
    .delete('/:id', (c) => {
      deleteProvider(db, c.req.param('id'));
      return c.body(null, 204);
    })
    .post('/:id/models', async (c) => c.json(await refreshModels(db, c.req.param('id'), fetchImpl)))
    .post('/:id/chat', zValidator('json', chatSchema), (c) => {
      const row = getProvider(db, c.req.param('id'));
      const { model = row.defaultModel, ...req } = c.req.valid('json');
      if (!model) return c.json({ error: '没有指定模型，请先拉取模型列表或手动填写模型名' }, 400);
      const signal = c.req.raw.signal;
      return streamSSE(c, async (stream) => {
        const started = performance.now();
        let firstTokenMs: number | null = null;
        try {
          for await (const chunk of chatStream(configOf(row), { model, ...req }, { fetch: fetchImpl, signal })) {
            if (chunk.type === 'delta') {
              firstTokenMs ??= Math.round(performance.now() - started);
              await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: chunk.text }) });
            } else {
              const totalMs = Math.round(performance.now() - started);
              await stream.writeSSE({ event: 'done', data: JSON.stringify({ model, usage: chunk.usage ?? null, firstTokenMs, totalMs }) });
            }
          }
        } catch (err) {
          if (signal.aborted) return;
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: (err as Error).message }) });
        }
      });
    });
}
