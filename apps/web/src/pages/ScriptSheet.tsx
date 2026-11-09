import { DEFAULT_SCRIPT_GAP_SEC, formatOffset, parseScript, scriptStats, type ScriptEvent } from '@lce/core';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVerticalIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, type Script, type RunInfo, type StartSim } from '../api.ts';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet.tsx';
import { card, input, listItem, primaryBtn, secondaryBtn } from '../ui.ts';
import { usePersistentState } from '../usePersistentState.ts';
import { paceOf, type PaceKey } from '../labels.ts';

const MAX_FILE_BYTES = 1_000_000;
const PREVIEW_ROWS = 200;

const EXAMPLE = [
  '# 每行一条弹幕：[时间] 昵称：内容',
  '# 时间可写 0:05、1:02:03、12s，或 +2（距上一行 2 秒）',
  '0:00 卡文：主播晚上好',
  '+3 奶茶不加糖：今天播多久呀',
  '+1 卡文：你是不是机器人',
].join('\n');

function nextName(existing: readonly string[]) {
  const taken = new Set(existing);
  let i = existing.length + 1;
  while (taken.has(`剧本 ${i}`)) i++;
  return `剧本 ${i}`;
}

function eventsToContent(events: ScriptEvent[]): string {
  return events.map((e) => `${formatOffset(e.at)} ${e.speaker}：${e.text}`).join('\n');
}

interface SortableRowProps {
  id: string;
  event: ScriptEvent;
}

