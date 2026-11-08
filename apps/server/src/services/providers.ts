import { randomUUID } from 'node:crypto';
import { detectProvider, normalizeBaseUrl, resolveModels, type FetchLike, type ProviderConfig, type ProviderKind } from '@lce/core';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { providers } from '../db/schema.ts';

type ProviderRow = typeof providers.$inferSelect;

export class ProviderNotFoundError extends Error {
  constructor() {
    super('服务商不存在');
  }
}

export class ProviderConflictError extends Error {}

export interface ProviderInput {
  name: string;
  baseUrl: string;
  kind?: ProviderKind;
  apiKey?: string;
  defaultModel?: string | null;
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
  if (!kind) return detectProvider(baseUrl);
  const detected = detectProvider(baseUrl);
  return { kind, baseUrl: detected.kind === kind ? detected.baseUrl : normalizeBaseUrl(baseUrl) };
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
      defaultModel: input.defaultModel ?? null,
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
      defaultModel: input.defaultModel === undefined ? current.defaultModel : input.defaultModel,
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

export async function refreshModels(db: Db, id: string, fetchImpl?: FetchLike) {
  const row = getProvider(db, id);
  const { baseUrl, models } = await resolveModels(configOf(row), { fetch: fetchImpl });
  const defaultModel = row.defaultModel && models.some((m) => m.id === row.defaultModel) ? row.defaultModel : (models[0]?.id ?? null);
  const updated = db
    .update(providers)
    .set({ baseUrl, models, modelsFetchedAt: new Date(), defaultModel })
    .where(eq(providers.id, id))
    .returning()
    .get();
  return toPublic(updated);
}
