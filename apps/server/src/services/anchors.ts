import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CONTEXT_TURNS,
  DEFAULT_PROACTIVE_PROMPT,
  DEFAULT_REPLY_RULES,
  DEFAULT_STRATEGY,
  type AnchorPromptConfig,
  type PriorityWeights,
  type ReplyStrategy,
} from '@lce/core';
import { asc, count, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { anchorConfigs, anchors, providers, sessions } from '../db/schema.ts';
import { ConflictError, NotFoundError } from './errors.ts';
import { getProvider, resolvePoolModel } from './providers.ts';

type AnchorRow = typeof anchors.$inferSelect;
type ConfigRow = typeof anchorConfigs.$inferSelect;

export interface StrategyPatch extends Partial<Omit<ReplyStrategy, 'weights'>> {
  weights?: Partial<PriorityWeights>;
}

export interface AnchorInput {
  name: string;
  code?: string | null;
  personaPrompt?: string;
}

export interface ConfigInput {
  name: string;
  providerId?: string | null;
  model?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  contextTurns?: number;
  replyRules?: string;
  proactivePrompt?: string;
  strategy?: StrategyPatch;
}

const keep = <T>(next: T | undefined, current: T): T => (next === undefined ? current : next);

export function mergeStrategy(base: ReplyStrategy, patch: StrategyPatch = {}): ReplyStrategy {
  return { ...base, ...patch, weights: { ...base.weights, ...patch.weights } };
}

function sessionCountOf(db: Db, name: string) {
  return db.select({ n: count() }).from(sessions).where(eq(sessions.anchorName, name)).get()?.n ?? 0;
}

export function getAnchor(db: Db, name: string): AnchorRow {
  const row = db.select().from(anchors).where(eq(anchors.name, name)).get();
  if (!row) throw new NotFoundError(`主播「${name}」不存在`);
  return row;
}

export function listAnchors(db: Db) {
  const sessionCounts = new Map(
    db.select({ name: sessions.anchorName, n: count() }).from(sessions).groupBy(sessions.anchorName).all().map((r) => [r.name, r.n]),
  );
  return db
    .select()
    .from(anchors)
    .orderBy(asc(anchors.name))
    .all()
    .map((a) => ({ ...a, sessionCount: sessionCounts.get(a.name) ?? 0 }));
}

export function getAnchorDetail(db: Db, name: string) {
  return { ...getAnchor(db, name), sessionCount: sessionCountOf(db, name) };
}

export function createAnchor(db: Db, input: AnchorInput) {
  if (db.select({ name: anchors.name }).from(anchors).where(eq(anchors.name, input.name)).get()) {
    throw new ConflictError(`主播「${input.name}」已存在`);
  }
  return db
    .insert(anchors)
    .values({ name: input.name, code: input.code ?? null, personaPrompt: input.personaPrompt ?? '', source: 'manual' })
    .returning()
    .get();
}

export function updateAnchor(db: Db, name: string, input: Omit<Partial<AnchorInput>, 'name'>) {
  const current = getAnchor(db, name);
  return db
    .update(anchors)
    .set({ code: keep(input.code, current.code), personaPrompt: keep(input.personaPrompt, current.personaPrompt) })
    .where(eq(anchors.name, name))
    .returning()
    .get();
}

export function deleteAnchor(db: Db, name: string) {
  getAnchor(db, name);
  const sessionCount = sessionCountOf(db, name);
  if (sessionCount > 0) throw new ConflictError(`主播「${name}」还有 ${sessionCount} 个会话，先删除这些会话再删除主播`);
  db.delete(anchors).where(eq(anchors.name, name)).run();
}

export function getConfig(db: Db, id: string): ConfigRow {
  const row = db.select().from(anchorConfigs).where(eq(anchorConfigs.id, id)).get();
  if (!row) throw new NotFoundError('主播配置不存在');
  return row;
}

function assertConfigNameFree(db: Db, name: string, selfId?: string) {
  const other = db.select({ id: anchorConfigs.id }).from(anchorConfigs).where(eq(anchorConfigs.name, name)).get();
  if (other && other.id !== selfId) throw new ConflictError(`配置名称「${name}」已存在`);
}

/** 选了服务商和模型时，模型必须在模型池里；只选服务商是未完成的中间状态 */
function checkModel(db: Db, providerId: string | null | undefined, model: string | null | undefined) {
  if (!providerId) return;
  if (model?.trim()) resolvePoolModel(db, providerId, model);
  else getProvider(db, providerId);
}

export function createConfig(db: Db, input: ConfigInput) {
  assertConfigNameFree(db, input.name);
  checkModel(db, input.providerId, input.model);
  return db
    .insert(anchorConfigs)
    .values({
      id: randomUUID(),
      name: input.name,
      providerId: input.providerId ?? null,
      model: input.model ?? null,
      temperature: input.temperature ?? null,
      maxTokens: input.maxTokens ?? null,
      contextTurns: input.contextTurns ?? DEFAULT_CONTEXT_TURNS,
      replyRules: input.replyRules ?? DEFAULT_REPLY_RULES,
      proactivePrompt: input.proactivePrompt ?? DEFAULT_PROACTIVE_PROMPT,
      strategy: mergeStrategy(DEFAULT_STRATEGY, input.strategy),
    })
    .returning()
    .get();
}

export function updateConfig(db: Db, id: string, input: Partial<ConfigInput>) {
  const current = getConfig(db, id);
  if (input.name !== undefined) assertConfigNameFree(db, input.name, id);
  if (input.providerId !== undefined || input.model !== undefined) checkModel(db, keep(input.providerId, current.providerId), keep(input.model, current.model));
  return db
    .update(anchorConfigs)
    .set({
      name: keep(input.name, current.name),
      providerId: keep(input.providerId, current.providerId),
      model: keep(input.model, current.model),
      temperature: keep(input.temperature, current.temperature),
      maxTokens: keep(input.maxTokens, current.maxTokens),
      contextTurns: keep(input.contextTurns, current.contextTurns),
      replyRules: keep(input.replyRules, current.replyRules),
      proactivePrompt: keep(input.proactivePrompt, current.proactivePrompt),
      strategy: mergeStrategy(current.strategy, input.strategy),
    })
    .where(eq(anchorConfigs.id, id))
    .returning()
    .get();
}

export function deleteConfig(db: Db, id: string) {
  const res = db.delete(anchorConfigs).where(eq(anchorConfigs.id, id)).run();
  if (!res.changes) throw new NotFoundError('主播配置不存在');
}

export function listAllConfigs(db: Db) {
  return db
    .select({ config: anchorConfigs, providerName: providers.name, enabledModels: providers.enabledModels })
    .from(anchorConfigs)
    .leftJoin(providers, eq(providers.id, anchorConfigs.providerId))
    .orderBy(asc(anchorConfigs.createdAt))
    .all()
    .map(({ config, providerName, enabledModels }) => ({
      ...config,
      providerName,
      /** 模型在模型池里，可以开播 */
      modelAvailable: Boolean(config.model && enabledModels?.includes(config.model)),
    }));
}

export function promptConfigOf(anchor: AnchorRow, cfg: ConfigRow): AnchorPromptConfig {
  return {
    anchorName: anchor.name,
    personaPrompt: anchor.personaPrompt,
    replyRules: cfg.replyRules,
    proactivePrompt: cfg.proactivePrompt,
    contextTurns: cfg.contextTurns,
  };
}
