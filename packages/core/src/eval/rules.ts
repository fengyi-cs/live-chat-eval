import { clamp, mean, round1, weightedMean } from './math.ts';
import type { RuleConfig, RuleKey } from './rubric.ts';
import type { EvalMessage, EvalSession, RuleMetric, RuleResult, TurnRules } from './types.ts';

const charCount = (text: string) => [...text.replace(/\s+/g, '')].length;

export function latencyScore(ms: number, goodSec: number, badSec: number): number {
  const sec = ms / 1000;
  if (sec <= goodSec) return 100;
  if (sec >= badSec) return 0;
  return ((badSec - sec) / (badSec - goodSec)) * 100;
}

export function lengthScore(chars: number, minChars: number, maxChars: number): number {
  if (chars >= minChars && chars <= maxChars) return 100;
  if (chars < minChars) return minChars > 0 ? (chars / minChars) * 100 : 100;
  return clamp(100 - ((chars - maxChars) / maxChars) * 100, 0, 100);
}

function bigrams(text: string): Set<string> {
  const chars = [...text.replace(/[\s\p{P}]/gu, '')];
  const set = new Set<string>();
  for (let i = 0; i < chars.length - 1; i++) set.add(chars[i]! + chars[i + 1]!);
  if (chars.length === 1) set.add(chars[0]!);
  return set;
}

/** Dice 系数：2|A∩B| / (|A|+|B|)，按字的二元组计算 */
export function similarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (x.size === 0 || y.size === 0) return 0;
  let common = 0;
  for (const g of x) if (y.has(g)) common++;
  return (2 * common) / (x.size + y.size);
}

export function findPhrases(text: string, phrases: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return phrases.filter((p) => p.trim() && lower.includes(p.toLowerCase()));
}

const metric = (score: number | null, value: number | null, hits?: string[]): RuleMetric => ({
  score: score === null ? null : round1(score),
  value: value === null ? null : round1(value),
  ...(hits ? { hits } : {}),
});

export function computeRules(session: EvalSession, rules: RuleConfig): RuleResult {
  const anchors = session.messages.filter((m) => m.role === 'anchor');
  const turns: Record<number, TurnRules> = {};
  const prev: EvalMessage[] = [];

  for (const m of anchors) {
    const t: TurnRules = {};
    if (rules.latency.enabled && !m.proactive && m.latencyMs !== null) {
      t.latency = metric(latencyScore(m.latencyMs, rules.latency.goodSec, rules.latency.badSec), m.latencyMs);
    }
    if (rules.length.enabled) {
      const n = charCount(m.text);
      t.length = metric(lengthScore(n, rules.length.minChars, rules.length.maxChars), n);
    }
    if (rules.repetition.enabled) {
      const window = prev.slice(-Math.max(0, rules.repetition.window));
      const sim = window.length ? Math.max(...window.map((p) => similarity(m.text, p.text))) : 0;
      t.repetition = metric((1 - sim) * 100, sim * 100);
    }
    if (rules.aiPhrases.enabled) {
      const hits = findPhrases(m.text, rules.aiPhrases.phrases);
      t.aiPhrases = metric(clamp(100 - hits.length * rules.aiPhrases.penaltyPerHit, 0, 100), hits.length, hits);
    }
    turns[m.seq] = t;
    prev.push(m);
  }

  const avg = (key: RuleKey) => {
    const scores = Object.values(turns)
      .map((t) => t[key]?.score)
      .filter((s): s is number => s !== null && s !== undefined);
    const values = Object.values(turns)
      .map((t) => t[key]?.value)
      .filter((v): v is number => v !== null && v !== undefined);
    return metric(mean(scores), mean(values));
  };

  const sessionMetrics: RuleResult['session'] = {};
  if (rules.latency.enabled) sessionMetrics.latency = avg('latency');
  if (rules.missRate.enabled) {
    const viewers = session.messages.filter((m) => m.role === 'viewer').length;
    const rate = viewers ? session.unanswered.length / viewers : null;
    sessionMetrics.missRate = metric(rate === null ? null : (1 - rate) * 100, rate === null ? null : rate * 100);
  }
  if (rules.length.enabled) sessionMetrics.length = avg('length');
  if (rules.repetition.enabled) sessionMetrics.repetition = avg('repetition');
  if (rules.aiPhrases.enabled) {
    const all = Object.values(turns).flatMap((t) => t.aiPhrases?.hits ?? []);
    sessionMetrics.aiPhrases = { ...avg('aiPhrases'), value: all.length, hits: [...new Set(all)] };
  }

  const score = weightedMean((Object.keys(sessionMetrics) as RuleKey[]).map((k) => ({ value: sessionMetrics[k]!.score, weight: rules[k].weight })));
  return { session: sessionMetrics, turns, score: score === null ? null : round1(score) };
}
