import type { ChatMessage } from '../providers/types.ts';
import type { Generate } from '../runtime/generate.ts';
import { round1 } from './math.ts';
import { SCORE_MAX, SCORE_MIN, type Dimension } from './rubric.ts';
import type { EvalMessage, EvalSession } from './types.ts';

export interface JudgeScore {
  score: number;
  reason: string;
}

export type JudgeScores = Record<string, JudgeScore>;

export const JUDGE_CONTEXT_MESSAGES = 10;
export const SESSION_TRANSCRIPT_BUDGET = 12_000;

const JUDGE_SYSTEM =
  '你是直播内容评审，负责评价 AI 主播在直播间的发言。按给出的评分维度逐项打 1-5 分的整数，每项给一句具体理由，引用发言里的原话作为依据。' +
  '评分要严格并拉开差距：没有亮点就不要给 4 分以上，有明显问题就给 2 分以下。只输出 JSON，不要输出其他内容。';

const visible = (m: EvalMessage) => m.role === 'viewer' || m.role === 'anchor';
const lineOf = (m: EvalMessage, anchorName: string) => (m.role === 'anchor' ? `【主播 ${anchorName}】${m.text}` : `【观众 ${m.speaker}】${m.text}`);

function personaSection(session: EvalSession) {
  return `## 主播人设\n${session.personaPrompt.trim() || `（没有提供人设，按真人主播「${session.anchorName}」的标准评）`}`;
}

function dimensionSection(dims: readonly Dimension[]) {
  return dims
    .map((d) => [`### ${d.key}：${d.name}`, d.description, ...d.anchors.map((a, i) => `${i + 1} 分：${a}`)].join('\n'))
    .join('\n\n');
}

function outputSection(dims: readonly Dimension[]) {
  const example = Object.fromEntries(dims.map((d) => [d.key, { score: 3, reason: '……' }]));
  return `## 输出格式\n只输出一个 JSON 对象，键必须是：${dims.map((d) => d.key).join(', ')}\n${JSON.stringify(example)}`;
}

export function buildTurnJudgeMessages(session: EvalSession, turnSeq: number, dims: readonly Dimension[], contextSize = JUDGE_CONTEXT_MESSAGES): ChatMessage[] {
  const turn = session.messages.find((m) => m.seq === turnSeq && m.role === 'anchor');
  if (!turn) throw new Error(`没有找到主播发言 #${turnSeq}`);
  const bySeq = new Map(session.messages.map((m) => [m.seq, m]));
  const context = session.messages.filter((m) => visible(m) && m.seq < turnSeq).slice(-contextSize);
  const replied = (turn.repliesTo ?? []).map((s) => bySeq.get(s)).filter((m): m is EvalMessage => Boolean(m));

  const sections = [
    personaSection(session),
    `## 之前的直播间对话（最近 ${context.length} 条）\n${context.length ? context.map((m) => lineOf(m, session.anchorName)).join('\n') : '（开播后的第一句）'}`,
    `## 本次主播回应的弹幕\n${turn.proactive || replied.length === 0 ? '（没有弹幕，这是主播的主动发言）' : replied.map((m) => `【观众 ${m.speaker}】${m.text}`).join('\n')}`,
    `## 待评价的主播发言\n${turn.text}`,
    `## 评分维度\n${dimensionSection(dims)}`,
    outputSection(dims),
  ];
  return [
    { role: 'system', content: JUDGE_SYSTEM },
    { role: 'user', content: sections.join('\n\n') },
  ];
}

