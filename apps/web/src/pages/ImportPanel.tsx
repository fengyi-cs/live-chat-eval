import type { SpeakerRole } from '@lce/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type ImportPreview } from '../api.ts';

const ROLE_LABELS: Record<SpeakerRole, string> = { anchor: '主播', viewer: '观众', action: '动作', ignore: '忽略' };

/** 主播唯一：把一个发言人设为主播时，原来的主播改为观众 */
function assignRole(roles: Record<string, SpeakerRole>, name: string, role: SpeakerRole): Record<string, SpeakerRole> {
  const next = { ...roles, [name]: role };
  if (role === 'anchor') for (const other of Object.keys(next)) if (other !== name && next[other] === 'anchor') next[other] = 'viewer';
  return next;
}

export function ImportPanel({ onImported }: { onImported: (sessionId: string) => void }) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [roles, setRoles] = useState<Record<string, SpeakerRole>>({});
  const [replace, setReplace] = useState(false);

  const previewMutation = useMutation({
    mutationFn: api.previewImport,
    onSuccess: (p) => {
      setPreview(p);
      setRoles(Object.fromEntries(p.speakers.map((s) => [s.name, s.suggestedRole])));
      setReplace(false);
    },
  });

  const commitMutation = useMutation({
    mutationFn: () => api.commitImport(content, roles, replace),
    onSuccess: ({ sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['anchors'] });
      setPreview(null);
      setContent('');
      setFileName('');
      onImported(sessionId);
    },
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setContent(text);
    commitMutation.reset();
    previewMutation.mutate(text);
  };

  const anchorCount = Object.values(roles).filter((r) => r === 'anchor').length;
  const blockedByDuplicate = Boolean(preview?.duplicateSessionId) && !replace;
  const error = previewMutation.error ?? commitMutation.error;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-2 text-sm font-medium">导入聊天记录</h2>
      <label className="block cursor-pointer rounded border border-dashed border-neutral-300 px-3 py-4 text-center text-sm text-neutral-500 hover:border-neutral-500 dark:border-neutral-700">
        {fileName || '选择 .md 聊天记录文件'}
        <input type="file" accept=".md,.markdown,.txt" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>

      {previewMutation.isPending && <p className="mt-2 text-sm text-neutral-500">解析中…</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error.message}</p>}

      {preview && (
        <div className="mt-3 space-y-3 text-sm">
          <div className="text-xs text-neutral-500">
            {preview.meta.externalId && <div>场次 {preview.meta.externalId}</div>}
            {preview.meta.anchorName && (
              <div>
                元信息主播：{preview.meta.anchorName}
                {preview.meta.anchorCode && `（${preview.meta.anchorCode}）`}
              </div>
            )}
            <div>共 {preview.messageCount} 条消息</div>
            {preview.knownAnchor && <div className="text-emerald-600">已识别主播档案：{preview.knownAnchor}</div>}
          </div>

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
                      className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 dark:border-neutral-700"
                    >
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {anchorCount !== 1 && <p className="text-xs text-amber-600">需要且只能指定一个主播（当前 {anchorCount} 个）</p>}
          {preview.duplicateSessionId && (
            <label className="flex items-center gap-2 text-xs text-amber-600">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              该场次已导入，勾选以覆盖
            </label>
          )}

          <button
            type="button"
            disabled={anchorCount !== 1 || blockedByDuplicate || commitMutation.isPending}
            onClick={() => commitMutation.mutate()}
            className="w-full rounded bg-neutral-900 px-3 py-2 text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {commitMutation.isPending ? '导入中…' : '确认导入'}
          </button>
        </div>
      )}
    </section>
  );
}
