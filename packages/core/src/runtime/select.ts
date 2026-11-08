import type { Danmaku } from '../anchor/strategy.ts';
import type { ChatMessage } from '../providers/types.ts';

export function buildSelectionMessages(anchorName: string, candidates: readonly Pick<Danmaku, 'speaker' | 'text'>[], limit: number): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你在帮直播间主播「${anchorName}」挑选接下来要回应的弹幕。从编号列表里选出最值得回应的弹幕，最多 ${limit} 条。只输出编号，用英文逗号分隔，例如：2,5。不要输出其他内容。`,
    },
    { role: 'user', content: candidates.map((c, i) => `${i + 1}. ${c.speaker}：${c.text}`).join('\n') },
  ];
}

/** 解析模型返回的编号，返回从 0 开始的下标；没有合法编号时返回 null */
export function parseSelection(output: string, candidateCount: number, limit: number): number[] | null {
  const picked: number[] = [];
  for (const m of output.matchAll(/\d+/g)) {
    const idx = Number(m[0]) - 1;
    if (idx >= 0 && idx < candidateCount && !picked.includes(idx)) picked.push(idx);
    if (picked.length >= limit) break;
  }
  return picked.length ? picked : null;
}
