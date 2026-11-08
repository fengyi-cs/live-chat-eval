import type { ParsedTranscript, RawMessage, SpeakerStat, TranscriptMeta } from '../domain/types.ts';

const TITLE_RE = /^#\s+(.+?)\s*聊天记录\s*$/;
const META_RE = /^-\s*(.+?)\s*[：:]\s*(.*)$/;
const HEADER_RE = /^###\s+(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*[｜|]\s*(.+?)\s*$/;
const ANCHOR_RE = /^(.+?)\s*[（(]\s*([^）)]+?)\s*[）)]\s*$/;
const ACTION_PREFIX_RE = /^[（(]动作[）)]\s*/;

export class TranscriptParseError extends Error {}

const pad = (n: string) => n.padStart(2, '0');

export function normalizeTime(raw: string): string | undefined {
  const m = raw.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m as unknown as string[];
  return `${y}-${pad(mo!)}-${pad(d!)}T${pad(h!)}:${mi}:${s}`;
}

export function timeToMs(iso: string): number {
  return Date.parse(`${iso}Z`);
}

export function isActionText(text: string): boolean {
  return ACTION_PREFIX_RE.test(text);
}

export function stripActionPrefix(text: string): string {
  return text.replace(ACTION_PREFIX_RE, '').trim();
}

function parseMeta(key: string, value: string, meta: TranscriptMeta): void {
  const k = key.replace(/\s+/g, '');
  if (k === '场次ID') meta.externalId = value || undefined;
  else if (k === '主播') {
    const m = value.match(ANCHOR_RE);
    if (m) {
      meta.anchorName = m[1];
      meta.anchorCode = m[2];
    } else if (value) meta.anchorName = value;
  } else if (k === '开始时间') meta.startedAt = normalizeTime(value);
  else if (k === '结束时间') meta.endedAt = normalizeTime(value);
}

export function parseMarkdownTranscript(source: string): ParsedTranscript {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  const meta: TranscriptMeta = {};
  const messages: RawMessage[] = [];
  let title: string | undefined;
  let current: { time: string; speaker: string; body: string[] } | undefined;

  const flush = () => {
    if (!current) return;
    const text = current.body.join('\n').trim();
    messages.push({
      seq: messages.length,
      time: current.time,
      ts: timeToMs(current.time),
      speaker: current.speaker,
      text,
    });
    current = undefined;
  };

  for (const line of lines) {
    const header = line.match(HEADER_RE);
    if (header) {
      flush();
      const [, y, mo, d, h, mi, s, speaker] = header as unknown as string[];
      current = { time: `${y}-${pad(mo!)}-${pad(d!)}T${pad(h!)}:${mi}:${s}`, speaker: speaker!, body: [] };
      continue;
    }
    const isSectionHeading = /^##?\s/.test(line);
    if (current && !isSectionHeading) {
      current.body.push(line);
      continue;
    }
    flush();
    if (!title) {
      const t = line.match(TITLE_RE);
      if (t) {
        title = t[1];
        continue;
      }
    }
    const m = line.match(META_RE);
    if (m && messages.length === 0) parseMeta(m[1]!, m[2]!.trim(), meta);
  }
  flush();

  if (messages.length === 0) {
    throw new TranscriptParseError('没有找到任何消息：需要形如 "### 2026/10/27 17:54:11｜发言人" 的标题行');
  }
  if (!meta.anchorName && title) meta.anchorName = title;

  const counts = new Map<string, number>();
  for (const msg of messages) counts.set(msg.speaker, (counts.get(msg.speaker) ?? 0) + 1);
  const speakers: SpeakerStat[] = [...counts].map(([name, count]) => ({ name, count }));

  return { title, meta, messages, speakers };
}
