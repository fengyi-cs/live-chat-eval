import { cloneRubric, DEFAULT_RUBRIC, RULE_KEYS, RULE_LABELS, type Dimension, type Rubric } from '@lce/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, type RubricRow } from '../api.ts';
import { card, emptyState, input, listItem, primaryBtn, secondaryBtn } from '../ui.ts';
import { usePersistentState } from '../usePersistentState.ts';

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

function DimensionCard({ d, onChange, onRemove }: { d: Dimension; onChange: (d: Dimension) => void; onRemove: () => void }) {
  const set = (p: Partial<Dimension>) => onChange({ ...d, ...p });
  return (
    <div className={`space-y-2 rounded border p-3 ${d.enabled ? 'border-neutral-300 dark:border-neutral-700' : 'border-dashed border-neutral-200 opacity-60 dark:border-neutral-800'}`}>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          启用
        </label>
        <select aria-label="评分粒度" className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 dark:border-neutral-700" value={d.scope} onChange={(e) => set({ scope: e.target.value as Dimension['scope'] })}>
          <option value="turn">逐条</option>
          <option value="session">整场</option>
        </select>
        {d.scope === 'turn' && (
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={d.skipProactive} onChange={(e) => set({ skipProactive: e.target.checked })} />
            主动发言时不评
          </label>
        )}
        <button type="button" className="ml-auto text-xs text-red-600" onClick={onRemove}>
          删除维度
        </button>
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
        <textarea className={`${input} min-h-12`} value={d.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <div className="grid gap-1">
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

function RubricEditor({ row, onDeleted }: { row: RubricRow; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(row.name);
  const [r, setR] = useState<Rubric>(() => cloneRubric(row.rubric));
  const dirty = name !== row.name || JSON.stringify(r) !== JSON.stringify(row.rubric);
  const save = useMutation({ mutationFn: () => api.updateRubric(row.id, { name: name.trim(), rubric: r }), onSuccess: () => qc.invalidateQueries({ queryKey: ['rubrics'] }) });
  const remove = useMutation({
    mutationFn: () => api.deleteRubric(row.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rubrics'] });
      onDeleted();
    },
  });
  const setRule = <K extends keyof Rubric['rules']>(k: K, p: Partial<Rubric['rules'][K]>) => setR({ ...r, rules: { ...r.rules, [k]: { ...r.rules[k], ...p } } });
  const setDim = (i: number, d: Dimension) => setR({ ...r, dimensions: r.dimensions.map((x, j) => (j === i ? d : x)) });

  return (
    <div className="space-y-4">
      <section className={`${card} flex flex-wrap items-end gap-2`}>
        <Field label="模板名称">
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </Field>
        <div className="w-28">
          <Num label="规则分权重" value={r.ruleWeight} onChange={(ruleWeight) => setR({ ...r, ruleWeight })} />
        </div>
        <div className="w-28">
          <Num label="LLM 分权重" value={r.llmWeight} onChange={(llmWeight) => setR({ ...r, llmWeight })} />
        </div>
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
      </section>

      <section className={`${card} space-y-3`}>
        <h2 className="text-sm font-medium">规则基础分</h2>
        <p className="text-xs text-neutral-500">直接从记录里计算，不调用模型。每项 0-100 分，按权重合成规则分。</p>
        <div className="grid gap-2">
          {RULE_KEYS.map((k) => (
            <div key={k} className="flex flex-wrap items-end gap-3 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
              <label className="flex w-28 items-center gap-1 self-center">
                <input type="checkbox" checked={r.rules[k].enabled} onChange={(e) => setRule(k, { enabled: e.target.checked })} />
                {RULE_LABELS[k]}
              </label>
              <div className="w-20">
                <Num label="权重" value={r.rules[k].weight} step={0.5} onChange={(weight) => setRule(k, { weight })} />
              </div>
              {k === 'latency' && (
                <>
                  <div className="w-24"><Num label="满分秒数 ≤" value={r.rules.latency.goodSec} onChange={(goodSec) => setRule('latency', { goodSec })} /></div>
                  <div className="w-24"><Num label="0 分秒数 ≥" value={r.rules.latency.badSec} onChange={(badSec) => setRule('latency', { badSec })} /></div>
                </>
              )}
              {k === 'length' && (
                <>
                  <div className="w-24"><Num label="最少字数" value={r.rules.length.minChars} onChange={(minChars) => setRule('length', { minChars })} /></div>
                  <div className="w-24"><Num label="最多字数" value={r.rules.length.maxChars} onChange={(maxChars) => setRule('length', { maxChars })} /></div>
                </>
              )}
              {k === 'repetition' && <div className="w-28"><Num label="和前几条比" value={r.rules.repetition.window} onChange={(window) => setRule('repetition', { window })} /></div>}
              {k === 'aiPhrases' && (
                <>
                  <div className="w-24"><Num label="每命中扣分" value={r.rules.aiPhrases.penaltyPerHit} onChange={(penaltyPerHit) => setRule('aiPhrases', { penaltyPerHit })} /></div>
                  <label className="block min-w-60 flex-1 space-y-1">
                    <span className="text-xs text-neutral-500">AI 腔词库（每行一个）</span>
                    <textarea
                      className={`${input} min-h-20 font-mono text-xs`}
                      value={r.rules.aiPhrases.phrases.join('\n')}
                      onChange={(e) => setRule('aiPhrases', { phrases: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                    />
                  </label>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className={`${card} space-y-3`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">LLM 裁判维度</h2>
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
        {r.dimensions.map((d, i) => (
          <DimensionCard key={i} d={d} onChange={(nd) => setDim(i, nd)} onRemove={() => setR({ ...r, dimensions: r.dimensions.filter((_, j) => j !== i) })} />
        ))}
      </section>
    </div>
  );
}

export function RubricsPage() {
  const qc = useQueryClient();
  const rubrics = useQuery({ queryKey: ['rubrics'], queryFn: api.rubrics });
  const [selected, setSelected] = usePersistentState<string | null>('lce.selectedRubric', null);
  const create = useMutation({
    mutationFn: (n: number) => api.createRubric({ name: n === 0 ? '默认评分' : `评分模板 ${n + 1}`, rubric: DEFAULT_RUBRIC }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['rubrics'] });
      setSelected(row.id);
    },
  });
  const active = rubrics.data?.find((r) => r.id === selected) ?? rubrics.data?.[0] ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <aside className={`${card} space-y-2 self-start`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">评分模板</h2>
          <button type="button" className={secondaryBtn} disabled={create.isPending} onClick={() => create.mutate(rubrics.data?.length ?? 0)}>
            新增
          </button>
        </div>
        {create.error && <p className="text-xs text-red-600">{create.error.message}</p>}
        <ul className="space-y-1">
          {rubrics.data?.map((r) => (
            <li key={r.id}>
              <button type="button" className={listItem(r.id === active?.id)} onClick={() => setSelected(r.id)}>
                {r.name}
                <span className="ml-2 text-xs text-neutral-500">{r.rubric.dimensions.filter((d) => d.enabled).length} 个维度</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main>{active ? <RubricEditor key={active.id} row={active} onDeleted={() => setSelected(null)} /> : <div className={emptyState}>点「新增」从内置默认模板开始</div>}</main>
    </div>
  );
}
