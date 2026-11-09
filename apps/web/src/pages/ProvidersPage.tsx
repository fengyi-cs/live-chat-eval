import { PROVIDER_KIND_LABELS, PROVIDER_KINDS, type ChatMessage, type ProbeAttempt, type ProviderKind } from '@lce/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, PlusIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type ChatDone, type Provider, type ProviderInput } from '../api.ts';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../components/ui/command.tsx';
import { cn } from '../lib/utils.ts';
import { card, input, primaryBtn, secondaryBtn } from '../ui.ts';
import { usePersistentState } from '../usePersistentState.ts';

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function ProviderForm({
  provider,
  onSaved,
  onCancel,
}: {
  provider: Provider | null;
  onSaved: (p: Provider, autoDetect: boolean) => void;
  onCancel: () => void;
}) {
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
      onSaved(p, kind === 'auto');
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
          <option value="auto">自动识别（保存后依次尝试各种格式，用拉到模型的那一种）</option>
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
  const choices = provider.enabledModels.length ? provider.enabledModels : provider.models.map((m) => m.id);
  const [model, setModel] = useState(choices[0] ?? '');
  const [system, setSystem] = usePersistentState('lce.tester.system', '');
  const [temperature, setTemperature] = usePersistentState('lce.tester.temperature', 0.8);
  const [draft, setDraft] = useState('');
  const [log, setLog] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => setModel((m) => (m && choices.includes(m) ? m : (choices[0] ?? ''))), [provider.id, choices.join('\n')]);
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
        { model, temperature, messages: system.trim() ? [{ role: 'system', content: system }, ...history] : history },
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
        <span className="text-xs text-neutral-500">模型（默认列出模型池，也可以手动输入别的模型测试）</span>
        <input className={input} list={`models-${provider.id}`} value={model} onChange={(e) => setModel(e.target.value)} placeholder="模型 ID" />
        <datalist id={`models-${provider.id}`}>
          {choices.map((m) => (
            <option key={m} value={m} />
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

function AttemptList({ attempts }: { attempts: ProbeAttempt[] }) {
  return (
    <ul className="space-y-0.5 text-xs">
      {attempts.map((a) => (
        <li key={a.kind}>
          {PROVIDER_KIND_LABELS[a.kind]}（{a.baseUrl}）：{a.error ? <span className="text-red-600">{a.error}</span> : `${a.count} 个模型`}
        </li>
      ))}
    </ul>
  );
}

function ModelPool({ provider, autoDetect }: { provider: Provider; autoDetect: boolean }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [attempts, setAttempts] = useState<ProbeAttempt[] | null>(null);
  const refresh = useMutation({
    mutationFn: (detect: boolean) => api.refreshModels(provider.id, detect),
    onSuccess: (p) => {
      setAttempts(p.attempts);
      queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
  });
  const savePool = useMutation({
    mutationFn: (enabledModels: string[]) => api.updateProvider(provider.id, { enabledModels }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['allConfigs'] });
    },
  });

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (autoDetect) refresh.mutate(true);
    else if (!provider.modelsFetchedAt) refresh.mutate(false);
  }, [autoDetect, provider.modelsFetchedAt, refresh]);

  const enabled = new Set(provider.enabledModels);
  const toggle = (id: string) => savePool.mutate(enabled.has(id) ? provider.enabledModels.filter((m) => m !== id) : [...provider.enabledModels, id]);
  const listed = new Set(provider.models.map((m) => m.id));
  const manual = provider.enabledModels.filter((m) => !listed.has(m));
  const term = search.trim();
  const canAdd = term.length > 0 && !listed.has(term) && !enabled.has(term);
  const fetchedEmpty = Boolean(provider.modelsFetchedAt) && provider.models.length === 0 && !refresh.isPending;

  const item = (id: string, name?: string) => (
    <CommandItem key={id} value={`${id} ${name ?? ''}`} onSelect={() => toggle(id)}>
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
          enabled.has(id) ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900' : 'border-neutral-300 dark:border-neutral-600',
        )}
      >
        {enabled.has(id) && <CheckIcon className="size-3" />}
      </span>
      <span className="truncate">{id}</span>
      {name && name !== id && <span className="truncate text-xs text-neutral-500">{name}</span>}
    </CommandItem>
  );

  return (
    <section className={`${card} space-y-2`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-medium">
          模型池 <span className="text-xs font-normal text-neutral-500">已启用 {provider.enabledModels.length} 个，回复配置和裁判只能选这里启用的模型</span>
        </h3>
        <button type="button" className={secondaryBtn} disabled={refresh.isPending} onClick={() => refresh.mutate(false)}>
          {refresh.isPending ? '拉取中…' : '重新拉取'}
        </button>
        <button type="button" className={secondaryBtn} disabled={refresh.isPending} onClick={() => refresh.mutate(true)}>
          自动识别格式
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        {refresh.isPending
          ? '正在拉取模型列表…'
          : provider.modelsFetchedAt
            ? `列表里有 ${provider.models.length} 个模型，更新于 ${new Date(provider.modelsFetchedAt).toLocaleString('zh-CN')}`
            : '还没有拉取过模型列表'}
      </p>
      {refresh.error && <p className="text-xs text-red-600">{refresh.error.message}</p>}
      {savePool.error && <p className="text-xs text-red-600">{savePool.error.message}</p>}
      {fetchedEmpty && (
        <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-2 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="text-xs">
            按「{PROVIDER_KIND_LABELS[provider.kind]}」格式没有拉到模型。可以点「自动识别格式」换别的接口格式试试，或在下面搜索框输入模型 ID 手动添加。
          </p>
          {attempts && <AttemptList attempts={attempts} />}
        </div>
      )}
      <Command className="rounded border border-neutral-200 bg-transparent dark:border-neutral-800">
        <CommandInput value={search} onValueChange={setSearch} placeholder="搜索模型，或输入模型 ID 手动添加" />
        <CommandList className="max-h-72">
          <CommandEmpty>{canAdd ? null : '没有匹配的模型'}</CommandEmpty>
          {canAdd && (
            <CommandGroup heading="手动添加">
              <CommandItem
                value={`__add__ ${term}`}
                onSelect={() => {
                  savePool.mutate([...provider.enabledModels, term]);
                  setSearch('');
                }}
              >
                <PlusIcon className="size-4" />
                添加「{term}」到模型池
              </CommandItem>
            </CommandGroup>
          )}
          {manual.length > 0 && <CommandGroup heading="手动添加的模型">{manual.map((m) => item(m))}</CommandGroup>}
          {provider.models.length > 0 && <CommandGroup heading="服务商返回的模型">{provider.models.map((m) => item(m.id, m.name))}</CommandGroup>}
        </CommandList>
      </Command>
    </section>
  );
}

