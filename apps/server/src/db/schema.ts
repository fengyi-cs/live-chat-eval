import type {
  ActionEvent,
  DimensionScope,
  EvalMessage,
  EvalItemStatus,
  EvalSummary,
  JudgeScores,
  ModelInfo,
  Pace,
  ProviderKind,
  ReplyStrategy,
  Rubric,
  RuleResult,
  SimMode,
  SpeakerRole,
} from '@lce/core';
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  kind: text('kind').$type<ProviderKind>().notNull(),
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key'),
  models: text('models', { mode: 'json' }).$type<ModelInfo[]>().notNull().default(sql`'[]'`),
  /** 模型池：用户启用的模型 ID，可以包含列表里没有的手动模型 */
  enabledModels: text('enabled_models', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  modelsFetchedAt: integer('models_fetched_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
});

export type AnchorSource = 'import' | 'manual';

export const anchors = sqliteTable('anchors', {
  name: text('name').primaryKey(),
  code: text('code'),
  source: text('source').$type<AnchorSource>().notNull().default('manual'),
  personaPrompt: text('persona_prompt').notNull().default(''),
  createdAt: createdAt(),
});

/** 回复配置：与主播解耦，开播时与任意主播组合使用（表名沿用 anchor_configs） */
export const anchorConfigs = sqliteTable('anchor_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  providerId: text('provider_id').references(() => providers.id, { onDelete: 'set null' }),
  model: text('model'),
  temperature: real('temperature'),
  maxTokens: integer('max_tokens'),
  contextTurns: integer('context_turns').notNull(),
  replyRules: text('reply_rules').notNull(),
  proactivePrompt: text('proactive_prompt').notNull(),
  strategy: text('strategy', { mode: 'json' }).$type<ReplyStrategy>().notNull(),
  createdAt: createdAt(),
});

export const speakerRoles = sqliteTable('speaker_roles', {
  speaker: text('speaker').primaryKey(),
  role: text('role').$type<SpeakerRole>().notNull(),
});

export type SessionStatus = 'done' | 'running' | 'stopped' | 'error';

export interface SessionSnapshot {
  configId: string;
  configName: string;
  providerName: string;
  model: string;
  temperature: number | null;
  personaPrompt: string;
  replyRules: string;
  proactivePrompt: string;
  contextTurns: number;
  strategy: ReplyStrategy;
  mode: SimMode;
  pace: Pace | null;
  scriptName: string | null;
  /** 续聊来源场次 */
  resumedFrom?: string | null;
  /** 续聊前的历史记录（含更早的续聊链），seq 都小于本场消息；只作评估上下文，不参与打分 */
  history?: EvalMessage[];
}

export const scripts = sqliteTable('scripts', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  content: text('content').notNull(),
  defaultGapSec: real('default_gap_sec').notNull().default(3),
  createdAt: createdAt(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  source: text('source').$type<'import' | 'live' | 'script'>().notNull(),
  externalId: text('external_id').unique(),
  anchorName: text('anchor_name')
    .notNull()
    .references(() => anchors.name),
  title: text('title'),
  startedAt: text('started_at'),
  endedAt: text('ended_at'),
  unanswered: text('unanswered', { mode: 'json' }).$type<number[]>().notNull(),
  orphanActions: text('orphan_actions', { mode: 'json' }).$type<ActionEvent[]>().notNull(),
  status: text('status').$type<SessionStatus>().notNull().default('done'),
  error: text('error'),
  configId: text('config_id'),
  scriptId: text('script_id'),
  snapshot: text('snapshot', { mode: 'json' }).$type<SessionSnapshot>(),
  createdAt: createdAt(),
});

export const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    time: text('time').notNull(),
    speaker: text('speaker').notNull(),
    role: text('role').$type<SpeakerRole>().notNull(),
    text: text('text').notNull(),
    repliesTo: text('replies_to', { mode: 'json' }).$type<number[]>(),
    latencyMs: integer('latency_ms'),
    proactive: integer('proactive', { mode: 'boolean' }),
    actions: text('actions', { mode: 'json' }).$type<ActionEvent[]>(),
    genFirstTokenMs: integer('gen_first_token_ms'),
    genTotalMs: integer('gen_total_ms'),
  },
  (t) => [uniqueIndex('messages_session_seq').on(t.sessionId, t.seq)],
);

export const rubrics = sqliteTable('rubrics', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  rubric: text('rubric', { mode: 'json' }).$type<Rubric>().notNull(),
  createdAt: createdAt(),
});

export type EvalStatus = 'running' | 'done' | 'stopped' | 'error';

export const evals = sqliteTable(
  'evals',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    rubricId: text('rubric_id').references(() => rubrics.id, { onDelete: 'set null' }),
    rubricName: text('rubric_name').notNull(),
    rubric: text('rubric', { mode: 'json' }).$type<Rubric>().notNull(),
    providerName: text('provider_name'),
    model: text('model'),
    temperature: real('temperature'),
    samples: integer('samples').notNull(),
    attempts: integer('attempts').notNull(),
    status: text('status').$type<EvalStatus>().notNull(),
    error: text('error'),
    rules: text('rules', { mode: 'json' }).$type<RuleResult>().notNull(),
    summary: text('summary', { mode: 'json' }).$type<EvalSummary>().notNull(),
    calls: integer('calls').notNull().default(0),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [index('evals_session').on(t.sessionId)],
);

export const evalItems = sqliteTable(
  'eval_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    evalId: text('eval_id')
      .notNull()
      .references(() => evals.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<DimensionScope>().notNull(),
    seq: integer('seq'),
    proactive: integer('proactive', { mode: 'boolean' }).notNull(),
    status: text('status').$type<EvalItemStatus>().notNull(),
    scores: text('scores', { mode: 'json' }).$type<JudgeScores>(),
    error: text('error'),
    calls: integer('calls').notNull().default(0),
  },
  (t) => [index('eval_items_eval').on(t.evalId)],
);
