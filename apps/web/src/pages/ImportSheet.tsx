import type { SpeakerRole } from '@lce/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type ImportPreview } from '../api.ts';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet.tsx';
import { input, primaryBtn } from '../ui.ts';

const ROLE_LABELS: Record<SpeakerRole, string> = {
  anchor: '主播（被评估方）',
  viewer: '观众（提问方）',
  action: '动作',
  ignore: '忽略',
};

function assignRole(roles: Record<string, SpeakerRole>, name: string, role: SpeakerRole): Record<string, SpeakerRole> {
  const next = { ...roles, [name]: role };
  if (role === 'anchor') {
    for (const other of Object.keys(next)) {
      if (other !== name && next[other] === 'anchor') next[other] = 'viewer';
    }
  }
  return next;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported: (sessionId: string) => void;
}

export function ImportSheet({ open, onOpenChange, onImported }: Props) {
  const queryClient = useQueryClient();
  const rubrics = useQuery({ queryKey: ['rubrics'], queryFn: api.rubrics });
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [roles, setRoles] = useState<Record<string, SpeakerRole>>({});
  const [replace, setReplace] = useState(false);
  const [withEval, setWithEval] = useState(false);
  const [rubricId, setRubricId] = useState<string | null>(null);

  const effectiveRubricId = rubricId ?? rubrics.data?.[0]?.id ?? null;

  const previewMut = useMutation({
    mutationFn: api.previewImport,
    onSuccess: (p) => {
      setPreview(p);
      setRoles(Object.fromEntries(p.speakers.map((s) => [s.name, s.suggestedRole])));
      setReplace(false);
    },
  });

  const commitMut = useMutation({
    mutationFn: () => api.commitImport(content, roles, replace),
    onSuccess: async ({ sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['anchors'] });
      if (withEval && effectiveRubricId) {
        await api.startEval({ sessionId, rubricId: effectiveRubricId }).catch(() => {
        });
        queryClient.invalidateQueries({ queryKey: ['evals'] });
      }
      setPreview(null);
      setContent('');
      setFileName('');
      onImported(sessionId);
      onOpenChange(false);
    },
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setContent(text);
    commitMut.reset();
    previewMut.mutate(text);
  };

  const anchorCount = Object.values(roles).filter((r) => r === 'anchor').length;
  const blockedByDuplicate = Boolean(preview?.duplicateSessionId) && !replace;
  const error = previewMut.error ?? commitMut.error;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>导入历史聊天记录</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          <p className="text-xs text-neutral-500">
            导入后可在聊天窗口查看，也可以选择继续对话或进行逐句评估。
          </p>

          <label className="block cursor-pointer rounded-lg border border-dashed border-neutral-300 px-3 py-6 text-center text-sm text-neutral-500 hover:border-neutral-500 dark:border-neutral-700">
            {fileName || '拖拽或点击选择 .md 聊天记录文件'}
            <input type="file" accept=".md,.markdown,.txt" className="hidden"
              onChange={(e) => { void onFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
          </label>

          {previewMut.isPending && <p className="text-sm text-neutral-500">解析中…</p>}
          {error && <p className="text-sm text-red-600">{error.message}</p>}

          {preview && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500 dark:bg-neutral-800">
                {preview.meta.externalId && <div>场次 {preview.meta.externalId}</div>}
                {preview.meta.anchorName && (
                  <div>元信息主播：{preview.meta.anchorName}{preview.meta.anchorCode && `（${preview.meta.anchorCode}）`}</div>
                )}
                <div>共 {preview.messageCount} 条消息</div>
                {preview.knownAnchor && <div className="text-emerald-600">已识别主播档案：{preview.knownAnchor}</div>}
              </div>

              <div>
                <p className="mb-1 text-xs text-neutral-500">角色分配 — 可拖拽调整，主播唯一</p>
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-xs text-neutral-500">
                      <th className="pb-1 font-normal">发言人</th>
                      <th className="pb-1 font-normal">条数</th>
                      <th className="pb-1 font-normal">角色</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.speakers.map((s) => (
                      <tr key={s.name}>
                        <td className="py-1 pr-2 break-all">{s.name}</td>
                        <td className="py-1 pr-2 text-neutral-500">{s.count}</td>
                        <td className="py-1">
                          <select
                            aria-label={`${s.name} 的角色`}
                            value={roles[s.name]}
                            onChange={(e) => setRoles(assignRole(roles, s.name, e.target.value as SpeakerRole))}
                            className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                          >
                            {Object.entries(ROLE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {anchorCount !== 1 && (
                <p className="text-xs text-amber-600">需要且只能指定一个主播（当前 {anchorCount} 个）</p>
              )}

              <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">导入选项</p>
                {preview.duplicateSessionId && (
                  <label className="flex items-center gap-2 text-xs text-amber-600">
                    <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                    该场次已导入，勾选以覆盖
                  </label>
                )}
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={withEval} onChange={(e) => setWithEval(e.target.checked)} />
                  <span>
                    导入后进行逐句评估
                    <span className="ml-1 text-neutral-400">（可在评估分析页查看进度）</span>
                  </span>
                </label>
                {withEval && (
                  <label className="flex items-center gap-2 text-xs">
                    <span className="shrink-0 text-neutral-500">评分标准：</span>
                    {rubrics.data?.length === 0 ? (
                      <span className="text-amber-600">还没有评分标准，先去「评分标准」页新建</span>
                    ) : (
                      <select
                        className="flex-1 rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                        value={effectiveRubricId ?? ''}
                        onChange={(e) => setRubricId(e.target.value || null)}
                      >
                        {rubrics.data?.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    )}
                  </label>
                )}
              </div>

              <button
                type="button"
                disabled={anchorCount !== 1 || blockedByDuplicate || commitMut.isPending}
                onClick={() => commitMut.mutate()}
                className={`${primaryBtn} w-full`}
              >
                {commitMut.isPending ? '导入中…' : '确认导入'}
              </button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
