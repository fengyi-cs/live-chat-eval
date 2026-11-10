import { PROVIDER_KIND_LABELS, PROVIDER_KINDS, type ProbeAttempt, type ProviderKind } from '@lce/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, ChevronsUpDownIcon, PlusIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type PingResponse, type Provider, type ProviderInput } from '../api.ts';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../components/ui/command.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.tsx';
import { cn } from '../lib/utils.ts';
import { card, input, listItem, primaryBtn, secondaryBtn } from '../ui.ts';
import { usePersistentState } from '../usePersistentState.ts';
import { HintBubble } from '../components/HintBubble.tsx';

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
        <Select value={kind} onValueChange={(v) => setKind(v as ProviderKind | 'auto')}>
          <SelectTrigger className="h-8 w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">自动识别（保存后依次尝试各种格式，用拉到模型的那一种）</SelectItem>
            {PROVIDER_KINDS.map((k) => (
              <SelectItem key={k} value={k}>{PROVIDER_KIND_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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

function ModelSelector({ choices, value, onChange }: { choices: string[]; value: string; onChange: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const term = search.trim();
  const pick = (m: string) => {
    onChange(m);
    setSearch('');
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-left text-sm dark:border-neutral-700"
        >
          <span className={cn('truncate', !value && 'text-neutral-400')}>{value || '选择模型'}</span>
          <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
        <Command>
          <CommandInput value={search} onValueChange={setSearch} placeholder="搜索模型，或输入模型 ID 测试" />
          <CommandList className="max-h-64">
            <CommandEmpty>{term ? null : '没有匹配的模型'}</CommandEmpty>
            {term && !choices.includes(term) && (
              <CommandItem value={`__custom__ ${term}`} onSelect={() => pick(term)}>
                <PlusIcon className="size-4" />
                测试「{term}」
              </CommandItem>
            )}
            {choices.map((m) => (
              <CommandItem key={m} value={m} onSelect={() => pick(m)}>
                <CheckIcon className={cn('size-4', m === value ? 'opacity-100' : 'opacity-0')} />
                <span className="truncate">{m}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

type PingResult = ({ status: 'ok' } & PingResponse) | { status: 'error'; model: string; error: string };

function PingPongTest({ provider }: { provider: Provider }) {
  const queryClient = useQueryClient();
  const choices = provider.enabledModels.length ? provider.enabledModels : provider.models.map((m) => m.id);
  const [model, setModel] = usePersistentState('lce.ping.model', '');
  const [result, setResult] = useState<PingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const effectiveModel = model || choices[0] || '';
  useEffect(() => setResult(null), [provider.id]);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async () => {
    if (busy || !effectiveModel) return;
    setResult(null);
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await api.pingProvider(provider.id, effectiveModel, ctrl.signal);
      setResult({ status: 'ok', ...res });
      if (res.previousKind) queryClient.invalidateQueries({ queryKey: ['providers'] });
    } catch (err) {
      if (!ctrl.signal.aborted) setResult({ status: 'error', model: effectiveModel, error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-medium">模型连通性测试</h2>
        {busy ? (
          <button type="button" className={secondaryBtn} onClick={() => abort.current?.abort()}>
            取消
          </button>
        ) : (
          <button type="button" className={primaryBtn} disabled={!effectiveModel} onClick={() => void run()}>
            测试连通性
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-400">点击按钮自动发送 ping，验证模型是否可用</p>
      <div className="space-y-1">
        <span className="text-xs text-neutral-500">模型（默认列出模型池，可手动输入其他模型 ID）</span>
        <ModelSelector choices={choices} value={effectiveModel} onChange={setModel} />
      </div>
      {busy && (
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <span className="size-2 animate-pulse rounded-full bg-sky-400" />
          正在测试…
        </div>
      )}
      {result && !busy && (
        <div className={`rounded-lg border p-3 text-sm ${result.status === 'ok' ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/50' : 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/50'}`}>
          {result.status === 'ok' ? (
            <>
              <p className="font-medium text-green-700 dark:text-green-300">✓ 连通正常</p>
              <p className="mt-1 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{result.reply.trim() || '（空回复）'}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {result.model} · {PROVIDER_KIND_LABELS[result.kind]} · 首字 {result.firstTokenMs ?? '-'}ms · 总耗时 {result.totalMs}ms
              </p>
              {result.previousKind && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                  「{PROVIDER_KIND_LABELS[result.previousKind]}」格式不可用，已自动切换为「{PROVIDER_KIND_LABELS[result.kind]}」
                </p>
              )}
            </>
          ) : (
            <>
              <p className="font-medium text-red-700 dark:text-red-300">✗ 连接失败</p>
              <p className="mt-1 whitespace-pre-wrap text-red-600 dark:text-red-400">{result.error}</p>
              <p className="mt-1 text-xs text-neutral-500">{result.model}</p>
            </>
          )}
        </div>
      )}
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
  const [poolOpen, setPoolOpen] = useState(false);
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
    <section className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-medium">模型池</h3>
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

      {/* Selected model chips + pool manager */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-start gap-1.5">
          {provider.enabledModels.length === 0 ? (
            <span className="text-xs text-neutral-400">暂无已启用模型，点「管理模型」添加</span>
          ) : (
            provider.enabledModels.map((m) => (
              <span key={m} className="flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-xs text-indigo-700 dark:bg-indigo-950/50 dark:border-indigo-800 dark:text-indigo-300">
                {m}
                <button
                  type="button"
                  className="ml-0.5 rounded-full text-indigo-400 hover:text-indigo-600 dark:text-indigo-500 dark:hover:text-indigo-300"
                  onClick={() => toggle(m)}
                  aria-label={`移除 ${m}`}
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            ))
          )}
        </div>
        <Popover open={poolOpen} onOpenChange={setPoolOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              role="combobox"
              aria-expanded={poolOpen}
              className="flex items-center gap-2 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-left text-sm transition-colors hover:bg-neutral-50 hover:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800/60 dark:hover:border-neutral-600"
            >
              <span className="flex-1 text-sm">管理模型</span>
              {provider.enabledModels.length > 0 && (
                <span className="rounded-full bg-indigo-100 px-1.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
                  {provider.enabledModels.length}
                </span>
              )}
              <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
            <Command>
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
          </PopoverContent>
        </Popover>
      </div>
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
      <PingPongTest provider={provider} />
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
                className={listItem(p.id === active?.id && !editing)}
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
          <>
            <HintBubble
              storageKey="lce.hint.providers"
              title="第一次设置？"
              tone="info"
            >
              填入模型服务商的接口地址和 API Key，保存后会自动拉取可用模型列表。推荐先用 DeepSeek 或 OpenAI 等 OpenAI 兼容接口。
            </HintBubble>
            <ProviderDetail key={active.id} provider={active} onEdit={() => setEditing(active.id)} autoDetect={detectFor === active.id} />
          </>
        ) : (
          <>
            <HintBubble
              storageKey="lce.hint.providersEmpty"
              title="从这里开始"
              tone="info"
              action={
                <button type="button" className={primaryBtn} onClick={() => setEditing('new')}>新增服务商</button>
              }
            >
              添加一个模型服务商（如 DeepSeek、OpenAI），填入接口地址和 API Key，保存后会自动拉取可用模型。这是开始使用前唯一需要手动配置的步骤。
            </HintBubble>
            <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
              新增一个服务商，填好地址和 Key，保存后会自动拉取模型；勾选要用的模型加入模型池
            </div>
          </>
        )}
      </main>
    </div>
  );
}
