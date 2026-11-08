import { randomUUID } from 'node:crypto';
import {
  appliesTo,
  buildSessionJudgeMessages,
  buildTurnJudgeMessages,
  computeRules,
  createGenerate,
  JudgeFailedError,
  runJudge,
  summarize,
  type EvalItemResult,
  type EvalSession,
  type EvalSummary,
  type FetchLike,
  type Generate,
} from '@lce/core';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { evalItems, evals, messages, sessions, type EvalStatus } from '../db/schema.ts';
import { getAnchor } from './anchors.ts';
import { BadRequestError, ConflictError, NotFoundError } from './errors.ts';
import { configOf, getProvider } from './providers.ts';
import { getRubric } from './rubrics.ts';

export interface StartEval {
  sessionId: string;
  rubricId: string;
  providerId?: string;
  model?: string;
  temperature?: number | null;
  samples?: number;
  attempts?: number;
}

type ItemRow = typeof evalItems.$inferSelect;
type EvalRow = typeof evals.$inferSelect;

export type EvalEvent =
  | { type: 'hello'; eval: ReturnType<typeof getEvalDetail> }
  | { type: 'item'; item: ReturnType<typeof itemView>; summary: EvalSummary; calls: number }
  | { type: 'end'; status: EvalStatus; error: string | null };

interface Run {
  id: string;
  sessionId: string;
  ctrl: AbortController;
  listeners: Set<(ev: EvalEvent) => void>;
}

export const EVAL_INTERRUPTED = '服务重启，评估被中断';

const asResult = (it: ItemRow): EvalItemResult => ({ kind: it.kind, seq: it.seq, proactive: it.proactive, status: it.status, scores: it.scores });

function itemView(it: ItemRow, textBySeq: Map<number, string>) {
  return { ...it, text: it.seq === null ? null : (textBySeq.get(it.seq) ?? null) };
}

function loadSession(db: Db, sessionId: string): EvalSession {
  const s = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!s) throw new NotFoundError('会话不存在');
  if (s.status === 'running') throw new BadRequestError('这场直播还在进行，结束后再评估');
  const msgs = db.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.seq)).all();
  return {
    anchorName: s.anchorName,
    personaPrompt: s.snapshot?.personaPrompt ?? getAnchor(db, s.anchorName).personaPrompt,
    unanswered: s.unanswered,
    messages: msgs.map((m) => ({ seq: m.seq, role: m.role, speaker: m.speaker, text: m.text, time: m.time, repliesTo: m.repliesTo, latencyMs: m.latencyMs, proactive: m.proactive })),
  };
}

export function listEvals(db: Db, sessionId?: string) {
  return db
    .select({ e: evals, title: sessions.title, anchorName: sessions.anchorName })
    .from(evals)
    .innerJoin(sessions, eq(sessions.id, evals.sessionId))
    .where(sessionId ? eq(evals.sessionId, sessionId) : undefined)
    .orderBy(desc(evals.createdAt))
    .all()
    .map(({ e, title, anchorName }) => ({
      id: e.id,
      sessionId: e.sessionId,
      sessionTitle: title,
      anchorName,
      rubricName: e.rubricName,
      model: e.model,
      status: e.status,
      error: e.error,
      composite: e.summary.composite,
      createdAt: e.createdAt,
      finishedAt: e.finishedAt,
    }));
}

export function getEvalDetail(db: Db, id: string) {
  const row = db.select().from(evals).where(eq(evals.id, id)).get();
  if (!row) throw new NotFoundError('评估不存在');
  const s = db.select({ title: sessions.title, anchorName: sessions.anchorName }).from(sessions).where(eq(sessions.id, row.sessionId)).get();
  const texts = new Map(db.select({ seq: messages.seq, text: messages.text }).from(messages).where(eq(messages.sessionId, row.sessionId)).all().map((m) => [m.seq, m.text]));
  const items = db.select().from(evalItems).where(eq(evalItems.evalId, id)).orderBy(asc(evalItems.id)).all();
  return { ...row, sessionTitle: s?.title ?? null, anchorName: s?.anchorName ?? null, items: items.map((it) => itemView(it, texts)) };
}

export class EvalManager {
  private readonly runs = new Map<string, Run>();

  constructor(
    private readonly db: Db,
    private readonly fetchImpl?: FetchLike,
  ) {
    for (const row of db.select().from(evals).where(eq(evals.status, 'running')).all()) {
      db.update(evals)
        .set({ status: 'stopped', error: EVAL_INTERRUPTED, summary: this.summaryOf(row), finishedAt: new Date() })
        .where(eq(evals.id, row.id))
        .run();
    }
  }

