import { randomUUID } from 'node:crypto';
import {
  createGenerate,
  LiveClock,
  LiveRoomEngine,
  parseScript,
  SimStateError,
  VirtualClock,
  type FetchLike,
  type Pace,
  type SimClock,
  type SimEvent,
  type SimMessage,
  type SimMode,
} from '@lce/core';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { messages, sessions, type SessionSnapshot, type SessionStatus } from '../db/schema.ts';
import { getAnchor, getConfig, promptConfigOf } from './anchors.ts';
import { BadRequestError, NotFoundError } from './errors.ts';
import { configOf, getProvider } from './providers.ts';
import { getScript } from './scripts.ts';

export type StartInput = { configId: string; mode: 'live' } | { configId: string; mode: 'script'; scriptId: string; pace: Pace };

export interface RunInfo {
  sessionId: string;
  mode: SimMode;
  anchorName: string;
  configName: string;
  scriptName: string | null;
  scriptDurationMs: number | null;
  pace: Pace | null;
  startedAt: string;
}

export type RoomEvent = SimEvent | { type: 'hello'; info: RunInfo } | { type: 'pace'; pace: Pace };

type Listener = (ev: RoomEvent) => void;

interface Run {
  info: RunInfo;
  engine: LiveRoomEngine;
  clock: SimClock;
  virtual: VirtualClock | null;
  startedWall: number;
  log: RoomEvent[];
  lastClock: RoomEvent | null;
  partial: string | null;
  listeners: Set<Listener>;
}

