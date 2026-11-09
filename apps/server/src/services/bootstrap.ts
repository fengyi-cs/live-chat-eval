import { DEFAULT_RUBRIC } from '@lce/core';
import { count, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { anchorConfigs, anchors, rubrics, scripts } from '../db/schema.ts';
import { randomUUID } from 'node:crypto';

const PRESET_ANCHOR_NAME = '小鹿';
const PRESET_ANCHOR_PERSONA = '你是一位活泼开朗的虚拟主播，名字叫小鹿。说话风格轻松幽默，喜欢用语气词，偶尔自嘲，对观众很热情。回答简短自然，像在直播间随口聊天，不会长篇大论或列要点。';

const PRESET_SCRIPT_NAME = '示例剧本';
const PRESET_SCRIPT_CONTENT = [
  '0:00 卡文：主播晚上好呀',
  '+3 奶茶不加糖：今天播多久呀',
  '+2 卡文：你是真人吗？',
  '+5 围观群众：哈哈哈这个问题好',
  '+2 奶茶不加糖：主播声音好好听',
].join('\n');

const PRESET_CONFIG_NAME = '默认配置';
const PRESET_RUBRIC_NAME = '默认评分';

export function bootstrapDefaults(db: Db) {
  seedRubric(db);
  seedAnchor(db);
  seedConfig(db);
  seedScript(db);
}

function seedRubric(db: Db) {
  const n = db.select({ n: count() }).from(rubrics).get()?.n ?? 0;
  if (n > 0) return;
  db.insert(rubrics).values({ id: randomUUID(), name: PRESET_RUBRIC_NAME, rubric: DEFAULT_RUBRIC }).run();
}

function seedAnchor(db: Db) {
  const existing = db.select({ name: anchors.name }).from(anchors).where(eq(anchors.name, PRESET_ANCHOR_NAME)).get();
  if (existing) return;
  db.insert(anchors).values({
    name: PRESET_ANCHOR_NAME,
    code: null,
    source: 'manual',
    personaPrompt: PRESET_ANCHOR_PERSONA,
  }).run();
}

function seedConfig(db: Db) {
  const n = db.select({ n: count() }).from(anchorConfigs).get()?.n ?? 0;
  if (n > 0) return;
  db.insert(anchorConfigs).values({
    id: randomUUID(),
    name: PRESET_CONFIG_NAME,
    providerId: null,
    model: null,
    temperature: null,
    maxTokens: null,
    contextTurns: 10,
    replyRules: '你正在直播。用户消息里每一行是一条观众弹幕，格式为「昵称：内容」，一次可能有多条。像真人主播一样用口语自然地回应，可以只挑重点回应，不要复述这个格式。',
    proactivePrompt: '直播间暂时没有新弹幕，请主动找个话题和观众聊几句。',
    strategy: {
      kind: 'window',
      mergeWindowSec: 3,
      maxBatch: 3,
      minGapSec: 2,
      idleProactiveSec: 60,
      weights: { question: 2, mention: 3, gift: 5, newViewer: 1 },
      llmSelect: false,
    },
  }).run();
}

function seedScript(db: Db) {
  const existing = db.select({ name: scripts.name }).from(scripts).where(eq(scripts.name, PRESET_SCRIPT_NAME)).get();
  if (existing) return;
  db.insert(scripts).values({
    id: randomUUID(),
    name: PRESET_SCRIPT_NAME,
    content: PRESET_SCRIPT_CONTENT,
    defaultGapSec: 3,
  }).run();
}