function ProviderDetail({ provider, onEdit, autoDetect }: { provider: Provider; onEdit: () => void; autoDetect: boolean }) {
  const queryClient = useQueryClient();
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
            onClick={() => confirm(`删除服务商「${provider.name}」？用到它的回复配置会变成未选模型。`) && remove.mutate()}
          >
            删除
          </button>
        </div>
        {remove.error && <p className="text-xs text-red-600">{remove.error.message}</p>}
      </section>
      <ModelPool provider={provider} autoDetect={autoDetect} />
      <ChatTester provider={provider} />
    </div>
  );
}

export function ProvidersPage() {
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers });
  const [selected, setSelected] = usePersistentState<string | null>('lce.selectedProvider', null);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [detectFor, setDetectFor] = useState<string | null>(null);

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
                  setDetectFor(null);
                  setEditing(null);
                }}
                className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                  p.id === active?.id && !editing ? 'bg-neutral-100 font-medium dark:bg-neutral-800' : ''
                }`}
              >
                <span>{p.name}</span>
                <span className="ml-2 text-xs text-neutral-500">
                  {PROVIDER_KIND_LABELS[p.kind]} · 启用 {p.enabledModels.length} 个模型
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
            onSaved={(p, autoDetect) => {
              setSelected(p.id);
              setDetectFor(autoDetect ? p.id : null);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : active ? (
          <ProviderDetail key={active.id} provider={active} onEdit={() => setEditing(active.id)} autoDetect={detectFor === active.id} />
        ) : (
          <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
            新增一个服务商，填好地址和 Key，保存后会自动拉取模型；勾选要用的模型加入模型池
          </div>
        )}
      </main>
    </div>
  );
}
