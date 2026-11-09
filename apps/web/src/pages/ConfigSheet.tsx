import {
  DEFAULT_PROACTIVE_PROMPT,
  DEFAULT_REPLY_RULES,
  STRATEGY_KIND_LABELS,
  STRATEGY_KINDS,
  type PriorityWeights,
  type ReplyStrategy,
  type StrategyKind,
} from '@lce/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, type AnchorConfig, type AnchorConfigSummary } from '../api.ts';
import { ModelPicker } from '../components/ModelPicker.tsx';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet.tsx';
import { card, input, primaryBtn, secondaryBtn } from '../ui.ts';
import { usePersistentState } from '../usePersistentState.ts';
import { TrialPanel } from './TrialPanel.tsx';

const WEIGHT_FIELDS: readonly [keyof PriorityWeights, string][] = [
  ['question', '提问'],
  ['mention', '@主播 / 叫名字'],
  ['gift', '礼物'],
  ['newViewer', '新观众'],
];

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-neutral-500">{label}</span>
      {children}
      {hint && <span className="block text-xs text-neutral-400">{hint}</span>}
    </label>
  );
}

function NumberInput({ value, onChange, min, max, step = 1, integer = false, nullable = false, placeholder }: {
  value: number | null; onChange: (v: number | null) => void; min: number; max: number;
  step?: number; integer?: boolean; nullable?: boolean; placeholder?: string;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  return (
    <input type="number" inputMode="decimal" className={input} value={text} min={min} max={max} step={step} placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw === '') { if (nullable) onChange(null); return; }
        const n = Number(raw);
        if (Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n))) onChange(n);
      }}
      onBlur={() => setText(value === null ? '' : String(value))}
    />
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-xs font-medium text-neutral-700 dark:text-neutral-300">{title}</legend>
      {children}
    </fieldset>
  );
}

