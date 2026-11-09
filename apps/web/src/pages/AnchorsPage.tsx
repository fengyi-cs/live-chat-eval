import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type AnchorDetail, type AnchorSource } from '../api.ts';
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

export const SOURCE_LABEL: Record<AnchorSource, string> = { import: '导入', manual: '手建' };

const sourceTone: Record<AnchorSource, string> = {
  import: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200',
  manual: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
};

export function SourceBadge({ source }: { source: AnchorSource }) {
  return <span className={`rounded px-1 text-xs ${sourceTone[source]}`}>{SOURCE_LABEL[source]}</span>;
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
  const [code, setCode] = useState<string | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['anchor', name] });
    queryClient.invalidateQueries({ queryKey: ['anchors'] });
  };
  const saveCode = useMutation({
    mutationFn: (value: string) => api.updateAnchor(name, { code: value.trim() || null }),
    onSuccess: () => {
      setCode(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteAnchor(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['anchors'] });
      onDeleted();
    },
  });

  if (detail.isPending) return <p className="text-sm text-neutral-500">加载中…</p>;
  if (detail.error) return <p className="text-sm text-red-600">{detail.error.message}</p>;

  const a = detail.data;
  const codeDraft = code ?? a.code ?? '';

  return (
    <div className="space-y-4">
      <section className={`${card} flex flex-wrap items-start gap-2`}>
        <div className="mr-auto space-y-1">
          <h2 className="flex items-center gap-2 font-medium">
            {a.name}
            <SourceBadge source={a.source} />
          </h2>
          <p className="text-xs text-neutral-500">{a.sessionCount} 个会话</p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveCode.mutate(codeDraft);
          }}
        >
          <input className={`${input} w-32`} value={codeDraft} onChange={(e) => setCode(e.target.value)} placeholder="编号（可选）" aria-label="主播编号" maxLength={50} />
          <button type="submit" className={secondaryBtn} disabled={code === null || saveCode.isPending}>
            保存编号
          </button>
        </form>
        <button type="button" className={`${secondaryBtn} text-red-600`} onClick={() => confirm(`删除主播「${a.name}」？`) && remove.mutate()}>
          删除主播
        </button>
        {saveCode.error && <p className="w-full text-xs text-red-600">{saveCode.error.message}</p>}
        {remove.error && <p className="w-full text-xs text-red-600">{remove.error.message}</p>}
      </section>

      <PersonaEditor key={a.name} anchor={a} />
    </div>
  );
}

function ConfigLibrary() {
  const queryClient = useQueryClient();
  const configs = useQuery({ queryKey: ['allConfigs'], queryFn: api.allConfigs });
  const [selected, setSelected] = usePersistentState<string | null>('lce.selectedConfig', null);
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
    <div className="space-y-4">
      <section className={`${card} space-y-2`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-medium">回复配置</h2>
          <button type="button" className={secondaryBtn} disabled={add.isPending} onClick={() => add.mutate(list.map((c) => c.name))}>
            新增配置
          </button>
        </div>
        <p className="text-xs text-neutral-500">一套回复配置决定用哪个模型、按什么策略回弹幕，和主播的人设分开，任何主播都能用。开播时选「主播 + 回复配置」。</p>
        {configs.error && <p className="text-xs text-red-600">{configs.error.message}</p>}
        {list.length > 0 && (
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="回复配置">
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={c.id === config?.id}
                onClick={() => setSelected(c.id)}
                className={`rounded-full border px-3 py-1 text-sm ${
                  c.id === config?.id
                    ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                    : 'border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
                }`}
              >
                {c.name}
                {!c.modelAvailable && <span className="ml-1 text-amber-500" title="没有可用模型">!</span>}
              </button>
            ))}
          </div>
        )}
        {add.error && <p className="text-xs text-red-600">{add.error.message}</p>}
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
  const [newCode, setNewCode] = useState('');

  const create = useMutation({
    mutationFn: () => api.createAnchor({ name: newName.trim(), code: newCode.trim() || null }),
    onSuccess: (a) => {
      queryClient.invalidateQueries({ queryKey: ['anchors'] });
      setSelected(a.name);
      setNewName('');
      setNewCode('');
    },
  });

  const active = anchors.data?.find((a) => a.name === selected) ?? anchors.data?.[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className={`${card} space-y-3 self-start`}>
          <h2 className="text-sm font-medium">主播</h2>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) create.mutate();
            }}
          >
            <input className={input} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新主播名字" aria-label="新主播名字" maxLength={100} />
            <div className="flex gap-2">
              <input className={input} value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="编号（可选）" aria-label="新主播编号" maxLength={50} />
              <button type="submit" className={secondaryBtn} disabled={!newName.trim() || create.isPending}>
                新增
              </button>
            </div>
          </form>
          {create.error && <p className="text-xs text-red-600">{create.error.message}</p>}
          {anchors.isPending && <p className="text-sm text-neutral-500">加载中…</p>}
          {anchors.error && <p className="text-sm text-red-600">{anchors.error.message}</p>}
          {anchors.data?.length === 0 && <p className="text-sm text-neutral-500">导入聊天记录时会自动建档，也可以在这里手动新增。</p>}
          <ul className="space-y-1">
            {anchors.data?.map((a) => (
              <li key={a.name}>
                <button type="button" onClick={() => setSelected(a.name)} className={listItem(a.name === active?.name)}>
                  <span className="flex items-center gap-1.5">
                    {a.name}
                    {a.code && <span className="text-xs text-neutral-500">{a.code}</span>}
                    <SourceBadge source={a.source} />
                  </span>
                  <span className="text-xs text-neutral-500">
                    {a.sessionCount} 会话{!a.personaPrompt.trim() && ' · 无人设'}
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
            <div className={emptyState}>新增一个主播，或者先去「场次库」导入一份记录</div>
          )}
        </main>
      </div>
      <ConfigLibrary />
    </div>
  );
}
