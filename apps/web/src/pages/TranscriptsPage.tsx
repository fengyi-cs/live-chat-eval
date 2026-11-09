import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { SOURCE_LABELS, STATUS_LABELS, STATUS_TONE } from '../labels.ts';
import { usePersistentState } from '../usePersistentState.ts';
import { card, emptyState, listItem } from '../ui.ts';
import { ImportPanel } from './ImportPanel.tsx';
import { SessionView } from './SessionView.tsx';

export function TranscriptsPage() {
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions });
  const [selected, setSelected] = usePersistentState<string | null>('lce.selectedSession', null);

  const selectedExists = sessions.data?.some((s) => s.id === selected) ?? true;
  const activeId = selectedExists ? selected : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-4">
        <ImportPanel onImported={setSelected} />
        <section className={card}>
          <h2 className="mb-2 text-sm font-medium">会话记录</h2>
          {sessions.isPending && <p className="text-sm text-neutral-500">加载中…</p>}
          {sessions.error && <p className="text-sm text-red-600">{sessions.error.message}</p>}
          {sessions.data?.length === 0 && <p className="text-sm text-neutral-500">还没有会话。导入一份聊天记录，或者去「直播间」跑一场模拟。</p>}
          <ul className="space-y-1">
            {sessions.data?.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelected(s.id)}
                  className={listItem(s.id === activeId)}
                >
                  <span>{s.anchorName}</span>
                  <span className="ml-2 text-xs text-neutral-500">
                    {s.externalId ? `场次 ${s.externalId}` : SOURCE_LABELS[s.source]} · {s.messageCount} 条
                  </span>
                  {s.status !== 'done' && <span className={`ml-1 rounded-full px-1.5 py-0.5 text-xs ${STATUS_TONE[s.status]}`}>{STATUS_LABELS[s.status]}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </aside>
      <main>
        {activeId ? (
          <SessionView id={activeId} onDeleted={() => setSelected(null)} />
        ) : (
          <div className={emptyState}>
            选择左侧的会话查看对话与配对结果
          </div>
        )}
      </main>
    </div>
  );
}
