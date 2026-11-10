import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatOffset } from '@lce/core';
import { ChevronDownIcon, PlusIcon, ZapIcon } from 'lucide-react';
import { useState } from 'react';
import { api, type Anchor, type RunInfo } from '../../api.ts';
import { ModelPicker } from '../../components/ModelPicker.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.tsx';
import { usePersistentState } from '../../usePersistentState.ts';
import { END_LABELS, type RoomState } from './roomReducer.ts';

interface Props {
  room: RoomState;
  anchorName: string | null;
  configName: string | null;
  configId?: string | null;
  onAnchorChange: (name: string) => void;
  onOpenAnchors: () => void;
  onOpenConfig?: () => void;
}

/** 内联模型切换按鈕：显示当前配置的模型，单击弹出切换面板 */
function ModelChip({ configId, onOpenConfig }: { configId?: string | null; onOpenConfig?: () => void }) {
  const qc = useQueryClient();
  const configs = useQuery({ queryKey: ['allConfigs'], queryFn: api.allConfigs });
  const [open, setOpen] = useState(false);
  const config = configs.data?.find((c) => c.id === configId) ?? null;

  const update = useMutation({
    mutationFn: (v: { providerId: string | null; model: string | null }) =>
      api.updateConfig(config!.id, { providerId: v.providerId, model: v.model }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['allConfigs'] }); setOpen(false); },
  });

  if (!config) return null;
  const modelLabel = config.model ?? '未配置模型';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="切换模型"
          className={`hidden items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors sm:flex ${
            config.modelAvailable
              ? 'border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/60'
              : 'border-amber-200 text-amber-600 dark:border-amber-700 dark:text-amber-400'
          }`}
        >
          <ZapIcon className="size-3 shrink-0" />
          <span className="max-w-32 truncate">{modelLabel}</span>
          <ChevronDownIcon className="size-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2" side="bottom">
        <p className="mb-2 text-xs font-medium text-neutral-500">切换模型（配置「{config.name}」）</p>
        <ModelPicker
          value={{ providerId: config.providerId, model: config.model }}
          onChange={(v) => update.mutate(v)}
        />
        {onOpenConfig && (
          <button
            type="button"
            className="mt-2 w-full rounded text-left text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
            onClick={() => { setOpen(false); onOpenConfig(); }}
          >
            高级回复配置 →
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function RoomTopBar({ room, anchorName, configName, configId, onAnchorChange, onOpenAnchors, onOpenConfig }: Props) {
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-indigo-600 hover:bg-neutral-100 dark:hover:bg-neutral-800"
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
        <ModelChip configId={configId} onOpenConfig={onOpenConfig} />
        {!configId && configName && (
          <span className="hidden rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-500 sm:inline dark:border-neutral-800">
            {configName}
          </span>
        )}
        {info && (
          <span className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
            {info.mode === 'live' ? '实时对话' : '剧本回放'}
          </span>
        )}
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
