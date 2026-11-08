export type SimMode = 'live' | 'script';

export type Pace = { kind: 'speed'; speed: number } | { kind: 'instant' } | { kind: 'step' };

export type SimRole = 'viewer' | 'anchor';

export interface SimMessage {
  seq: number;
  /** 相对开播的毫秒数 */
  at: number;
  role: SimRole;
  speaker: string;
  text: string;
  repliesTo: number[] | null;
  proactive: boolean | null;
  /** 主播回复完成时间 - 最早一条被回应弹幕的到达时间 */
  latencyMs: number | null;
  firstTokenMs: number | null;
  genTotalMs: number | null;
}

export type SimEndReason = 'finished' | 'stopped' | 'error';

export type SimEvent =
  | { type: 'danmaku'; message: SimMessage }
  | { type: 'thinking'; at: number; replyTo: number[]; skipped: number[]; proactive: boolean }
  | { type: 'delta'; text: string }
  | { type: 'reply'; message: SimMessage }
  | { type: 'waiting'; at: number; until: number | null }
  | { type: 'clock'; at: number }
  | { type: 'warning'; at: number; message: string }
  | { type: 'end'; at: number; reason: SimEndReason; error: string | null; unanswered: number[] };
