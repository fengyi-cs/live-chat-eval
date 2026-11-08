import { randomUUID } from 'node:crypto';
import { parseScript, scriptStats } from '@lce/core';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { scripts } from '../db/schema.ts';
import { BadRequestError, ConflictError, NotFoundError } from './errors.ts';

type ScriptRow = typeof scripts.$inferSelect;

export interface ScriptInput {
  name: string;
  content: string;
  defaultGapSec?: number;
}

const MAX_ISSUES_IN_ERROR = 3;

function withStats(row: ScriptRow) {
  const { events, issues } = parseScript(row.content, row.defaultGapSec);
  const stats = scriptStats(events);
  return { ...row, eventCount: stats.eventCount, durationMs: stats.durationMs, speakerCount: stats.speakers.length, issueCount: issues.length };
}

function assertParses(content: string, defaultGapSec?: number) {
  const { issues } = parseScript(content, defaultGapSec);
  if (issues.length === 0) return;
  const detail = issues
    .slice(0, MAX_ISSUES_IN_ERROR)
    .map((i) => `第 ${i.line} 行：${i.message}`)
    .join('；');
  throw new BadRequestError(`剧本有 ${issues.length} 处格式问题：${detail}`);
}

function assertNameFree(db: Db, name: string, selfId?: string) {
  const other = db.select({ id: scripts.id }).from(scripts).where(eq(scripts.name, name)).get();
  if (other && other.id !== selfId) throw new ConflictError(`剧本名称「${name}」已存在`);
}

export function getScript(db: Db, id: string): ScriptRow {
  const row = db.select().from(scripts).where(eq(scripts.id, id)).get();
  if (!row) throw new NotFoundError('剧本不存在');
  return row;
}

export function listScripts(db: Db) {
  return db.select().from(scripts).orderBy(asc(scripts.createdAt)).all().map(withStats);
}

export function createScript(db: Db, input: ScriptInput) {
  assertNameFree(db, input.name);
  assertParses(input.content, input.defaultGapSec);
  const row = db
    .insert(scripts)
    .values({ id: randomUUID(), name: input.name, content: input.content, defaultGapSec: input.defaultGapSec ?? 3 })
    .returning()
    .get();
  return withStats(row);
}

export function updateScript(db: Db, id: string, input: Partial<ScriptInput>) {
  const current = getScript(db, id);
  if (input.name !== undefined) assertNameFree(db, input.name, id);
  const content = input.content ?? current.content;
  const defaultGapSec = input.defaultGapSec ?? current.defaultGapSec;
  assertParses(content, defaultGapSec);
  const row = db
    .update(scripts)
    .set({ name: input.name ?? current.name, content, defaultGapSec })
    .where(eq(scripts.id, id))
    .returning()
    .get();
  return withStats(row);
}

export function deleteScript(db: Db, id: string) {
  const res = db.delete(scripts).where(eq(scripts.id, id)).run();
  if (!res.changes) throw new NotFoundError('剧本不存在');
}
