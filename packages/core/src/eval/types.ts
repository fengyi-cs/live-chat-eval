import type { RuleKey } from './rubric.ts';

export interface EvalMessage {
  seq: number;
  role: 'viewer' | 'anchor' | 'action' | 'ignore';
  speaker: string;
  text: string;
  /** 本地时间 ISO（不带时区），只用于相互计算间隔 */
  time: string;
  repliesTo: number[] | null;
  latencyMs: number | null;
  proactive: boolean | null;
}

export interface EvalSession {
  anchorName: string;
  personaPrompt: string;
  messages: EvalMessage[];
  /** 续聊前的历史记录：只作裁判上下文，不打分、不计入规则分；seq 都小于 messages */
  history?: EvalMessage[];
  /** 没有被回应的观众弹幕 seq */
  unanswered: number[];
}

export interface RuleMetric {
  /** 0-100，没有可计算的数据时为 null */
  score: number | null;
  value: number | null;
  hits?: string[];
}

export type TurnRules = Partial<Record<RuleKey, RuleMetric>>;

export interface RuleResult {
  session: Partial<Record<RuleKey, RuleMetric>>;
  /** 按主播发言 seq 索引 */
  turns: Record<number, TurnRules>;
  score: number | null;
}
