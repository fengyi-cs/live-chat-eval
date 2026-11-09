import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useReducer, useState } from 'react';
import { api, type AnchorConfigSummary, type RunInfo } from '../api.ts';
import { primaryBtn, secondaryBtn, card, input } from '../ui.ts';
import { usePersistentState } from '../usePersistentState.ts';
import { paceOf, type PaceKey } from '../labels.ts';
import { SessionView } from './SessionView.tsx';
import { ChatArea } from './room/ChatArea.tsx';
import { DanmakuInput } from './room/DanmakuInput.tsx';
import {
  initialRoom,
  makeEvalSubscriber,
  roomReducer,
  type LiveEvalState,
} from './room/roomReducer.ts';
import { LeftIcons, MobileIconBar, RightIcons } from './room/RoomIcons.tsx';
import { RoomTopBar } from './room/RoomTopBar.tsx';
import { ScriptControlBar } from './room/ScriptControlBar.tsx';
import { ScriptSheet } from './ScriptSheet.tsx';
import { ImportSheet } from './ImportSheet.tsx';
import { SessionSheet } from './SessionSheet.tsx';
import { ConfigSheet } from './ConfigSheet.tsx';
import { AnchorDialog } from './AnchorDialog.tsx';
import { ModelPicker } from '../components/ModelPicker.tsx';
import { GuidedTour } from '../components/GuidedTour.tsx';
import { HintBubble } from '../components/HintBubble.tsx';

function ActiveSession({
  sessionId,
  onClosed,
  anchorName,
  onAnchorChange,
  onOpenSheet,
  onSendDanmaku,
}: {
  sessionId: string;
  onClosed: () => void;
  anchorName: string | null;
  onAnchorChange: (name: string) => void;
  onOpenSheet: (sheet: string) => void;
  onSendDanmaku: (speaker: string, text: string) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [room, dispatch] = useReducer(roomReducer, initialRoom);
  const [liveEval, setLiveEval] = useState<LiveEvalState | null>(null);

  useEffect(() => api.subscribeSim(sessionId, dispatch), [sessionId]);

  const evalId = room.info?.evalId ?? null;
  useEffect(() => {
    if (!evalId) return;
    return api.subscribeEval(evalId, makeEvalSubscriber(setLiveEval));
  }, [evalId]);

  useEffect(() => {
    if (!room.ended && !room.gone) return;
    queryClient.invalidateQueries({ queryKey: ['sims'] });
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
    queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
  }, [room.ended, room.gone, queryClient, sessionId]);

  const stopMut = useMutation({ mutationFn: () => api.stopSim(sessionId) });

  if (room.gone && !room.ended) return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <span className="text-sm text-neutral-500">查看历史场次</span>
        <button type="button" className={`${secondaryBtn} ml-auto`} onClick={onClosed}>新建一场</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <SessionView id={sessionId} onDeleted={onClosed} />
      </div>
    </div>
  );
  if (!room.info) return <p className="flex flex-1 items-center justify-center text-sm text-neutral-500">连接中…</p>;

  const showInput = room.info.mode === 'live' && !room.ended;

  return (
    <>
      <RoomTopBar
        room={room}
        anchorName={anchorName}
        configName={room.info?.configName ?? null}
        onAnchorChange={onAnchorChange}
        onOpenAnchors={() => onOpenSheet('anchors')}
      />
      <ChatArea room={room} info={room.info} liveEval={liveEval} />
      {room.info.mode === 'script' && !room.ended && (
        <ScriptControlBar sessionId={sessionId} pace={room.info.pace} waitingStep={room.waitingStep} running />
      )}
      {showInput && (
        <div className="border-t border-neutral-200 dark:border-neutral-800">
          <div className="flex justify-end px-2 pt-1.5">
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => { if (confirm('结束这场模拟？')) stopMut.mutate(); }}
              disabled={stopMut.isPending}
            >
              结束本场
            </button>
          </div>
          <DanmakuInput onSend={onSendDanmaku} />
        </div>
      )}
      {room.ended && !room.gone && (
        <div className="flex items-center justify-center gap-2 border-t border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <span className="text-sm text-neutral-500 mr-auto">模拟已结束</span>
          <button type="button" className={secondaryBtn} onClick={() => onOpenSheet('sessions')}>查看场次</button>
          <button type="button" className={secondaryBtn} onClick={() => onClosed()}>新建一场</button>
        </div>
      )}
      {room.ended && room.gone && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
            <span className="text-sm text-neutral-500">模拟已结束 · 查看详情</span>
            <button type="button" className={`${secondaryBtn} ml-auto`} onClick={onClosed}>新建一场</button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3">
            <SessionView id={sessionId} onDeleted={onClosed} />
          </div>
        </div>
      )}
    </>
  );
}

