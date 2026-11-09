import { randomUUID } from 'node:crypto';
import { endpointFor, detectProvider, pingChat, probeModels, resolveModels, type FetchLike, type ProbeAttempt, type ProviderConfig, type ProviderKind } from '@lce/core';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { providers } from '../db/schema.ts';
import { BadRequestError, ConflictError, NotFoundError } from './errors.ts';

type ProviderRow = typeof providers.$inferSelect;

export class ProviderNotFoundError extends NotFoundError {
  constructor() {
    super('服务商不存在');
  }
}

export class ProviderConflictError extends ConflictError {}

export interface ProviderInput {
  name: string;
  baseUrl: string;
  kind?: ProviderKind;
  apiKey?: string;
  enabledModels?: string[];
}

const KEY_TAIL = 4;

export function maskKey(key: string | null): string | null {
  if (!key) return null;
  return key.length <= KEY_TAIL * 2 ? '****' : `****${key.slice(-KEY_TAIL)}`;
}

export function toPublic({ apiKey, ...row }: ProviderRow) {
  return { ...row, apiKeyMasked: maskKey(apiKey) };
}

export function resolveEndpoint(baseUrl: string, kind?: ProviderKind) {
  return kind ? endpointFor(baseUrl, kind) : detectProvider(baseUrl);
}

export function configOf(row: Pick<ProviderRow, 'kind' | 'baseUrl' | 'apiKey'>): ProviderConfig {
  return { kind: row.kind, baseUrl: row.baseUrl, apiKey: row.apiKey ?? undefined };
}

export function getProvider(db: Db, id: string): ProviderRow {
  const row = db.select().from(providers).where(eq(providers.id, id)).get();
  if (!row) throw new ProviderNotFoundError();
  return row;
}

export function listProviders(db: Db) {
  return db.select().from(providers).orderBy(asc(providers.createdAt)).all().map(toPublic);
}

function assertNameFree(db: Db, name: string, selfId?: string) {
  const other = db.select({ id: providers.id }).from(providers).where(eq(providers.name, name)).get();
  if (other && other.id !== selfId) throw new ProviderConflictError(`服务商名称「${name}」已存在`);
}

export function createProvider(db: Db, input: ProviderInput) {
  assertNameFree(db, input.name);
  const endpoint = resolveEndpoint(input.baseUrl, input.kind);
  const row = db
    .insert(providers)
    .values({
      id: randomUUID(),
      name: input.name,
      kind: endpoint.kind,
      baseUrl: endpoint.baseUrl,
      apiKey: input.apiKey || null,
      enabledModels: dedupe(input.enabledModels ?? []),
    })
    .returning()
    .get();
  return toPublic(row);
}

export function updateProvider(db: Db, id: string, input: Partial<ProviderInput>) {
  const current = getProvider(db, id);
  if (input.name !== undefined) assertNameFree(db, input.name, id);
  const endpointChanged = input.baseUrl !== undefined || input.kind !== undefined;
  const endpoint = endpointChanged ? resolveEndpoint(input.baseUrl ?? current.baseUrl, input.kind ?? current.kind) : current;
  const row = db
    .update(providers)
    .set({
      name: input.name ?? current.name,
      kind: endpoint.kind,
      baseUrl: endpoint.baseUrl,
      apiKey: input.apiKey === undefined ? current.apiKey : input.apiKey || null,
      enabledModels: input.enabledModels === undefined ? current.enabledModels : dedupe(input.enabledModels),
      ...(endpointChanged && endpoint.baseUrl !== current.baseUrl ? { models: [], modelsFetchedAt: null } : {}),
    })
    .where(eq(providers.id, id))
    .returning()
    .get();
  return toPublic(row);
}

export function deleteProvider(db: Db, id: string) {
  const res = db.delete(providers).where(eq(providers.id, id)).run();
  if (!res.changes) throw new ProviderNotFoundError();
}

/**
 * 刷新模型列表。detect 为 true 时依次尝试几种接口格式，并把接口类型改成拉到模型的那一种。
 * 模型池是用户的选择，刷新不改动它。
 */
export async function refreshModels(db: Db, id: string, fetchImpl?: FetchLike, detect = false) {
  const row = getProvider(db, id);
  let result: { kind: ProviderKind; baseUrl: string; models: { id: string; name?: string }[]; attempts: ProbeAttempt[] };
  if (detect) {
    result = await probeModels(row.baseUrl, row.apiKey ?? undefined, { fetch: fetchImpl });
  } else {
    const { baseUrl, models } = await resolveModels(configOf(row), { fetch: fetchImpl });
    result = { kind: row.kind, baseUrl, models, attempts: [{ kind: row.kind, baseUrl, count: models.length, error: null }] };
  }
  const updated = db
    .update(providers)
    .set({ kind: result.kind, baseUrl: result.baseUrl, models: result.models, modelsFetchedAt: new Date() })
    .where(eq(providers.id, id))
    .returning()
    .get();
  return { ...toPublic(updated), attempts: result.attempts };
}

function dedupe(models: readonly string[]) {
  return [...new Set(models.map((m) => m.trim()).filter(Boolean))];
}

/** 连通性测试；另一种 OpenAI 接口格式才通时，把接口类型改成能用的那种，后续开播和评测直接可用 */
export async function pingProvider(db: Db, id: string, model: string, fetchImpl?: FetchLike, signal?: AbortSignal) {
  const row = getProvider(db, id);
  const result = await pingChat(configOf(row), model, { fetch: fetchImpl, signal });
  const switched = result.kind !== row.kind;
  if (switched) db.update(providers).set({ kind: result.kind }).where(eq(providers.id, id)).run();
  return { ...result, model, previousKind: switched ? row.kind : null };
}

/** 取模型池里的一个模型；不在池里（被停用或从没启用）时报错 */
export function resolvePoolModel(db: Db, providerId: string | null | undefined, model: string | null | undefined, what = '模型') {
  if (!providerId || !model?.trim()) throw new BadRequestError(`还没有选择${what}`);
  const provider = getProvider(db, providerId);
  if (!provider.enabledModels.includes(model.trim())) {
    throw new BadRequestError(`${what}「${provider.name} / ${model}」不在模型池里，请到「设置 · 模型服务」启用它，或重新选择`);
  }
  return { provider, model: model.trim() };
}
