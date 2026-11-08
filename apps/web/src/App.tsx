import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { ImportPanel } from './pages/ImportPanel.tsx';
import { SessionView } from './pages/SessionView.tsx';

const SELECTED_KEY = 'lce.selectedSession';

export function App() {
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions });
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(SELECTED_KEY));

  useEffect(() => {
    if (selected) localStorage.setItem(SELECTED_KEY, selected);
    else localStorage.removeItem(SELECTED_KEY);
  }, [selected]);

  const selectedExists = sessions.data?.some((s) => s.id === selected) ?? true;
  const activeId = selectedExists ? selected : null;

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-lg font-semibold">live-chat-eval</h1>
        <p className="text-xs text-neutral-500">直播间 AI 主播对话评估</p>
      </header>
      <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <ImportPanel onImported={setSelected} />
          <section className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="mb-2 text-sm font-medium">已导入会话</h2>
            {sessions.isPending && <p className="text-sm text-neutral-500">加载中…</p>}
            {sessions.error && <p className="text-sm text-red-600">{sessions.error.message}</p>}
            {sessions.data?.length === 0 && <p className="text-sm text-neutral-500">还没有会话，先导入一份聊天记录。</p>}
            <ul className="space-y-1">
              {sessions.data?.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(s.id)}
                    className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                      s.id === activeId ? 'bg-neutral-100 font-medium dark:bg-neutral-800' : ''
                    }`}
                  >
                    <span>{s.anchorName}</span>
                    <span className="ml-2 text-xs text-neutral-500">
                      {s.externalId ? `场次 ${s.externalId}` : '无场次'} · {s.messageCount} 条
                    </span>
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
            <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
              选择左侧的会话查看对话与配对结果
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