  start(input: StartEval) {
    const session = loadSession(this.db, input.sessionId);
    if (this.db.select({ id: evals.id }).from(evals).where(and(eq(evals.sessionId, input.sessionId), eq(evals.status, 'running'))).get()) {
      throw new ConflictError('这场会话已经有评估在进行');
    }
    const rubricRow = getRubric(this.db, input.rubricId);
    const rubric = rubricRow.rubric;
    const rules = computeRules(session, rubric.rules);
    const turnDims = rubric.dimensions.filter((d) => d.enabled && d.scope === 'turn');
    const planned: Omit<ItemRow, 'id' | 'evalId' | 'calls' | 'scores' | 'error'>[] = session.messages
      .filter((m) => m.role === 'anchor')
      .map((m) => {
        const proactive = Boolean(m.proactive);
        return { kind: 'turn', seq: m.seq, proactive, status: turnDims.some((d) => appliesTo(d, { kind: 'turn', proactive })) ? 'pending' : 'skipped' };
      });
    if (rubric.dimensions.some((d) => d.enabled && d.scope === 'session')) planned.push({ kind: 'session', seq: null, proactive: false, status: 'pending' });
    const needsJudge = planned.some((p) => p.status === 'pending');

    let generate: Generate | null = null;
    let providerName: string | null = null;
    let model: string | null = null;
    if (needsJudge) {
      if (!input.providerId) throw new BadRequestError('这个模板需要 LLM 裁判，请选择裁判模型服务');
      const provider = getProvider(this.db, input.providerId);
      model = input.model || provider.defaultModel;
      if (!model) throw new BadRequestError('没有指定裁判模型，请填写模型或先拉取模型列表');
      providerName = provider.name;
      generate = createGenerate(configOf(provider), { model, temperature: input.temperature ?? undefined }, { fetch: this.fetchImpl });
    }

    const id = randomUUID();
    const summary = summarize(rubric, rules, planned.map((p) => ({ ...p, scores: null })));
    this.db.transaction((tx) => {
      tx.insert(evals)
        .values({
          id,
          sessionId: input.sessionId,
          rubricId: rubricRow.id,
          rubricName: rubricRow.name,
          rubric,
          providerName,
          model,
          temperature: input.temperature ?? null,
          samples: input.samples ?? 1,
          attempts: input.attempts ?? 3,
          status: needsJudge ? 'running' : 'done',
          rules,
          summary,
          finishedAt: needsJudge ? null : new Date(),
        })
        .run();
      if (planned.length) tx.insert(evalItems).values(planned.map((p) => ({ ...p, evalId: id }))).run();
    });

    if (generate) {
      const run: Run = { id, sessionId: input.sessionId, ctrl: new AbortController(), listeners: new Set() };
      this.runs.set(id, run);
      void this.loop(run, session, generate).finally(() => {
        this.runs.delete(id);
        run.listeners.clear();
      });
    }
    return getEvalDetail(this.db, id);
  }

  subscribe(id: string, listener: (ev: EvalEvent) => void): (() => void) | null {
    const run = this.runs.get(id);
    if (!run) return null;
    listener({ type: 'hello', eval: getEvalDetail(this.db, id) });
    run.listeners.add(listener);
    return () => run.listeners.delete(listener);
  }

  has(id: string) {
    return this.runs.has(id);
  }

  stop(id: string) {
    const run = this.runs.get(id);
    if (!run) throw new NotFoundError('这个评估不在进行中');
    run.ctrl.abort();
  }

  stopForSession(sessionId: string) {
    for (const run of this.runs.values()) if (run.sessionId === sessionId) run.ctrl.abort();
  }

  private summaryOf(row: EvalRow): EvalSummary {
    const items = this.db.select().from(evalItems).where(eq(evalItems.evalId, row.id)).all();
    return summarize(row.rubric, row.rules, items.map(asResult));
  }

  private async loop(run: Run, session: EvalSession, generate: Generate) {
    const row = this.db.select().from(evals).where(eq(evals.id, run.id)).get()!;
    const texts = new Map(session.messages.map((m) => [m.seq, m.text]));
    const pending = this.db.select().from(evalItems).where(and(eq(evalItems.evalId, run.id), eq(evalItems.status, 'pending'))).orderBy(asc(evalItems.id)).all();
    const signal = run.ctrl.signal;
    let status: EvalStatus = 'done';
    let error: string | null = null;
    let calls = 0;
    try {
      for (const item of pending) {
        if (signal.aborted) {
          status = 'stopped';
          break;
        }
        const dims = row.rubric.dimensions.filter((d) => appliesTo(d, item));
        const prompt = item.kind === 'turn' ? buildTurnJudgeMessages(session, item.seq!, dims) : buildSessionJudgeMessages(session, dims);
        let patch: Partial<ItemRow>;
        try {
          const res = await runJudge(generate, prompt, dims.map((d) => d.key), { attempts: row.attempts, samples: row.samples, signal });
          patch = { status: 'done', scores: res.scores, calls: res.calls, error: null };
        } catch (err) {
          const used = err instanceof JudgeFailedError ? err.calls : 0;
          calls += used;
          if (signal.aborted) {
            status = 'stopped';
            break;
          }
          patch = { status: 'error', error: (err as Error).message.slice(0, 500), calls: used };
        }
        if (patch.status === 'done') calls += patch.calls!;
        const saved = this.db.update(evalItems).set(patch).where(eq(evalItems.id, item.id)).returning().get();
        if (!saved) {
          status = 'stopped';
          break;
        }
        const summary = this.summaryOf(row);
        this.db.update(evals).set({ summary, calls }).where(eq(evals.id, run.id)).run();
        this.broadcast(run, { type: 'item', item: itemView(saved, texts), summary, calls });
      }
    } catch (err) {
      status = 'error';
      error = (err as Error).message;
      console.error(`eval ${run.id} failed`, err);
    }
    this.db.update(evals).set({ status, error, calls, summary: this.summaryOf(row), finishedAt: new Date() }).where(eq(evals.id, run.id)).run();
    this.broadcast(run, { type: 'end', status, error });
  }

  private broadcast(run: Run, ev: EvalEvent) {
    for (const l of run.listeners) l(ev);
  }
}
