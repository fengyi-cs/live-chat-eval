import type { Pace } from '@lce/core';
import { useMutation } from '@tanstack/react-query';
import { PACE_OPTIONS, paceKeyOf, paceOf, type PaceKey } from '../../labels.ts';
import { api } from '../../api.ts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.tsx';
import { primaryBtn, secondaryBtn } from '../../ui.ts';

interface Props {
  sessionId: string;
  pace: Pace | null;
  waitingStep: boolean;
  running: boolean;
}

export function ScriptControlBar({ sessionId, pace, waitingStep, running }: Props) {
  const paceMut = useMutation({ mutationFn: (p: Pace) => api.setPace(sessionId, p) });
  const stepMut = useMutation({ mutationFn: () => api.stepSim(sessionId) });
  const stopMut = useMutation({ mutationFn: () => api.stopSim(sessionId) });
  const error = paceMut.error ?? stepMut.error ?? stopMut.error;

  if (!running) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 px-2 py-1.5 text-sm dark:border-neutral-800">
      <Select value={paceKeyOf(pace)} onValueChange={(v) => paceMut.mutate(paceOf(v as PaceKey))}>
        <SelectTrigger className="h-8 w-auto text-sm" aria-label="节奏">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PACE_OPTIONS.map((o) => (
            <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pace?.kind === 'step' && (
        <button type="button" className={primaryBtn} disabled={!waitingStep || stepMut.isPending} onClick={() => stepMut.mutate()}>
          下一步
        </button>
      )}
      <button
        type="button"
        className={`${secondaryBtn} ml-auto text-red-600`}
        disabled={stopMut.isPending}
        onClick={() => stopMut.mutate()}
      >
        结束直播
      </button>
      {error && <p className="w-full text-xs text-red-600">{error.message}</p>}
    </div>
  );
}
