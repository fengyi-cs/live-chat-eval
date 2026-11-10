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
  type Rubric,
  type RuleResult,
} from '@lce/core';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { evalItems, evals, messages, sessions, type EvalStatus } from '../db/schema.ts';
import { getAnchor } from './anchors.ts';
import { BadRequestError, ConflictError, NotFoundError } from './errors.ts';
import { configOf, resolvePoolModel } from './providers.ts';
import { getRubric } from './rubrics.ts';

export interface JudgeInput {
  rubricId: string;
  providerId?: string;
  model?: string;
  temperature?: number | null;
  samples?: number;
  attempts?: number;
}

export interface StartEval extends JudgeInput {
  sessionId: string;
}

type ItemRow = typeof evalItems.$inferSelect;
type PlannedItem = Pick<ItemRow, 'kind' | 'seq' | 'proactive' | 'status'>;

export type EvalEvent =
  | { type: 'hello'; eval: ReturnType<typeof getEvalDetail> }
  | { type: 'item'; item: ReturnType<typeof itemView>; summary: EvalSummary; rules: RuleResult; calls: number }
  | { type: 'end'; status: EvalStatus; error: string | null };

interface Judge {
  rubricRow: ReturnType<typeof getRubric>;
  generate: Generate | null;
  providerName: string | null;
  model: string | null;
  temperature: number | null;
  samples: number;
  attempts: number;
}

export type PreparedLiveEval = Judge;

interface Run {
  id: string;
  sessionId: string;
  rubric: Rubric;
  judge: Judge;
  ctrl: AbortController;
  listeners: Set<(ev: EvalEvent) => void>;
  queue: ItemRow[];
  /** 不会再有新条目：整场评估一开始就是 true，实时评估在直播结束后变成 true */
  closed: boolean;
  wake: (() => void) | null;
  session: EvalSession;
  rules: RuleResult;
  calls: number;
}

export const EVAL_INTERRUPTED = '服务重启，评估被中断';

const asResult = (it: ItemRow): EvalItemResult => ({ kind: it.kind, seq: it.seq, proactive: it.proactive, status: it.status, scores: it.scores });
const hasSessionDims = (rubric: Rubric) => rubric.dimensions.some((d) => d.enabled && d.scope === 'session');

function itemView(it: ItemRow, textBySeq: Map<number, string>) {
  return { ...it, text: it.seq === null ? null : (textBySeq.get(it.seq) ?? null) };
}

function planTurn(rubric: Rubric, seq: number, proactive: boolean, canJudge: boolean): PlannedItem {
  const judged = canJudge && rubric.dimensions.some((d) => appliesTo(d, { kind: 'turn', proactive }));
  return { kind: 'turn', seq, proactive, status: judged ? 'pending' : 'skipped' };
}

