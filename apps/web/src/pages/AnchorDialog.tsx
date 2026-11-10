import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, type AnchorDetail, type AnchorSource } from '../api.ts';
import { ModelPicker } from '../components/ModelPicker.tsx';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog.tsx';
import { usePersistentState } from '../usePersistentState.ts';
import { card, input, listItem, primaryBtn, secondaryBtn } from '../ui.ts';
import { ConfigSheet } from './ConfigSheet.tsx';

const MAX_PERSONA_FILE_BYTES = 1_000_000;

const SOURCE_LABEL: Record<AnchorSource, string> = { import: '导入', manual: '手建' };

const sourceTone: Record<AnchorSource, string> = {
  import: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200',
  manual: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
};

function SourceBadge({ source }: { source: AnchorSource }) {
  return <span className={`rounded px-1 text-xs ${sourceTone[source]}`}>{SOURCE_LABEL[source]}</span>;
}

function PersonaEditor({ anchor, onDirtyChange }: { anchor: AnchorDetail; onDirtyChange?: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(anchor.personaPrompt);
  const [fileError, setFileError] = useState<string | null>(null);
  const dirty = draft !== anchor.personaPrompt;

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

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
    if (file.size > MAX_PERSONA_FILE_BYTES) { setFileError('文件超过 1MB'); return; }
    const text = await file.text();
    if (draft.trim() && !confirm(`用「${file.name}」的内容替换当前人设？`)) return;
    setDraft(text);
  };

  return (
    <section className={`${card} space-y-2`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-medium">主播人设</h3>
        <label className={`${secondaryBtn} cursor-pointer`}>
          上传文件
          <input type="file" accept=".md,.markdown,.txt,.prompt" className="hidden"
            onChange={(e) => { void onFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
        </label>
        <button type="button" className={primaryBtn} disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? '保存中…' : '保存人设'}
        </button>
      </div>
      <textarea
        aria-label="人设 prompt"
        className={`${input} min-h-48 font-mono leading-relaxed`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={`主播的人设、性格、说话习惯、背景故事……\n留空时只告诉模型「你是直播间主播「${anchor.name}」」`}
      />
      <p className="text-xs text-neutral-500">
        {draft.length} 字{dirty && <span className="text-amber-600"> · 有未保存的修改</span>}
      </p>
      {fileError && <p className="text-xs text-red-600">{fileError}</p>}
      {save.error && <p className="text-xs text-red-600">{save.error.message}</p>}
    </section>
  );
}

/** 快速模型切换区块：直接在主播管理里修改当前回复配置的模型 */
function ModelSection() {
  const qc = useQueryClient();
  const [configId] = usePersistentState<string | null>('lce.room.config', null);
  const configs = useQuery({ queryKey: ['allConfigs'], queryFn: api.allConfigs });
  const config = configs.data?.find((c) => c.id === configId) ?? configs.data?.[0] ?? null;

  const updateModel = useMutation({
    mutationFn: (v: { providerId: string | null; model: string | null }) =>
      api.updateConfig(config!.id, { providerId: v.providerId, model: v.model }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['allConfigs'] }),
  });

  if (!config) return null;

  return (
    <section className={`${card} space-y-2`}>
      <div className="flex items-center gap-2">
        <h3 className="mr-auto text-sm font-medium">回复模型</h3>
        <button
          type="button"
          className={secondaryBtn}
          style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
          onClick={() => window.dispatchEvent(new CustomEvent('lce:open-config'))}
        >
          高级配置 →
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        配置「{config.name}」正在使用的模型，立即生效。
      </p>
      <ModelPicker
        value={{ providerId: config.providerId, model: config.model }}
        onChange={(v) => updateModel.mutate(v)}
      />
      {updateModel.isPending && <p className="text-xs text-neutral-400">保存中…</p>}
      {updateModel.error && <p className="text-xs text-red-600">{updateModel.error.message}</p>}
    </section>
  );
}

function AnchorView({ name, onDeleted, onDirtyChange }: { name: string; onDeleted: () => void; onDirtyChange?: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['anchor', name], queryFn: () => api.anchor(name) });
  const [code, setCode] = useState<string | null>(null);

  const saveCode = useMutation({
    mutationFn: (value: string) => api.updateAnchor(name, { code: value.trim() || null }),
    onSuccess: () => {
      setCode(null);
      queryClient.invalidateQueries({ queryKey: ['anchor', name] });
      queryClient.invalidateQueries({ queryKey: ['anchors'] });
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
          <h3 className="flex items-center gap-2 font-medium">
            {a.name}
            <SourceBadge source={a.source} />
          </h3>
          <p className="text-xs text-neutral-500">{a.sessionCount} 个场次</p>
        </div>
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); saveCode.mutate(codeDraft); }}>
          <input className={`${input} w-32`} value={codeDraft} onChange={(e) => setCode(e.target.value)}
            placeholder="编号（可选）" aria-label="主播编号" maxLength={50} />
          <button type="submit" className={secondaryBtn} disabled={code === null || saveCode.isPending}>保存编号</button>
        </form>
        <button type="button" className={`${secondaryBtn} text-red-600`}
          onClick={() => confirm(`删除主播「${a.name}」？`) && remove.mutate()}>
          删除主播
        </button>
        {saveCode.error && <p className="w-full text-xs text-red-600">{saveCode.error.message}</p>}
        {remove.error && <p className="w-full text-xs text-red-600">{remove.error.message}</p>}
      </section>

      <PersonaEditor key={a.name} anchor={a} onDirtyChange={onDirtyChange} />

      <ModelSection />
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedAnchor: string | null;
  onAnchorChange: (name: string) => void;
}

export function AnchorDialog({ open, onOpenChange, selectedAnchor, onAnchorChange }: Props) {
  const queryClient = useQueryClient();
  const anchors = useQuery({ queryKey: ['anchors'], queryFn: api.anchors });
  const [activeName, setActiveName] = useState<string | null>(selectedAnchor);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const isDirtyRef = useRef(false);

  const create = useMutation({
    mutationFn: () => api.createAnchor({ name: newName.trim(), code: newCode.trim() || null }),
    onSuccess: (a) => {
      queryClient.invalidateQueries({ queryKey: ['anchors'] });
      setActiveName(a.name);
      setNewName('');
      setNewCode('');
    },
  });

  const active = anchors.data?.find((a) => a.name === (activeName ?? anchors.data[0]?.name)) ?? null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && isDirtyRef.current && !confirm('人设有未保存的修改，确定放弃？')) return; isDirtyRef.current = false; onOpenChange(v); }}>
      <DialogContent className="flex h-[85vh] w-[95vw] max-w-[95vw] flex-col overflow-hidden p-0 sm:grid sm:grid-cols-[220px_1fr] sm:gap-0 sm:max-w-[90vw]">
        <DialogTitle className="sr-only">主播管理</DialogTitle>
        <aside className="max-h-48 overflow-y-auto border-b border-neutral-200 p-3 sm:max-h-none sm:border-b-0 sm:border-r dark:border-neutral-800">
          <h2 className="mb-2 text-sm font-medium">主播</h2>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) create.mutate(); }}>
            <input className={input} value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="新主播名字" aria-label="新主播名字" maxLength={100} />
            <div className="flex gap-2">
              <input className={input} value={newCode} onChange={(e) => setNewCode(e.target.value)}
                placeholder="编号（可选）" aria-label="新主播编号" maxLength={50} />
              <button type="submit" className={secondaryBtn} disabled={!newName.trim() || create.isPending}>新增</button>
            </div>
          </form>
          {create.error && <p className="mt-1 text-xs text-red-600">{create.error.message}</p>}
          <ul className="mt-3 space-y-1">
            {anchors.data?.map((a) => (
              <li key={a.name}>
                <button type="button" onClick={() => { setActiveName(a.name); onAnchorChange(a.name); }}
                  className={listItem(a.name === active?.name)}>
                  <span className="flex items-center gap-1.5">
                    <span className="truncate">{a.name}</span>
                    {a.code && <span className="text-xs text-neutral-500">{a.code}</span>}
                    <SourceBadge source={a.source} />
                  </span>
                  <span className="text-xs text-neutral-500">{a.sessionCount} 场次</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="overflow-y-auto p-4">
          {active ? (
            <AnchorView key={active.name} name={active.name} onDeleted={() => setActiveName(null)} onDirtyChange={(v) => { isDirtyRef.current = v; }} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-neutral-500">
              新增一个主播，或者先去导入聊天记录
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { ConfigSheet };
