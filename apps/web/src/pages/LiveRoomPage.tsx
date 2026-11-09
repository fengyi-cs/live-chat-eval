import { computeRules, type EvalItemResult, type EvalSummary, type Pace, type Rubric, type RuleResult, type SimMessage, turnComposite, formatOffset } from '@lce/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { api, type RoomEvent, type RunInfo } from '../api.ts';
import { PACE_OPTIONS, paceKeyOf, paceOf, type PaceKey } from '../labels.ts';
import { card, emptyState, input, listItem, primaryBtn, secondaryBtn } from '../ui.ts';
import { usePersistentState } from '../usePersistentState.ts';
import type { EvalEvent } from '../api.ts';
import { MessageBubble, type TurnScore } from './MessageBubble.tsx';
import { SessionView } from './SessionView.tsx';

const END_LABELS = { finished: '剧本播完', stopped: '已手动结束', error: '出错结束' } as const;

interface RoomState {
  info: RunInfo | null;
  messages: SimMessage[];
  generating: { replyTo: number[]; proactive: boolean; text: string } | null;
  skipped: Set<number>;
  unanswered: Set<number>;
  now: number;
  waitingStep: boolean;
  warnings: string[];
  ended: { reason: keyof typeof END_LABELS; error: string | null } | null;
  gone: boolean;
}

interface LiveEvalState {
  rules: RuleResult;
  summary: EvalSummary;
  items: EvalItemResult[];
  rubric: Rubric;
}

const initialRoom: RoomState = {
  info: null,
  messages: [],
  generating: null,
  skipped: new Set(),
  unanswered: new Set(),
  now: 0,
  waitingStep: false,
  warnings: [],
  ended: null,
  gone: false,
};

function roomReducer(s: RoomState, ev: RoomEvent): RoomState {
  switch (ev.type) {
    case 'hello':
      return { ...initialRoom, info: ev.info };
    case 'danmaku':
      return { ...s, messages: [...s.messages, ev.message], now: Math.max(s.now, ev.message.at) };
    case 'thinking':
      return {
        ...s,
        generating: { replyTo: ev.replyTo, proactive: ev.proactive, text: '' },
        skipped: ev.skipped.length ? new Set([...s.skipped, ...ev.skipped]) : s.skipped,
        now: Math.max(s.now, ev.at),
        waitingStep: false,
      };
    case 'delta':
      return s.generating ? { ...s, generating: { ...s.generating, text: s.generating.text + ev.text } } : s;
    case 'reply':
      return { ...s, messages: [...s.messages, ev.message], generating: null, now: Math.max(s.now, ev.message.at) };
    case 'waiting':
      return { ...s, now: Math.max(s.now, ev.at), waitingStep: s.info?.pace?.kind === 'step' && ev.until !== null };
    case 'clock':
      return { ...s, now: Math.max(s.now, ev.at), waitingStep: false };
    case 'pace':
      return s.info ? { ...s, info: { ...s.info, pace: ev.pace }, waitingStep: ev.pace.kind === 'step' && s.waitingStep } : s;
    case 'warning':
      return { ...s, warnings: [...s.warnings, ev.message] };
    case 'end':
      return { ...s, generating: null, waitingStep: false, unanswered: new Set(ev.unanswered), ended: { reason: ev.reason, error: ev.error } };
    case 'gone':
      return { ...s, gone: true };
  }
}

