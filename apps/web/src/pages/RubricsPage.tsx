import { cloneRubric, DEFAULT_RUBRIC, RULE_KEYS, RULE_LABELS, RULE_DESCRIPTIONS, type Dimension, type Rubric } from '@lce/core';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVerticalIcon, PencilIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type RubricRow } from '../api.ts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.tsx';
import { card, emptyState, input, listItem, primaryBtn, secondaryBtn } from '../ui.ts';
import { usePersistentState } from '../usePersistentState.ts';
import { HintBubble } from '../components/HintBubble.tsx';

const num = (v: string, fallback: number) => (v === '' || !Number.isFinite(Number(v)) ? fallback : Number(v));

function Num({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-neutral-500">{label}</span>
      <input type="number" className={input} step={step} min={0} value={value} onChange={(e) => onChange(num(e.target.value, value))} />
    </label>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

function DimensionForm({ d, onChange }: { d: Dimension; onChange: (d: Dimension) => void }) {
  const set = (p: Partial<Dimension>) => onChange({ ...d, ...p });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          启用
        </label>
        <select
          aria-label="评分粒度"
          className="rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
          value={d.scope}
          onChange={(e) => set({ scope: e.target.value as Dimension['scope'] })}
        >
          <option value="turn">逐条</option>
          <option value="session">整场</option>
        </select>
        {d.scope === 'turn' && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={d.skipProactive} onChange={(e) => set({ skipProactive: e.target.checked })} />
            主动发言时不评
          </label>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_90px]">
        <Field label="名称">
          <input className={input} value={d.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="键（裁判输出用，英文）">
          <input className={`${input} font-mono`} value={d.key} onChange={(e) => set({ key: e.target.value })} />
        </Field>
        <Num label="权重" value={d.weight} step={0.5} onChange={(weight) => set({ weight })} />
      </div>
      <Field label="评什么">
        <textarea className={`${input} min-h-16`} value={d.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <div className="grid gap-1.5">
        {d.anchors.map((a, i) => (
          <label key={i} className="flex items-start gap-2 text-xs">
            <span className="mt-1.5 w-8 shrink-0 text-neutral-500">{i + 1} 分</span>
            <input
              className={input}
              value={a}
              onChange={(e) => {
                const anchors = [...d.anchors] as Dimension['anchors'];
                anchors[i] = e.target.value;
                set({ anchors });
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

interface SortableDimRowProps {
  id: string;
  d: Dimension;
  contrib?: number; // S11: 占总分百分比 (0-100)
  onEdit: () => void;
  onWeightChange: (weight: number) => void;
}

function SortableDimRow({ id, d, contrib, onEdit, onWeightChange }: SortableDimRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
        isDragging
          ? 'bg-indigo-50 border-indigo-200 dark:bg-indigo-950/30 dark:border-indigo-800'
          : d.enabled
            ? 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
            : 'border-dashed border-neutral-200 bg-neutral-50 opacity-60 dark:border-neutral-800 dark:bg-neutral-950'
      }`}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-400 active:cursor-grabbing"
        aria-label="拖拽排序"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-4 shrink-0" />
      </button>
      <span className={`font-medium ${d.enabled ? '' : 'text-neutral-400'}`}>{d.name}</span>
      <span className="ml-1 rounded-full bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800">
        {d.scope === 'session' ? '整场' : '逐条'}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={5}
          step={0.5}
          value={d.weight}
          disabled={!d.enabled}
          onChange={(e) => onWeightChange(Number(e.target.value))}
          className="w-20 accent-indigo-500 disabled:opacity-30"
          aria-label={`「${d.name}」权重`}
        />
        <span className="w-7 text-sm font-medium tabular-nums text-neutral-500">{d.weight}</span>
        {contrib !== undefined && d.enabled && d.weight > 0 && (
          <span className="w-8 text-xs text-indigo-500 dark:text-indigo-400" title="占总分的比例">{contrib.toFixed(0)}%</span>
        )}
        <button
          type="button"
          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          aria-label={`编辑「${d.name}」`}
          onClick={onEdit}
        >
          <PencilIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function DonutChart({ ruleWeight, llmWeight }: { ruleWeight: number; llmWeight: number }) {
  const r = 40;
  const cx = 56;
  const cy = 56;
  const sw = 16;
  const circ = 2 * Math.PI * r;
  const total = (ruleWeight + llmWeight) || 1;
  const ruleLen = (ruleWeight / total) * circ;
  const llmLen = (llmWeight / total) * circ;
  const baseOffset = circ / 4;
  const rulePct = Math.round((ruleWeight / total) * 100);
  const llmPct = 100 - rulePct;

  return (
    <div className="flex items-center gap-5">
      <svg width="112" height="112" viewBox="0 0 112 112" aria-hidden>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border)" strokeWidth={sw} />
        {ruleWeight > 0 && (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#10b981" strokeWidth={sw}
            strokeDasharray={`${ruleLen} ${circ - ruleLen}`} strokeDashoffset={baseOffset} />
        )}
        {llmWeight > 0 && (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#6366f1" strokeWidth={sw}
            strokeDasharray={`${llmLen} ${circ - llmLen}`} strokeDashoffset={baseOffset - ruleLen} />
        )}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fill="currentColor" className="text-neutral-600 dark:text-neutral-400">
          {rulePct}%
        </text>
        <text x={cx} y={cy + 9} textAnchor="middle" fontSize="9" fill="currentColor" className="text-neutral-400">
          规则占比
        </text>
      </svg>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-neutral-500">
            <span className="inline-block size-2.5 rounded-full bg-emerald-500" />规则基础分
          </span>
          <span className="font-semibold tabular-nums text-neutral-700 dark:text-neutral-300">{rulePct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
          <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${rulePct}%` }} />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-neutral-500">
            <span className="inline-block size-2.5 rounded-full bg-indigo-500" />LLM 裁判分
          </span>
          <span className="font-semibold tabular-nums text-neutral-700 dark:text-neutral-300">{llmPct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
          <div className="h-2 rounded-full bg-indigo-500 transition-all" style={{ width: `${llmPct}%` }} />
        </div>
      </div>
    </div>
  );
}

function RubricEditor({ row, onDeleted, onDirtyChange }: { row: RubricRow; onDeleted: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(row.name);
  const [r, setR] = useState<Rubric>(() => cloneRubric(row.rubric));
  const [editingDimIdx, setEditingDimIdx] = useState<number | null>(null);
  const dirty = name !== row.name || JSON.stringify(r) !== JSON.stringify(row.rubric);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const save = useMutation({ mutationFn: () => api.updateRubric(row.id, { name: name.trim(), rubric: r }), onSuccess: () => qc.invalidateQueries({ queryKey: ['rubrics'] }) });
  const remove = useMutation({
    mutationFn: () => api.deleteRubric(row.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rubrics'] });
      onDeleted();
    },
  });

  const setRule = <K extends keyof Rubric['rules']>(k: K, p: Partial<Rubric['rules'][K]>) =>
    setR({ ...r, rules: { ...r.rules, [k]: { ...r.rules[k], ...p } } });
  const setDim = (i: number, d: Dimension) => setR({ ...r, dimensions: r.dimensions.map((x, j) => (j === i ? d : x)) });

  // S11: 计算每项占综合总分的百分比
  const totalCombo = (r.ruleWeight + r.llmWeight) || 1;
  const rulePct = r.ruleWeight / totalCombo;
  const llmPct = r.llmWeight / totalCombo;
  const totalRuleWeight = RULE_KEYS.filter((k) => r.rules[k].enabled && r.rules[k].weight > 0).reduce((s, k) => s + r.rules[k].weight, 0) || 1;
  const totalDimWeight = r.dimensions.filter((d) => d.enabled && d.weight > 0).reduce((s, d) => s + d.weight, 0) || 1;
  const ruleContrib = (k: typeof RULE_KEYS[number]) => r.rules[k].enabled && r.rules[k].weight > 0
    ? (r.rules[k].weight / totalRuleWeight) * rulePct * 100 : 0;
  const dimContrib = (d: Dimension) => d.enabled && d.weight > 0
    ? (d.weight / totalDimWeight) * llmPct * 100 : 0;

  function handleDimDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    const oldIdx = r.dimensions.findIndex((_, i) => String(i) === active.id);
    const newIdx = r.dimensions.findIndex((_, i) => String(i) === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    setR({ ...r, dimensions: arrayMove(r.dimensions, oldIdx, newIdx) });
  }

  const editingDim = editingDimIdx !== null ? r.dimensions[editingDimIdx] ?? null : null;

  return (
    <div className="space-y-4">
      <section className={`${card} space-y-4`}>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="模板名称">
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </Field>
          <div className="ml-auto flex flex-wrap gap-2">
            {dirty && <span className="self-center text-xs text-amber-600">有未保存的修改</span>}
            <button type="button" className={secondaryBtn} onClick={() => confirm('恢复成内置默认模板？') && setR(cloneRubric(DEFAULT_RUBRIC))}>
              恢复默认
            </button>
            <button type="button" className={primaryBtn} disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              保存
            </button>
            <button type="button" className={`${secondaryBtn} text-red-600`} onClick={() => confirm(`删除模板「${row.name}」？已有的评估报告不受影响。`) && remove.mutate()}>
              删除
            </button>
          </div>
          {save.error && <p className="w-full text-xs text-red-600">{save.error.message}</p>}
        </div>

        <div className="border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <p className="mb-2 text-xs text-neutral-500">规则分与 LLM 裁判分的合成比例（总和固定 100）</p>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-neutral-500" htmlFor="rule-weight-range">
              <span className="inline-block size-2.5 rounded-full bg-emerald-500" />规则
            </label>
            <input
              id="rule-weight-range"
              type="range" min={0} max={100} step={1}
              value={r.ruleWeight}
              onChange={(e) => {
                const rw = Number(e.target.value);
                setR({ ...r, ruleWeight: rw, llmWeight: 100 - rw });
              }}
              className="flex-1 accent-emerald-500"
              aria-label={`规则分比例 ${r.ruleWeight}%`}
            />
            <span className="w-10 text-right text-sm font-semibold tabular-nums">{r.ruleWeight}%</span>
            <span className="text-xs text-neutral-400">LLM</span>
            <span className="w-10 text-right text-sm font-semibold tabular-nums">{r.llmWeight}%</span>
          </div>
        </div>

        <div className="border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <DonutChart ruleWeight={r.ruleWeight} llmWeight={r.llmWeight} />
        </div>
      </section>

      <section className={`${card} space-y-3`}>
        <h2 className="text-sm font-medium">规则基础分</h2>
        <p className="text-xs text-neutral-500">直接从记录里计算，不调用模型。每项 0-100 分，按权重合成规则分。</p>
        <div className="grid gap-2">
          {RULE_KEYS.map((k) => (
            <div key={k} className={`rounded-xl border p-3 transition-colors ${
              r.rules[k].enabled
                ? 'border-indigo-200 bg-indigo-50/40 dark:border-indigo-800/50 dark:bg-indigo-950/10'
                : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
            }`}>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-32 flex-1 cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={r.rules[k].enabled} onChange={(e) => setRule(k, { enabled: e.target.checked })} className="size-4" />
                  <span className={`text-sm font-medium ${r.rules[k].enabled ? 'text-neutral-800 dark:text-neutral-100' : 'text-neutral-400'}`}>
                    {RULE_LABELS[k]}
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-400">权重</span>
                  <input type="range" min={0} max={10} step={0.5}
                    value={r.rules[k].weight}
                    disabled={!r.rules[k].enabled}
                    onChange={(e) => setRule(k, { weight: Number(e.target.value) })}
                    className="w-24 accent-emerald-500 disabled:opacity-30" />
                  <span className="w-7 text-sm font-medium tabular-nums text-neutral-500">{r.rules[k].weight}</span>
                  {r.rules[k].enabled && r.rules[k].weight > 0 && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400" title="占综合总分的比例">{ruleContrib(k).toFixed(0)}%</span>
                  )}
                </div>
              </div>
              {RULE_DESCRIPTIONS[k] && (
                <p className="mt-1 text-xs text-neutral-400 pl-6">{RULE_DESCRIPTIONS[k]}</p>
              )}
              {r.rules[k].enabled && (
                <>
                  {k === 'latency' && (
                    <div className="mt-2.5 flex flex-wrap gap-3 border-t border-indigo-100 pt-2.5 dark:border-indigo-800/20">
                      <div className="w-28"><Num label="满分秒数 ≤" value={r.rules.latency.goodSec} onChange={(goodSec) => setRule('latency', { goodSec })} /></div>
                      <div className="w-28"><Num label="0 分秒数 ≥" value={r.rules.latency.badSec} onChange={(badSec) => setRule('latency', { badSec })} /></div>
                    </div>
                  )}
                  {k === 'length' && (
                    <div className="mt-2.5 flex flex-wrap gap-3 border-t border-indigo-100 pt-2.5 dark:border-indigo-800/20">
                      <div className="w-24"><Num label="最少字数" value={r.rules.length.minChars} onChange={(minChars) => setRule('length', { minChars })} /></div>
                      <div className="w-24"><Num label="最多字数" value={r.rules.length.maxChars} onChange={(maxChars) => setRule('length', { maxChars })} /></div>
                    </div>
                  )}
                  {k === 'repetition' && (
                    <div className="mt-2.5 flex flex-wrap gap-3 border-t border-indigo-100 pt-2.5 dark:border-indigo-800/20">
                      <div className="w-28"><Num label="和前几条比" value={r.rules.repetition.window} onChange={(window) => setRule('repetition', { window })} /></div>
                    </div>
                  )}
                  {k === 'aiPhrases' && (
                    <div className="mt-2.5 flex flex-wrap gap-3 border-t border-indigo-100 pt-2.5 dark:border-indigo-800/20">
                      <div className="w-28"><Num label="每命中扣分" value={r.rules.aiPhrases.penaltyPerHit} onChange={(penaltyPerHit) => setRule('aiPhrases', { penaltyPerHit })} /></div>
                      <label className="block min-w-60 flex-1 space-y-1">
                        <span className="text-xs text-neutral-500">AI 腔词库（每行一个）</span>
                        <textarea className={`${input} min-h-20 font-mono text-xs`}
                          value={r.rules.aiPhrases.phrases.join('\n')}
                          onChange={(e) => setRule('aiPhrases', { phrases: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
                      </label>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className={`${card} space-y-3`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">LLM 裁判维度</h2>
            {r.dimensions.length > 1 && (
              <p className="mt-0.5 text-xs text-neutral-400">可拖拽手柄调整顺序，点铅笔图标编辑</p>
            )}
          </div>
          <button
            type="button"
            className={secondaryBtn}
            onClick={() =>
              setR({
                ...r,
                dimensions: [
                  ...r.dimensions,
                  { key: `dim_${r.dimensions.length + 1}`, name: '新维度', description: '', anchors: ['', '', '', '', ''], weight: 1, scope: 'turn', enabled: true, skipProactive: false },
                ],
              })
            }
          >
            新增维度
          </button>
        </div>
        <p className="text-xs text-neutral-500">每个维度 1-5 分，下面五档描述会原样写进裁判提示词。逐条维度评每一句主播发言，整场维度看完整场直播评一次。</p>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDimDragEnd}>
          <SortableContext
            items={r.dimensions.map((_, i) => String(i))}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {r.dimensions.map((d, i) => (
                <SortableDimRow
                  key={i}
                  id={String(i)}
                  d={d}
                  contrib={dimContrib(d)}
                  onEdit={() => setEditingDimIdx(i)}
                  onWeightChange={(weight) => setDim(i, { ...d, weight })}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {r.dimensions.length === 0 && (
          <p className="text-xs text-neutral-500">还没有维度，点「新增维度」添加</p>
        )}
      </section>

      <Dialog open={editingDim !== null} onOpenChange={(open) => { if (!open) setEditingDimIdx(null); }}>
        <DialogContent className="max-w-xl overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>编辑维度：{editingDim?.name ?? ''}</DialogTitle>
          </DialogHeader>
          {editingDim !== null && editingDimIdx !== null && (
            <div className="space-y-4 pt-1">
              <DimensionForm d={editingDim} onChange={(nd) => setDim(editingDimIdx, nd)} />
              <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                <button
                  type="button"
                  className={`${secondaryBtn} text-red-600`}
                  onClick={() => {
                    setR({ ...r, dimensions: r.dimensions.filter((_, j) => j !== editingDimIdx) });
                    setEditingDimIdx(null);
                  }}
                >
                  删除维度
                </button>
                <button type="button" className={primaryBtn} onClick={() => setEditingDimIdx(null)}>
                  完成
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function RubricsPage() {
  const qc = useQueryClient();
  const rubrics = useQuery({ queryKey: ['rubrics'], queryFn: api.rubrics });
  const [selected, setSelected] = usePersistentState<string | null>('lce.selectedRubric', null);
  // S07: 跟踪当前编辑器的脏状态，切换模板时保护未保存修改
  const dirtyRef = useRef(false);
  const create = useMutation({
    mutationFn: (n: number) => api.createRubric({ name: n === 0 ? '默认评分' : `评分标准 ${n + 1}`, rubric: DEFAULT_RUBRIC }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['rubrics'] });
      setSelected(row.id);
    },
  });
  const active = rubrics.data?.find((r) => r.id === selected) ?? rubrics.data?.[0] ?? null;

  const guardedSetSelected = (id: string) => {
    if (dirtyRef.current && id !== selected) {
      if (!confirm('当前模板有未保存的修改，切换模板将丢失修改。是否继续？')) return;
    }
    setSelected(id);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <aside className={`${card} space-y-2 self-start`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">评分标准</h2>
          <button type="button" className={secondaryBtn} disabled={create.isPending} onClick={() => create.mutate(rubrics.data?.length ?? 0)}>
            新增
          </button>
        </div>
        {create.error && <p className="text-xs text-red-600">{create.error.message}</p>}
        <ul className="space-y-1">
          {rubrics.data?.map((r) => (
            <li key={r.id}>
              <button type="button" className={listItem(r.id === active?.id)} onClick={() => guardedSetSelected(r.id)}>
                {r.name}
                <span className="ml-2 text-xs text-neutral-500">{r.rubric.dimensions.filter((d) => d.enabled).length} 个维度</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="space-y-3">
        <HintBubble
          storageKey="lce.hint.rubrics"
          title="评分标准"
        >
          评分标准分两部分：规则基础分（从记录自动算，不调模型）和 LLM 裁判分（调模型逐条或整场评分）。用顶部的滑杆调整两部分占比，每项的权重用滑杆调整。已预置默认模板，开箱即用。
        </HintBubble>
        {active ? <RubricEditor key={active.id} row={active} onDeleted={() => setSelected(null)} onDirtyChange={(v) => { dirtyRef.current = v; }} /> : <div className={emptyState}>点「新增」从内置默认模板开始</div>}
      </main>
    </div>
  );
}
