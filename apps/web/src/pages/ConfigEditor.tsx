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
import { api, type AnchorConfig } from '../api.ts';
import { card, input, primaryBtn, secondaryBtn } from '../ui.ts';

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

interface NumberInputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  min: number;
  max: number;
  step?: number;
  integer?: boolean;
  nullable?: boolean;
  placeholder?: string;
}

function NumberInput({ value, onChange, min, max, step = 1, integer = false, nullable = false, placeholder }: NumberInputProps) {
  const [text, setText] = useState(value === null ? '' : String(value));
  return (
    <input
      type="number"
      inputMode="decimal"
      className={input}
      value={text}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw === '') {
          if (nullable) onChange(null);
          return;
        }
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

export function ConfigEditor({ config }: { config: AnchorConfig }) {
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers });
  const [draft, setDraft] = useState(config);

  const set = (patch: Partial<AnchorConfig>) => setDraft((d) => ({ ...d, ...patch }));
  const setStrategy = (patch: Partial<ReplyStrategy>) => setDraft((d) => ({ ...d, strategy: { ...d.strategy, ...patch } }));
  const setWeight = (key: keyof PriorityWeights, v: number) =>
    setDraft((d) => ({ ...d, strategy: { ...d.strategy, weights: { ...d.strategy.weights, [key]: v } } }));

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const refreshAnchor = () => {
    queryClient.invalidateQueries({ queryKey: ['anchor', config.anchorName] });
    queryClient.invalidateQueries({ queryKey: ['anchors'] });
  };

  const save = useMutation({
    mutationFn: () =>
      api.updateConfig(config.id, {
        name: draft.name.trim(),
        providerId: draft.providerId,
        model: draft.model?.trim() || null,
        temperature: draft.temperature,
        maxTokens: draft.maxTokens,
        contextTurns: draft.contextTurns,
        replyRules: draft.replyRules,
        proactivePrompt: draft.proactivePrompt,
        strategy: draft.strategy,
      }),
    onSuccess: (saved) => {
      setDraft(saved);
      refreshAnchor();
    },
  });
  const remove = useMutation({ mutationFn: () => api.deleteConfig(config.id), onSuccess: refreshAnchor });

  const provider = providers.data?.find((p) => p.id === draft.providerId);
  const s = draft.strategy;

  return (
    <form
      className={`${card} space-y-5`}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-medium">编辑配置</h3>
        {dirty && <span className="text-xs text-amber-600">有未保存的修改</span>}
        <button type="submit" className={primaryBtn} disabled={!dirty || !draft.name.trim() || save.isPending}>
          {save.isPending ? '保存中…' : '保存配置'}
        </button>
        <button type="button" className={`${secondaryBtn} text-red-600`} onClick={() => confirm(`删除配置「${config.name}」？`) && remove.mutate()}>
          删除
        </button>
      </div>
      {save.error && <p className="text-xs text-red-600">{save.error.message}</p>}
      {remove.error && <p className="text-xs text-red-600">{remove.error.message}</p>}

      <Section title="模型">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="配置名称">
            <input className={input} value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} required />
          </Field>
          <Field label="模型服务" hint={providers.data?.length === 0 ? '还没有服务商，先去「模型服务」新增' : undefined}>
            <select className={input} value={draft.providerId ?? ''} onChange={(e) => set({ providerId: e.target.value || null })}>
              <option value="">未绑定</option>
              {providers.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="模型" hint={provider?.defaultModel ? `留空使用服务商默认模型 ${provider.defaultModel}` : undefined}>
            <input
              className={input}
              list={`cfg-models-${config.id}`}
              value={draft.model ?? ''}
              onChange={(e) => set({ model: e.target.value })}
              placeholder="模型 ID"
            />
            <datalist id={`cfg-models-${config.id}`}>
              {provider?.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </datalist>
          </Field>
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
              {STRATEGY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {STRATEGY_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="最小回复间隔（秒）" hint="两次发言之间至少隔多久">
            <NumberInput value={s.minGapSec} onChange={(v) => v !== null && setStrategy({ minGapSec: v })} min={0} max={600} step={0.5} />
          </Field>
          {s.kind !== 'each' && (
            <>
              <Field label="合并窗口（秒）" hint="第一条弹幕到达后等多久再一起回">
                <NumberInput value={s.mergeWindowSec} onChange={(v) => v !== null && setStrategy({ mergeWindowSec: v })} min={0} max={600} step={0.5} />
              </Field>
              <Field label="单次最多回应" hint={s.kind === 'window' ? '超出时回应最新的几条' : '超出时按下面的权重挑选'}>
                <NumberInput value={s.maxBatch} onChange={(v) => v !== null && setStrategy({ maxBatch: v })} min={1} max={50} integer />
              </Field>
            </>
          )}
          <Field label="冷场主动发言（秒）" hint="多久没有弹幕就主动找话题，0 表示关闭">
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
          <span>
            让模型判断回应哪几条弹幕
            <span className="block text-xs text-neutral-500">会多一次模型调用，先从待回复的弹幕里挑出最多「单次最多回应」条，耗时计入回复延迟。</span>
          </span>
        </label>
        <p className="text-xs text-neutral-500">回复策略在直播间模拟里生效；试播是手动触发，不受策略影响。</p>
      </Section>

      <Section title="提示词">
        <Field label="回复要求" hint="拼在人设后面，告诉模型弹幕的格式和回复方式">
          <textarea className={`${input} min-h-24`} value={draft.replyRules} onChange={(e) => set({ replyRules: e.target.value })} />
        </Field>
        <Field label="主动发言提示" hint="冷场时发给模型的提示">
          <textarea className={`${input} min-h-16`} value={draft.proactivePrompt} onChange={(e) => set({ proactivePrompt: e.target.value })} />
        </Field>
        <button type="button" className={secondaryBtn} onClick={() => set({ replyRules: DEFAULT_REPLY_RULES, proactivePrompt: DEFAULT_PROACTIVE_PROMPT })}>
          恢复默认提示词
        </button>
      </Section>
    </form>
  );
}
