import type { ActionEvent, SpeakerRole } from '@lce/core';
import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

export const anchors = sqliteTable('anchors', {
  name: text('name').primaryKey(),
  code: text('code'),
  personaPrompt: text('persona_prompt').notNull().default(''),
  createdAt: createdAt(),
});

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