const END_STATUS: Record<'finished' | 'stopped' | 'error', SessionStatus> = { finished: 'done', stopped: 'stopped', error: 'error' };
export const INTERRUPTED = '服务重启，模拟被中断';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 本地时间，格式与导入记录一致：2026-10-27T17:54:11 */
export function localIso(epochMs: number) {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export class SimulationManager {
  private readonly runs = new Map<string, Run>();

  constructor(
    private readonly db: Db,
    private readonly fetchImpl?: FetchLike,
  ) {
    db.update(sessions).set({ status: 'stopped', error: INTERRUPTED }).where(eq(sessions.status, 'running')).run();
  }

  list(): RunInfo[] {
    return [...this.runs.values()].map((r) => r.info);
  }

  has(sessionId: string) {
    return this.runs.has(sessionId);
  }

  start(input: StartInput): RunInfo {
    const cfg = getConfig(this.db, input.configId);
    const anchor = getAnchor(this.db, cfg.anchorName);
    if (!cfg.providerId) throw new BadRequestError('这个配置还没有绑定模型服务');
    const provider = getProvider(this.db, cfg.providerId);
    const model = cfg.model || provider.defaultModel;
    if (!model) throw new BadRequestError('没有指定模型，请在配置里填写模型或先拉取模型列表');

    let script: ReturnType<typeof parseScript>['events'] | undefined;
    let scriptRow: ReturnType<typeof getScript> | null = null;
    if (input.mode === 'script') {
      scriptRow = getScript(this.db, input.scriptId);
      const parsed = parseScript(scriptRow.content, scriptRow.defaultGapSec);
      if (parsed.issues.length) throw new BadRequestError(`剧本有 ${parsed.issues.length} 处格式问题，先到剧本页修正`);
      if (parsed.events.length === 0) throw new BadRequestError('剧本里没有弹幕');
      script = parsed.events;
    }

    const sessionId = randomUUID();
    const startedWall = Date.now();
    const pace = input.mode === 'script' ? input.pace : null;
    const virtual = pace ? new VirtualClock(pace) : null;
    const clock: SimClock = virtual ?? new LiveClock();
    const prompt = promptConfigOf(anchor, cfg);
    const snapshot: SessionSnapshot = {
      configId: cfg.id,
      configName: cfg.name,
      providerName: provider.name,
      model,
      temperature: cfg.temperature,
      personaPrompt: anchor.personaPrompt,
      replyRules: cfg.replyRules,
      proactivePrompt: cfg.proactivePrompt,
      contextTurns: cfg.contextTurns,
      strategy: cfg.strategy,
      mode: input.mode,
      pace,
      scriptName: scriptRow?.name ?? null,
    };

    this.db
      .insert(sessions)
      .values({
        id: sessionId,
        source: input.mode,
        anchorName: anchor.name,
        title: scriptRow ? `${cfg.name} · ${scriptRow.name}` : `${cfg.name} · 单人实时`,
        startedAt: localIso(startedWall),
        unanswered: [],
        orphanActions: [],
        status: 'running',
        configId: cfg.id,
        scriptId: scriptRow?.id ?? null,
        snapshot,
      })
      .run();

    const info: RunInfo = {
      sessionId,
      mode: input.mode,
      anchorName: anchor.name,
      configName: cfg.name,
      scriptName: scriptRow?.name ?? null,
      scriptDurationMs: script ? (script.at(-1)?.at ?? 0) : null,
      pace,
      startedAt: localIso(startedWall),
    };

    let run!: Run;
    const engine = new LiveRoomEngine({
      mode: input.mode,
      clock,
      strategy: cfg.strategy,
      prompt,
      script,
      generate: createGenerate(
        configOf(provider),
        { model, temperature: cfg.temperature ?? undefined, maxTokens: cfg.maxTokens ?? undefined },
        { fetch: this.fetchImpl },
      ),
      onEvent: (ev) => this.handle(run, ev),
    });
    run = { info, engine, clock, virtual, startedWall, log: [], lastClock: null, partial: null, listeners: new Set() };
    this.runs.set(sessionId, run);

    void engine
      .run()
      .catch((err) => console.error(`simulation ${sessionId} failed`, err))
      .finally(() => clock.dispose());
    return info;
  }

  subscribe(sessionId: string, listener: Listener): (() => void) | null {
    const run = this.runs.get(sessionId);
    if (!run) return null;
    listener({ type: 'hello', info: run.info });
    for (const ev of run.log) listener(ev);
    if (run.lastClock) listener(run.lastClock);
    if (run.partial) listener({ type: 'delta', text: run.partial });
    run.listeners.add(listener);
    return () => run.listeners.delete(listener);
  }

  inject(sessionId: string, speaker: string, text: string): SimMessage {
    const run = this.get(sessionId);
    if (run.info.mode !== 'live') throw new BadRequestError('剧本模式不能手动发弹幕');
    try {
      return run.engine.inject(speaker, text);
    } catch (err) {
      if (err instanceof SimStateError) throw new BadRequestError(err.message);
      throw err;
    }
  }

  setPace(sessionId: string, pace: Pace) {
    const run = this.get(sessionId);
    if (!run.virtual) throw new BadRequestError('单人实时模式没有回放节奏');
    run.virtual.setPace(pace);
    run.info = { ...run.info, pace };
    this.broadcast(run, { type: 'pace', pace });
  }

  step(sessionId: string) {
    const run = this.get(sessionId);
    if (!run.virtual) throw new BadRequestError('单人实时模式不能单步');
    run.virtual.step();
  }

  stop(sessionId: string) {
    this.get(sessionId).engine.stop();
  }

  stopIfRunning(sessionId: string) {
    this.runs.get(sessionId)?.engine.stop();
  }

  private get(sessionId: string): Run {
    const run = this.runs.get(sessionId);
    if (!run) throw new NotFoundError('这场模拟不在运行中');
    return run;
  }

  private handle(run: Run, ev: SimEvent) {
    if (ev.type === 'danmaku' || ev.type === 'reply') this.persist(run, ev.message);
    if (ev.type === 'thinking') run.partial = '';
    else if (ev.type === 'delta') run.partial = (run.partial ?? '') + ev.text;
    else if (ev.type === 'reply') run.partial = null;

    if (ev.type === 'end') {
      this.runs.delete(run.info.sessionId);
      try {
        this.db
          .update(sessions)
          .set({ status: END_STATUS[ev.reason], error: ev.error, unanswered: ev.unanswered, endedAt: localIso(run.startedWall + ev.at) })
          .where(eq(sessions.id, run.info.sessionId))
          .run();
      } finally {
        this.broadcast(run, ev);
        run.listeners.clear();
      }
      return;
    }
    if (ev.type === 'clock' || ev.type === 'waiting') run.lastClock = ev;
    else if (ev.type !== 'delta') run.log.push(ev);
    this.broadcast(run, ev);
  }

  private persist(run: Run, m: SimMessage) {
    this.db
      .insert(messages)
      .values({
        sessionId: run.info.sessionId,
        seq: m.seq,
        time: localIso(run.startedWall + m.at),
        speaker: m.speaker,
        role: m.role,
        text: m.text,
        repliesTo: m.repliesTo,
        latencyMs: m.latencyMs,
        proactive: m.proactive,
        genFirstTokenMs: m.firstTokenMs,
        genTotalMs: m.genTotalMs,
      })
      .run();
  }

  private broadcast(run: Run, ev: RoomEvent) {
    for (const l of run.listeners) l(ev);
  }
}
