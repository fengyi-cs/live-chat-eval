import { PROVIDER_KIND_LABELS, PROVIDER_KINDS, type ChatMessage, type ProviderKind } from '@lce/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, type ChatDone, type Provider, type ProviderInput } from '../api.ts';
import { usePersistentState } from '../usePersistentState.ts';

const card = 'rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900';
const input = 'w-full rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700';
const primaryBtn = 'shrink-0 whitespace-nowrap rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900';
const secondaryBtn = 'shrink-0 whitespace-nowrap rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800';

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function ProviderForm({ provider, onSaved, onCancel }: { provider: Provider | null; onSaved: (p: Provider) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(provider?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '');
  const [kind, setKind] = useState<ProviderKind | 'auto'>(provider ? provider.kind : 'auto');
  const [apiKey, setApiKey] = useState('');

  const debouncedUrl = useDebounced(baseUrl.trim(), 300);
  const detected = useQuery({
    queryKey: ['detect', debouncedUrl],
    queryFn: () => api.detectProvider(debouncedUrl),
    enabled: debouncedUrl.length > 0,
    retry: false,
  });

  const save = useMutation({
    mutationFn: () => {
      const body: ProviderInput = { name: name.trim(), baseUrl: baseUrl.trim(), kind: kind === 'auto' ? undefined : kind };
      if (apiKey) body.apiKey = apiKey;
      return provider ? api.updateProvider(provider.id, body) : api.createProvider(body);
    },
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      onSaved(p);
    },
  });

  return (
    <form
      className={`${card} space-y-3`}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2 className="text-sm font-medium">{provider ? `编辑：${provider.name}` : '新增服务商'}</h2>
      <label className="block space-y-1 text-sm">
        <span className="text-xs text-neutral-500">名称</span>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：DeepSeek / 公司大脑" required />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-xs text-neutral-500">接口地址</span>
        <input
          className={input}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.deepseek.com/v1，可直接粘贴完整接口地址"
          required
        />
        {detected.data && (
          <span className="block text-xs text-neutral-500">
            识别为 <b>{PROVIDER_KIND_LABELS[detected.data.kind]}</b> · 保存为 {detected.data.baseUrl}
          </span>
        )}
        {detected.error && <span className="block text-xs text-red-600">{detected.error.message}</span>}
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-xs text-neutral-500">接口类型</span>
        <select className={input} value={kind} onChange={(e) => setKind(e.target.value as ProviderKind | 'auto')}>
          <option value="auto">自动识别{detected.data ? `（${PROVIDER_KIND_LABELS[detected.data.kind]}）` : ''}</option>
          {PROVIDER_KINDS.map((k) => (
            <option key={k} value={k}>
              {PROVIDER_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-xs text-neutral-500">API Key{provider?.apiKeyMasked && `（当前 ${provider.apiKeyMasked}，留空则不修改）`}</span>
        <input className={input} type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="本地服务可留空" />
      </label>
      {save.error && <p className="text-xs text-red-600">{save.error.message}</p>}
      <div className="flex gap-2">
        <button type="submit" className={primaryBtn} disabled={save.isPending}>
          {save.isPending ? '保存中…' : '保存'}
        </button>
        <button type="button" className={secondaryBtn} onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}

interface Bubble extends ChatMessage {
  info?: ChatDone;
  error?: string;
}

function ChatTester({ provider }: { provider: Provider }) {
  const [model, setModel] = useState(provider.defaultModel ?? '');
  const [system, setSystem] = usePersistentState('lce.tester.system', '');
  const [temperature, setTemperature] = usePersistentState('lce.tester.temperature', 0.8);
  const [draft, setDraft] = useState('');
  const [log, setLog] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => setModel(provider.defaultModel ?? ''), [provider.id, provider.defaultModel]);
  useEffect(() => () => abort.current?.abort(), []);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const history: ChatMessage[] = [...log.filter((b) => !b.error).map(({ role, content }) => ({ role, content })), { role: 'user', content: text }];
    setDraft('');
    setLog((l) => [...l, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const patchLast = (fn: (b: Bubble) => Bubble) => setLog((l) => [...l.slice(0, -1), fn(l.at(-1)!)]);
    try {
      await api.streamChat(
        provider.id,
        { model: model || undefined, temperature, messages: system.trim() ? [{ role: 'system', content: system }, ...history] : history },
        { onDelta: (t) => patchLast((b) => ({ ...b, content: b.content + t })), onDone: (info) => patchLast((b) => ({ ...b, info })) },
        ctrl.signal,
      );
    } catch (err) {
      if (!ctrl.signal.aborted) patchLast((b) => ({ ...b, error: (err as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-end gap-2">
        <h2 className="mr-auto text-sm font-medium">测试对话</h2>
        <label className="text-xs text-neutral-500">
          温度 {temperature.toFixed(1)}
          <input type="range" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="ml-2 align-middle" />
        </label>
        <button type="button" className={secondaryBtn} onClick={() => setLog([])} disabled={busy || log.length === 0}>
          清空
        </button>
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-neutral-500">模型（可从列表选择，也可手动输入）</span>
        <input className={input} list={`models-${provider.id}`} value={model} onChange={(e) => setModel(e.target.value)} placeholder="模型 ID" />
        <datalist id={`models-${provider.id}`}>
          {provider.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </datalist>
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-neutral-500">系统提示词（可选，例如主播人设）</span>
        <textarea className={`${input} min-h-16`} value={system} onChange={(e) => setSystem(e.target.value)} />
      </label>
      <ul className="max-h-[50vh] space-y-2 overflow-y-auto" aria-live="polite">
        {log.map((b, i) => (
          <li key={i} className={`flex ${b.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${b.role === 'user' ? 'bg-sky-50 dark:bg-sky-950' : 'bg-neutral-100 dark:bg-neutral-800'}`}>
              <p className="whitespace-pre-wrap">{b.content || (b.error ? '' : '…')}</p>
              {b.error && <p className="text-xs text-red-600">{b.error}</p>}
              {b.info && (
                <p className="mt-1 text-xs text-neutral-500">
                  {b.info.model} · 首字 {b.info.firstTokenMs ?? '-'}ms · 总耗时 {b.info.totalMs}ms
                  {b.info.usage?.outputTokens !== undefined && ` · ${b.info.usage.inputTokens ?? '?'}→${b.info.usage.outputTokens} tokens`}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input className={input} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={model ? '发一条弹幕试试' : '先选择模型'} />
        {busy ? (
          <button type="button" className={secondaryBtn} onClick={() => abort.current?.abort()}>
            停止
          </button>
        ) : (
          <button type="submit" className={primaryBtn} disabled={!draft.trim() || !model}>
            发送
          </button>
        )}
      </form>
    </section>
  );
}

function ProviderDetail({ provider, onEdit }: { provider: Provider; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const refresh = useMutation({
    mutationFn: () => api.refreshModels(provider.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteProvider(provider.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
  });

  return (
    <div className="space-y-4">
      <section className={`${card} space-y-2`}>
        <div className="flex flex-wrap items-start gap-2">
          <div className="mr-auto min-w-0">
            <h2 className="font-medium">{provider.name}</h2>
            <p className="break-all text-xs text-neutral-500">
              {PROVIDER_KIND_LABELS[provider.kind]} · {provider.baseUrl} · Key {provider.apiKeyMasked ?? '未设置'}
            </p>
          </div>
          <button type="button" className={secondaryBtn} onClick={onEdit}>
            编辑
          </button>
          <button
            type="button"
            className={`${secondaryBtn} text-red-600`}
            onClick={() => confirm(`删除服务商「${provider.name}」？`) && remove.mutate()}
          >
            删除
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className={primaryBtn} onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            {refresh.isPending ? '拉取中…' : '拉取模型列表'}
          </button>
          <span className="text-xs text-neutral-500">
            {provider.modelsFetchedAt ? `共 ${provider.models.length} 个模型，更新于 ${new Date(provider.modelsFetchedAt).toLocaleString('zh-CN')}` : '还没有拉取过模型列表'}
          </span>
        </div>
        {refresh.error && <p className="text-xs text-red-600">{refresh.error.message}</p>}
        {remove.error && <p className="text-xs text-red-600">{remove.error.message}</p>}
      </section>
      <ChatTester provider={provider} />
    </div>
  );
}

export function ProvidersPage() {
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers });
  const [selected, setSelected] = usePersistentState<string | null>('lce.selectedProvider', null);
  const [editing, setEditing] = useState<'new' | string | null>(null);

  const active = providers.data?.find((p) => p.id === selected) ?? providers.data?.[0] ?? null;
  const editingProvider = editing && editing !== 'new' ? (providers.data?.find((p) => p.id === editing) ?? null) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside className={`${card} space-y-2 self-start`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">服务商</h2>
          <button type="button" className={secondaryBtn} onClick={() => setEditing('new')}>
            新增
          </button>
        </div>
        {providers.isPending && <p className="text-sm text-neutral-500">加载中…</p>}
        {providers.error && <p className="text-sm text-red-600">{providers.error.message}</p>}
        {providers.data?.length === 0 && <p className="text-sm text-neutral-500">还没有服务商，先新增一个。</p>}
        <ul className="space-y-1">
          {providers.data?.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  setSelected(p.id);
                  setEditing(null);
                }}
                className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                  p.id === active?.id && !editing ? 'bg-neutral-100 font-medium dark:bg-neutral-800' : ''
                }`}
              >
                <span>{p.name}</span>
                <span className="ml-2 text-xs text-neutral-500">
                  {PROVIDER_KIND_LABELS[p.kind]} · {p.models.length} 模型
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main>
        {editing ? (
          <ProviderForm
            key={editing}
            provider={editingProvider}
            onSaved={(p) => {
              setSelected(p.id);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : active ? (
          <ProviderDetail provider={active} onEdit={() => setEditing(active.id)} />
        ) : (
          <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
            新增一个服务商，填好地址和 Key 后即可拉取模型并测试对话
          </div>
        )}
      </main>
    </div>
  );
}
