export const DEFAULT_SCRIPT_GAP_SEC = 3;
export const MAX_SCRIPT_EVENTS = 5000;

export interface ScriptEvent {
  /** 相对开播的毫秒数 */
  at: number;
  speaker: string;
  text: string;
  line: number;
}

export interface ScriptIssue {
  line: number;
  message: string;
}

export interface ParsedScript {
  events: ScriptEvent[];
  issues: ScriptIssue[];
}

const RELATIVE_RE = /^\+(\d+(?:\.\d+)?)\s*s?\s+/;
const CLOCK_RE = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\s+/;
const SECONDS_RE = /^(\d+(?:\.\d+)?)s\s+/;
const SPEAKER_RE = /^(.{1,100}?)\s*[：:]\s*(.+)$/;

type TimePrefix = { kind: 'relative' | 'absolute'; ms: number; rest: string } | { kind: 'error'; message: string } | null;

function parseTimePrefix(line: string): TimePrefix {
  let m = RELATIVE_RE.exec(line);
  if (m) return { kind: 'relative', ms: Number(m[1]) * 1000, rest: line.slice(m[0].length) };
  m = CLOCK_RE.exec(line);
  if (m) {
    const [, h, mi, s, frac] = m;
    if (Number(s) >= 60 || (h !== undefined && Number(mi) >= 60)) return { kind: 'error', message: `时间「${m[0].trim()}」不合法` };
    const ms = ((Number(h ?? 0) * 60 + Number(mi)) * 60 + Number(s)) * 1000 + Number((frac ?? '').padEnd(3, '0'));
    return { kind: 'absolute', ms, rest: line.slice(m[0].length) };
  }
  m = SECONDS_RE.exec(line);
  if (m) return { kind: 'absolute', ms: Number(m[1]) * 1000, rest: line.slice(m[0].length) };
  return null;
}

/**
 * 解析弹幕剧本。每行一条：[时间] 昵称：内容
 * - 时间可写 0:05 / 1:02:03 / 12s（相对开播），或 +2（距上一行 2 秒）；
 * - 不写时间则距上一行 defaultGapSec 秒，第一行默认 0 秒；
 * - # 开头的行和空行忽略。最后按时间稳定排序。
 */
export function parseScript(source: string, defaultGapSec = DEFAULT_SCRIPT_GAP_SEC): ParsedScript {
  const events: ScriptEvent[] = [];
  const issues: ScriptIssue[] = [];
  let prev: number | null = null;

  source.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const lineNo = i + 1;
    if (!line || line.startsWith('#')) return;
    const time = parseTimePrefix(line);
    if (time?.kind === 'error') {
      issues.push({ line: lineNo, message: time.message });
      return;
    }
    const body = time ? time.rest : line;
    const m = SPEAKER_RE.exec(body);
    if (!m) {
      issues.push({ line: lineNo, message: '需要「昵称：内容」格式' });
      return;
    }
    let at: number;
    if (time?.kind === 'absolute') at = time.ms;
    else if (time?.kind === 'relative') at = (prev ?? 0) + time.ms;
    else at = prev === null ? 0 : prev + defaultGapSec * 1000;
    at = Math.round(at);
    prev = at;
    events.push({ at, speaker: m[1]!.trim(), text: m[2]!.trim(), line: lineNo });
  });

  if (events.length > MAX_SCRIPT_EVENTS) issues.push({ line: events[MAX_SCRIPT_EVENTS]!.line, message: `最多 ${MAX_SCRIPT_EVENTS} 条弹幕` });
  events.sort((a, b) => a.at - b.at);
  return { events, issues };
}

export interface ScriptStats {
  eventCount: number;
  durationMs: number;
  speakers: { name: string; count: number }[];
}

export function scriptStats(events: readonly ScriptEvent[]): ScriptStats {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.speaker, (counts.get(e.speaker) ?? 0) + 1);
  return {
    eventCount: events.length,
    durationMs: events.at(-1)?.at ?? 0,
    speakers: [...counts].map(([name, count]) => ({ name, count })),
  };
}

export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
