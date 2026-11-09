import type { SimMode } from '@lce/core';
import { useQuery } from '@tanstack/react-query';
import { formatOffset } from '@lce/core';
import { ChevronDownIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { api, type Anchor, type RunInfo } from '../../api.ts';
import { usePersistentState } from '../../usePersistentState.ts';
import { END_LABELS, type RoomState } from './roomReducer.ts';

interface Props {
  room: RoomState;
  anchorName: string | null;
  onAnchorChange: (name: string) => void;
  onModeChange: (mode: SimMode) => void;
  onOpenAnchors: () => void;
}

export function RoomTopBar({ room, anchorName, onAnchorChange, onModeChange, onOpenAnchors }: Props) {
  const anchors = useQuery({ queryKey: ['anchors'], queryFn: api.anchors });
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const info: RunInfo | null = room.info;
  const running = !room.ended;
  const elapsed = info?.mode === 'live' && info.startedAt ? Math.max(0, Date.now() - Date.parse(info.startedAt)) : room.now;
  const currentAnchor = anchors.data?.find((a) => a.name === anchorName) ?? null;
  const anchorInitial = [...(anchorName ?? '?')].find((c) => /\S/.test(c)) ?? '?';

  return (
    <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
      <div className="relative">
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={() => setDropdownOpen((v) => !v)}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-200 text-sm font-semibold text-sky-800 dark:bg-sky-800 dark:text-sky-200">
            {anchorInitial}
          </span>
          <span className="text-sm font-medium">{anchorName ?? '未选择'}</span>
          <ChevronDownIcon className="size-4 text-neutral-400" />
        </button>

        {dropdownOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setDropdownOpen(false)} />
            <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
              {anchors.data?.length === 0 && (
                <p className="px-3 py-2 text-sm text-neutral-500">还没有主播</p>
              )}
              {anchors.data?.map((a: Anchor) => (
                <button
                  key={a.name}
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                    a.name === anchorName ? 'bg-neutral-100 font-medium dark:bg-neutral-800' : ''
                  }`}
                  onClick={() => {
                    onAnchorChange(a.name);
                    setDropdownOpen(false);
                  }}
                >
                  <span className="flex size-6 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold dark:bg-neutral-700">
                    {[...a.name].find((c) => /\S/.test(c)) ?? '?'}
                  </span>
                  {a.name}
                  <span className="ml-auto text-xs text-neutral-400">{a.sessionCount}场</span>
                </button>
              ))}
              <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-sky-600 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                onClick={() => {
                  setDropdownOpen(false);
                  onOpenAnchors();
                }}
              >
                <PlusIcon className="size-4" />
                新建主播
              </button>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-neutral-500">
        {info && (
          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium ${
            running
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300'
              : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
          }`}>
            {running && <span className="live-dot size-1.5 rounded-full bg-emerald-500" />}
            {running ? '直播中' : room.ended ? END_LABELS[room.ended.reason] : '空闲'}
          </span>
        )}
        {info && <span>{formatOffset(elapsed)}{info.scriptDurationMs !== null && ` / ${formatOffset(info.scriptDurationMs)}`}</span>}
        {room.generating && <span>主播回复中…</span>}
        {room.waitingStep && <span>等待下一步</span>}
        {room.skipped.size > 0 && <span>跳过 {room.skipped.size} 条</span>}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <div className="flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
          {(['live', 'script'] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={!info}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                info?.mode === m
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
              }`}
              onClick={() => onModeChange(m)}
            >
              {m === 'live' ? '实时对话' : '剧本回放'}
            </button>
          ))}
        </div>
      </div>

      {room.warnings.length > 0 && (
        <div className="absolute left-0 right-0 top-full bg-amber-50 px-3 py-1 text-xs text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
          {room.warnings[room.warnings.length - 1]}
        </div>
      )}
    </div>
  );
}

export { usePersistentState };