export function buildSessionJudgeMessages(session: EvalSession, dims: readonly Dimension[], budget = SESSION_TRANSCRIPT_BUDGET): ChatMessage[] {
  const lines = session.messages.filter(visible).map((m) => lineOf(m, session.anchorName));
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    used += lines[i]!.length + 1;
    if (used > budget && kept.length > 0) break;
    kept.unshift(lines[i]!);
  }
  const omitted = lines.length - kept.length;
  const transcript = (omitted > 0 ? [`（前面省略 ${omitted} 条）`] : []).concat(kept).join('\n');
  const sections = [
    personaSection(session),
    `## 整场直播记录\n${transcript}`,
    `## 评分维度（评价整场表现）\n${dimensionSection(dims)}`,
    outputSection(dims),
  ];
  return [
    { role: 'system', content: JUDGE_SYSTEM },
    { role: 'user', content: sections.join('\n\n') },
  ];
}

export class JudgeParseError extends Error {}

export function parseJudgeOutput(text: string, keys: readonly string[]): JudgeScores {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new JudgeParseError('输出里没有 JSON 对象');
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new JudgeParseError('JSON 格式不合法');
  }
  const obj = (raw as { scores?: unknown })?.scores ?? raw;
  if (!obj || typeof obj !== 'object') throw new JudgeParseError('JSON 不是对象');
  const out: JudgeScores = {};
  for (const key of keys) {
    const entry = (obj as Record<string, unknown>)[key];
    const rawScore = typeof entry === 'object' && entry !== null ? (entry as { score?: unknown }).score : entry;
    const score = typeof rawScore === 'string' ? Number(rawScore) : rawScore;
    if (typeof score !== 'number' || !Number.isFinite(score)) throw new JudgeParseError(`缺少维度 ${key} 的分数`);
    if (score < SCORE_MIN || score > SCORE_MAX) throw new JudgeParseError(`维度 ${key} 的分数 ${score} 不在 ${SCORE_MIN}-${SCORE_MAX} 之间`);
    const reason = typeof entry === 'object' && entry !== null ? String((entry as { reason?: unknown }).reason ?? '') : '';
    out[key] = { score, reason };
  }
  return out;
}

export interface JudgeOptions {
  attempts?: number;
  samples?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
}

export class JudgeFailedError extends Error {
  constructor(
    message: string,
    readonly calls: number,
  ) {
    super(message);
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/** 调用裁判并解析；解析失败时把错误告诉模型重试。samples > 1 时多次独立打分取平均。 */
export async function runJudge(generate: Generate, messages: ChatMessage[], keys: readonly string[], opts: JudgeOptions = {}) {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const samples = Math.max(1, opts.samples ?? 1);
  const results: JudgeScores[] = [];
  let calls = 0;
  for (let s = 0; s < samples; s++) {
    let convo = messages;
    let lastError = '';
    for (let a = 0; a < attempts; a++) {
      if (opts.signal?.aborted) throw new JudgeFailedError('已停止', calls);
      if (a > 0) await sleep(opts.retryDelayMs ?? 1000, opts.signal);
      calls++;
      let text: string;
      try {
        text = (await generate(convo, { signal: opts.signal })).text;
      } catch (err) {
        if (opts.signal?.aborted) throw new JudgeFailedError('已停止', calls);
        lastError = (err as Error).message;
        continue;
      }
      try {
        results.push(parseJudgeOutput(text, keys));
        lastError = '';
        break;
      } catch (err) {
        lastError = `${(err as Error).message}：${text.slice(0, 200)}`;
        convo = [
          ...messages,
          { role: 'assistant', content: text },
          { role: 'user', content: `你的输出无法解析（${(err as Error).message}）。请只输出一个 JSON 对象，键为：${keys.join(', ')}，每个值形如 {"score": 1-5 的整数, "reason": "理由"}。` },
        ];
      }
    }
    if (lastError) throw new JudgeFailedError(lastError, calls);
  }
  return { scores: averageScores(results, keys), calls, samples: results };
}

export function averageScores(results: readonly JudgeScores[], keys: readonly string[]): JudgeScores {
  return Object.fromEntries(
    keys.map((k) => [k, { score: round1(results.reduce((sum, r) => sum + r[k]!.score, 0) / results.length), reason: results[0]![k]!.reason }]),
  );
}