function SortableRow({ id, event }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border-t border-neutral-100 align-top dark:border-neutral-800 ${isDragging ? 'opacity-50 bg-sky-50 dark:bg-sky-950/30' : ''}`}
    >
      <td className="py-1 pr-1 w-5">
        <button
          type="button"
          className="cursor-grab touch-none text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-400 active:cursor-grabbing"
          aria-label="拖拽排序"
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon className="size-3.5" />
        </button>
      </td>
      <td className="py-1 pr-2 font-mono text-xs text-neutral-500">{formatOffset(event.at)}</td>
      <td className="py-1 pr-2 whitespace-nowrap">{event.speaker}</td>
      <td className="py-1 break-all">{event.text}</td>
    </tr>
  );
}

function ScriptEditor({ script, onDeleted }: { script: Script; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(script.name);
  const [gap, setGap] = useState(script.defaultGapSec);
  const [content, setContent] = useState(script.content);
  const [fileError, setFileError] = useState<string | null>(null);

  const parsed = useMemo(() => parseScript(content, gap), [content, gap]);
  const stats = useMemo(() => scriptStats(parsed.events), [parsed]);
  const dirty = name !== script.name || gap !== script.defaultGapSec || content !== script.content;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const save = useMutation({
    mutationFn: () => api.updateScript(script.id, { name: name.trim(), defaultGapSec: gap, content }),
    onSuccess: (saved) => {
      setName(saved.name);
      setGap(saved.defaultGapSec);
      setContent(saved.content);
      queryClient.invalidateQueries({ queryKey: ['scripts'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteScript(script.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scripts'] });
      onDeleted();
    },
  });

  const onFile = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setFileError('文件超过 1MB'); return; }
    const text = await file.text();
    if (content.trim() && !confirm(`用「${file.name}」的内容替换当前剧本？`)) return;
    setContent(text);
  };

  function handleDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    if (!over || active.id === over.id || parsed.issues.length > 0) return;
    const events = parsed.events.slice(0, PREVIEW_ROWS);
    const oldIndex = events.findIndex((e) => String(e.line) === active.id);
    const newIndex = events.findIndex((e) => String(e.line) === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(parsed.events, oldIndex, newIndex);
    setContent(eventsToContent(reordered));
  }

  const previewEvents = parsed.events.slice(0, PREVIEW_ROWS);

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-sm font-medium">编辑剧本</h3>
          {dirty && <span className="text-xs text-amber-600">有未保存的修改</span>}
          <label className={`${secondaryBtn} cursor-pointer`}>
            上传文件
            <input type="file" accept=".txt,.md,.script" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <button type="button" className={primaryBtn} disabled={!dirty || !name.trim() || parsed.issues.length > 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? '保存中…' : '保存'}
          </button>
          <button type="button" className={`${secondaryBtn} text-red-600`} onClick={() => confirm(`删除剧本「${script.name}」？`) && remove.mutate()}>
            删除
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <label className="block space-y-1">
            <span className="text-xs text-neutral-500">名称</span>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-neutral-500">默认间隔（秒）</span>
            <input className={input} type="number" min={0} max={3600} step={0.5} value={gap}
              onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n) && n >= 0 && n <= 3600) setGap(n); }} />
          </label>
        </div>
        <textarea
          aria-label="剧本内容"
          className={`${input} min-h-[45vh] font-mono leading-relaxed`}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={EXAMPLE}
          spellCheck={false}
        />
        {!content.trim() && (
          <button type="button" className={secondaryBtn} onClick={() => setContent(EXAMPLE)}>填入示例</button>
        )}
        {fileError && <p className="text-xs text-red-600">{fileError}</p>}
        {save.error && <p className="text-xs text-red-600">{save.error.message}</p>}
        {remove.error && <p className="text-xs text-red-600">{remove.error.message}</p>}
      </div>

      <div className={`${card} space-y-2`}>
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium">解析预览</h3>
          {parsed.issues.length === 0 && previewEvents.length > 0 && (
            <span className="text-xs text-neutral-400">可拖拽行调整顺序</span>
          )}
        </div>
        <p className="text-xs text-neutral-500">
          {stats.eventCount} 条弹幕 · {stats.speakers.length} 位观众 · 时长 {formatOffset(stats.durationMs)}
        </p>
        {parsed.issues.length > 0 && (
          <ul className="space-y-1 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {parsed.issues.map((i) => (
              <li key={`${i.line}-${i.message}`}>第 {i.line} 行：{i.message}</li>
            ))}
          </ul>
        )}
        <div className="max-h-[40vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="w-5 py-1 font-normal" />
                <th className="py-1 pr-2 font-normal">时间</th>
                <th className="py-1 pr-2 font-normal">昵称</th>
                <th className="py-1 font-normal">内容</th>
              </tr>
            </thead>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={previewEvents.map((e) => String(e.line))} strategy={verticalListSortingStrategy}>
                <tbody>
                  {previewEvents.map((e) => (
                    <SortableRow key={e.line} id={String(e.line)} event={e} />
                  ))}
                </tbody>
              </SortableContext>
            </DndContext>
          </table>
          {parsed.events.length > PREVIEW_ROWS && <p className="mt-1 text-xs text-neutral-500">只显示前 {PREVIEW_ROWS} 条</p>}
        </div>
      </div>
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  anchorName: string | null;
  configId: string | null;
  paceKey: PaceKey;
  onStartScript: (info: RunInfo) => void;
}

export function ScriptSheet({ open, onOpenChange, anchorName, configId, paceKey, onStartScript }: Props) {
  const queryClient = useQueryClient();
  const scripts = useQuery({ queryKey: ['scripts'], queryFn: api.scripts });
  const [selected, setSelected] = usePersistentState<string | null>('lce.room.script', null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (names: string[]) => api.createScript({ name: nextName(names), content: '', defaultGapSec: DEFAULT_SCRIPT_GAP_SEC }),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ['scripts'] });
      setEditingId(s.id);
    },
  });

  const startScript = useMutation({
    mutationFn: (scriptId: string) => {
      if (!anchorName || !configId) throw new Error('请先选择主播和回复配置');
      return api.startSim({ mode: 'script', anchorName, configId, scriptId, pace: paceOf(paceKey) } as StartSim);
    },
    onSuccess: (info) => {
      queryClient.invalidateQueries({ queryKey: ['sims'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onStartScript(info);
    },
  });

  const editingScript = scripts.data?.find((s) => s.id === editingId) ?? null;
  const list = scripts.data ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>弹幕剧本</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          {!editingScript ? (
            <>
              <div className="flex gap-2">
                <button type="button" className={secondaryBtn} disabled={create.isPending}
                  onClick={() => create.mutate(list.map((s) => s.name))}>
                  + 新建剧本
                </button>
              </div>
              {create.error && <p className="text-xs text-red-600">{create.error.message}</p>}
              {scripts.isPending && <p className="text-sm text-neutral-500">加载中…</p>}
              {list.length === 0 && !scripts.isPending && (
                <p className="text-sm text-neutral-500">还没有剧本，新建一个吧。</p>
              )}
              <ul className="space-y-2">
                {list.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-neutral-500">
                        {s.eventCount} 条 · {formatOffset(s.durationMs)}
                        {s.issueCount > 0 && <span className="ml-1 text-red-600">{s.issueCount} 个格式错误</span>}
                      </p>
                    </div>
                    <button type="button" className={secondaryBtn} onClick={() => setEditingId(s.id)}>编辑</button>
                    <button
                      type="button"
                      className={primaryBtn}
                      disabled={s.eventCount === 0 || s.issueCount > 0 || startScript.isPending || !anchorName || !configId}
                      onClick={() => startScript.mutate(s.id)}
                    >
                      {startScript.isPending ? '加载中…' : '▶ 加载'}
                    </button>
                  </li>
                ))}
              </ul>
              {startScript.error && <p className="text-xs text-red-600">{startScript.error.message}</p>}
              {(!anchorName || !configId) && (
                <p className="text-xs text-amber-600">请先在主播管理和回复配置中完成设置，才能加载剧本。</p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <button type="button" className={secondaryBtn} onClick={() => setEditingId(null)}>← 返回列表</button>
                <span className="text-sm text-neutral-500 truncate">{editingScript.name}</span>
              </div>
              <ScriptEditor key={editingScript.id} script={editingScript} onDeleted={() => setEditingId(null)} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
