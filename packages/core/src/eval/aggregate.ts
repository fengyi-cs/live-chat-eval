import { mean, round1, toHundred, weightedMean } from './math.ts';
import type { Dimension, DimensionScope, RuleKey, Rubric } from './rubric.ts';
import type { JudgeScores } from './judge.ts';
import type { RuleResult, TurnRules } from './types.ts';

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
  /** rubric 包含 LLM 维度但所有打分调用均失败，composite 仅含规则分，不可信 */
  llmFullyFailed: boolean;
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
  const hasLlmDims = rubric.dimensions.some((d) => d.enabled);
  const failed = items.filter((it) => it.status === 'error').length;
  const judged = items.filter((it) => it.status === 'done').length;
  const llmFullyFailed = hasLlmDims && llmScore === null && failed > 0 && judged === 0;

  return {
    composite: r1(composite),
    ruleScore: rules.score,
    llmScore: r1(llmScore),
    dimensions,
    turnCount: items.filter((it) => it.kind === 'turn').length,
    judged,
    failed,
    pending: items.filter((it) => it.status === 'pending').length,
    llmFullyFailed,
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

/** 单条发言的规则分（0-100）：只有逐条可算的规则（漏回率是整场指标，不计入） */
export function turnRuleScore(rubric: Rubric, rules: TurnRules | undefined): number | null {
  if (!rules) return null;
  const parts = (Object.keys(rules) as RuleKey[]).map((k) => ({ value: rules[k]?.score ?? null, weight: rubric.rules[k].weight }));
  return r1(weightedMean(parts));
}

/** 单条发言的综合分：按模板里规则分与 LLM 分的权重合成，只有一边有分时取那一边 */
export function turnComposite(rubric: Rubric, rules: TurnRules | undefined, item: EvalItemResult | undefined) {
  const ruleScore = turnRuleScore(rubric, rules);
  const llmScore = item ? turnLlmScore(rubric, item) : null;
  const composite = weightedMean([
    { value: ruleScore, weight: rubric.ruleWeight },
    { value: llmScore, weight: rubric.llmWeight },
  ]);
  return { ruleScore, llmScore, composite: r1(composite) };
}
