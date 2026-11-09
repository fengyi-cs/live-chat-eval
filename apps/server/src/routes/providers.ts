import { PROVIDER_KINDS, probeModels, resolveModels, type FetchLike, type ProviderKind } from '@lce/core';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import {
  configOf,
  createProvider,
  deleteProvider,
  getProvider,
  listProviders,
  pingProvider,
  refreshModels,
  resolveEndpoint,
  updateProvider,
} from '../services/providers.ts';
import { streamChatSSE } from './sse.ts';

const kindSchema = z.enum(PROVIDER_KINDS as [ProviderKind, ...ProviderKind[]]);
const baseUrlSchema = z.string().trim().min(1).max(2000);
const apiKeySchema = z.string().max(4000);

const modelIdSchema = z.string().trim().min(1).max(300);

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  baseUrl: baseUrlSchema,
  kind: kindSchema.optional(),
  apiKey: apiKeySchema.optional(),
  enabledModels: z.array(modelIdSchema).max(500).optional(),
});

const probeSchema = z.object({ baseUrl: baseUrlSchema, kind: kindSchema.optional(), apiKey: apiKeySchema.optional() });

const chatSchema = z.object({
  model: modelIdSchema,
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
      const opts = { fetch: fetchImpl, signal: c.req.raw.signal };
      if (!kind) return c.json(await probeModels(baseUrl, apiKey || undefined, opts));
      const endpoint = resolveEndpoint(baseUrl, kind);
      const result = await resolveModels({ ...endpoint, apiKey: apiKey || undefined }, opts);
      return c.json({ kind, ...result, attempts: [{ kind, baseUrl: result.baseUrl, count: result.models.length, error: null }] });
    })
    .post('/', zValidator('json', createSchema), (c) => c.json(createProvider(db, c.req.valid('json')), 201))
    .patch('/:id', zValidator('json', createSchema.partial()), (c) => c.json(updateProvider(db, c.req.param('id'), c.req.valid('json'))))
    .delete('/:id', (c) => {
      deleteProvider(db, c.req.param('id'));
      return c.body(null, 204);
    })
    .post('/:id/models', async (c) => c.json(await refreshModels(db, c.req.param('id'), fetchImpl, c.req.query('detect') === '1')))
    .post('/:id/ping', zValidator('json', z.object({ model: modelIdSchema })), async (c) => c.json(await pingProvider(db, c.req.param('id'), c.req.valid('json').model, fetchImpl, c.req.raw.signal)))
    .post('/:id/chat', zValidator('json', chatSchema), (c) => {
      const row = getProvider(db, c.req.param('id'));
      return streamChatSSE(c, configOf(row), c.req.valid('json'), fetchImpl);
    });
}
