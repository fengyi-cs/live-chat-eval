import { randomUUID } from 'node:crypto';
import { DIMENSION_KEY_RE, RULE_KEYS, type Rubric } from '@lce/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { rubrics } from '../db/schema.ts';
import { BadRequestError, ConflictError, NotFoundError } from './errors.ts';

const anchor = z.string().max(300);
const weight = z.number().min(0).max(100);
const base = { enabled: z.boolean(), weight };

export const rubricSchema = z
  .object({
    ruleWeight: weight,
    llmWeight: weight,
    rules: z.object({
      latency: z.object({ ...base, goodSec: z.number().min(0).max(600), badSec: z.number().min(0).max(600) }),
      missRate: z.object(base),
      length: z.object({ ...base, minChars: z.number().int().min(0).max(2000), maxChars: z.number().int().min(1).max(2000) }),
      repetition: z.object({ ...base, window: z.number().int().min(1).max(50) }),
      aiPhrases: z.object({ ...base, phrases: z.array(z.string().trim().min(1).max(40)).max(200), penaltyPerHit: z.number().min(0).max(100) }),
    }),
    dimensions: z
      .array(
        z.object({
          key: z.string().regex(DIMENSION_KEY_RE, '维度键只能用小写字母、数字和下划线，并以字母开头'),
          name: z.string().trim().min(1).max(40),
          description: z.string().max(1000),
          anchors: z.tuple([anchor, anchor, anchor, anchor, anchor]),
          weight,
          scope: z.enum(['turn', 'session']),
          enabled: z.boolean(),
          skipProactive: z.boolean(),
        }),
      )
      .max(30),
  })
  .superRefine((r, ctx) => {
    const keys = r.dimensions.map((d) => d.key);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) ctx.addIssue({ code: 'custom', message: `维度键「${dup}」重复了` });
    if (r.rules.latency.badSec <= r.rules.latency.goodSec) ctx.addIssue({ code: 'custom', message: '响应延迟：0 分的秒数要大于满分的秒数' });
    if (r.rules.length.maxChars < r.rules.length.minChars) ctx.addIssue({ code: 'custom', message: '回复长度：最多字数不能小于最少字数' });
    const enabled = r.dimensions.filter((d) => d.enabled).length + RULE_KEYS.filter((k) => r.rules[k].enabled).length;
    if (enabled === 0) ctx.addIssue({ code: 'custom', message: '至少启用一个维度或一条规则' });
    // S10: 启用的项必须有有效权重，否则合成分永远是 null
    const hasEffectiveRuleWeight = RULE_KEYS.some((k) => r.rules[k].enabled && r.rules[k].weight > 0);
    const hasEffectiveDimWeight = r.dimensions.some((d) => d.enabled && d.weight > 0);
    const ruleContributes = r.ruleWeight > 0 && hasEffectiveRuleWeight;
    const llmContributes = r.llmWeight > 0 && hasEffectiveDimWeight;
    if (enabled > 0 && !ruleContributes && !llmContributes) {
      ctx.addIssue({ code: 'custom', message: '启用的项没有有效权重，无法计算综合分。请确保规则分权重或 LLM 分权重大于 0，且对应已启用项也有权重。' });
    }
  });

export function parseRubric(input: unknown): Rubric {
  const r = rubricSchema.safeParse(input);
  if (!r.success) throw new BadRequestError(r.error.issues.slice(0, 3).map((i) => i.message).join('；'));
  return r.data as Rubric;
}

export function getRubric(db: Db, id: string) {
  const row = db.select().from(rubrics).where(eq(rubrics.id, id)).get();
  if (!row) throw new NotFoundError('评分模板不存在');
  return row;
}

export const listRubrics = (db: Db) => db.select().from(rubrics).orderBy(asc(rubrics.createdAt)).all();

function assertNameFree(db: Db, name: string, selfId?: string) {
  const other = db.select({ id: rubrics.id }).from(rubrics).where(eq(rubrics.name, name)).get();
  if (other && other.id !== selfId) throw new ConflictError(`模板名称「${name}」已存在`);
}

export function createRubric(db: Db, input: { name: string; rubric: unknown }) {
  assertNameFree(db, input.name);
  const rubric = parseRubric(input.rubric);
  return db.insert(rubrics).values({ id: randomUUID(), name: input.name, rubric }).returning().get();
}

export function updateRubric(db: Db, id: string, input: { name?: string; rubric?: unknown }) {
  const current = getRubric(db, id);
  if (input.name !== undefined) assertNameFree(db, input.name, id);
  const rubric = input.rubric === undefined ? current.rubric : parseRubric(input.rubric);
  return db
    .update(rubrics)
    .set({ name: input.name ?? current.name, rubric })
    .where(eq(rubrics.id, id))
    .returning()
    .get();
}

export function deleteRubric(db: Db, id: string) {
  if (!db.delete(rubrics).where(eq(rubrics.id, id)).run().changes) throw new NotFoundError('评分模板不存在');
}
