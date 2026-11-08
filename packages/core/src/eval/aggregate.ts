import { mean, round1, toHundred, weightedMean } from './math.ts';
import type { Dimension, DimensionScope, Rubric } from './rubric.ts';
import type { JudgeScores } from './judge.ts';
import type { RuleResult } from './types.ts';

export type EvalItemStatus = 'pending' | 'done' | 'error' | 'skipped';

export interface EvalItemResult {
  kind: DimensionScope;
  seq: number | null;
  proactive: boolean;
  status: EvalItemStatus;
  scores: JudgeScores | null;
}

export interface DimensionSummary {
  key: string;
  name: string;
  scope: DimensionScope;
  weight: number;
  /** 1-5 的平均分 */
  mean: number | null;
  score100: number | null;
  count: number;
}

export interface EvalSummary {
  composite: number | null;
  ruleScore: number | null;
  llmScore: number | null;
  dimensions: DimensionSummary[];
  turnCount: number;
  judged: number;
  failed: number;
  pending: number;
}

const r1 = (n: number | null) => (n === null ? null : round1(n));

export function appliesTo(d: Dimension, item: Pick<EvalItemResult, 'kind' | 'proactive'>) {
  return d.enabled && d.scope === item.kind && !(item.kind === 'turn' && item.proactive && d.skipProactive);
}

export function summarize(rubric: Rubric, rules: RuleResult, items: readonly EvalItemResult[]): EvalSummary {
  const dims = rubric.dimensions.filter((d) => d.enabled);
  const dimensions: DimensionSummary[] = dims.map((d) => {
    const scores = items
      .filter((it) => it.status === 'done' && appliesTo(d, it))
      .map((it) => it.scores?.[d.key]?.score)
      .filter((s): s is number => typeof s === 'number');
    const m = mean(scores);
    return { key: d.key, name: d.name, scope: d.scope, weight: d.weight, mean: r1(m), score100: r1(m === null ? null : toHundred(m)), count: scores.length };
  });
  const llmScore = weightedMean(dimensions.map((d) => ({ value: d.score100, weight: d.weight })));
  const composite = weightedMean([
    { value: rules.score, weight: rubric.ruleWeight },
    { value: llmScore, weight: rubric.llmWeight },
  ]);
  return {
    composite: r1(composite),
    ruleScore: rules.score,
    llmScore: r1(llmScore),
    dimensions,
    turnCount: items.filter((it) => it.kind === 'turn').length,
    judged: items.filter((it) => it.status === 'done').length,
    failed: items.filter((it) => it.status === 'error').length,
    pending: items.filter((it) => it.status === 'pending').length,
  };
}

/** 单条发言的 LLM 分（0-100），按适用维度加权 */
export function turnLlmScore(rubric: Rubric, item: EvalItemResult): number | null {
  if (item.status !== 'done' || !item.scores) return null;
  const parts = rubric.dimensions
    .filter((d) => appliesTo(d, item))
    .map((d) => {
      const s = item.scores![d.key]?.score;
      return { value: typeof s === 'number' ? toHundred(s) : null, weight: d.weight };
    });
  return r1(weightedMean(parts));
}