function ConfigEditor({ config }: { config: AnchorConfigSummary }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AnchorConfig>({ ...config });
  const [showTrial, setShowTrial] = useState(false);

  const set = (patch: Partial<AnchorConfig>) => setDraft((d) => ({ ...d, ...patch }));
  const setStrategy = (patch: Partial<ReplyStrategy>) => setDraft((d) => ({ ...d, strategy: { ...d.strategy, ...patch } }));
  const setWeight = (key: keyof PriorityWeights, v: number) =>
    setDraft((d) => ({ ...d, strategy: { ...d.strategy, weights: { ...d.strategy.weights, [key]: v } } }));

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const refreshConfigs = () => queryClient.invalidateQueries({ queryKey: ['allConfigs'] });

  const save = useMutation({
    mutationFn: () => api.updateConfig(config.id, {
      name: draft.name.trim(), providerId: draft.providerId, model: draft.model,
      temperature: draft.temperature, maxTokens: draft.maxTokens, contextTurns: draft.contextTurns,
      replyRules: draft.replyRules, proactivePrompt: draft.proactivePrompt, strategy: draft.strategy,
    }),
    onSuccess: (saved) => { setDraft(saved); refreshConfigs(); },
  });
  const remove = useMutation({ mutationFn: () => api.deleteConfig(config.id), onSuccess: refreshConfigs });

  const s = draft.strategy;

  return (
    <div className="space-y-4">
      <form className={`${card} space-y-5`} onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-sm font-medium">编辑回复配置</h3>
          {dirty && <span className="text-xs text-amber-600">有未保存的修改</span>}
          <button type="submit" className={primaryBtn} disabled={!dirty || !draft.name.trim() || save.isPending}>
            {save.isPending ? '保存中…' : '保存配置'}
          </button>
          <button type="button" className={`${secondaryBtn} text-red-600`}
            onClick={() => confirm(`删除回复配置「${config.name}」？`) && remove.mutate()}>
            删除
          </button>
          <button type="button" className={secondaryBtn} onClick={() => setShowTrial((v) => !v)}>
            {showTrial ? '收起试播' : '试播 →'}
          </button>
        </div>
        {save.error && <p className="text-xs text-red-600">{save.error.message}</p>}
        {remove.error && <p className="text-xs text-red-600">{remove.error.message}</p>}

        <Section title="模型">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="配置名称">
              <input className={input} value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} required />
            </Field>
            <div className="space-y-1">
              <span className="text-xs text-neutral-500">模型</span>
              <ModelPicker value={{ providerId: draft.providerId, model: draft.model }} onChange={(v) => set(v)} />
            </div>
            <Field label="温度" hint="0 ~ 2，留空使用模型默认值">
              <NumberInput value={draft.temperature} onChange={(v) => set({ temperature: v })} min={0} max={2} step={0.1} nullable placeholder="默认" />
            </Field>
            <Field label="最大输出 tokens" hint="留空不限制">
              <NumberInput value={draft.maxTokens} onChange={(v) => set({ maxTokens: v })} min={1} max={64000} integer nullable placeholder="不限制" />
            </Field>
            <Field label="上下文轮数" hint="带上最近几轮对话，0 表示不带">
              <NumberInput value={draft.contextTurns} onChange={(v) => v !== null && set({ contextTurns: v })} min={0} max={200} integer />
            </Field>
          </div>
        </Section>

        <Section title="回复策略">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="策略">
              <select className={input} value={s.kind} onChange={(e) => setStrategy({ kind: e.target.value as StrategyKind })}>
                {STRATEGY_KINDS.map((k) => (<option key={k} value={k}>{STRATEGY_KIND_LABELS[k]}</option>))}
              </select>
            </Field>
            <Field label="最小回复间隔（秒）">
              <NumberInput value={s.minGapSec} onChange={(v) => v !== null && setStrategy({ minGapSec: v })} min={0} max={600} step={0.5} />
            </Field>
            {s.kind !== 'each' && (
              <>
                <Field label="合并窗口（秒）">
                  <NumberInput value={s.mergeWindowSec} onChange={(v) => v !== null && setStrategy({ mergeWindowSec: v })} min={0} max={600} step={0.5} />
                </Field>
                <Field label="单次最多回应">
                  <NumberInput value={s.maxBatch} onChange={(v) => v !== null && setStrategy({ maxBatch: v })} min={1} max={50} integer />
                </Field>
              </>
            )}
            <Field label="冷场主动发言（秒）" hint="0 表示关闭">
              <NumberInput value={s.idleProactiveSec} onChange={(v) => v !== null && setStrategy({ idleProactiveSec: v })} min={0} max={3600} />
            </Field>
          </div>
          {s.kind === 'priority' && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {WEIGHT_FIELDS.map(([key, label]) => (
                <Field key={key} label={`权重：${label}`}>
                  <NumberInput value={s.weights[key]} onChange={(v) => v !== null && setWeight(key, v)} min={0} max={100} step={0.5} />
                </Field>
              ))}
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={s.llmSelect} onChange={(e) => setStrategy({ llmSelect: e.target.checked })} />
            <span>让模型判断回应哪几条弹幕</span>
          </label>
        </Section>

        <Section title="提示词">
          <Field label="回复要求" hint="拼在人设后面，告诉模型弹幕的格式和回复方式">
            <textarea className={`${input} min-h-24`} value={draft.replyRules} onChange={(e) => set({ replyRules: e.target.value })} />
          </Field>
          <Field label="主动发言提示">
            <textarea className={`${input} min-h-16`} value={draft.proactivePrompt} onChange={(e) => set({ proactivePrompt: e.target.value })} />
          </Field>
          <button type="button" className={secondaryBtn}
            onClick={() => set({ replyRules: DEFAULT_REPLY_RULES, proactivePrompt: DEFAULT_PROACTIVE_PROMPT })}>
            恢复默认提示词
          </button>
        </Section>
      </form>

      {showTrial && <TrialPanel config={config} />}
    </div>
  );
}

function nextConfigName(existing: readonly string[]) {
  const taken = new Set(existing);
  let i = existing.length + 1;
  while (taken.has(`配置 ${i}`)) i++;
  return `配置 ${i}`;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ConfigSheet({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const configs = useQuery({ queryKey: ['allConfigs'], queryFn: api.allConfigs });
  const [selected, setSelected] = usePersistentState<string | null>('lce.room.config', null);
  const add = useMutation({
    mutationFn: (names: string[]) => api.createConfig({ name: nextConfigName(names) }),
    onSuccess: (cfg) => {
      queryClient.invalidateQueries({ queryKey: ['allConfigs'] });
      setSelected(cfg.id);
    },
  });
  const list = configs.data ?? [];
  const config = list.find((c) => c.id === selected) ?? list[0] ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>回复配置</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="回复配置">
              {list.map((c) => (
                <button key={c.id} type="button" role="tab" aria-selected={c.id === config?.id}
                  onClick={() => setSelected(c.id)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    c.id === config?.id
                      ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                      : 'border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
                  }`}>
                  {c.name}
                  {!c.modelAvailable && <span className="ml-1 text-amber-500" title="没有可用模型">!</span>}
                </button>
              ))}
            </div>
            <button type="button" className={secondaryBtn} disabled={add.isPending}
              onClick={() => add.mutate(list.map((c) => c.name))}>
              + 新增配置
            </button>
          </div>
          {add.error && <p className="text-xs text-red-600">{add.error.message}</p>}
          {config && (
            <ConfigEditor key={config.id} config={config} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export type { AnchorConfigSummary };
