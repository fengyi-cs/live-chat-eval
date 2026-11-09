import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useReducer, useState } from 'react';
import { api, type RunInfo } from '../api.ts';
import { primaryBtn, secondaryBtn } from '../ui.ts';
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

  if (room.gone && !room.ended) return <SessionView id={sessionId} onDeleted={onClosed} />;
  if (!room.info) return <p className="flex flex-1 items-center justify-center text-sm text-neutral-500">连接中…</p>;

  const showInput = room.info.mode === 'live' && !room.ended;

  return (
    <>
      <RoomTopBar
        room={room}
        anchorName={anchorName}
        onAnchorChange={onAnchorChange}
        onModeChange={() => {}}
        onOpenAnchors={() => onOpenSheet('anchors')}
      />
      <ChatArea room={room} info={room.info} liveEval={liveEval} />
      {room.info.mode === 'script' && !room.ended && (
        <ScriptControlBar sessionId={sessionId} pace={room.info.pace} waitingStep={room.waitingStep} running />
      )}
      {showInput && (
        <DanmakuInput onSend={onSendDanmaku} />
      )}
      {room.ended && room.gone && <SessionView id={sessionId} onDeleted={onClosed} />}
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
        const info = await api.startSim({ mode: 'live', anchorName: effectiveAnchor, configId: effectiveConfig });
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
    <div className="flex h-[calc(100vh-7rem)] gap-1">
      <LeftIcons activeSheet={activeSheet} onOpenSheet={handleOpenSheet} evalRunning={evalRunning} />

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
              onAnchorChange={handleAnchorChange}
              onModeChange={() => {}}
              onOpenAnchors={() => handleOpenSheet('anchors')}
            />
            <ChatAreaEmpty
              anchorName={anchorName}
              configId={configId}
              onSend={handleSendDanmaku}
              onOpenScript={() => handleOpenSheet('script')}
              onOpenAnchors={() => handleOpenSheet('anchors')}
              onOpenConfig={() => handleOpenSheet('config')}
            />
          </>
        )}
      </div>

      <RightIcons activeSheet={activeSheet} onOpenSheet={handleOpenSheet} />
      <MobileIconBar activeSheet={activeSheet} onOpenSheet={handleOpenSheet} evalRunning={evalRunning} />

      <ScriptSheet
        open={activeSheet === 'script'}
        onOpenChange={(v) => !v && setActiveSheet(null)}
        anchorName={effectiveAnchor}
        configId={effectiveConfig}
        paceKey={paceKey}
        onStartScript={handleStarted}
      />

      <ImportSheet
        open={activeSheet === 'import'}
        onOpenChange={(v) => !v && setActiveSheet(null)}
        onImported={() => { setActive(null); setActiveSheet(null); }}
      />

      <SessionSheet
        open={activeSheet === 'sessions'}
        onOpenChange={(v) => !v && setActiveSheet(null)}
        onSelect={() => setActiveSheet(null)}
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
    </div>
  );
}

function ChatAreaEmpty({
  anchorName,
  configId,
  onSend,
  onOpenScript,
  onOpenAnchors,
  onOpenConfig,
}: {
  anchorName: string | null;
  configId: string | null;
  onSend: (speaker: string, text: string) => Promise<void>;
  onOpenScript: () => void;
  onOpenAnchors: () => void;
  onOpenConfig: () => void;
}) {
  return (
    <>
      <div className="flex flex-1 items-center justify-center">
        <div className="space-y-3 text-center">
          {!anchorName && (
            <p className="text-sm text-amber-600">还没有主播，先新建一个</p>
          )}
          {anchorName && !configId && (
            <p className="text-sm text-amber-600">还没有可用的回复配置</p>
          )}
          {anchorName && configId && (
            <p className="text-sm text-neutral-500">在下面发一条弹幕开始聊天，或加载剧本测试</p>
          )}
          <div className="flex justify-center gap-2">
            <button type="button" className={primaryBtn} onClick={onOpenScript}>
              加载剧本
            </button>
            {!anchorName && (
              <button type="button" className={secondaryBtn} onClick={onOpenAnchors}>新建主播</button>
            )}
            {anchorName && !configId && (
              <button type="button" className={secondaryBtn} onClick={onOpenConfig}>配置回复</button>
            )}
          </div>
        </div>
      </div>
      <DanmakuInput
        onSend={onSend}
        disabled={!anchorName || !configId}
        hint={!anchorName || !configId ? '请先完成主播和配置' : '发一条弹幕开始聊天'}
      />
    </>
  );
}
