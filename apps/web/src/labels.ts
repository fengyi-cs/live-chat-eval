import type { Pace } from '@lce/core';
import type { SessionSource, SessionStatus } from './api.ts';

export const SOURCE_LABELS: Record<SessionSource, string> = { import: '导入', live: '单人实时', script: '弹幕剧本' };

export const STATUS_LABELS: Record<SessionStatus, string> = { done: '已结束', running: '进行中', stopped: '已停止', error: '出错' };

export const STATUS_TONE: Record<SessionStatus, string> = {
  done: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
  running: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200',
  stopped: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200',
  error: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
};

export const PACE_OPTIONS = [
  { key: '1', label: '实时 1x', pace: { kind: 'speed', speed: 1 } },
  { key: '2', label: '2x', pace: { kind: 'speed', speed: 2 } },
  { key: '5', label: '5x', pace: { kind: 'speed', speed: 5 } },
  { key: '10', label: '10x', pace: { kind: 'speed', speed: 10 } },
  { key: 'instant', label: '跳过等待', pace: { kind: 'instant' } },
  { key: 'step', label: '单步', pace: { kind: 'step' } },
] as const satisfies readonly { key: string; label: string; pace: Pace }[];

export type PaceKey = (typeof PACE_OPTIONS)[number]['key'];

export function paceKeyOf(pace: Pace | null): PaceKey {
  if (!pace || pace.kind === 'speed') return (PACE_OPTIONS.find((o) => o.pace.kind === 'speed' && o.pace.speed === pace?.speed)?.key ?? '1') as PaceKey;
  return pace.kind;
}

export function paceOf(key: PaceKey): Pace {
  return PACE_OPTIONS.find((o) => o.key === key)!.pace;
}

export const formatLatency = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
