import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { formatLatency, SOURCE_LABELS, STATUS_LABELS, STATUS_TONE } from '../labels.ts';
import { card } from '../ui.ts';
import { MessageBubble } from './MessageBubble.tsx';

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
  const quote = (seq: number) => {
    const m = bySeq.get(seq);
    return m && `${m.speaker}：${m.text}`;
  };
  const unanswered = new Set(s.unanswered);
  const anchorTurns = s.messages.filter((m) => m.role === 'anchor');
  const latencies = anchorTurns.map((m) => m.latencyMs).filter((v): v is number => v !== null);
  const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

  return (
    <div className="space-y-3">
      <div className={`${card} flex flex-wrap items-start justify-between gap-2`}>
        <div>
          <h2 className="font-medium">
            {s.anchorName}
            {s.externalId && <span className="ml-2 text-sm text-neutral-500">场次 {s.externalId}</span>}
            {s.source !== 'import' && <span className="ml-2 text-sm text-neutral-500">{s.title}</span>}
          </h2>
          <p className="mt-0.5 flex flex-wrap gap-1 text-xs">
            <span className="rounded bg-neutral-100 px-1 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{SOURCE_LABELS[s.source]}</span>
            <span className={`rounded px-1 ${STATUS_TONE[s.status]}`}>{STATUS_LABELS[s.status]}</span>
            {s.snapshot && (
              <span className="text-neutral-500">
                {s.snapshot.providerName} · {s.snapshot.model}
                {s.snapshot.temperature !== null && ` · 温度 ${s.snapshot.temperature}`}
              </span>
            )}
          </p>
          {s.error && <p className="mt-1 text-xs text-red-600">{s.error}</p>}
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
      <ul className="space-y-3">
        {s.messages.map((m) => (
          <MessageBubble key={m.id} m={{ ...m, time: m.time.slice(11) }} quote={quote} unanswered={unanswered.has(m.seq)} />
        ))}
      </ul>
    </div>
  );
}
