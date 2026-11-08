import type { ChatMessage } from '../providers/types.ts';
import type { Danmaku } from './strategy.ts';

export const DEFAULT_REPLY_RULES =
  '你正在直播。用户消息里每一行是一条观众弹幕，格式为「昵称：内容」，一次可能有多条。像真人主播一样用口语自然地回应，可以只挑重点回应，不要复述这个格式。';

export const DEFAULT_PROACTIVE_PROMPT = '直播间暂时没有新弹幕，请主动找个话题和观众聊几句。';

export const DEFAULT_CONTEXT_TURNS = 10;

export interface AnchorPromptConfig {
  anchorName: string;
  personaPrompt: string;
  replyRules: string;
  proactivePrompt: string;
  contextTurns: number;
}

export type TurnInput = { kind: 'danmaku'; danmaku: Pick<Danmaku, 'speaker' | 'text'>[] } | { kind: 'proactive' };

export interface AnchorExchange {
  input: TurnInput;
  reply: string;
}

export function buildSystemPrompt(cfg: Pick<AnchorPromptConfig, 'anchorName' | 'personaPrompt' | 'replyRules'>): string {
  const persona = cfg.personaPrompt.trim() || `你是直播间主播「${cfg.anchorName}」。`;
  return [persona, cfg.replyRules.trim()].filter(Boolean).join('\n\n');
}

export function formatTurnInput(input: TurnInput, proactivePrompt: string): string {
  if (input.kind === 'proactive') return `[系统] ${proactivePrompt.trim() || DEFAULT_PROACTIVE_PROMPT}`;
  return input.danmaku.map((d) => `${d.speaker}：${d.text}`).join('\n');
}

export function buildAnchorMessages(cfg: AnchorPromptConfig, history: readonly AnchorExchange[], input: TurnInput): ChatMessage[] {
  const recent = cfg.contextTurns > 0 ? history.slice(-cfg.contextTurns) : [];
  const messages: ChatMessage[] = [{ role: 'system', content: buildSystemPrompt(cfg) }];
  for (const turn of recent) {
    messages.push({ role: 'user', content: formatTurnInput(turn.input, cfg.proactivePrompt) });
    messages.push({ role: 'assistant', content: turn.reply });
  }
  messages.push({ role: 'user', content: formatTurnInput(input, cfg.proactivePrompt) });
  return messages;
}
