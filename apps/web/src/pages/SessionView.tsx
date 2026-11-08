import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type StoredMessage } from '../api.ts';

const formatLatency = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;

function MessageRow({ m, bySeq, unanswered }: { m: StoredMessage; bySeq: Map<number, StoredMessage>; unanswered: boolean }) {
  if (m.role === 'action' || m.role === 'ignore') return null;
  const isAnchor = m.role === 'anchor';
  return (
    <li className={`flex ${isAnchor ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-lg px-3 py-2 sm:max-w-[70%] ${isAnchor ? 'bg-sky-50 dark:bg-sky-950' : 'bg-white dark:bg-neutral-900'} border border-neutral-200 dark:border-neutral-800`}>
        <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
          <span className="font-medium text-neutral-700 dark:text-neutral-300">{m.speaker}</span>
          <span>{m.time.slice(11)}</span>
          {isAnchor && m.proactive && <span className="rounded bg-violet-100 px-1 text-violet-700 dark:bg-violet-900 dark:text-violet-200">主动发言</span>}
          {isAnchor && m.latencyMs !== null && <span>延迟 {formatLatency(m.latencyMs)}</span>}
          {unanswered && <span className="rounded bg-amber-100 px-1 text-amber-700 dark:bg-amber-900 dark:text-amber-200">未回应</span>}
        </div>
        {isAnchor && m.repliesTo && m.repliesTo.length > 0 && (
          <div className="mb-1 border-l-2 border-sky-300 pl-2 text-xs text-neutral-500">
            回应：{m.repliesTo.map((s) => `${bySeq.get(s)?.speaker}：${bySeq.get(s)?.text}`).join(' / ')}
          </div>
        )}
        <p className="whitespace-pre-wrap text-sm">{m.text}</p>
        {m.actions?.map((a) => (
          <p key={a.seq} className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
            [动作] {a.text}
          </p>
        ))}
      </div>
    </li>
  );
}

export function SessionView({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ['session', id], queryFn: () => api.session(id) });
  const remove = useMutation({
    mutationFn: () => api.deleteSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['anchors'] });
      onDeleted();
    },
  });

  if (session.isPending) return <p className="text-sm text-neutral-500">加载中…</p>;
  if (session.error) return <p className="text-sm text-red-600">{session.error.message}</p>;

  const s = session.data;
  const bySeq = new Map(s.messages.map((m) => [m.seq, m]));
  const unanswered = new Set(s.unanswered);
  const anchorTurns = s.messages.filter((m) => m.role === 'anchor');
  const latencies = anchorTurns.map((m) => m.latencyMs).filter((v): v is number => v !== null);
  const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <h2 className="font-medium">
            {s.anchorName}
            {s.externalId && <span className="ml-2 text-sm text-neutral-500">场次 {s.externalId}</span>}
          </h2>
          <p className="text-xs text-neutral-500">
            {s.startedAt?.replace('T', ' ')} ~ {s.endedAt?.replace('T', ' ')}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            主播发言 {anchorTurns.length} 条（主动 {anchorTurns.filter((m) => m.proactive).length}）· 未回应弹幕 {s.unanswered.length} 条
            {avgLatency !== null && ` · 平均延迟 ${formatLatency(avgLatency)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => confirm('删除这个会话？') && remove.mutate()}
          className="rounded border border-neutral-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-neutral-700 dark:hover:bg-red-950"
        >
          删除
        </button>
      </div>
      <ul className="space-y-2">
        {s.messages.map((m) => (
          <MessageRow key={m.id} m={m} bySeq={bySeq} unanswered={unanswered.has(m.seq)} />
        ))}
      </ul>
    </div>
  );
}
