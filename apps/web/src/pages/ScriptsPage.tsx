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
import { api, type Script } from '../api.ts';
import { card, emptyState, input, listItem, primaryBtn, secondaryBtn } from '../ui.ts';
import { usePersistentState } from '../usePersistentState.ts';

const MAX_FILE_BYTES = 1_000_000;
const PREVIEW_ROWS = 200;

const EXAMPLE = [
  '# 每行一条弹幕：[时间] 昵称：内容',
  '# 时间可写 0:05、1:02:03、12s（相对开播），或 +2（距上一行 2 秒）',
  '# 不写时间就按「默认间隔」接在上一行后面；# 开头的行是注释',
  '0:00 卡文：主播晚上好',
  '0:03 奶茶不加糖：今天播多久呀',
  '+1 卡文：你是不是机器人',
  '0:20 新来的：第一次来，这是在干嘛',
  '0:21 奶茶不加糖：送你一个小心心',
  '1:30 卡文：人呢',
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
    if (file.size > MAX_FILE_BYTES) {
      setFileError('文件超过 1MB');
      return;
    }
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
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-medium">编辑剧本</h2>
          {dirty && <span className="text-xs text-amber-600">有未保存的修改</span>}
          <label className={`${secondaryBtn} cursor-pointer`}>
            上传文件
            <input
              type="file"
              accept=".txt,.md,.script"
              className="hidden"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
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
            <input
              className={input}
              type="number"
              min={0}
              max={3600}
              step={0.5}
              value={gap}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (e.target.value !== '' && Number.isFinite(n) && n >= 0 && n <= 3600) setGap(n);
              }}
            />
          </label>
        </div>
        <textarea
          aria-label="剧本内容"
          className={`${input} min-h-[50vh] font-mono leading-relaxed`}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={EXAMPLE}
          spellCheck={false}
        />
        {!content.trim() && (
          <button type="button" className={secondaryBtn} onClick={() => setContent(EXAMPLE)}>
            填入示例
          </button>
        )}
        {fileError && <p className="text-xs text-red-600">{fileError}</p>}
        {save.error && <p className="text-xs text-red-600">{save.error.message}</p>}
        {remove.error && <p className="text-xs text-red-600">{remove.error.message}</p>}
      </section>

      <section className={`${card} space-y-3`}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">解析预览</h2>
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
              <li key={`${i.line}-${i.message}`}>
                第 {i.line} 行：{i.message}
              </li>
            ))}
          </ul>
        )}
        {stats.speakers.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {stats.speakers.map((s) => (
              <span key={s.name} className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                {s.name} × {s.count}
              </span>
            ))}
          </div>
        )}
        <div className="max-h-[60vh] overflow-auto">
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
              <SortableContext
                items={previewEvents.map((e) => String(e.line))}
                strategy={verticalListSortingStrategy}
              >
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
      </section>
    </div>
  );
}

export function ScriptsPage() {
  const queryClient = useQueryClient();
  const scripts = useQuery({ queryKey: ['scripts'], queryFn: api.scripts });
  const [selected, setSelected] = usePersistentState<string | null>('lce.selectedScript', null);

  const create = useMutation({
    mutationFn: (names: string[]) => api.createScript({ name: nextName(names), content: '', defaultGapSec: DEFAULT_SCRIPT_GAP_SEC }),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ['scripts'] });
      setSelected(s.id);
    },
  });

  const active = scripts.data?.find((s) => s.id === selected) ?? scripts.data?.[0] ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside className={`${card} space-y-2 self-start`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">弹幕剧本</h2>
          <button type="button" className={secondaryBtn} disabled={create.isPending} onClick={() => create.mutate(scripts.data?.map((s) => s.name) ?? [])}>
            新增
          </button>
        </div>
        {create.error && <p className="text-xs text-red-600">{create.error.message}</p>}
        {scripts.isPending && <p className="text-sm text-neutral-500">加载中…</p>}
        {scripts.error && <p className="text-sm text-red-600">{scripts.error.message}</p>}
        {scripts.data?.length === 0 && <p className="text-sm text-neutral-500">剧本是一组按时间排好的多人弹幕，用来在「直播间」里回放给主播。</p>}
        <ul className="space-y-1">
          {scripts.data?.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setSelected(s.id)} className={listItem(s.id === active?.id)}>
                <span>{s.name}</span>
                <span className="ml-2 text-xs text-neutral-500">
                  {s.eventCount} 条 · {formatOffset(s.durationMs)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main>
        {active ? (
          <ScriptEditor key={active.id} script={active} onDeleted={() => setSelected(null)} />
        ) : (
          <div className={emptyState}>新增一个剧本，写好多人弹幕后就能去「直播间」回放</div>
        )}
      </main>
    </div>
  );
}