export function LiveRoom() {
  const queryClient = useQueryClient();
  const [active, setActive] = usePersistentState<string | null>('lce.room.active', null);
  const [anchorName, setAnchorName] = usePersistentState<string | null>('lce.room.anchor', null);
  const [configId, setConfigId] = usePersistentState<string | null>('lce.room.config', null);
  const [paceKey] = usePersistentState<PaceKey>('lce.room.pace', '5');
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);

  const [liveEvalEnabled, setLiveEvalEnabled] = usePersistentState('lce.room.liveEval', false);
  const [liveEvalRubricId, setLiveEvalRubricId] = usePersistentState<string | null>('lce.room.liveEvalRubric', null);
  const [liveEvalJudge, setLiveEvalJudge] = usePersistentState<{ providerId: string | null; model: string | null }>('lce.room.liveEvalJudge', { providerId: null, model: null });

  const rubrics = useQuery({ queryKey: ['rubrics'], queryFn: api.rubrics });
  const effectiveLiveEval = liveEvalEnabled && liveEvalRubricId && liveEvalJudge.providerId && liveEvalJudge.model
    ? { rubricId: liveEvalRubricId, providerId: liveEvalJudge.providerId, model: liveEvalJudge.model }
    : liveEvalEnabled && liveEvalRubricId
      ? { rubricId: liveEvalRubricId }
      : undefined;

  useEffect(() => {
    const handler = () => setActiveSheet('config');
    window.addEventListener('lce:open-config', handler);
    return () => window.removeEventListener('lce:open-config', handler);
  }, []);

  const evals = useQuery({ queryKey: ['evals'], queryFn: () => api.evals() });
  const evalRunning = Boolean(evals.data?.some((e) => e.status === 'running'));

  const anchors = useQuery({ queryKey: ['anchors'], queryFn: api.anchors });
  const configs = useQuery({ queryKey: ['allConfigs'], queryFn: api.allConfigs });
  const sims = useQuery({ queryKey: ['sims'], queryFn: api.sims });

  const effectiveAnchor = anchorName ?? anchors.data?.[0]?.name ?? null;
  const effectiveConfig = configId ?? configs.data?.find((c) => c.modelAvailable)?.id ?? null;

  useEffect(() => {
    if (!anchorName && anchors.data?.length) setAnchorName(anchors.data[0]!.name);
  }, [anchorName, anchors.data, setAnchorName]);

  useEffect(() => {
    if (!configId && configs.data?.length) {
      const firstAvailable = configs.data.find((c) => c.modelAvailable);
      if (firstAvailable) setConfigId(firstAvailable.id);
    }
  }, [configId, configs.data, setConfigId]);

  useEffect(() => {
    if (active || !sims.data?.length || booting) return;
    const running = sims.data.find((s) => s.sessionId && !s.sessionId.includes('ended'));
    if (running) {
      setActive(running.sessionId);
      setAnchorName(running.anchorName);
    }
  }, [active, sims.data, booting, setActive, setAnchorName]);

  const handleAnchorChange = (name: string) => {
    if (name === anchorName) return;
    if (active && !confirm(`切换主播将结束当前模拟，确定切换到「${name}」？`)) return;
    setAnchorName(name);
    if (active) {
      void api.stopSim(active).then(() => setActive(null));
    }
  };

  const handleStarted = (info: RunInfo) => {
    setActive(info.sessionId);
    setAnchorName(info.anchorName);
    setActiveSheet(null);
  };

  const handleOpenSheet = (sheet: string | null) => setActiveSheet(sheet);

  const handleSendDanmaku = async (speaker: string, text: string): Promise<void> => {
    if (!active) {
      if (!effectiveAnchor || !effectiveConfig) {
        handleOpenSheet(effectiveAnchor ? 'config' : 'anchors');
        throw new Error('请先选择主播和回复配置');
      }
      setBooting(true);
      try {
        const info = await api.startSim({ mode: 'live', anchorName: effectiveAnchor, configId: effectiveConfig, liveEval: effectiveLiveEval });
        setActive(info.sessionId);
        setAnchorName(info.anchorName);
        queryClient.invalidateQueries({ queryKey: ['sims'] });
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        await api.injectDanmaku(info.sessionId, speaker, text);
      } finally {
        setBooting(false);
      }
      return;
    }
    await api.injectDanmaku(active, speaker, text);
  };

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <div className="flex min-h-0 flex-1 gap-1">
      <LeftIcons activeSheet={activeSheet} onOpenSheet={handleOpenSheet} evalRunning={evalRunning} liveEvalEnabled={liveEvalEnabled} onToggleLiveEval={() => setLiveEvalEnabled(!liveEvalEnabled)} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        {active ? (
          <ActiveSession
            sessionId={active}
            onClosed={() => setActive(null)}
            anchorName={anchorName}
            onAnchorChange={handleAnchorChange}
            onOpenSheet={(s) => handleOpenSheet(s)}
            onSendDanmaku={handleSendDanmaku}
          />
        ) : (
          <>
            <RoomTopBar
              room={initialRoom}
              anchorName={anchorName}
              configName={configs.data?.find((c) => c.id === effectiveConfig)?.name ?? null}
              onAnchorChange={handleAnchorChange}
              onOpenAnchors={() => handleOpenSheet('anchors')}
            />
            <ChatAreaEmpty
              anchorName={anchorName}
              configId={configId}
              configs={configs.data}
              onSend={handleSendDanmaku}
              onOpenScript={() => handleOpenSheet('script')}
              onOpenAnchors={() => handleOpenSheet('anchors')}
              onOpenConfig={() => handleOpenSheet('config')}
            />
          </>
        )}
      </div>

      <RightIcons activeSheet={activeSheet} onOpenSheet={handleOpenSheet} />
      </div>

      {!active && liveEvalEnabled && (
        <div className={`${card} mx-1 mt-1 space-y-2 rounded-xl border-indigo-200 bg-indigo-50/50 dark:border-indigo-800/50 dark:bg-indigo-950/20`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">实时评估配置</span>
            <p className="text-xs text-neutral-500">每句主播回复生成后自动打分并显示在消息上</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs text-neutral-500">评分标准</span>
              <select className={input} value={liveEvalRubricId ?? ''} onChange={(e) => setLiveEvalRubricId(e.target.value || null)}>
                <option value="">请选择评分标准</option>
                {rubrics.data?.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </label>
            <div className="space-y-1">
              <span className="text-xs text-neutral-500">裁判模型（可选，仅含规则评分时留空）</span>
              <ModelPicker value={liveEvalJudge} onChange={setLiveEvalJudge} placeholder="使用规则评分，无需模型" />
            </div>
          </div>
          {liveEvalEnabled && !liveEvalRubricId && (
            <p className="text-xs text-amber-700 dark:text-amber-400">⚠️ 实时评估已开启但尚未选择评分标准，开播后将不会评分</p>
          )}
        </div>
      )}

      <MobileIconBar activeSheet={activeSheet} onOpenSheet={handleOpenSheet} evalRunning={evalRunning} liveEvalEnabled={liveEvalEnabled} onToggleLiveEval={() => setLiveEvalEnabled(!liveEvalEnabled)} />

      <ScriptSheet
        open={activeSheet === 'script'}
        onOpenChange={(v) => !v && setActiveSheet(null)}
        anchorName={effectiveAnchor}
        configId={effectiveConfig}
        paceKey={paceKey}
        liveEval={effectiveLiveEval}
        onStartScript={handleStarted}
      />

      <ImportSheet
        open={activeSheet === 'import'}
        onOpenChange={(v) => !v && setActiveSheet(null)}
        onImported={(sessionId) => { setActive(sessionId); setActiveSheet(null); }}
      />

      <SessionSheet
        open={activeSheet === 'sessions'}
        onOpenChange={(v) => !v && setActiveSheet(null)}
        onSelect={(sessionId) => { setActive(sessionId); setActiveSheet(null); }}
      />

      <ConfigSheet
        open={activeSheet === 'config'}
        onOpenChange={(v) => !v && setActiveSheet(null)}
      />

      <AnchorDialog
        open={activeSheet === 'anchors'}
        onOpenChange={(v) => !v && setActiveSheet(null)}
        selectedAnchor={anchorName}
        onAnchorChange={handleAnchorChange}
      />

      <GuidedTour />
    </div>
  );
}

