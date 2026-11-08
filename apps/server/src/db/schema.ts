import type { ActionEvent, ModelInfo, ProviderKind, ReplyStrategy, SpeakerRole } from '@lce/core';
import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  modelsFetchedAt: integer('models_fetched_at', { mode: 'timestamp_ms' }),
  defaultModel: text('default_model'),
  createdAt: createdAt(),
});

export const anchors = sqliteTable('anchors', {
  name: text('name').primaryKey(),
  code: text('code'),
  personaPrompt: text('persona_prompt').notNull().default(''),
  createdAt: createdAt(),
});

export const anchorConfigs = sqliteTable(
  'anchor_configs',
  {
    id: text('id').primaryKey(),
    anchorName: text('anchor_name')
      .notNull()
      .references(() => anchors.name, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    providerId: text('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    model: text('model'),
    temperature: real('temperature'),
    maxTokens: integer('max_tokens'),
    contextTurns: integer('context_turns').notNull(),
    replyRules: text('reply_rules').notNull(),
    proactivePrompt: text('proactive_prompt').notNull(),
    strategy: text('strategy', { mode: 'json' }).$type<ReplyStrategy>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('anchor_configs_anchor_name').on(t.anchorName, t.name)],
);

export const speakerRoles = sqliteTable('speaker_roles', {
  speaker: text('speaker').primaryKey(),
  role: text('role').$type<SpeakerRole>().notNull(),
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
  },
  (t) => [uniqueIndex('messages_session_seq').on(t.sessionId, t.seq)],
);
