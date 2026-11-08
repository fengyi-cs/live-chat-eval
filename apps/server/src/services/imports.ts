import { randomUUID } from 'node:crypto';
import { anchorsOf, pairTurns, parseMarkdownTranscript, suggestRoles, type RoleMap } from '@lce/core';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { anchors, messages, sessions, speakerRoles } from '../db/schema.ts';

export class ImportError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409,
  ) {
    super(message);
  }
}

function loadHints(db: Db) {
  const knownAnchors = db.select({ name: anchors.name }).from(anchors).all().map((a) => a.name);
  const rememberedRoles: RoleMap = Object.fromEntries(
    db.select().from(speakerRoles).all().map((r) => [r.speaker, r.role]),
  );
  return { knownAnchors, rememberedRoles };
}

function findByExternalId(db: Db, externalId: string | undefined) {
  if (!externalId) return undefined;
  return db.select({ id: sessions.id }).from(sessions).where(eq(sessions.externalId, externalId)).get();
}

export function previewImport(db: Db, content: string) {
  const parsed = parseMarkdownTranscript(content);
  const hints = loadHints(db);
  const roles = suggestRoles(parsed, hints);
  const anchor = anchorsOf(roles)[0];
  return {
    title: parsed.title,
    meta: parsed.meta,
    messageCount: parsed.messages.length,
    speakers: parsed.speakers.map((s) => ({ ...s, suggestedRole: roles[s.name]! })),
    knownAnchor: anchor !== undefined && hints.knownAnchors.includes(anchor) ? anchor : null,
    duplicateSessionId: findByExternalId(db, parsed.meta.externalId)?.id ?? null,
  };
}

export function commitImport(db: Db, content: string, roles: RoleMap, replace: boolean) {
  const parsed = parseMarkdownTranscript(content);
  const missing = parsed.speakers.filter((s) => !(s.name in roles)).map((s) => s.name);
  if (missing.length) throw new ImportError(`缺少发言人角色：${missing.join('、')}`, 400);
  const anchorNames = anchorsOf(roles).filter((n) => parsed.speakers.some((s) => s.name === n));
  if (anchorNames.length !== 1) throw new ImportError('必须且只能指定一个主播', 400);
  const anchorName = anchorNames[0]!;

  const existing = findByExternalId(db, parsed.meta.externalId);
  if (existing && !replace) throw new ImportError(`场次 ${parsed.meta.externalId} 已导入`, 409);

  const { turns, unanswered, orphanActions } = pairTurns(parsed.messages, roles);
  const turnBySeq = new Map(turns.map((t) => [t.seq, t]));
  const sessionId = randomUUID();

  db.transaction((tx) => {
    if (existing) tx.delete(sessions).where(eq(sessions.id, existing.id)).run();
    const code = anchorName === parsed.meta.anchorName ? (parsed.meta.anchorCode ?? null) : null;
    tx.insert(anchors).values({ name: anchorName, code }).onConflictDoNothing().run();
    for (const [speaker, role] of Object.entries(roles)) {
      if (role === 'anchor') continue;
      tx.insert(speakerRoles).values({ speaker, role }).onConflictDoUpdate({ target: speakerRoles.speaker, set: { role } }).run();
    }
    tx.insert(sessions)
      .values({
        id: sessionId,
        source: 'import',
        externalId: parsed.meta.externalId ?? null,
        anchorName,
        title: parsed.title ?? null,
        startedAt: parsed.meta.startedAt ?? parsed.messages[0]?.time ?? null,
        endedAt: parsed.meta.endedAt ?? parsed.messages.at(-1)?.time ?? null,
        unanswered,
        orphanActions,
      })
      .run();
    tx.insert(messages)
      .values(
        parsed.messages.map((m) => {
          const turn = turnBySeq.get(m.seq);
          return {
            sessionId,
            seq: m.seq,
            time: m.time,
            speaker: m.speaker,
            role: roles[m.speaker]!,
            text: m.text,
            repliesTo: turn?.repliesTo ?? null,
            latencyMs: turn?.latencyMs ?? null,
            proactive: turn?.proactive ?? null,
            actions: turn?.actions ?? null,
          };
        }),
      )
      .run();
  });

  return { sessionId, anchorName, turns: turns.length, unanswered: unanswered.length };
}
