import { buildAnchorMessages, STRATEGY_KINDS, type FetchLike, type StrategyKind } from '@lce/core';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import {
  createAnchor,
  createConfig,
  deleteAnchor,
  deleteConfig,
  getAnchor,
  getAnchorDetail,
  getConfig,
  listAnchors,
  promptConfigOf,
  updateAnchor,
  updateConfig,
} from '../services/anchors.ts';
import { configOf, getProvider } from '../services/providers.ts';
import { streamChatSSE } from './sse.ts';

const MAX_PERSONA_CHARS = 200_000;

const nameSchema = z.string().trim().min(1).max(100);
const codeSchema = z.string().trim().max(50).nullable();
const personaSchema = z.string().max(MAX_PERSONA_CHARS);
const weight = z.number().min(0).max(100);

const strategySchema = z
  .object({
    kind: z.enum(STRATEGY_KINDS as [StrategyKind, ...StrategyKind[]]),
    mergeWindowSec: z.number().min(0).max(600),
    maxBatch: z.number().int().min(1).max(50),
    minGapSec: z.number().min(0).max(600),
    idleProactiveSec: z.number().min(0).max(3600),
    weights: z.object({ question: weight, mention: weight, gift: weight, newViewer: weight }).partial(),
    llmSelect: z.boolean(),
  })
  .partial();

const configSchema = z.object({
  name: nameSchema,
  providerId: z.string().min(1).nullable().optional(),
  model: z.string().trim().max(300).nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTokens: z.number().int().min(1).max(64_000).nullable().optional(),
  contextTurns: z.number().int().min(0).max(200).optional(),
  replyRules: z.string().max(50_000).optional(),
  proactivePrompt: z.string().max(10_000).optional(),
  strategy: strategySchema.optional(),
});

const turnInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('danmaku'),
    danmaku: z
      .array(z.object({ speaker: z.string().trim().min(1).max(100), text: z.string().trim().min(1).max(2000) }))
      .min(1)
      .max(50),
  }),
  z.object({ kind: z.literal('proactive') }),
]);

const trialSchema = z.object({
  input: turnInputSchema,
  history: z
    .array(z.object({ input: turnInputSchema, reply: z.string().max(20_000) }))
    .max(200)
    .default([]),
});

export function anchorRoutes(db: Db) {
  return new Hono()
    .get('/', (c) => c.json(listAnchors(db)))
    .post('/', zValidator('json', z.object({ name: nameSchema, code: codeSchema.optional(), personaPrompt: personaSchema.optional() })), (c) =>
      c.json(createAnchor(db, c.req.valid('json')), 201),
    )
    .get('/:name', (c) => c.json(getAnchorDetail(db, c.req.param('name'))))
    .patch('/:name', zValidator('json', z.object({ code: codeSchema.optional(), personaPrompt: personaSchema.optional() })), (c) =>
      c.json(updateAnchor(db, c.req.param('name'), c.req.valid('json'))),
    )
    .delete('/:name', (c) => {
      deleteAnchor(db, c.req.param('name'));
      return c.body(null, 204);
    })
    .post('/:name/configs', zValidator('json', configSchema), (c) => c.json(createConfig(db, c.req.param('name'), c.req.valid('json')), 201));
}

function trialRequest(db: Db, id: string, body: z.infer<typeof trialSchema>) {
  const cfg = getConfig(db, id);
  const messages = buildAnchorMessages(promptConfigOf(getAnchor(db, cfg.anchorName), cfg), body.history, body.input);
  return { cfg, messages };
}

export function anchorConfigRoutes(db: Db, fetchImpl?: FetchLike) {
  return new Hono()
    .patch('/:id', zValidator('json', configSchema.partial()), (c) => c.json(updateConfig(db, c.req.param('id'), c.req.valid('json'))))
    .delete('/:id', (c) => {
      deleteConfig(db, c.req.param('id'));
      return c.body(null, 204);
    })
    .post('/:id/prompt', zValidator('json', trialSchema), (c) => c.json(trialRequest(db, c.req.param('id'), c.req.valid('json')).messages))
    .post('/:id/chat', zValidator('json', trialSchema), (c) => {
      const { cfg, messages } = trialRequest(db, c.req.param('id'), c.req.valid('json'));
      if (!cfg.providerId) return c.json({ error: '这个配置还没有绑定模型服务' }, 400);
      const provider = getProvider(db, cfg.providerId);
      const model = cfg.model || provider.defaultModel;
      if (!model) return c.json({ error: '没有指定模型，请在配置里填写模型或先拉取模型列表' }, 400);
      return streamChatSSE(
        c,
        configOf(provider),
        { model, messages, temperature: cfg.temperature ?? undefined, maxTokens: cfg.maxTokens ?? undefined },
        fetchImpl,
      );
    });
}
