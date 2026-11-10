import type { SpeakerRole } from '@lce/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, type ImportPreview } from '../api.ts';
import { ModelPicker } from '../components/ModelPicker.tsx';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.tsx';
import { input, primaryBtn, secondaryBtn } from '../ui.ts';

const ROLE_LABELS: Record<SpeakerRole, string> = {
  anchor: '主播（被评估方）',
  viewer: '观众（弹幕发送者）',
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
  const [judgeChoice, setJudgeChoice] = useState<{ providerId: string | null; model: string | null }>({ providerId: null, model: null });
  const [evalError, setEvalError] = useState<string | null>(null);
  const [importedSessionId, setImportedSessionId] = useState<string | null>(null);
  /** 多选时排队的后续文件：逐份预览、分配角色和处理重复场次 */
  const [queue, setQueue] = useState<File[]>([]);
  const [doneCount, setDoneCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveRubricId = rubricId ?? rubrics.data?.[0]?.id ?? null;
  const selectedRubric = rubrics.data?.find((r) => r.id === effectiveRubricId);
  const needsJudge = selectedRubric?.rubric.dimensions.some((d) => d.enabled) ?? false;

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
      setEvalError(null);
      if (withEval && effectiveRubricId) {
        try {
          await api.startEval({
            sessionId,
            rubricId: effectiveRubricId,
            providerId: judgeChoice.providerId ?? undefined,
            model: judgeChoice.model ?? undefined,
          });
          queryClient.invalidateQueries({ queryKey: ['evals'] });
        } catch (e) {
          setEvalError((e as Error).message);
        }
      }
      setPreview(null);
      setContent('');
      setFileName('');
      setImportedSessionId(sessionId);
      setDoneCount((n) => n + 1);
    },
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setContent(text);
    setPreview(null);
    commitMut.reset();
    setImportedSessionId(null);
    setEvalError(null);
    previewMut.mutate(text);
  };

  const onFiles = (list: FileList | null | undefined) => {
    const files = [...(list ?? [])];
    if (files.length === 0) return;
    setQueue(files.slice(1));
    setDoneCount(0);
    void onFile(files[0]);
  };

  const nextFile = () => {
    const [next, ...rest] = queue;
    setQueue(rest);
    void onFile(next);
  };

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    onFiles(e.dataTransfer.files);
  };

  const anchorCount = Object.values(roles).filter((r) => r === 'anchor').length;
  const blockedByDuplicate = Boolean(preview?.duplicateSessionId) && !replace;
  const missingJudge = withEval && needsJudge && (!judgeChoice.providerId || !judgeChoice.model);
  const error = previewMut.error ?? commitMut.error;

  if (importedSessionId) {
    return (
      <Sheet open={open} onOpenChange={(v) => { if (!v) { setImportedSessionId(null); setEvalError(null); } onOpenChange(v); }}>
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>导入历史聊天记录</SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 pb-4 text-center">
            <p className="text-base font-medium text-emerald-600">导入成功{doneCount > 1 && `（本批已导入 ${doneCount} 份）`}</p>
            {evalError ? (
              <p className="text-sm text-red-600">评估启动失败：{evalError}</p>
            ) : withEval ? (
              <p className="text-sm text-neutral-500">评估已启动，可前往「评估分析」查看进度</p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                className={primaryBtn}
                onClick={() => { onImported(importedSessionId); onOpenChange(false); }}
              >
                打开此场次
              </button>
              {evalError && (
                <button
                  type="button"
                  className={secondaryBtn}
                  onClick={() => {
                    if (!effectiveRubricId) return;
                    setEvalError(null);
                    void api.startEval({
                      sessionId: importedSessionId,
                      rubricId: effectiveRubricId,
                      providerId: judgeChoice.providerId ?? undefined,
                      model: judgeChoice.model ?? undefined,
                    }).then(() => {
                      queryClient.invalidateQueries({ queryKey: ['evals'] });
                      setEvalError(null);
                    }).catch((e: Error) => setEvalError(e.message));
                  }}
                >
                  重试评估
                </button>
              )}
              {queue.length > 0 ? (
                <button type="button" className={secondaryBtn} onClick={nextFile}>
                  导入下一份（剩 {queue.length} 份）
                </button>
              ) : (
                <button
                  type="button"
                  className={secondaryBtn}
                  onClick={() => {
                    setImportedSessionId(null);
                    setEvalError(null);
                  }}
                >
                  继续导入
                </button>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>导入历史聊天记录</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          <p className="text-xs text-neutral-500">
            支持 .md 格式聊天记录，可一次选择多份，逐份确认角色后导入。导入后可查看对话或发起评估。
          </p>

          <label
            className="block cursor-pointer rounded-lg border border-dashed border-neutral-300 px-3 py-6 text-center text-sm text-neutral-500 hover:border-neutral-500 dark:border-neutral-700"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            {fileName ? `${fileName}${queue.length ? `（后面还有 ${queue.length} 份）` : ''}` : '拖拽或点击选择 .md 聊天记录文件（可多选）'}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".md,.markdown,.txt"
              className="hidden"
              onChange={(e) => { onFiles(e.target.files); e.currentTarget.value = ''; }}
            />
          </label>

          {previewMut.isPending && <p className="text-sm text-neutral-500">解析中…</p>}
          {error && <p className="text-sm text-red-600">{error.message}</p>}
          {queue.length > 0 && (previewMut.isError || preview) && (
            <button type="button" className={`${secondaryBtn} w-full`} disabled={commitMut.isPending} onClick={nextFile}>
              跳过这份，处理下一份（剩 {queue.length} 份）
            </button>
          )}

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
                <p className="mb-1 text-xs text-neutral-500">角色分配 — 通过下拉框指定，主播唯一</p>
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
                          <Select
                            value={roles[s.name]}
                            onValueChange={(v) => setRoles(assignRole(roles, s.name, v as SpeakerRole))}
                          >
                            <SelectTrigger className="h-7 w-auto min-w-36 text-xs" aria-label={`${s.name} 的角色`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                                <SelectItem key={value} value={value}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {anchorCount !== 1 && (
                <p className="text-xs text-amber-600">需要且只能指定 1 位主播（当前 {anchorCount} 位）</p>
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
                    导入后自动发起逐句评估
                    <span className="ml-1 text-neutral-400">（可在评估分析页查看进度）</span>
                  </span>
                </label>
                {withEval && (
                  <div className="space-y-2 pl-5">
                    <label className="flex items-center gap-2 text-xs">
                      <span className="shrink-0 text-neutral-500">评分标准：</span>
                      {rubrics.data?.length === 0 ? (
                        <span className="text-amber-600">还没有评分标准，先去「评分标准」页新建</span>
                      ) : (
                        <Select value={effectiveRubricId ?? ''} onValueChange={(v) => setRubricId(v || null)}>
                          <SelectTrigger className="h-7 flex-1 text-xs" aria-label="评分标准">
                            <SelectValue placeholder="选择评分标准" />
                          </SelectTrigger>
                          <SelectContent>
                            {rubrics.data?.map((r) => (
                              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </label>
                    {needsJudge ? (
                      <div className="space-y-1">
                        <p className="text-xs text-neutral-500">此评分标准包含模型评分维度，需选择裁判模型：</p>
                        <ModelPicker value={judgeChoice} onChange={setJudgeChoice} />
                      </div>
                    ) : (
                      <p className="text-xs text-neutral-400">此评分标准仅含规则评分，无需裁判模型</p>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={anchorCount !== 1 || blockedByDuplicate || commitMut.isPending || missingJudge}
                onClick={() => commitMut.mutate()}
                className={`${primaryBtn} w-full`}
              >
                {commitMut.isPending ? '导入中…' : '确认导入'}
              </button>
              {missingJudge && (
                <p className="text-xs text-amber-600">请先选择裁判模型</p>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