function loadSession(db: Db, sessionId: string, allowRunning = false): EvalSession {
  const s = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!s) throw new NotFoundError('会话不存在');
  if (s.status === 'running' && !allowRunning) throw new BadRequestError('这场直播还在进行，结束后再评估，或在开播时打开实时评估');
  const msgs = db.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.seq)).all();
  return {
    anchorName: s.anchorName,
    personaPrompt: s.snapshot?.personaPrompt ?? getAnchor(db, s.anchorName).personaPrompt,
    unanswered: s.unanswered,
    messages: msgs.map((m) => ({ seq: m.seq, role: m.role, speaker: m.speaker, text: m.text, time: m.time, repliesTo: m.repliesTo, latencyMs: m.latencyMs, proactive: m.proactive })),
    history: s.snapshot?.history ?? [],
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
        .set({ status: 'stopped', error: EVAL_INTERRUPTED, summary: this.summaryOf(row.id, row.rubric, row.rules), finishedAt: new Date() })
        .where(eq(evals.id, row.id))
        .run();
    }
  }

  start(input: StartEval) {
    const session = loadSession(this.db, input.sessionId);
    this.assertIdle(input.sessionId);
    const rubricRow = getRubric(this.db, input.rubricId);
    const rubric = rubricRow.rubric;
    const planned = session.messages.filter((m) => m.role === 'anchor').map((m) => planTurn(rubric, m.seq, Boolean(m.proactive), true));
    if (hasSessionDims(rubric)) planned.push({ kind: 'session', seq: null, proactive: false, status: 'pending' });
    const judge = this.judgeOf(input, planned.some((p) => p.status === 'pending'));
    const rules = computeRules(session, rubric.rules);
    const id = this.insert(input.sessionId, judge, rules, planned);
    if (judge.generate) {
      const queue = this.db.select().from(evalItems).where(and(eq(evalItems.evalId, id), eq(evalItems.status, 'pending'))).orderBy(asc(evalItems.id)).all();
      this.launch({ id, sessionId: input.sessionId, judge, session, rules, queue, closed: true });
    }
    return getEvalDetail(this.db, id);
  }

  /** 开播前校验实时评估的模板和裁判模型，失败时直接拒绝开播 */
  prepareLive(input: JudgeInput): PreparedLiveEval {
    const rubric = getRubric(this.db, input.rubricId).rubric;
    return this.judgeOf(input, rubric.dimensions.some((d) => d.enabled));
  }

  /** 直播开始后创建实时评估：每条主播回复完成后由 addTurn 加入打分队列 */
  startLive(sessionId: string, judge: PreparedLiveEval) {
    this.assertIdle(sessionId);
    const session = loadSession(this.db, sessionId, true);
    const rules = computeRules(session, judge.rubricRow.rubric.rules);
    const id = this.insert(sessionId, judge, rules, [], 'running');
    this.launch({ id, sessionId, judge, session, rules, queue: [], closed: false });
    return id;
  }

  addTurn(evalId: string, seq: number, proactive: boolean) {
    const run = this.runs.get(evalId);
    if (!run || run.closed || run.ctrl.signal.aborted) return;
    run.session = loadSession(this.db, run.sessionId, true);
    run.rules = computeRules(run.session, run.rubric.rules);
    const planned = planTurn(run.rubric, seq, proactive, Boolean(run.judge.generate));
    const item = this.db.insert(evalItems).values({ ...planned, evalId }).returning().get();
    this.publish(run, item);
    if (item.status === 'pending') {
      run.queue.push(item);
      run.wake?.();
    }
  }

  /** 直播结束：用最终记录重算规则分，加入整场维度，打完剩下的条目后结束 */
  finishLive(evalId: string) {
    const run = this.runs.get(evalId);
    if (!run || run.closed || run.ctrl.signal.aborted) return;
    run.session = loadSession(this.db, run.sessionId, true);
    run.rules = computeRules(run.session, run.rubric.rules);
    if (run.judge.generate && hasSessionDims(run.rubric) && run.session.messages.some((m) => m.role === 'anchor')) {
      run.queue.push(this.db.insert(evalItems).values({ evalId, kind: 'session', seq: null, proactive: false, status: 'pending' }).returning().get());
    }
    this.db.update(evals).set({ rules: run.rules, summary: this.summaryOf(run.id, run.rubric, run.rules) }).where(eq(evals.id, run.id)).run();
    run.closed = true;
    run.wake?.();
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
    this.abort(run);
  }

  stopForSession(sessionId: string) {
    for (const run of this.runs.values()) if (run.sessionId === sessionId) this.abort(run);
  }

  private abort(run: Run) {
    run.ctrl.abort();
    run.wake?.();
  }

  private assertIdle(sessionId: string) {
    if (this.db.select({ id: evals.id }).from(evals).where(and(eq(evals.sessionId, sessionId), eq(evals.status, 'running'))).get()) {
      throw new ConflictError('这场会话已经有评估在进行');
    }
  }

  private judgeOf(input: JudgeInput, needsJudge: boolean): Judge {
    const rubricRow = getRubric(this.db, input.rubricId);
    const base = { rubricRow, temperature: input.temperature ?? null, samples: input.samples ?? 1, attempts: input.attempts ?? 3 };
    if (!needsJudge) return { ...base, generate: null, providerName: null, model: null };
    if (!input.providerId || !input.model) throw new BadRequestError('这个评分标准需要 LLM 裁判，请从模型池里选择裁判模型');
    const { provider, model } = resolvePoolModel(this.db, input.providerId, input.model, '裁判模型');
    const generate = createGenerate(configOf(provider), { model, temperature: input.temperature ?? undefined }, { fetch: this.fetchImpl });
    return { ...base, generate, providerName: provider.name, model };
  }

  private insert(sessionId: string, judge: Judge, rules: RuleResult, planned: PlannedItem[], status?: EvalStatus) {
    const id = randomUUID();
    const rubric = judge.rubricRow.rubric;
    const finalStatus = status ?? (judge.generate ? 'running' : 'done');
    this.db.transaction((tx) => {
      tx.insert(evals)
        .values({
          id,
          sessionId,
          rubricId: judge.rubricRow.id,
          rubricName: judge.rubricRow.name,
          rubric,
          providerName: judge.providerName,
          model: judge.model,
          temperature: judge.temperature,
          samples: judge.samples,
          attempts: judge.attempts,
          status: finalStatus,
          rules,
          summary: summarize(rubric, rules, planned.map((p) => ({ ...p, scores: null }))),
          finishedAt: finalStatus === 'running' ? null : new Date(),
        })
        .run();
      if (planned.length) tx.insert(evalItems).values(planned.map((p) => ({ ...p, evalId: id }))).run();
    });
    return id;
  }

  private launch(init: Pick<Run, 'id' | 'sessionId' | 'judge' | 'session' | 'rules' | 'queue' | 'closed'>) {
    const run: Run = { ...init, rubric: init.judge.rubricRow.rubric, ctrl: new AbortController(), listeners: new Set(), wake: null, calls: 0 };
    this.runs.set(run.id, run);
    void this.work(run).finally(() => {
      this.runs.delete(run.id);
      run.listeners.clear();
    });
  }

  private summaryOf(evalId: string, rubric: Rubric, rules: RuleResult): EvalSummary {
    const items = this.db.select().from(evalItems).where(eq(evalItems.evalId, evalId)).all();
    return summarize(rubric, rules, items.map(asResult));
  }

  private publish(run: Run, item: ItemRow) {
    const summary = this.summaryOf(run.id, run.rubric, run.rules);
    this.db.update(evals).set({ summary, rules: run.rules, calls: run.calls }).where(eq(evals.id, run.id)).run();
    const texts = new Map(run.session.messages.map((m) => [m.seq, m.text]));
    this.broadcast(run, { type: 'item', item: itemView(item, texts), summary, rules: run.rules, calls: run.calls });
  }

  private async judgeItem(run: Run, item: ItemRow): Promise<Partial<ItemRow>> {
    const dims = run.rubric.dimensions.filter((d) => appliesTo(d, item));
    const prompt = item.kind === 'turn' ? buildTurnJudgeMessages(run.session, item.seq!, dims) : buildSessionJudgeMessages(run.session, dims);
    const signal = run.ctrl.signal;
    try {
      const res = await runJudge(run.judge.generate!, prompt, dims.map((d) => d.key), { attempts: run.judge.attempts, samples: run.judge.samples, signal });
      run.calls += res.calls;
      return { status: 'done', scores: res.scores, calls: res.calls, error: null };
    } catch (err) {
      const used = err instanceof JudgeFailedError ? err.calls : 0;
      run.calls += used;
      return { status: 'error', error: (err as Error).message.slice(0, 500), calls: used };
    }
  }

  private async work(run: Run) {
    const signal = run.ctrl.signal;
    let status: EvalStatus = 'done';
    let error: string | null = null;
    try {
      for (;;) {
        if (signal.aborted) {
          status = 'stopped';
          break;
        }
        const item = run.queue.shift();
        if (!item) {
          if (run.closed) break;
          await new Promise<void>((resolve) => (run.wake = resolve));
          run.wake = null;
          continue;
        }
        const patch = await this.judgeItem(run, item);
        if (signal.aborted) {
          status = 'stopped';
          break;
        }
        const saved = this.db.update(evalItems).set(patch).where(eq(evalItems.id, item.id)).returning().get();
        if (!saved) {
          status = 'stopped';
          break;
        }
        this.publish(run, saved);
      }
    } catch (err) {
      status = 'error';
      error = (err as Error).message;
      console.error(`eval ${run.id} failed`, err);
    }
    this.db
      .update(evals)
      .set({ status, error, calls: run.calls, rules: run.rules, summary: this.summaryOf(run.id, run.rubric, run.rules), finishedAt: new Date() })
      .where(eq(evals.id, run.id))
      .run();
    this.broadcast(run, { type: 'end', status, error });
  }

  private broadcast(run: Run, ev: EvalEvent) {
    for (const l of run.listeners) l(ev);
  }
}
