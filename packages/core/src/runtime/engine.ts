import { buildAnchorMessages, type AnchorExchange, type AnchorPromptConfig, type TurnInput } from '../anchor/prompt.ts';
import { decideReply, type Danmaku, type ReplyStrategy, type StrategyDecision } from '../anchor/strategy.ts';
import type { SimClock } from './clock.ts';
import type { Generate } from './generate.ts';
import type { ScriptEvent } from './script.ts';
import { buildSelectionMessages, parseSelection } from './select.ts';
import type { SimEndReason, SimEvent, SimMessage, SimMode } from './types.ts';

export interface EngineOptions {
  mode: SimMode;
  clock: SimClock;
  strategy: ReplyStrategy;
  prompt: AnchorPromptConfig;
  generate: Generate;
  script?: readonly ScriptEvent[];
  initialHistory?: readonly AnchorExchange[];
  /** 第一条新消息的 seq；续聊时接在历史记录之后，保证编号不和历史重复 */
  seqStart?: number;
  onEvent: (ev: SimEvent) => void;
}

export interface EngineResult {
  reason: SimEndReason;
  error: string | null;
  transcript: SimMessage[];
  unanswered: number[];
}

export class SimStateError extends Error {}

type ReplyDecision = Exclude<StrategyDecision, { type: 'wait' }>;

/**
 * 直播间模拟引擎。循环：放入到点的弹幕 → 按回复策略决定说不说、回哪几条 → 调模型生成 → 记录。
 * 时间只由 SimClock 推进：剧本模式是虚拟时钟，单人模式是真实时间；
 * 模型生成期间到达的弹幕先进入待回复队列，在回复之前写入记录。
 */
export class LiveRoomEngine {
  readonly transcript: SimMessage[] = [];
  private pending: Danmaku[] = [];
  private scriptIdx = 0;
  private lastReplyAt: number | null = null;
  private lastActivityAt = 0;
  private readonly seen = new Set<string>();
  private readonly skipped = new Set<number>();
  private readonly history: AnchorExchange[];
  private stopped = false;
  private finished = false;
  private abort: AbortController | null = null;

  constructor(private readonly opts: EngineOptions) {
    this.history = opts.initialHistory ? [...opts.initialHistory] : [];
  }

  get ended() {
    return this.finished;
  }

  inject(speaker: string, text: string): SimMessage {
    if (this.opts.mode !== 'live') throw new SimStateError('剧本模式不能手动发弹幕');
    if (this.finished || this.stopped) throw new SimStateError('直播已结束');
    const msg = this.admit(this.opts.clock.now(), speaker, text);
    this.opts.clock.wake();
    return msg;
  }

  stop() {
    this.stopped = true;
    this.abort?.abort();
    this.opts.clock.wake();
  }

  async run(): Promise<EngineResult> {
    const { clock, strategy, prompt, mode } = this.opts;
    try {
      while (!this.stopped) {
        const now = clock.now();
        this.admitScript(now);
        const decision = decideReply(strategy, {
          now,
          pending: this.pending,
          lastReplyAt: this.lastReplyAt,
          lastActivityAt: this.lastActivityAt,
          seenSpeakers: this.seen,
          anchorName: prompt.anchorName,
        });
        if (decision.type !== 'wait') {
          await this.speak(decision, now);
          continue;
        }
        const nextScript = this.opts.script?.[this.scriptIdx]?.at ?? null;
        if (mode === 'script' && nextScript === null && this.pending.length === 0) break;
        const target = [decision.until, nextScript].filter((t): t is number => t !== null).reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
        const until = Number.isFinite(target) ? target : null;
        this.opts.onEvent({ type: 'waiting', at: now, until });
        const at = await clock.waitUntil(until);
        this.opts.onEvent({ type: 'clock', at });
      }
      return this.finish(this.stopped ? 'stopped' : 'finished', null);
    } catch (err) {
      return this.finish(this.stopped ? 'stopped' : 'error', this.stopped ? null : (err as Error).message);
    }
  }

