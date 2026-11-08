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
import { and, asc, count, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { anchorConfigs, anchors, sessions } from '../db/schema.ts';
import { ConflictError, NotFoundError } from './errors.ts';
import { getProvider } from './providers.ts';

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
  const tally = (rows: { name: string; n: number }[]) => new Map(rows.map((r) => [r.name, r.n]));
  const sessionCounts = tally(db.select({ name: sessions.anchorName, n: count() }).from(sessions).groupBy(sessions.anchorName).all());
  const configCounts = tally(db.select({ name: anchorConfigs.anchorName, n: count() }).from(anchorConfigs).groupBy(anchorConfigs.anchorName).all());
  return db
    .select()
    .from(anchors)
    .orderBy(asc(anchors.name))
    .all()
    .map((a) => ({ ...a, sessionCount: sessionCounts.get(a.name) ?? 0, configCount: configCounts.get(a.name) ?? 0 }));
}

export function getAnchorDetail(db: Db, name: string) {
  const anchor = getAnchor(db, name);
  const configs = db.select().from(anchorConfigs).where(eq(anchorConfigs.anchorName, name)).orderBy(asc(anchorConfigs.createdAt)).all();
  return { ...anchor, sessionCount: sessionCountOf(db, name), configs };
}

export function createAnchor(db: Db, input: AnchorInput) {
  if (db.select({ name: anchors.name }).from(anchors).where(eq(anchors.name, input.name)).get()) {
    throw new ConflictError(`主播「${input.name}」已存在`);
  }
  return db
    .insert(anchors)
    .values({ name: input.name, code: input.code ?? null, personaPrompt: input.personaPrompt ?? '' })
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

function assertConfigNameFree(db: Db, anchorName: string, name: string, selfId?: string) {
  const other = db
    .select({ id: anchorConfigs.id })
    .from(anchorConfigs)
    .where(and(eq(anchorConfigs.anchorName, anchorName), eq(anchorConfigs.name, name)))
    .get();
  if (other && other.id !== selfId) throw new ConflictError(`配置名称「${name}」已存在`);
}

export function createConfig(db: Db, anchorName: string, input: ConfigInput) {
  getAnchor(db, anchorName);
  assertConfigNameFree(db, anchorName, input.name);
  if (input.providerId) getProvider(db, input.providerId);
  return db
    .insert(anchorConfigs)
    .values({
      id: randomUUID(),
      anchorName,
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
  if (input.name !== undefined) assertConfigNameFree(db, current.anchorName, input.name, id);
  if (input.providerId) getProvider(db, input.providerId);
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

export function promptConfigOf(anchor: AnchorRow, cfg: ConfigRow): AnchorPromptConfig {
  return {
    anchorName: anchor.name,
    personaPrompt: anchor.personaPrompt,
    replyRules: cfg.replyRules,
    proactivePrompt: cfg.proactivePrompt,
    contextTurns: cfg.contextTurns,
  };
}
