import { turnComposite } from '@lce/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { PlayCircleIcon } from 'lucide-react';
import { api, type EvalDetail } from '../api.ts';
import { formatLatency, SOURCE_LABELS, STATUS_LABELS, STATUS_TONE } from '../labels.ts';
import { card, secondaryBtn } from '../ui.ts';
import { fmtScore, ScorePill } from '../components/ScorePill.tsx';
import { MessageBubble, type TurnEvalDetail, type TurnScore } from './MessageBubble.tsx';

function useSessionEval(sessionId: string) {
  const evals = useQuery({ queryKey: ['evals', sessionId], queryFn: () => api.evals(sessionId) });
  const latest = evals.data?.find((e) => e.status === 'done') ?? evals.data?.[0] ?? null;
  const detail = useQuery({
    queryKey: ['eval', latest?.id],
    queryFn: () => api.evalDetail(latest!.id),
    enabled: Boolean(latest),
  });
  return { latest, detail: latest ? detail.data : undefined };
}

function buildScoreMaps(d: EvalDetail | undefined) {
  const scores = new Map<number, TurnScore>();
  const details = new Map<number, TurnEvalDetail>();
  if (!d) return { scores, details };
  for (const it of d.items) {
    if (it.kind !== 'turn' || it.seq === null) continue;
    const turnRules = d.rules.turns[it.seq];
    scores.set(it.seq, turnComposite(d.rubric, turnRules, it));
    details.set(it.seq, {
      dimensions: d.rubric.dimensions
        .filter((dim) => it.scores?.[dim.key])
        .map((dim) => ({ name: dim.name, score: it.scores![dim.key]!.score, reason: it.scores![dim.key]!.reason })),
      aiPhraseHits: turnRules?.aiPhrases?.hits,
      latencyMs: turnRules?.latency?.value ?? null,
      evalError: it.status === 'error' ? it.error : null,
    });
  }
  return { scores, details };
}

export function SessionView({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const session = useQuery({ queryKey: ['session', id], queryFn: () => api.session(id) });
  const { latest: evalItem, detail: evalDetail } = useSessionEval(id);
  const remove = useMutation({
    mutationFn: () => api.deleteSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['anchors'] });
      onDeleted();
    },
  });

  const { scores: scoreBySeq, details: detailBySeq } = useMemo(() => buildScoreMaps(evalDetail), [evalDetail]);

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
        <div className="flex items-center gap-2">
          {evalItem ? (
            <button
              type="button"
              className={`${secondaryBtn} flex items-center gap-1.5`}
              onClick={() => navigate(`/evals?session=${id}`)}
              title="打开评估分析页面查看详情"
            >
              <ScorePill score={evalItem.composite} label={evalItem.status === 'running' ? '评估中…' : `综合 ${fmtScore(evalItem.composite)}`} />
              查看评估
            </button>
          ) : (
            <button
              type="button"
              className={`${secondaryBtn} flex items-center gap-1.5`}
              onClick={() => navigate(`/evals?session=${id}`)}
            >
              <PlayCircleIcon className="size-4" />
              发起评估
            </button>
          )}
          <button
            type="button"
            onClick={() => confirm('删除这个会话？') && remove.mutate()}
            className={`${secondaryBtn} text-red-600`}
          >
            删除
          </button>
        </div>
      </div>
      <ul className="space-y-3">
        {s.messages.map((m) => (
          <MessageBubble
            key={m.id}
            m={{ ...m, time: m.time.slice(11) }}
            quote={quote}
            unanswered={unanswered.has(m.seq)}
            score={m.role === 'anchor' ? scoreBySeq.get(m.seq) ?? null : null}
            evalDetail={m.role === 'anchor' ? detailBySeq.get(m.seq) ?? null : null}
          />
        ))}
      </ul>
    </div>
  );
}
