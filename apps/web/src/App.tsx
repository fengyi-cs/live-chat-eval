import { Navigate, NavLink, Route, Routes } from 'react-router';
import { ActivityIcon, CircleHelpIcon } from 'lucide-react';
import { EvalsPage } from './pages/EvalsPage.tsx';
import { ProvidersPage } from './pages/ProvidersPage.tsx';
import { RubricsPage } from './pages/RubricsPage.tsx';
import { LiveRoom } from './pages/LiveRoom.tsx';
import { SessionsPage } from './pages/SessionsPage.tsx';

const NAV = [
  { to: '/', label: '直播间', end: true },
  { to: '/sessions', label: '场次库' },
  { to: '/evals', label: '评估分析' },
  { to: '/rubrics', label: '评分标准' },
  { to: '/settings', label: '设置' },
] as const;

export const tabClass = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
    isActive
      ? 'border-indigo-500 font-medium text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
      : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
  }`;

function SettingsPage() {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium">模型服务</h2>
      <ProvidersPage />
    </div>
  );
}

export function App() {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 px-4 pt-3 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-950/90">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-2">
            <ActivityIcon className="size-5 text-indigo-500" aria-hidden />
            <h1 className="text-base font-semibold tracking-tight">live-chat-eval</h1>
            <span className="ml-1 hidden text-xs text-neutral-500 sm:inline">直播间 AI 主播对话评估</span>
            <NavLink to="/?tour=1" className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200">
              <CircleHelpIcon className="size-3.5" aria-hidden />
              帮助
            </NavLink>
          </div>
          <nav className="mt-2 -mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none]" aria-label="主导航">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={'end' in n ? n.end : undefined} className={tabClass}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-7xl p-4">
        <Routes>
          <Route path="/" element={<LiveRoom />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/evals" element={<EvalsPage />} />
          <Route path="/rubrics" element={<RubricsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
