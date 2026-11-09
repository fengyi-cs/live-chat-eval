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
import { GripVerticalIcon, ListIcon, TextIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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

interface VisualRow {
  id: string;
  speaker: string;
  text: string;
  delayFromPrev: number;
}

function eventsToVisualRows(events: ScriptEvent[]): VisualRow[] {
  return events.map((e, i) => ({
    id: String(i),
    speaker: e.speaker,
    text: e.text,
    delayFromPrev:
      i === 0
        ? e.at / 1000
        : Math.round(((e.at - events[i - 1]!.at) / 1000) * 10) / 10,
  }));
}

function rowsToText(rows: VisualRow[]): string {
  if (rows.length === 0) return '';
  return rows
    .map((r, i) => {
      let timeStr: string;
      if (i === 0) {
        const totalSec = Math.max(0, r.delayFromPrev);
        const minutes = Math.floor(totalSec / 60);
        const secs = Math.round(totalSec % 60);
        timeStr = `${minutes}:${String(secs).padStart(2, '0')}`;
      } else {
        const d = Math.max(0, r.delayFromPrev);
        timeStr = `+${d % 1 === 0 ? Math.round(d) : d.toFixed(1)}`;
      }
      return `${timeStr} ${r.speaker}：${r.text}`;
    })
    .join('\n');
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
      className={`border-t border-neutral-100 align-top dark:border-neutral-800 ${isDragging ? 'opacity-50 bg-indigo-50 dark:bg-indigo-950/30' : ''}`}
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

interface SortableVisualRowProps {
  id: string;
  row: VisualRow;
  isFirst: boolean;
  onDelete: () => void;
  onChange: (updates: Partial<VisualRow>) => void;
}

function SortableVisualRow({ id, row, isFirst, onDelete, onChange }: SortableVisualRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const [localSpeaker, setLocalSpeaker] = useState(row.speaker);
  const [localText, setLocalText] = useState(row.text);
  const [localDelay, setLocalDelay] = useState(row.delayFromPrev);

  useEffect(() => { setLocalSpeaker(row.speaker); }, [row.speaker]);
  useEffect(() => { setLocalText(row.text); }, [row.text]);
  useEffect(() => { setLocalDelay(row.delayFromPrev); }, [row.delayFromPrev]);

  const commit = () => {
    onChange({
      speaker: localSpeaker.trim() || row.speaker,
      text: localText,
      delayFromPrev: localDelay,
    });
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm ${
        isDragging
          ? 'opacity-50 bg-indigo-50 border-indigo-200 dark:bg-indigo-950/30 dark:border-indigo-800'
          : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
      }`}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-400 active:cursor-grabbing"
        aria-label="拖拽排序"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-3.5" />
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        {!isFirst && <span className="text-xs text-neutral-400">+</span>}
        <input
          type="number"
          min={0}
          step={0.5}
          value={localDelay}
          onChange={(e) => setLocalDelay(Number(e.target.value) || 0)}
          onBlur={commit}
          className="w-12 rounded border border-transparent bg-transparent px-0.5 py-0 text-xs font-mono text-neutral-500 hover:border-neutral-200 focus:border-neutral-300 focus:outline-none dark:text-neutral-400 dark:hover:border-neutral-700 dark:focus:border-neutral-600"
          title={isFirst ? '距剧本开始的秒数' : '距上一条的间隔秒数'}
        />
        <span className="text-xs text-neutral-400">s</span>
      </div>
      <input
        value={localSpeaker}
        onChange={(e) => setLocalSpeaker(e.target.value)}
        onBlur={commit}
        placeholder="昵称"
        className="w-20 shrink-0 rounded border border-transparent bg-transparent px-1 py-0 text-sm hover:border-neutral-200 focus:border-neutral-300 focus:outline-none dark:hover:border-neutral-700 dark:focus:border-neutral-600"
        maxLength={100}
      />
      <span className="shrink-0 text-neutral-300 dark:text-neutral-600">：</span>
      <input
        value={localText}
        onChange={(e) => setLocalText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        placeholder="弹幕内容"
        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0 text-sm hover:border-neutral-200 focus:border-neutral-300 focus:outline-none dark:hover:border-neutral-700 dark:focus:border-neutral-600"
        maxLength={2000}
      />
      <button
        type="button"
        className="shrink-0 rounded p-0.5 text-neutral-300 hover:text-red-500 dark:text-neutral-600 dark:hover:text-red-400"
        onClick={onDelete}
        aria-label="删除此条"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

interface VisualEditorProps {
  events: ScriptEvent[];
  defaultGapSec: number;
  onContentChange: (content: string) => void;
}

function VisualEditor({ events, defaultGapSec, onContentChange }: VisualEditorProps) {
  const [newSpeaker, setNewSpeaker] = useState('');
  const [newText, setNewText] = useState('');
  const [newDelay, setNewDelay] = useState<number | ''>('');
  const newTextRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const visualRows = useMemo(() => eventsToVisualRows(events), [events]);

  const recentSpeakers = useMemo(
    () => [...new Map(events.map((e) => [e.speaker, e.speaker])).values()],
    [events],
  );

  const handleDragEnd = (ev: DragEndEvent) => {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    const oldIndex = visualRows.findIndex((r) => r.id === active.id);
    const newIndex = visualRows.findIndex((r) => r.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onContentChange(rowsToText(arrayMove(visualRows, oldIndex, newIndex)));
  };

  const handleRowChange = (idx: number, updates: Partial<VisualRow>) => {
    const updated = visualRows.map((r, i) => (i === idx ? { ...r, ...updates } : r));
    onContentChange(rowsToText(updated));
  };

  const handleDelete = (idx: number) => {
    onContentChange(rowsToText(visualRows.filter((_, i) => i !== idx)));
  };

  const handleAdd = () => {
    const spk = newSpeaker.trim();
    const txt = newText.trim();
    if (!spk || !txt) return;
    const delay = typeof newDelay === 'number' ? newDelay : defaultGapSec;
    const newRow: VisualRow = { id: String(Date.now()), speaker: spk, text: txt, delayFromPrev: delay };
    onContentChange(rowsToText([...visualRows, newRow]));
    setNewText('');
    setNewDelay('');
    newTextRef.current?.focus();
  };

  return (
    <div className="space-y-2">
      {visualRows.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visualRows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {visualRows.map((row, idx) => (
                <SortableVisualRow
                  key={row.id}
                  id={row.id}
                  row={row}
                  isFirst={idx === 0}
                  onDelete={() => handleDelete(idx)}
                  onChange={(updates) => handleRowChange(idx, updates)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="rounded-lg border border-dashed border-neutral-200 py-6 text-center text-xs text-neutral-400 dark:border-neutral-800">
          还没有弹幕，用下面的表单添加第一条
        </p>
      )}

      <div className="rounded-lg border border-dashed border-neutral-300 p-3 dark:border-neutral-700">
        <p className="mb-2 text-xs font-medium text-neutral-500">快速添加</p>
        {recentSpeakers.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {recentSpeakers.map((s) => (
              <button
                key={s}
                type="button"
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                  newSpeaker === s
                    ? 'border-indigo-300 bg-indigo-100 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                    : 'border-neutral-200 bg-neutral-100 text-neutral-600 hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
                }`}
                onClick={() => { setNewSpeaker(s); newTextRef.current?.focus(); }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            className={`${input} w-28 shrink-0`}
            value={newSpeaker}
            onChange={(e) => setNewSpeaker(e.target.value)}
            placeholder="昵称"
            maxLength={100}
          />
          <input
            ref={newTextRef}
            className={`${input} min-w-0 flex-1`}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
            placeholder="弹幕内容，回车快速添加"
            maxLength={2000}
          />
          <div className="flex shrink-0 items-center gap-1">
            <input
              className={`${input} w-16`}
              type="number"
              min={0}
              step={0.5}
              value={newDelay === '' ? defaultGapSec : newDelay}
              onChange={(e) => setNewDelay(e.target.value === '' ? '' : Number(e.target.value))}
              title="距前一条间隔（秒）"
              aria-label="间隔秒数"
            />
            <span className="text-xs text-neutral-400">s</span>
          </div>
          <button
            type="button"
            className={primaryBtn}
            onClick={handleAdd}
            disabled={!newSpeaker.trim() || !newText.trim()}
          >
            + 添加
          </button>
        </div>
      </div>
    </div>
  );
}

function ScriptEditor({ script, onDeleted }: { script: Script; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(script.name);
  const [gap, setGap] = useState(script.defaultGapSec);
  const [content, setContent] = useState(script.content);
  const [fileError, setFileError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = usePersistentState<'visual' | 'text'>('lce.scriptEditor.mode', 'visual');

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
    setEditorMode('text');
  };

  function handleTextDragEnd(ev: DragEndEvent) {
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
  const effectiveMode = parsed.issues.length > 0 ? 'text' : editorMode;

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

        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">编辑模式</span>
          <div className="flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700">
            <button
              type="button"
              onClick={() => setEditorMode('visual')}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                effectiveMode === 'visual'
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
              }`}
              disabled={parsed.issues.length > 0}
              title={parsed.issues.length > 0 ? '格式有错误时需先修复才能切换到可视化模式' : ''}
            >
              <ListIcon className="size-3.5" />
              可视化
            </button>
            <button
              type="button"
              onClick={() => setEditorMode('text')}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                effectiveMode === 'text'
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
              }`}
            >
              <TextIcon className="size-3.5" />
              原始文本
            </button>
          </div>
          {parsed.issues.length > 0 && (
            <span className="text-xs text-amber-600">格式错误，请在文本模式下修复</span>
          )}
        </div>

        {effectiveMode === 'text' && (
          <>
            <textarea
              aria-label="剧本内容"
              className={`${input} min-h-[35vh] font-mono leading-relaxed`}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={EXAMPLE}
              spellCheck={false}
            />
            {!content.trim() && (
              <button type="button" className={secondaryBtn} onClick={() => setContent(EXAMPLE)}>填入示例</button>
            )}
          </>
        )}

        {effectiveMode === 'visual' && (
          <VisualEditor
            events={parsed.events}
            defaultGapSec={gap}
            onContentChange={setContent}
          />
        )}

        {fileError && <p className="text-xs text-red-600">{fileError}</p>}
        {save.error && <p className="text-xs text-red-600">{save.error.message}</p>}
        {remove.error && <p className="text-xs text-red-600">{remove.error.message}</p>}
      </div>

      <div className={`${card} space-y-2`}>
        <h3 className="text-sm font-medium">剧本统计</h3>
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
        {effectiveMode === 'text' && parsed.events.length > 0 && (
          <div className="max-h-[30vh] overflow-auto">
            <p className="mb-1 text-xs text-neutral-400">
              解析预览{parsed.issues.length === 0 && previewEvents.length > 0 ? '（可拖拽调整顺序）' : ''}
            </p>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="w-5 py-1 font-normal" />
                  <th className="py-1 pr-2 font-normal">时间</th>
                  <th className="py-1 pr-2 font-normal">昵称</th>
                  <th className="py-1 font-normal">内容</th>
                </tr>
              </thead>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleTextDragEnd}>
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
        )}
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
  liveEval?: { rubricId: string; providerId?: string; model?: string };
  onStartScript: (info: RunInfo) => void;
}

export function ScriptSheet({ open, onOpenChange, anchorName, configId, paceKey, liveEval, onStartScript }: Props) {
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
      return api.startSim({ mode: 'script', anchorName, configId, scriptId, pace: paceOf(paceKey), liveEval } as StartSim);
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
                      {startScript.isPending ? '启动中…' : '▶ 开始模拟'}
                    </button>
                  </li>
                ))}
              </ul>
              {startScript.error && <p className="text-xs text-red-600">{startScript.error.message}</p>}
              {(!anchorName || !configId) && (
                <p className="text-xs text-amber-600">请先在主播管理和回复配置中完成设置，才能开始模拟。</p>
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
