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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type AnchorConfig, type AnchorConfigSummary } from '../api.ts';
import { ModelPicker } from '../components/ModelPicker.tsx';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet.tsx';
import { card, fieldHint, fieldLabel, input, primaryBtn, secondaryBtn } from '../ui.ts';
import { usePersistentState } from '../usePersistentState.ts';
import { TrialPanel } from './TrialPanel.tsx';

const WEIGHT_FIELDS: readonly [keyof PriorityWeights, string, string][] = [
  ['question', '提问', '弹幕中包含问号或疑问词'],
  ['mention', '@主播 / 叫名字', '弹幕中提到主播名字或 @'],
  ['gift', '礼物', '弹幕中包含送礼关键词'],
  ['newViewer', '新观众', '第一次发言的观众'],
];

const STRATEGY_DESCRIPTIONS: Record<StrategyKind, string> = {
  each: '每条弹幕单独生成一条回复。最简单直接，但弹幕密集时回复会很频繁。',
  window: '等待合并窗口内所有弹幕到齐后一起回复，超过上限时回应最新的几条。适合弹幕不太密集的场景。',
  priority: '与时间窗口类似，但超过上限时按权重打分挑选最重要的弹幕回复。适合弹幕密集的直播间。',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className={fieldLabel}>{label}</span>
      {children}
      {hint && <span className={fieldHint}>{hint}</span>}
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

function SectionCard({ title, description, icon, children }: { title: string; description?: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className={`${card} space-y-4`}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-neutral-500">{description}</p>}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ConfigEditor({ config, onDirtyChange }: { config: AnchorConfigSummary; onDirtyChange?: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AnchorConfig>({ ...config });
  const [showTrial, setShowTrial] = useState(false);

  const set = (patch: Partial<AnchorConfig>) => setDraft((d) => ({ ...d, ...patch }));
  const setStrategy = (patch: Partial<ReplyStrategy>) => setDraft((d) => ({ ...d, strategy: { ...d.strategy, ...patch } }));
  const setWeight = (key: keyof PriorityWeights, v: number) =>
    setDraft((d) => ({ ...d, strategy: { ...d.strategy, weights: { ...d.strategy.weights, [key]: v } } }));

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
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
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold">编辑回复配置</h3>
        {dirty && <span className="text-xs text-amber-600">有未保存的修改</span>}
        <button type="submit" form="config-form" className={primaryBtn} disabled={!dirty || !draft.name.trim() || save.isPending}>
          {save.isPending ? '保存中…' : '保存配置'}
        </button>
        <button type="button" className={`${secondaryBtn} text-red-600`}
          onClick={() => confirm(`删除回复配置「${config.name}」？`) && remove.mutate()}>
          删除
        </button>
        <button type="button" className={secondaryBtn} onClick={() => setShowTrial((v) => !v)}>
          {showTrial ? '收起预览' : '预览回复方案 →'}
        </button>
      </div>
      {save.error && <p className="text-xs text-red-600">{save.error.message}</p>}
      {remove.error && <p className="text-xs text-red-600">{remove.error.message}</p>}

      <form id="config-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>

        <SectionCard
          title="模型"
          description="选择驱动主播的 AI 模型和生成参数"
          icon={<svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a4 4 0 0 0-4 4v2H6a3 3 0 0 0-3 3v2a3 3 0 0 0 3 3h2v2a4 4 0 0 0 8 0v-2h2a3 3 0 0 0 3-3v-2a3 3 0 0 0-3-3h-2V6a4 4 0 0 0-4-4Z"/></svg>}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="配置名称">
              <input className={input} value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} required />
            </Field>
            <div className="space-y-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">模型</span>
              <ModelPicker value={{ providerId: draft.providerId, model: draft.model }} onChange={(v) => set(v)} />
            </div>
            <Field label="温度" hint="0 严谨、2 发散。留空使用模型默认值">
              <NumberInput value={draft.temperature} onChange={(v) => set({ temperature: v })} min={0} max={2} step={0.1} nullable placeholder="默认" />
            </Field>
            <Field label="最大输出 tokens" hint="留空不设上限，使用服务端默认">
              <NumberInput value={draft.maxTokens} onChange={(v) => set({ maxTokens: v })} min={1} max={64000} integer nullable placeholder="不限制" />
            </Field>
            <Field label="上下文轮数" hint="带上最近几轮对话作为上下文，0 表示不带">
              <NumberInput value={draft.contextTurns} onChange={(v) => v !== null && set({ contextTurns: v })} min={0} max={200} integer />
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          title="回复策略"
          description="控制主播什么时候回复、回复哪几条弹幕"
          icon={<svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>}
        >
          <div className="space-y-2">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">回复策略</span>
            <div className="grid gap-2 sm:grid-cols-3">
              {STRATEGY_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setStrategy({ kind: k })}
                  className={`rounded-lg border p-2.5 text-left transition-colors ${
                    s.kind === k
                      ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/40'
                      : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-700 dark:hover:border-neutral-600'
                  }`}
                >
                  <span className="block text-sm font-medium">{STRATEGY_KIND_LABELS[k]}</span>
                  <span className="mt-0.5 block text-xs text-neutral-500">{STRATEGY_DESCRIPTIONS[k]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="最小回复间隔（秒）" hint="两次回复之间的最短等待时间，避免回复过于频繁">
              <NumberInput value={s.minGapSec} onChange={(v) => v !== null && setStrategy({ minGapSec: v })} min={0} max={600} step={0.5} />
            </Field>
            <Field label="冷场主动发言（秒）" hint="多久没人发弹幕时主播主动说话，0 表示关闭主动发言">
              <NumberInput value={s.idleProactiveSec} onChange={(v) => v !== null && setStrategy({ idleProactiveSec: v })} min={0} max={3600} />
            </Field>
            {s.kind !== 'each' && (
              <>
                <Field label="合并窗口（秒）" hint="弹幕到达后等待多久再回复，窗口内所有弹幕合并为一次回复">
                  <NumberInput value={s.mergeWindowSec} onChange={(v) => v !== null && setStrategy({ mergeWindowSec: v })} min={0} max={600} step={0.5} />
                </Field>
                <Field label="单次最多回应" hint="一次回复最多回应几条弹幕，超过时按策略选最新的或最重要的">
                  <NumberInput value={s.maxBatch} onChange={(v) => v !== null && setStrategy({ maxBatch: v })} min={1} max={50} integer />
                </Field>
              </>
            )}
          </div>

          {s.kind === 'priority' && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">优先级权重</span>
              <p className="text-xs text-neutral-500">弹幕超过上限时按这些权重打分挑选。数值越大越优先回复。</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {WEIGHT_FIELDS.map(([key, label, desc]) => (
                  <div key={key} className="rounded-lg border border-neutral-200 p-2.5 dark:border-neutral-800">
                    <Field label={label} hint={desc}>
                      <NumberInput value={s.weights[key]} onChange={(v) => v !== null && setWeight(key, v)} min={0} max={100} step={0.5} />
                    </Field>
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-start gap-2.5 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <input type="checkbox" className="mt-0.5 size-4" checked={s.llmSelect} onChange={(e) => setStrategy({ llmSelect: e.target.checked })} />
            <div>
              <span className="text-sm font-medium">让模型判断回应哪几条弹幕</span>
              <p className="mt-0.5 text-xs text-neutral-500">不靠规则打分，而是把所有待回复弹幕发给模型，让模型自己决定回应哪几条。会多消耗 token，但更灵活。</p>
            </div>
          </label>
        </SectionCard>

        <SectionCard
          title="提示词"
          description="控制主播说话风格和回复格式"
          icon={<svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2"/><path d="M4 12h16M8 7h8"/></svg>}
        >
          <Field label="回复要求" hint="拼在主播人设后面，告诉模型弹幕的格式和回复方式。比如「用轻松的语气回弹幕，每条不超过50字」">
            <textarea className={`${input} min-h-24`} value={draft.replyRules} onChange={(e) => set({ replyRules: e.target.value })} />
          </Field>
          <Field label="主动发言提示" hint="主播主动说话时的引导提示词。比如「聊聊今天的心情或最近的事」">
            <textarea className={`${input} min-h-16`} value={draft.proactivePrompt} onChange={(e) => set({ proactivePrompt: e.target.value })} />
          </Field>
          <button type="button" className={secondaryBtn}
            onClick={() => set({ replyRules: DEFAULT_REPLY_RULES, proactivePrompt: DEFAULT_PROACTIVE_PROMPT })}>
            恢复默认提示词
          </button>
        </SectionCard>
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
  const isDirtyRef = useRef(false);
  const add = useMutation({
    mutationFn: (names: string[]) => api.createConfig({ name: nextConfigName(names) }),
    onSuccess: (cfg) => {
      queryClient.invalidateQueries({ queryKey: ['allConfigs'] });
      setSelected(cfg.id);
    },
  });
  const list = configs.data ?? [];
  const config = list.find((c) => c.id === selected) ?? list[0] ?? null;

  const guardedOpenChange = (v: boolean) => {
    if (!v && isDirtyRef.current && !confirm('有未保存的修改，确定放弃？')) return;
    isDirtyRef.current = false;
    onOpenChange(v);
  };

  return (
    <Sheet open={open} onOpenChange={guardedOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-hidden sm:max-w-2xl">
        <SheetHeader className="shrink-0">
          <SheetTitle>回复配置</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="回复配置">
              {list.map((c) => (
                <button key={c.id} type="button" role="tab" aria-selected={c.id === config?.id}
                  onClick={() => setSelected(c.id)}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    c.id === config?.id
                      ? 'border-indigo-500 bg-indigo-500 text-white'
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
            <ConfigEditor key={config.id} config={config} onDirtyChange={(v) => { isDirtyRef.current = v; }} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export type { AnchorConfigSummary };
