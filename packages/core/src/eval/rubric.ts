export type DimensionScope = 'turn' | 'session';

export const SCORE_MIN = 1;
export const SCORE_MAX = 5;

export interface Dimension {
  /** 裁判输出 JSON 里的键，只用字母数字下划线 */
  key: string;
  name: string;
  description: string;
  /** 1-5 分各档的描述，下标 0 对应 1 分 */
  anchors: [string, string, string, string, string];
  weight: number;
  scope: DimensionScope;
  enabled: boolean;
  /** 主动发言（没有弹幕可回应）时不评这个维度 */
  skipProactive: boolean;
}

export const DIMENSION_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

export type RuleKey = 'latency' | 'missRate' | 'length' | 'repetition' | 'aiPhrases';

export const RULE_KEYS: readonly RuleKey[] = ['latency', 'missRate', 'length', 'repetition', 'aiPhrases'];

export const RULE_LABELS: Record<RuleKey, string> = {
  latency: '响应延迟',
  missRate: '未配对率',
  length: '回复长度',
  repetition: '重复度',
  aiPhrases: 'AI 腔词库',
};

export const RULE_DESCRIPTIONS: Partial<Record<RuleKey, string>> = {
  missRate: '主播发言前无弹幕对应的观众消息占比（基于位置配对，非语义回应）',
};

interface RuleBase {
  enabled: boolean;
  weight: number;
}

export interface RuleConfig {
  latency: RuleBase & { goodSec: number; badSec: number };
  missRate: RuleBase;
  length: RuleBase & { minChars: number; maxChars: number };
  repetition: RuleBase & { window: number };
  aiPhrases: RuleBase & { phrases: string[]; penaltyPerHit: number };
}

export interface Rubric {
  dimensions: Dimension[];
  rules: RuleConfig;
  /** 综合指数里规则基础分与 LLM 裁判分的权重 */
  ruleWeight: number;
  llmWeight: number;
}

export const DEFAULT_AI_PHRASES = [
  // 强信号：自我确认为 AI、模板化语言
  '作为一个AI',
  '作为AI',
  '作为一名主播',
  '希望对你有帮助',
  '希望能帮到你',
  '如果你还有其他问题',
  '有什么可以帮你',
  '我理解你的',
  '非常感谢你的',
  '这是一个很好的问题',
  '以下是',
  // 中强信号：明显的应答型开场白
  '总的来说',
  '总而言之',
  '综上所述',
  '值得注意的是',
  '需要注意的是',
];

const dim = (d: Omit<Dimension, 'enabled'>): Dimension => ({ ...d, enabled: true });

export const DEFAULT_RUBRIC: Rubric = {
  ruleWeight: 30,
  llmWeight: 70,
  rules: {
    latency: { enabled: true, weight: 1, goodSec: 3, badSec: 15 },
    missRate: { enabled: true, weight: 1 },
    length: { enabled: true, weight: 1, minChars: 6, maxChars: 80 },
    repetition: { enabled: true, weight: 1, window: 5 },
    aiPhrases: { enabled: true, weight: 2, phrases: DEFAULT_AI_PHRASES, penaltyPerHit: 25 },
  },
  dimensions: [
    dim({
      key: 'colloquial',
      name: '去 AI 味 / 口语化',
      description: '像不像真人主播在直播间随口说话：口语、自然、有临场感；不是书面语、客服腔或模型腔。',
      anchors: [
        '一眼就是 AI：书面语、列条目、"首先其次"、客服套话或自称 AI。',
        '明显的模型腔：句子工整、用词正式，偶尔有口语但很生硬。',
        '半口语：能读下去，但有几处书面表达或套路句，不像真人随口说。',
        '基本像真人说话，偶有一两处略显工整。',
        '完全是真人主播的随口说话，语气词、节奏、长短句都自然。',
      ],
      weight: 3,
      scope: 'turn',
      skipProactive: false,
    }),
    dim({
      key: 'relevance',
      name: '回应与逻辑',
      description: '是否接住了弹幕：回答是否切题、信息是否正确、逻辑是否通顺；多条弹幕时是否抓住了重点。',
      anchors: [
        '答非所问，或内容自相矛盾、明显错误。',
        '只沾边，没真正回应弹幕的意思。',
        '回应了，但较浅或漏掉了关键的那条。',
        '切题、通顺，抓住了主要的弹幕。',
        '精准接住弹幕，还自然地延伸或追问。',
      ],
      weight: 2,
      scope: 'turn',
      skipProactive: true,
    }),
    dim({
      key: 'fun',
      name: '趣味性',
      description: '有没有直播间的氛围感和互动感：幽默、梗、情绪、让观众想接着聊。',
      anchors: ['干巴巴，毫无情绪。', '平淡，像在完成任务。', '正常聊天，偶有一点趣味。', '有梗或有情绪，互动感不错。', '很有感染力，观众很想接话。'],
      weight: 1.5,
      scope: 'turn',
      skipProactive: false,
    }),
    dim({
      key: 'persona',
      name: '人设一致性',
      description: '发言是否符合人设设定：身份、背景、经历、说话习惯不出戏，不自称 AI，不说与设定矛盾的话。没有人设时按"真人主播"标准评。',
      anchors: ['严重出戏：自称 AI 或与人设明显矛盾。', '有明显不符合人设的内容。', '没有矛盾，但看不出人设特点。', '符合人设，有一些设定里的细节。', '人设鲜明，自然地带出设定。'],
      weight: 2,
      scope: 'turn',
      skipProactive: false,
    }),
    dim({
      key: 'personality',
      name: '性格遵从',
      description: '语气和态度是否体现了人设里的性格（如直爽、傲娇、温柔、毒舌），并且和当下场景相称。',
      anchors: ['性格完全不对。', '性格表现弱或跑偏。', '中性，看不出性格。', '性格明显，基本贴切。', '性格表现稳定、贴切又不过火。'],
      weight: 1,
      scope: 'turn',
      skipProactive: false,
    }),
    dim({
      key: 'session_consistency',
      name: '整场一致性',
      description: '整场下来人设、性格、说话风格是否前后一致；有没有反复用同样的套话、开场白或口头禅。',
      anchors: ['前后像换了个人，或大量重复套话。', '风格不稳定，重复明显。', '大体一致，有一些重复。', '一致，重复很少。', '始终如一，表达有变化不单调。'],
      weight: 2,
      scope: 'session',
      skipProactive: false,
    }),
    dim({
      key: 'session_engagement',
      name: '互动节奏',
      description: '整场的互动节奏：是否照顾到不同观众，冷场时能否主动找话题，有没有长时间漏回或抢话。',
      anchors: ['大量漏回或冷场无作为。', '经常顾此失彼。', '基本跟得上，节奏一般。', '照顾到大多数观众，节奏不错。', '节奏很好，像熟练的真人主播在控场。'],
      weight: 1,
      scope: 'session',
      skipProactive: false,
    }),
  ],
};

export function cloneRubric(r: Rubric): Rubric {
  return structuredClone(r);
}