function ChatAreaEmpty({
  anchorName,
  configId,
  configs,
  onSend,
  onOpenScript,
  onOpenAnchors,
  onOpenConfig,
}: {
  anchorName: string | null;
  configId: string | null;
  configs: AnchorConfigSummary[] | undefined;
  onSend: (speaker: string, text: string) => Promise<void>;
  onOpenScript: () => void;
  onOpenAnchors: () => void;
  onOpenConfig: () => void;
}) {
  const selectedConfig = configs?.find((c) => c.id === configId);
  const configReady = Boolean(selectedConfig?.modelAvailable);
  const ready = anchorName && configReady;
  const steps = [
    {
      done: Boolean(anchorName),
      label: '选择主播',
      desc: anchorName ?? '尚未选择',
      action: !anchorName ? (
        <button type="button" className={secondaryBtn} onClick={onOpenAnchors}>新建主播</button>
      ) : null,
    },
    {
      done: configReady,
      label: '回复方案',
      desc: configReady
        ? (selectedConfig?.name ?? '已配置')
        : configId
          ? '回复方案未配置模型 — 请前往设置'
          : '尚未选择回复方案',
      action: !configReady ? (
        <button type="button" className={secondaryBtn} onClick={onOpenConfig}>配置回复</button>
      ) : null,
    },
    {
      done: false,
      label: '开始测试',
      desc: ready ? '发一条弹幕开始，或加载剧本' : '完成上面两步后可开始',
      action: ready ? (
        <button type="button" className={secondaryBtn} onClick={onOpenScript}>加载剧本</button>
      ) : null,
    },
  ];

  return (
    <>
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-3">
          <HintBubble
            storageKey="lce.hint.checklist"
            title="准备清单"
            tone="tip"
          >
            按顺序完成三步就能开播。已预置了示例主播「小鹿」和默认回复配置，你只需到设置页添加模型。
          </HintBubble>
          <p className="text-xs font-medium text-neutral-500">开始测试前</p>
          {steps.map((step, i) => (
            <div key={step.label} className={`flex items-start gap-3 rounded-lg border p-3 ${
              step.done ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'
                : i === steps.findIndex((s) => !s.done)
                  ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
                  : 'border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800/30'
            }`}>
              <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                step.done ? 'bg-emerald-500 text-white' : 'bg-neutral-300 text-neutral-600 dark:bg-neutral-600 dark:text-neutral-300'
              }`}>{step.done ? '✓' : i + 1}</span>
              <div className="flex-1">
                <p className="text-sm font-medium">{step.label}</p>
                <p className="text-xs text-neutral-500">{step.desc}</p>
              </div>
              {step.action}
            </div>
          ))}
        </div>
      </div>
      <DanmakuInput
        onSend={onSend}
        disabled={!ready}
        hint={!ready ? '完成准备后可发送弹幕' : '发一条弹幕开始模拟'}
      />
    </>
  );
}
