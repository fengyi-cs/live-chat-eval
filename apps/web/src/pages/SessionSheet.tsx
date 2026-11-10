import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { SOURCE_LABELS, STATUS_LABELS, STATUS_TONE } from '../labels.ts';
import { usePersistentState } from '../usePersistentState.ts';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet.tsx';
import { listItem } from '../ui.ts';
import { SessionView } from './SessionView.tsx';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (sessionId: string) => void;
}

export function SessionSheet({ open, onOpenChange, onSelect }: Props) {
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions });
  const [selected, setSelected] = usePersistentState<string | null>('lce.room.selectedSession', null);

  const selectedExists = sessions.data?.some((s) => s.id === selected) ?? true;
  const activeId = selectedExists ? selected : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-hidden sm:max-w-2xl">
        <SheetHeader className="shrink-0">
          <SheetTitle>场次库</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="w-56 shrink-0 space-y-1 overflow-y-auto border-r border-neutral-200 p-3 dark:border-neutral-800">
            {sessions.isPending && <p className="text-sm text-neutral-500">加载中…</p>}
            {sessions.error && <p className="text-sm text-red-600">{sessions.error.message}</p>}
            {sessions.data?.length === 0 && !sessions.isPending && (
              <p className="text-sm text-neutral-500">还没有场次。导入一份聊天记录，或在直播间跑一场模拟。</p>
            )}
            <ul className="space-y-1">
              {sessions.data?.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(s.id)}
                    className={listItem(s.id === activeId)}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{s.anchorName}</span>
                      {s.status !== 'done' && (
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs ${STATUS_TONE[s.status]}`}>
                          {STATUS_LABELS[s.status]}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {s.externalId ? `场次 ${s.externalId}` : SOURCE_LABELS[s.source]} · {s.messageCount} 条
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto p-3">
            {activeId ? (
              <>
                <button
                  type="button"
                  onClick={() => { onSelect(activeId); onOpenChange(false); }}
                  className="mb-2 text-xs text-indigo-600 hover:underline"
                >
                  打开此场次 →
                </button>
                <SessionView id={activeId} onDeleted={() => setSelected(null)} />
              </>
            ) : (
              <p className="text-sm text-neutral-500">选择一个场次查看对话与配对结果</p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
