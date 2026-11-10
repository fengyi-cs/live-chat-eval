import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useReducer, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, type AnchorConfigSummary, type Provider, type RunInfo } from '../api.ts';
import { primaryBtn, secondaryBtn, card, input } from '../ui.ts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.tsx';
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
import { GuidedTour, type TourPath } from '../components/GuidedTour.tsx';

function ActiveSession({
  sessionId,
  onClosed,
  anchorName,
  onAnchorChange,
  onOpenSheet,
  onSendDanmaku,
  configId,
}: {
  sessionId: string;
  onClosed: () => void;
  anchorName: string | null;
  onAnchorChange: (name: string) => void;
  onOpenSheet: (sheet: string) => void;
  onSendDanmaku: (speaker: string, text: string) => Promise<void>;
  configId?: string | null;
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
  const navigate = useNavigate();

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
        configId={configId}
        onAnchorChange={onAnchorChange}
        onOpenAnchors={() => onOpenSheet('anchors')}
        onOpenConfig={() => onOpenSheet('config')}
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
          <span className="mr-auto text-sm text-neutral-600 dark:text-neutral-400">{room.info?.evalId ? '模拟已结束，实时评估结果可在评估分析查看' : '模拟已结束，尚未评分'}</span>
          <button type="button" className={primaryBtn} onClick={() => navigate(`/evals?session=${sessionId}`)}>评估本场</button>
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
  const selectedRubric = rubrics.data?.find((r) => r.id === liveEvalRubricId) ?? null;
  const liveEvalNeedsJudge = selectedRubric?.rubric.dimensions.some((d) => d.enabled) ?? false;
  const liveEvalJudgeReady = liveEvalJudge.providerId && liveEvalJudge.model;
  const liveEvalMissingJudge = liveEvalNeedsJudge && !liveEvalJudgeReady;
  const liveEvalReady = liveEvalEnabled && liveEvalRubricId && (!liveEvalNeedsJudge || liveEvalJudgeReady);
  const effectiveLiveEval = liveEvalReady && liveEvalRubricId
    ? liveEvalNeedsJudge
      ? { rubricId: liveEvalRubricId, providerId: liveEvalJudge.providerId ?? undefined, model: liveEvalJudge.model ?? undefined }
      : { rubricId: liveEvalRubricId }
    : undefined;
  const liveEvalStatus = !liveEvalEnabled ? 'off' : liveEvalReady ? 'ready' : 'pending';
  const liveEvalBlockedReason = liveEvalEnabled && liveEvalMissingJudge
    ? '实时评估需要裁判模型：请在「实时评估配置」中选择，或关闭实时评估'
    : null;

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
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers });
  const navigate = useNavigate();

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

  const handleTourChoice = (path: TourPath) => {
    if (path === 'import') setActiveSheet('import');
    else if (!configs.data?.some((c) => c.modelAvailable)) navigate('/settings');
  };

  const handleSendDanmaku = async (speaker: string, text: string): Promise<void> => {
    if (!active) {
      if (!effectiveAnchor || !effectiveConfig) {
        handleOpenSheet(effectiveAnchor ? 'config' : 'anchors');
        throw new Error('请先选择主播和回复配置');
      }
      if (liveEvalBlockedReason) throw new Error(liveEvalBlockedReason);
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
      <LeftIcons activeSheet={activeSheet} onOpenSheet={handleOpenSheet} evalRunning={evalRunning} liveEvalStatus={liveEvalStatus} onToggleLiveEval={() => setLiveEvalEnabled(!liveEvalEnabled)} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        {active ? (
          <ActiveSession
            sessionId={active}
            onClosed={() => setActive(null)}
            anchorName={anchorName}
            onAnchorChange={handleAnchorChange}
            onOpenSheet={(s) => handleOpenSheet(s)}
            onSendDanmaku={handleSendDanmaku}
            configId={effectiveConfig}
          />
        ) : (
          <>
            <RoomTopBar
              room={initialRoom}
              anchorName={anchorName}
              configName={configs.data?.find((c) => c.id === effectiveConfig)?.name ?? null}
              configId={effectiveConfig}
              onAnchorChange={handleAnchorChange}
              onOpenAnchors={() => handleOpenSheet('anchors')}
              onOpenConfig={() => handleOpenSheet('config')}
            />
            <ChatAreaEmpty
              anchorName={anchorName}
              configId={effectiveConfig}
              configs={configs.data}
              providers={providers.data}
              onSend={handleSendDanmaku}
              onOpenScript={() => handleOpenSheet('script')}
              onOpenAnchors={() => handleOpenSheet('anchors')}
              onOpenConfig={() => handleOpenSheet('config')}
              onOpenImport={() => handleOpenSheet('import')}
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
              <Select value={liveEvalRubricId ?? ''} onValueChange={(v) => setLiveEvalRubricId(v || null)}>
                <SelectTrigger className="h-8 w-full text-sm">
                  <SelectValue placeholder="请选择评分标准" />
                </SelectTrigger>
                <SelectContent>
                  {rubrics.data?.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                  {rubrics.data?.length === 0 && (
                    <SelectItem value="__none" disabled>先去『评分标准』新建</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </label>
            <div className="space-y-1">
              <span className="text-xs text-neutral-500">
                裁判模型{liveEvalNeedsJudge ? '' : '（可选，仅含规则评分时留空）'}
              </span>
              <ModelPicker value={liveEvalJudge} onChange={setLiveEvalJudge} placeholder={liveEvalNeedsJudge ? '请选择裁判模型' : '此标准无需裁判模型'} />
            </div>
          </div>
          {liveEvalEnabled && !liveEvalRubricId && (
            <p className="text-xs text-amber-700 dark:text-amber-400">⚠️ 实时评估已开启但尚未选择评分标准，开播后将不会评分</p>
          )}
          {liveEvalMissingJudge && (
            <p className="text-xs text-red-600 dark:text-red-400">⚠️ 当前评分标准包含 LLM 评分维度，开播前必须选择裁判模型</p>
          )}
        </div>
      )}

      <MobileIconBar activeSheet={activeSheet} onOpenSheet={handleOpenSheet} evalRunning={evalRunning} liveEvalStatus={liveEvalStatus} onToggleLiveEval={() => setLiveEvalEnabled(!liveEvalEnabled)} />

      <ScriptSheet
        open={activeSheet === 'script'}
        onOpenChange={(v) => !v && setActiveSheet(null)}
        anchorName={effectiveAnchor}
        configId={effectiveConfig}
        paceKey={paceKey}
        liveEval={effectiveLiveEval}
        blockedReason={liveEvalBlockedReason}
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

      <GuidedTour onChoose={handleTourChoice} />
    </div>
  );
}

function ChatAreaEmpty({
  anchorName,
  configId,
  configs,
  providers,
  onSend,
  onOpenScript,
  onOpenAnchors,
  onOpenConfig,
  onOpenImport,
}: {
  anchorName: string | null;
  configId: string | null;
  configs: AnchorConfigSummary[] | undefined;
  providers: Provider[] | undefined;
  onSend: (speaker: string, text: string) => Promise<void>;
  onOpenScript: () => void;
  onOpenAnchors: () => void;
  onOpenConfig: () => void;
  onOpenImport: () => void;
}) {
  const navigate = useNavigate();
  const selectedConfig = configs?.find((c) => c.id === configId) ?? configs?.[0];
  const hasProvider = (providers?.length ?? 0) > 0;
  const hasPoolModel = providers?.some((p) => p.enabledModels.length > 0) ?? false;
  const configReady = Boolean(selectedConfig?.modelAvailable);
  const ready = Boolean(anchorName) && configReady;

  const modelStep = !hasProvider
    ? { desc: '添加模型服务后才能生成回复', action: <button type="button" className={secondaryBtn} onClick={() => navigate('/settings')}>添加模型服务</button> }
    : !hasPoolModel
      ? { desc: '选择至少一个模型加入模型池（可供主播和裁判选择的模型）', action: <button type="button" className={secondaryBtn} onClick={() => navigate('/settings')}>管理模型</button> }
      : !configReady
        ? { desc: `为回复配置「${selectedConfig?.name ?? '默认'}」选择一个模型`, action: <button type="button" className={secondaryBtn} onClick={onOpenConfig}>选择回复模型</button> }
        : { desc: `${selectedConfig?.name ?? '已配置'} · ${selectedConfig?.model ?? ''}`, action: null };

  const steps = [
    {
      done: Boolean(anchorName),
      label: '主播',
      desc: anchorName ?? '还没有主播',
      action: !anchorName ? <button type="button" className={secondaryBtn} onClick={onOpenAnchors}>新建主播</button> : null,
    },
    { done: configReady, label: '回复模型', ...modelStep },
    {
      done: false,
      label: '开始模拟',
      desc: ready ? '发送第一条弹幕即可开始，或运行示例剧本' : '完成上面的步骤后可开始',
      action: ready ? <button type="button" className={secondaryBtn} onClick={onOpenScript}>运行剧本</button> : null,
    },
  ];
  const currentIndex = steps.findIndex((s) => !s.done);

  return (
    <>
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-4">
        <div className="w-full max-w-sm space-y-3">
          {ready ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              <span className="font-medium text-neutral-900 dark:text-neutral-100">{anchorName}</span> · {selectedConfig?.name}，发一条弹幕开始模拟。
            </p>
          ) : (
            <>
              <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400">模拟 AI 主播前还差这些</p>
              {steps.map((step, i) => (
                <div key={step.label} className={`flex items-start gap-3 rounded-lg border p-3 ${
                  step.done ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'
                    : i === currentIndex
                      ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
                      : 'border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800/30'
                }`}>
                  <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    step.done ? 'bg-emerald-500 text-white' : 'bg-neutral-300 text-neutral-600 dark:bg-neutral-600 dark:text-neutral-300'
                  }`}>{step.done ? '✓' : i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{step.label}</p>
                    <p className="text-xs text-neutral-600 dark:text-neutral-400">{step.desc}</p>
                  </div>
                  {step.action}
                </div>
              ))}
            </>
          )}
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 p-3 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
            <span className="flex-1">只想评估真人聊天记录？导入后直接评分，不需要回复模型。</span>
            <button type="button" className={secondaryBtn} onClick={onOpenImport}>导入记录</button>
          </div>
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
