import { RULE_KEYS, RULE_LABELS, turnLlmScore } from '@lce/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type EvalDetail, type EvalItemView } from '../api.ts';
import { card, emptyState, input, listItem, primaryBtn, secondaryBtn } from '../ui.ts';
import { usePersistentState } from '../usePersistentState.ts';

const STATUS: Record<EvalDetail['status'], string> = { running: '评估中', done: '已完成', stopped: '已停止', error: '出错' };
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(1));
const tone = (n: number | null) => (n === null ? 'text-neutral-400' : n >= 80 ? 'text-emerald-600' : n >= 60 ? 'text-amber-600' : 'text-red-600');

function Bar({ value }: { value: number | null }) {
  return (
    <div className="h-1.5 w-full rounded bg-neutral-100 dark:bg-neutral-800">
      <div className="h-1.5 rounded bg-sky-500" style={{ width: `${value ?? 0}%` }} />
    </div>
  );
}

function StartPanel({ onStarted }: { onStarted: (id: string) => void }) {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions });
  const rubrics = useQuery({ queryKey: ['rubrics'], queryFn: api.rubrics });
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers });
  const [sessionId, setSessionId] = usePersistentState<string | null>('lce.eval.session', null);
  const [rubricId, setRubricId] = usePersistentState<string | null>('lce.eval.rubric', null);
  const [providerId, setProviderId] = usePersistentState<string | null>('lce.eval.provider', null);
  const [model, setModel] = usePersistentState('lce.eval.model', '');
  const [temperature, setTemperature] = usePersistentState('lce.eval.temperature', 0);
  const [samples, setSamples] = usePersistentState('lce.eval.samples', 1);

  const done = sessions.data?.filter((s) => s.status !== 'running') ?? [];
  const session = done.find((s) => s.id === sessionId) ?? done[0];
  const rubric = rubrics.data?.find((r) => r.id === rubricId) ?? rubrics.data?.[0];
  const provider = providers.data?.find((p) => p.id === providerId) ?? providers.data?.[0];
  const start = useMutation({
    mutationFn: () => api.startEval({ sessionId: session!.id, rubricId: rubric!.id, providerId: provider?.id, model: model.trim() || undefined, temperature, samples }),
    onSuccess: (ev) => {
      qc.invalidateQueries({ queryKey: ['evals'] });
      onStarted(ev.id);
    },
  });

  return (
    <section className={`${card} space-y-3`}>
      <h2 className="text-sm font-medium">发起评估</h2>
      <label className="block space-y-1">
        <span className="text-xs text-neutral-500">会话</span>
        <select className={input} value={session?.id ?? ''} onChange={(e) => setSessionId(e.target.value)}>
          {done.length === 0 && <option value="">还没有会话</option>}
          {done.map((s) => (
            <option key={s.id} value={s.id}>
              {s.anchorName} · {s.title ?? s.externalId ?? s.id.slice(0, 8)} · {s.messageCount} 条
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-neutral-500">评分模板</span>
        <select className={input} value={rubric?.id ?? ''} onChange={(e) => setRubricId(e.target.value)}>
          {rubrics.data?.length === 0 && <option value="">先去「评分模板」新建</option>}
          {rubrics.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-xs text-neutral-500">裁判模型服务</span>
          <select className={input} value={provider?.id ?? ''} onChange={(e) => setProviderId(e.target.value)}>
            {providers.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-neutral-500">模型</span>
          <input className={input} list="eval-models" value={model} placeholder={provider?.defaultModel ?? ''} onChange={(e) => setModel(e.target.value)} />
          <datalist id="eval-models">
            {provider?.models.map((m) => <option key={m.id} value={m.id} />)}
          </datalist>
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-neutral-500">温度</span>
          <input type="number" className={input} min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value) || 0)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-neutral-500">每条打分次数（取平均）</span>
          <select className={input} value={samples} onChange={(e) => setSamples(Number(e.target.value))}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <button type="button" className={`${primaryBtn} w-full`} disabled={!session || !rubric || start.isPending} onClick={() => start.mutate()}>
        开始评估
      </button>
      {start.error && <p className="text-xs text-red-600">{start.error.message}</p>}
    </section>
  );
}

function TurnRow({ it, detail }: { it: EvalItemView; detail: EvalDetail }) {
  const rules = it.seq === null ? undefined : detail.rules.turns[it.seq];
  const llm = turnLlmScore(detail.rubric, it);
  const dims = detail.rubric.dimensions.filter((d) => it.scores?.[d.key]);
  return (
    <li className="space-y-1 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <span>{it.kind === 'session' ? '整场' : `#${it.seq}${it.proactive ? ' · 主动发言' : ''}`}</span>
        {it.status === 'done' && <span className={`font-medium ${tone(llm)}`}>LLM {fmt(llm)}</span>}
        {it.status === 'pending' && <span>等待打分</span>}
        {it.status === 'skipped' && <span>不需要 LLM 评</span>}
        {it.status === 'error' && <span className="text-red-600">打分失败：{it.error}</span>}
        {rules?.latency && <span>延迟 {((rules.latency.value ?? 0) / 1000).toFixed(1)}s</span>}
        {rules?.aiPhrases?.hits?.length ? <span className="text-amber-600">AI 腔：{rules.aiPhrases.hits.join('、')}</span> : null}
      </div>
      {it.text && <p className="whitespace-pre-wrap">{it.text}</p>}
      {dims.length > 0 && (
        <ul className="grid gap-0.5 text-xs">
          {dims.map((d) => (
            <li key={d.key}>
              <span className="font-medium">{d.name} {it.scores![d.key]!.score}</span>
              <span className="text-neutral-500"> · {it.scores![d.key]!.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Report({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['eval', id], queryFn: () => api.evalDetail(id) });
  const [live, setLive] = useState<EvalDetail | null>(null);
  const running = (live ?? detail.data)?.status === 'running';

  useEffect(() => {
    if (!running) return;
    return api.subscribeEval(id, (ev: any) => {
      if (ev.type === 'hello') setLive(ev.eval);
      else if (ev.type === 'item')
        setLive((d) => (d ? { ...d, summary: ev.summary, calls: ev.calls, items: d.items.map((x) => (x.id === ev.item.id ? ev.item : x)) } : d));
      else {
        setLive(null);
        qc.invalidateQueries({ queryKey: ['eval', id] });
        qc.invalidateQueries({ queryKey: ['evals'] });
      }
    });
  }, [id, running, qc]);

  const stop = useMutation({ mutationFn: () => api.stopEval(id) });
  const remove = useMutation({
    mutationFn: () => api.deleteEval(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evals'] });
      onDeleted();
    },
  });

  const d = live ?? detail.data;
  if (!d) return <p className="text-sm text-neutral-500">{detail.error?.message ?? '加载中…'}</p>;
  const s = d.summary;
  const done = s.judged + s.failed;
  const total = done + s.pending;

  return (
    <div className="space-y-4">
      <section className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-start gap-2">
          <div className="mr-auto">
            <h2 className="font-medium">
              {d.anchorName} <span className="text-sm text-neutral-500">{d.sessionTitle}</span>
            </h2>
            <p className="text-xs text-neutral-500">
              {d.rubricName} · {d.providerName ? `${d.providerName} / ${d.model}` : '只用规则'} · {STATUS[d.status]}
              {total > 0 && ` · 已打分 ${done}/${total}`} · 调用 {d.calls} 次
            </p>
            {d.error && <p className="text-xs text-red-600">{d.error}</p>}
          </div>
          {running && (
            <button type="button" className={secondaryBtn} onClick={() => stop.mutate()}>
              停止
            </button>
          )}
          <button type="button" className={`${secondaryBtn} text-red-600`} onClick={() => confirm('删除这份评估报告？') && remove.mutate()}>
            删除
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          {(
            [
              ['综合指数', s.composite],
              ['规则基础分', s.ruleScore],
              ['LLM 裁判分', s.llmScore],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="rounded bg-neutral-50 p-3 dark:bg-neutral-800">
              <div className={`text-2xl font-semibold ${tone(v)}`}>{fmt(v)}</div>
              <div className="text-xs text-neutral-500">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className={`${card} grid gap-4 md:grid-cols-2`}>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">LLM 维度</h3>
          {s.dimensions.map((dim) => (
            <div key={dim.key} className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>
                  {dim.name} <span className="text-xs text-neutral-500">{dim.scope === 'session' ? '整场' : '逐条'} · 权重 {dim.weight}</span>
                </span>
                <span className={tone(dim.score100)}>{fmt(dim.score100)}</span>
              </div>
              <Bar value={dim.score100} />
            </div>
          ))}
          {s.dimensions.length === 0 && <p className="text-xs text-neutral-500">这个模板没有启用 LLM 维度</p>}
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">规则基础分</h3>
          {RULE_KEYS.filter((k) => d.rules.session[k]).map((k) => {
            const m = d.rules.session[k]!;
            return (
              <div key={k} className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>{RULE_LABELS[k]}</span>
                  <span className={tone(m.score)}>{fmt(m.score)}</span>
                </div>
                <Bar value={m.score} />
              </div>
            );
          })}
        </div>
      </section>

      <section className={`${card} space-y-2`}>
        <h3 className="text-sm font-medium">逐条明细</h3>
        <ul className="space-y-2">
          {d.items.map((it) => (
            <TurnRow key={it.id} it={it} detail={d} />
          ))}
        </ul>
      </section>
    </div>
  );
}

export function EvalsPage() {
  const list = useQuery({ queryKey: ['evals'], queryFn: () => api.evals() });
  const [selected, setSelected] = usePersistentState<string | null>('lce.selectedEval', null);
  const active = list.data?.find((e) => e.id === selected) ?? list.data?.[0] ?? null;
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-4">
        <StartPanel onStarted={setSelected} />
        <section className={`${card} space-y-1`}>
          <h2 className="mb-1 text-sm font-medium">评估报告</h2>
          {list.data?.length === 0 && <p className="text-sm text-neutral-500">还没有评估</p>}
          <ul className="space-y-1">
            {list.data?.map((e) => (
              <li key={e.id}>
                <button type="button" className={listItem(e.id === active?.id)} onClick={() => setSelected(e.id)}>
                  <span className={`mr-2 font-medium ${tone(e.composite)}`}>{fmt(e.composite)}</span>
                  {e.anchorName}
                  <span className="ml-2 text-xs text-neutral-500">
                    {e.rubricName} · {STATUS[e.status]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </aside>
      <main>{active ? <Report key={active.id} id={active.id} onDeleted={() => setSelected(null)} /> : <div className={emptyState}>选一场会话和评分模板，开始评估</div>}</main>
    </div>
  );
}
