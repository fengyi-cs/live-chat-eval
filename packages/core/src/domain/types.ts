export type SpeakerRole = 'anchor' | 'viewer' | 'action' | 'ignore';

export const SPEAKER_ROLES: readonly SpeakerRole[] = ['anchor', 'viewer', 'action', 'ignore'];

export interface TranscriptMeta {
  externalId?: string;
  anchorName?: string;
  anchorCode?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface RawMessage {
  seq: number;
  time: string;
  /** time 按 UTC 解释得到的毫秒数，只用于计算时间差 */
  ts: number;
  speaker: string;
  text: string;
}

export interface SpeakerStat {
  name: string;
  count: number;
}

export interface ParsedTranscript {
  title?: string;
  meta: TranscriptMeta;
  messages: RawMessage[];
  speakers: SpeakerStat[];
}

export type RoleMap = Record<string, SpeakerRole>;

export interface ActionEvent {
  seq: number;
  time: string;
  text: string;
}

export interface AnchorTurn {
  seq: number;
  repliesTo: number[];
  proactive: boolean;
  /** 主播发言时间 - 最早一条关联弹幕时间；主动发言为 null */
  latencyMs: number | null;
  actions: ActionEvent[];
}

export interface PairingResult {
  turns: AnchorTurn[];
  unanswered: number[];
  orphanActions: ActionEvent[];
}
