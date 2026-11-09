import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../api.ts';
import { SOURCE_LABELS, STATUS_LABELS, STATUS_TONE } from '../labels.ts';
import { usePersistentState } from '../usePersistentState.ts';
import { card, emptyState, listItem, secondaryBtn } from '../ui.ts';
import { SessionView } from './SessionView.tsx';
import { ImportSheet } from './ImportSheet.tsx';
import { useState } from 'react';
import { UploadIcon, PlayCircleIcon } from 'lucide-react';

export function SessionsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions });
  const [selected, setSelected] = usePersistentState<string | null>('lce.sessions.selected', null);
  const [importOpen, setImportOpen] = useState(false);

  const selectedExists = sessions.data?.some((s) => s.id === selected) ?? true;
  const activeId = selectedExists ? selected : null;

  const list = sessions.data ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside className={`${card} space-y-2 self-start`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">场次库</h2>
          <button
            type="button"
            className={`${secondaryBtn} flex items-center gap-1.5`}
            onClick={() => setImportOpen(true)}
          >
            <UploadIcon className="size-3.5" />
            导入
          </button>
        </div>
        {sessions.isPending && <p className="text-sm text-neutral-500">加载中…</p>}
        {sessions.error && <p className="text-sm text-red-600">{sessions.error.message}</p>}
        {list.length === 0 && !sessions.isPending && (
          <div className={emptyState}>
            <p>还没有场次</p>
            <p className="mt-1 text-xs">在直播间跑一场模拟，或者导入聊天记录</p>
          </div>
        )}
        <ul className="space-y-1">
          {list.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setSelected(s.id)}
                className={listItem(s.id === activeId)}
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{s.anchorName}</span>
                  {s.status !== 'done' && (
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs ${STATUS_TONE[s.status]}`}>
                      {STATUS_LABELS[s.status]}
                    </span>
                  )}
                </span>
                <span className="text-xs text-neutral-500">
                  {s.externalId ? `场次 ${s.externalId}` : SOURCE_LABELS[s.source]} · {s.messageCount} 条
                </span>
                {s.startedAt && (
                  <span className="text-xs text-neutral-400">{s.startedAt.replace('T', ' ').slice(0, 16)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main>
        {activeId ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                className={`${secondaryBtn} flex items-center gap-1.5`}
                onClick={() => navigate(`/evals?session=${activeId}`)}
              >
                <PlayCircleIcon className="size-4" />
                发起评估
              </button>
            </div>
            <SessionView
              id={activeId}
              onDeleted={() => {
                setSelected(null);
                qc.invalidateQueries({ queryKey: ['sessions'] });
              }}
            />
          </div>
        ) : (
          <div className={emptyState}>选择左侧场次查看详情</div>
        )}
      </main>

      <ImportSheet
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(sessionId) => {
          setSelected(sessionId);
          setImportOpen(false);
          qc.invalidateQueries({ queryKey: ['sessions'] });
        }}
      />
    </div>
  );
}