function StartPanel({ onStarted }: { onStarted: (info: RunInfo) => void }) {
  const queryClient = useQueryClient();
  const anchors = useQuery({ queryKey: ['anchors'], queryFn: api.anchors });
  const configs = useQuery({ queryKey: ['allConfigs'], queryFn: api.allConfigs });
  const scripts = useQuery({ queryKey: ['scripts'], queryFn: api.scripts });
  const [anchorName, setAnchorName] = usePersistentState<string | null>('lce.room.anchor', null);
  const [configId, setConfigId] = usePersistentState<string | null>('lce.room.config', null);
  const [mode, setMode] = usePersistentState<'live' | 'script'>('lce.room.mode', 'script');
  const [scriptId, setScriptId] = usePersistentState<string | null>('lce.room.script', null);
  const [paceKey, setPaceKey] = usePersistentState<PaceKey>('lce.room.pace', '5');

  const anchor = anchors.data?.find((a) => a.name === anchorName) ?? anchors.data?.[0] ?? null;
  const config = configs.data?.find((c) => c.id === configId) ?? configs.data?.find((c) => c.modelAvailable) ?? null;
  const script = scripts.data?.find((s) => s.id === scriptId) ?? scripts.data?.find((s) => s.eventCount > 0) ?? null;

  const start = useMutation({
    mutationFn: () =>
      api.startSim(
        mode === 'live'
          ? { mode, anchorName: anchor!.name, configId: config!.id }
          : { mode, anchorName: anchor!.name, configId: config!.id, scriptId: script!.id, pace: paceOf(paceKey) },
      ),
    onSuccess: (info) => {
      queryClient.invalidateQueries({ queryKey: ['sims'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onStarted(info);
    },
  });


  const canStart = Boolean(anchor && config?.modelAvailable) && (mode === 'live' || (script && script.eventCount > 0 && script.issueCount === 0));

  return (
    <section className={`${card} space-y-3`}>
      <h2 className="text-sm font-medium">开播</h2>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-xs text-neutral-500">主播</span>
          <select className={input} value={anchor?.name ?? ''} onChange={(e) => setAnchorName(e.target.value || null)}>
            {anchors.data?.length === 0 && <option value="">还没有主播</option>}
            {anchors.data?.map((a) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-neutral-500">回复配置</span>
          <select className={input} value={config?.id ?? ''} onChange={(e) => setConfigId(e.target.value || null)}>
            {configs.data?.length === 0 && <option value="">还没有配置，先去「主播」页新建</option>}
            {configs.data?.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.modelAvailable}>
                {c.name}{!c.modelAvailable && '（没有可用模型）'}
              </option>
            ))}
          </select>
          {config?.modelAvailable && config.model && <span className="block text-xs text-neutral-400">{config.providerName} · {config.model}</span>}
        </label>
      </div>
      <fieldset className="flex gap-4 text-sm">
        <legend className="sr-only">模式</legend>
        {(
          [
            ['script', '弹幕剧本回放'],
            ['live', '单人实时对话'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-1.5">
            <input type="radio" name="room-mode" value={value} checked={mode === value} onChange={() => setMode(value)} />
            {label}
          </label>
        ))}
      </fieldset>
      {mode === 'script' && (
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <label className="block space-y-1">
            <span className="text-xs text-neutral-500">剧本</span>
            <select className={input} value={script?.id ?? ''} onChange={(e) => setScriptId(e.target.value || null)}>
              {scripts.data?.length === 0 && <option value="">还没有剧本，先去「弹幕剧本」页新建</option>}
              {scripts.data?.map((s) => (
                <option key={s.id} value={s.id} disabled={s.eventCount === 0 || s.issueCount > 0}>
                  {s.name}（{s.eventCount} 条 · {formatOffset(s.durationMs)}）
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-neutral-500">节奏</span>
            <select className={input} value={paceKey} onChange={(e) => setPaceKey(e.target.value as PaceKey)}>
              {PACE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <button type="button" className={`${primaryBtn} w-full`} disabled={!canStart || start.isPending} onClick={() => start.mutate()}>
        {start.isPending ? '开播中…' : '开播'}
      </button>
      {start.error && <p className="text-xs text-red-600">{start.error.message}</p>}
    </section>
  );
}

function RunningList({ active, onSelect }: { active: string | null; onSelect: (id: string) => void }) {
  const sims = useQuery({ queryKey: ['sims'], queryFn: api.sims });
  if (!sims.data?.length) return null;
  return (
    <section className={`${card} space-y-1`}>
      <h2 className="mb-1 text-sm font-medium">进行中</h2>
      <ul className="space-y-1">
        {sims.data.map((r) => (
          <li key={r.sessionId}>
            <button type="button" className={listItem(r.sessionId === active)} onClick={() => onSelect(r.sessionId)}>
              <span>{r.anchorName}</span>
              <span className="ml-2 text-xs text-neutral-500">
                {r.configName} · {r.scriptName ?? '单人实时'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RunView({ sessionId, onClosed }: { sessionId: string; onClosed: () => void }) {
  const queryClient = useQueryClient();
  const [room, dispatch] = useReducer(roomReducer, initialRoom);
  const [liveEval, setLiveEval] = useState<LiveEvalState | null>(null);
  const [, tick] = useState(0);
  const scroller = useRef<HTMLUListElement>(null);
  const stick = useRef(true);
  const [speaker, setSpeaker] = usePersistentState('lce.room.speaker', '我');
  const [text, setText] = useState('');

  useEffect(() => api.subscribeSim(sessionId, dispatch), [sessionId]);
  const evalId = room.info?.evalId ?? null;
  useEffect(() => {
    if (!evalId) return;
    return api.subscribeEval(evalId, (ev: EvalEvent) => {
      if (ev.type === 'item') {
        setLiveEval((prev) => {
          if (!prev) return prev;
          const idx = prev.items.findIndex((it) => it.seq === ev.item.seq && it.kind === ev.item.kind);
          const items: EvalItemResult[] = idx >= 0 ? prev.items.map((it, i) => (i === idx ? ev.item : it)) : [...prev.items, ev.item];
          return { ...prev, items, rules: ev.rules, summary: ev.summary };
        });
      } else if (ev.type === 'hello') {
        setLiveEval({ rules: ev.eval.rules, summary: ev.eval.summary, items: ev.eval.items, rubric: ev.eval.rubric });
      }
    });
  }, [evalId]);
  useEffect(() => {
    if (!room.ended && !room.gone) return;
    queryClient.invalidateQueries({ queryKey: ['sims'] });
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
    queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
  }, [room.ended, room.gone, queryClient, sessionId]);
  useEffect(() => {
    if (room.info?.mode !== 'live' || room.ended) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [room.info?.mode, room.ended]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [room.messages.length, room.generating?.text]);

  const inject = useMutation({
    mutationFn: () => api.injectDanmaku(sessionId, speaker.trim(), text.trim()),
    onSuccess: () => setText(''),
  });
  const pace = useMutation({ mutationFn: (p: Pace) => api.setPace(sessionId, p) });
  const step = useMutation({ mutationFn: () => api.stepSim(sessionId) });
  const stop = useMutation({ mutationFn: () => api.stopSim(sessionId) });
  const controlError = pace.error ?? step.error ?? stop.error;

  const scoreOf = (seq: number): TurnScore | null => {
    if (!liveEval) return null;
    const item = liveEval.items.find((it) => it.kind === 'turn' && it.seq === seq && it.status === 'done');
    const turnRules = liveEval.rules.turns[seq];
    return turnComposite(liveEval.rubric, turnRules, item);
  };

  if (room.gone && !room.ended) return <SessionView id={sessionId} onDeleted={onClosed} />;
  if (!room.info) return <p className="text-sm text-neutral-500">连接中…</p>;

  const info = room.info;
  const bySeq = new Map(room.messages.map((m) => [m.seq, m]));
  const quote = (seq: number) => {
    const m = bySeq.get(seq);
    return m && `${m.speaker}：${m.text}`;
  };
  const replying = new Set(room.generating?.replyTo);
  const elapsed = info.mode === 'live' ? Math.max(0, Date.now() - Date.parse(info.startedAt)) : room.now;
  const running = !room.ended;

  return (
    <div className="space-y-3">
      <section className={`${card} space-y-2`}>
        <div className="flex flex-wrap items-start gap-2">
          <div className="mr-auto min-w-0">
            <h2 className="font-medium">
              {info.anchorName}
              <span className="ml-2 text-sm text-neutral-500">
                {info.configName} · {info.scriptName ?? '单人实时'}
              </span>
            </h2>
            <p className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500">
              <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium ${
                running
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300'
                  : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
              }`}>
                {running && <span className="live-dot size-1.5 rounded-full bg-emerald-500" />}
                {running ? '直播中' : END_LABELS[room.ended!.reason]}
              </span>
              <span>{formatOffset(elapsed)}{info.scriptDurationMs !== null && ` / ${formatOffset(info.scriptDurationMs)}`}</span>
              {room.generating && <span>主播回复中…</span>}
              {room.waitingStep && <span>等待下一步</span>}
              {room.skipped.size > 0 && <span>跳过 {room.skipped.size} 条</span>}
            </p>
          </div>
          {running && info.mode === 'script' && (
            <>
              <select
                aria-label="节奏"
                className="rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
                value={paceKeyOf(info.pace)}
                onChange={(e) => pace.mutate(paceOf(e.target.value as PaceKey))}
              >
                {PACE_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
              {info.pace?.kind === 'step' && (
                <button type="button" className={primaryBtn} disabled={!room.waitingStep || step.isPending} onClick={() => step.mutate()}>
                  下一步
                </button>
              )}
            </>
          )}
          {running && (
            <button type="button" className={`${secondaryBtn} text-red-600`} disabled={stop.isPending} onClick={() => stop.mutate()}>
              结束直播
            </button>
          )}
        </div>
        {controlError && <p className="text-xs text-red-600">{controlError.message}</p>}
        {room.warnings.map((w, i) => (
          <p key={i} className="text-xs text-amber-600">
            {w}
          </p>
        ))}
        {room.ended && (
          <p className={`text-xs ${room.ended.error ? 'text-red-600' : 'text-neutral-500'}`}>
            {room.ended.error ?? '这场直播已保存到「聊天记录」，可以在那里查看和删除。'}
          </p>
        )}
      </section>

      <ul
        ref={scroller}
        className="max-h-[65vh] min-h-48 space-y-3 overflow-y-auto pr-1"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {room.messages.length === 0 && !room.generating && (
          <li className="flex h-32 items-center justify-center text-sm text-neutral-400">
            {info.mode === 'live' ? '在下面发一条弹幕开始聊天' : '等待第一条弹幕…'}
          </li>
        )}
        {room.messages.map((m) => (
          <MessageBubble
            key={m.seq}
            m={{ ...m, time: formatOffset(m.at), genTotalMs: m.genTotalMs }}
            quote={quote}
            highlighted={replying.has(m.seq)}
            unanswered={room.ended ? room.unanswered.has(m.seq) : room.skipped.has(m.seq)}
            score={m.role === 'anchor' ? scoreOf(m.seq) : null}
          />
        ))}
        {room.generating && (
          <MessageBubble
            pending
            m={{
              seq: -1,
              role: 'anchor',
              speaker: info.anchorName,
              time: formatOffset(room.now),
              text: room.generating.text,
              repliesTo: room.generating.replyTo,
              proactive: room.generating.proactive,
              latencyMs: null,
            }}
            quote={quote}
          />
        )}
      </ul>

      {info.mode === 'live' && running && (
        <form
          className={`${card} flex flex-wrap gap-2`}
          onSubmit={(e) => {
            e.preventDefault();
            if (speaker.trim() && text.trim()) inject.mutate();
          }}
        >
          <input className={`${input} w-28`} value={speaker} onChange={(e) => setSpeaker(e.target.value)} aria-label="昵称" placeholder="昵称" maxLength={100} />
          <input
            className={`${input} min-w-0 flex-1`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="弹幕内容"
            placeholder="发一条弹幕"
            maxLength={2000}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (speaker.trim() && text.trim()) inject.mutate();
              }
            }}
          />
          <button type="submit" className={primaryBtn} disabled={!speaker.trim() || !text.trim() || inject.isPending}>
            发送
          </button>
          {inject.error && <p className="w-full text-xs text-red-600">{inject.error.message}</p>}
        </form>
      )}
    </div>
  );
}

export function LiveRoomPage() {
  const [active, setActive] = usePersistentState<string | null>('lce.room.active', null);
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-4">
        <StartPanel onStarted={(info) => setActive(info.sessionId)} />
        <RunningList active={active} onSelect={setActive} />
      </aside>
      <main>
        {active ? (
          <RunView key={active} sessionId={active} onClosed={() => setActive(null)} />
        ) : (
          <div className={emptyState}>选一套主播配置开播：回放弹幕剧本，或者自己发弹幕和主播实时聊</div>
        )}
      </main>
    </div>
  );
}
