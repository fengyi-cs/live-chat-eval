import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type AnchorDetail } from '../api.ts';
import { card, emptyState, input, listItem, primaryBtn, secondaryBtn } from '../ui.ts';
import { usePersistentState } from '../usePersistentState.ts';
import { ConfigEditor } from './ConfigEditor.tsx';
import { TrialPanel } from './TrialPanel.tsx';

const MAX_PERSONA_FILE_BYTES = 1_000_000;

function PersonaEditor({ anchor }: { anchor: AnchorDetail }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(anchor.personaPrompt);
  const [fileError, setFileError] = useState<string | null>(null);
  const dirty = draft !== anchor.personaPrompt;

  const save = useMutation({
    mutationFn: () => api.updateAnchor(anchor.name, { personaPrompt: draft }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['anchor', anchor.name] });
      queryClient.invalidateQueries({ queryKey: ['anchors'] });
    },
  });

  const onFile = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_PERSONA_FILE_BYTES) {
      setFileError('文件超过 1MB，请检查是否选错了文件');
      return;
    }
    const text = await file.text();
    if (draft.trim() && !confirm(`用「${file.name}」的内容替换当前人设？`)) return;
    setDraft(text);
  };

  return (
    <section className={`${card} space-y-2`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-medium">人设 prompt</h3>
        <label className={`${secondaryBtn} cursor-pointer`}>
          上传文件
          <input
            type="file"
            accept=".md,.markdown,.txt,.prompt"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <button type="button" className={primaryBtn} disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? '保存中…' : '保存人设'}
        </button>
      </div>
      <textarea
        aria-label="人设 prompt"
        className={`${input} min-h-64 font-mono leading-relaxed`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="主播的人设、性格、说话习惯、背景故事……可以直接粘贴，也可以上传 .md / .txt 文件"
      />
      <p className="text-xs text-neutral-500">
        {draft.length} 字{dirty && <span className="text-amber-600"> · 有未保存的修改</span>}
        {!draft.trim() && ` · 留空时只告诉模型「你是直播间主播「${anchor.name}」」`}
      </p>
      {fileError && <p className="text-xs text-red-600">{fileError}</p>}
      {save.error && <p className="text-xs text-red-600">{save.error.message}</p>}
    </section>
  );
}

function nextConfigName(existing: readonly string[]) {
  const taken = new Set(existing);
  let i = existing.length + 1;
  while (taken.has(`配置 ${i}`)) i++;
  return `配置 ${i}`;
}

function AnchorView({ name, onDeleted }: { name: string; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['anchor', name], queryFn: () => api.anchor(name) });
  const [selectedConfig, setSelectedConfig] = usePersistentState<string | null>(`lce.anchorConfig.${name}`, null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['anchor', name] });
    queryClient.invalidateQueries({ queryKey: ['anchors'] });
  };
  const remove = useMutation({
    mutationFn: () => api.deleteAnchor(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['anchors'] });
      onDeleted();
    },
  });
  const addConfig = useMutation({
    mutationFn: (names: string[]) => api.createConfig(name, { name: nextConfigName(names) }),
    onSuccess: (cfg) => {
      refresh();
      setSelectedConfig(cfg.id);
    },
  });

  if (detail.isPending) return <p className="text-sm text-neutral-500">加载中…</p>;
  if (detail.error) return <p className="text-sm text-red-600">{detail.error.message}</p>;

  const a = detail.data;
  const config = a.configs.find((c) => c.id === selectedConfig) ?? a.configs[0] ?? null;

  return (
    <div className="space-y-4">
      <section className={`${card} flex flex-wrap items-start gap-2`}>
        <div className="mr-auto">
          <h2 className="font-medium">
            {a.name}
            {a.code && <span className="ml-2 text-sm text-neutral-500">{a.code}</span>}
          </h2>
          <p className="text-xs text-neutral-500">
            {a.sessionCount} 个会话 · {a.configs.length} 套配置
          </p>
        </div>
        <button type="button" className={`${secondaryBtn} text-red-600`} onClick={() => confirm(`删除主播「${a.name}」及其所有配置？`) && remove.mutate()}>
          删除主播
        </button>
        {remove.error && <p className="w-full text-xs text-red-600">{remove.error.message}</p>}
      </section>

      <PersonaEditor key={a.name} anchor={a} />

      <section className={`${card} space-y-2`}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-sm font-medium">主播配置</h3>
          <button
            type="button"
            className={secondaryBtn}
            disabled={addConfig.isPending}
            onClick={() => addConfig.mutate(a.configs.map((c) => c.name))}
          >
            新增配置
          </button>
        </div>
        {a.configs.length === 0 ? (
          <p className="text-sm text-neutral-500">还没有配置。一套配置决定主播用哪个模型、按什么策略回复弹幕，可以建多套做对比。</p>
        ) : (
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="主播配置">
            {a.configs.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={c.id === config?.id}
                onClick={() => setSelectedConfig(c.id)}
                className={`rounded-full border px-3 py-1 text-sm ${
                  c.id === config?.id
                    ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                    : 'border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        {addConfig.error && <p className="text-xs text-red-600">{addConfig.error.message}</p>}
      </section>

      {config && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <ConfigEditor key={config.id} config={config} />
          <TrialPanel key={config.id} config={config} />
        </div>
      )}
    </div>
  );
}

export function AnchorsPage() {
  const queryClient = useQueryClient();
  const anchors = useQuery({ queryKey: ['anchors'], queryFn: api.anchors });
  const [selected, setSelected] = usePersistentState<string | null>('lce.selectedAnchor', null);
  const [newName, setNewName] = useState('');

  const create = useMutation({
    mutationFn: () => api.createAnchor({ name: newName.trim() }),
    onSuccess: (a) => {
      queryClient.invalidateQueries({ queryKey: ['anchors'] });
      setSelected(a.name);
      setNewName('');
    },
  });

  const active = anchors.data?.find((a) => a.name === selected) ?? anchors.data?.[0] ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside className={`${card} space-y-3 self-start`}>
        <h2 className="text-sm font-medium">主播</h2>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) create.mutate();
          }}
        >
          <input className={input} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新主播名字" aria-label="新主播名字" maxLength={100} />
          <button type="submit" className={secondaryBtn} disabled={!newName.trim() || create.isPending}>
            新增
          </button>
        </form>
        {create.error && <p className="text-xs text-red-600">{create.error.message}</p>}
        {anchors.isPending && <p className="text-sm text-neutral-500">加载中…</p>}
        {anchors.error && <p className="text-sm text-red-600">{anchors.error.message}</p>}
        {anchors.data?.length === 0 && <p className="text-sm text-neutral-500">导入聊天记录时会自动建档，也可以在这里手动新增。</p>}
        <ul className="space-y-1">
          {anchors.data?.map((a) => (
            <li key={a.name}>
              <button type="button" onClick={() => setSelected(a.name)} className={listItem(a.name === active?.name)}>
                <span>{a.name}</span>
                <span className="ml-2 text-xs text-neutral-500">
                  {a.sessionCount} 会话 · {a.configCount} 配置{!a.personaPrompt.trim() && ' · 无人设'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main>
        {active ? (
          <AnchorView key={active.name} name={active.name} onDeleted={() => setSelected(null)} />
        ) : (
          <div className={emptyState}>新增一个主播，或者先去「聊天记录」导入一份记录</div>
        )}
      </main>
    </div>
  );
}