  private async speak(decision: ReplyDecision, now: number) {
    const { clock, strategy, prompt, generate } = this.opts;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    let replyTo = decision.type === 'reply' ? decision.replyTo : [];
    let skipped = decision.type === 'reply' ? decision.skipped : [];
    let startAt = now;

    const candidates = [...replyTo, ...skipped].sort((a, b) => a.id - b.id);
    if (strategy.llmSelect && candidates.length > 1) {
      const limit = Math.max(1, Math.floor(strategy.maxBatch));
      const sel = await generate(buildSelectionMessages(prompt.anchorName, candidates, limit), { signal });
      startAt = clock.advance(sel.totalMs);
      const picked = parseSelection(sel.text, candidates.length, limit);
      if (picked) {
        const chosen = new Set(picked.map((i) => candidates[i]!));
        replyTo = candidates.filter((d) => chosen.has(d));
        skipped = candidates.filter((d) => !chosen.has(d));
      } else {
        this.opts.onEvent({ type: 'warning', at: startAt, message: `模型选弹幕的输出无法解析，改用规则选择：${sel.text.slice(0, 100)}` });
      }
    }

    const proactive = decision.type === 'proactive';
    this.opts.onEvent({ type: 'thinking', at: startAt, replyTo: replyTo.map((d) => d.id), skipped: skipped.map((d) => d.id), proactive });
    const input: TurnInput = proactive ? { kind: 'proactive' } : { kind: 'danmaku', danmaku: replyTo.map(({ speaker, text }) => ({ speaker, text })) };
    const gen = await generate(buildAnchorMessages(prompt, this.history, input), {
      signal,
      onDelta: (text) => this.opts.onEvent({ type: 'delta', text }),
    });
    this.abort = null;
    if (this.stopped) return;

    const doneAt = clock.advance(gen.totalMs);
    this.admitScript(doneAt);
    const consumed = new Set([...replyTo, ...skipped]);
    this.pending = this.pending.filter((d) => !consumed.has(d));
    for (const d of consumed) this.seen.add(d.speaker);
    for (const d of skipped) this.skipped.add(d.id);

    const message: SimMessage = {
      seq: this.nextSeq(),
      at: doneAt,
      role: 'anchor',
      speaker: prompt.anchorName,
      text: gen.text,
      repliesTo: replyTo.map((d) => d.id),
      proactive,
      latencyMs: replyTo[0] ? doneAt - replyTo[0].ts : null,
      firstTokenMs: gen.firstTokenMs,
      genTotalMs: gen.totalMs,
    };
    this.transcript.push(message);
    this.history.push({ input, reply: gen.text });
    this.lastReplyAt = doneAt;
    this.lastActivityAt = doneAt;
    this.opts.onEvent({ type: 'reply', message });
  }

  private admitScript(until: number) {
    const script = this.opts.script ?? [];
    while (this.scriptIdx < script.length && script[this.scriptIdx]!.at <= until) {
      const ev = script[this.scriptIdx++]!;
      this.admit(ev.at, ev.speaker, ev.text);
    }
  }

  private admit(at: number, speaker: string, text: string): SimMessage {
    const message: SimMessage = {
      seq: this.nextSeq(),
      at,
      role: 'viewer',
      speaker,
      text,
      repliesTo: null,
      proactive: null,
      latencyMs: null,
      firstTokenMs: null,
      genTotalMs: null,
    };
    this.transcript.push(message);
    this.pending.push({ id: message.seq, speaker, text, ts: at });
    this.lastActivityAt = Math.max(this.lastActivityAt, at);
    this.opts.onEvent({ type: 'danmaku', message });
    return message;
  }

  private nextSeq() {
    return (this.opts.seqStart ?? 0) + this.transcript.length;
  }

  private finish(reason: SimEndReason, error: string | null): EngineResult {
    this.finished = true;
    this.abort = null;
    const unanswered = [...this.skipped, ...this.pending.map((d) => d.id)].sort((a, b) => a - b);
    this.opts.onEvent({ type: 'end', at: this.opts.clock.now(), reason, error, unanswered });
    return { reason, error, transcript: this.transcript, unanswered };
  }
}
