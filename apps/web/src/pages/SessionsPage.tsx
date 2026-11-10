import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api } from '../api.ts';
import { SOURCE_LABELS, STATUS_LABELS, STATUS_TONE } from '../labels.ts';
import { usePersistentState } from '../usePersistentState.ts';
import { card, emptyState, input, listItem, secondaryBtn } from '../ui.ts';
import { SessionView } from './SessionView.tsx';
import { ImportSheet } from './ImportSheet.tsx';
import { useState } from 'react';
import { UploadIcon } from 'lucide-react';

export function SessionsPage() {
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions });
  const [selected, setSelected] = usePersistentState<string | null>('lce.sessions.selected', null);
  const [importOpen, setImportOpen] = useState(false);

  const selectedExists = sessions.data?.some((s) => s.id === selected) ?? true;
  // S06: 如果 URL 传入了 session 参数，在数据加载后自动选中对应场次
  const sessionParam = searchParams.get('session');
  const activeId = sessionParam && sessions.data?.some((s) => s.id === sessionParam)
    ? sessionParam
    : selectedExists ? selected : null;

  const [query, setQuery] = useState('');
  const all = sessions.data ?? [];
  const q = query.trim().toLowerCase();
  const list = q
    ? all.filter((s) => [s.anchorName, s.title, s.externalId].some((v) => v?.toLowerCase().includes(q)))
    : all;
  // 手机端：列表与详情分屏显示；URL 带 session 参数时直接进详情
  const [mobileView, setMobileView] = useState<'list' | 'detail'>(sessionParam ? 'detail' : 'list');
  const select = (id: string) => { setSelected(id); setMobileView('detail'); };

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside className={`${card} min-w-0 space-y-2 self-start ${mobileView === 'detail' ? 'hidden lg:block' : ''}`}>
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
        {all.length > 0 && (
          <input
            type="search"
            className={`${input} py-1 text-xs`}
            placeholder="搜索主播、标题或场次号…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {sessions.isPending && <p className="text-sm text-neutral-500">加载中…</p>}
        {sessions.error && <p className="text-sm text-red-600">{sessions.error.message}</p>}
        {q && list.length === 0 && <p className="text-xs text-neutral-500">没有匹配的场次</p>}
        {all.length === 0 && !sessions.isPending && (
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
                onClick={() => select(s.id)}
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
                  {s.title ? <span className="block truncate">{s.title}</span> : null}
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

      <main className={`min-w-0 ${mobileView === 'list' ? 'hidden lg:block' : ''}`}>
        <button type="button" className={`${secondaryBtn} mb-3 lg:hidden`} onClick={() => setMobileView('list')}>← 返回场次列表</button>
        {activeId ? (
          <SessionView
            id={activeId}
            onDeleted={() => {
              setSelected(null);
              qc.invalidateQueries({ queryKey: ['sessions'] });
            }}
          />
        ) : (
          <div className={emptyState}>选择一个场次查看详情</div>
        )}
      </main>

      <ImportSheet
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(sessionId) => {
          select(sessionId);
          setImportOpen(false);
          qc.invalidateQueries({ queryKey: ['sessions'] });
        }}
      />
    </div>
  );
}
