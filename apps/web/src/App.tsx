import { ProvidersPage } from './pages/ProvidersPage.tsx';
import { TranscriptsPage } from './pages/TranscriptsPage.tsx';
import { usePersistentState } from './usePersistentState.ts';

const TABS = [
  { id: 'transcripts', label: '聊天记录', Page: TranscriptsPage },
  { id: 'providers', label: '模型服务', Page: ProvidersPage },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = usePersistentState<TabId>('lce.tab', 'transcripts');
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 bg-white px-4 pt-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-lg font-semibold">live-chat-eval</h1>
          <p className="text-xs text-neutral-500">直播间 AI 主播对话评估</p>
          <nav className="mt-2 flex gap-1" aria-label="主导航">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={t.id === active.id ? 'page' : undefined}
                className={`border-b-2 px-3 py-2 text-sm ${
                  t.id === active.id
                    ? 'border-neutral-900 font-medium dark:border-neutral-100'
                    : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-7xl p-4">
        <active.Page />
      </div>
    </div>
  );
}
