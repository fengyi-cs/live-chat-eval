import { Navigate, NavLink, useParams } from 'react-router';
import { tabClass } from '../App.tsx';
import { AnchorsPage } from '../pages/AnchorsPage.tsx';
import { LiveRoomPage } from '../pages/LiveRoomPage.tsx';
import { ScriptsPage } from '../pages/ScriptsPage.tsx';
import { TranscriptsPage } from '../pages/TranscriptsPage.tsx';

/** 直播间重构前的过渡：原来的四个页面作为直播间的子页 */
const SUBS = [
  { id: 'live', label: '直播', Page: LiveRoomPage },
  { id: 'library', label: '场次库', Page: TranscriptsPage },
  { id: 'anchors', label: '主播', Page: AnchorsPage },
  { id: 'scripts', label: '弹幕剧本', Page: ScriptsPage },
] as const;

export function RoomPage() {
  const { sub = 'live' } = useParams();
  const active = SUBS.find((s) => s.id === sub);
  if (!active) return <Navigate to="/room" replace />;
  return (
    <div className="space-y-4">
      <nav className="-mt-2 flex gap-1 overflow-x-auto border-b border-neutral-200 [scrollbar-width:none] dark:border-neutral-800" aria-label="直播间">
        {SUBS.map((s) => (
          <NavLink key={s.id} to={s.id === 'live' ? '/room' : `/room/${s.id}`} end className={tabClass}>
            {s.label}
          </NavLink>
        ))}
      </nav>
      <active.Page />
    </div>
  );
}
