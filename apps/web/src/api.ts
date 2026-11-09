import type {
  ActionEvent,
  AnchorExchange,
  ChatMessage,
  ChatUsage,
  EvalItemStatus,
  EvalSummary,
  JudgeScores,
  ModelInfo,
  Pace,
  ProbeAttempt,
  ProviderKind,
  ReplyStrategy,
  Rubric,
  RuleResult,
  SimEvent,
  SimMode,
  SpeakerRole,
  TranscriptMeta,
  TurnInput,
} from '@lce/core';

export interface ImportPreview {
  title?: string;
  meta: TranscriptMeta;
  messageCount: number;
  speakers: { name: string; count: number; suggestedRole: SpeakerRole }[];
  knownAnchor: string | null;
  duplicateSessionId: string | null;
}

export type SessionSource = 'import' | 'live' | 'script';
export type SessionStatus = 'done' | 'running' | 'stopped' | 'error';

export interface SessionSummary {
  id: string;
  externalId: string | null;
  anchorName: string;
  title: string | null;
  source: SessionSource;
  status: SessionStatus;
  startedAt: string | null;
  endedAt: string | null;
  messageCount: number;
}

export interface StoredMessage {
  id: number;
  seq: number;
  time: string;
  speaker: string;
  role: SpeakerRole;
  text: string;
  repliesTo: number[] | null;
  latencyMs: number | null;
  proactive: boolean | null;
  actions: ActionEvent[] | null;
  genFirstTokenMs: number | null;
  genTotalMs: number | null;
}

export interface SessionSnapshot {
  configName: string;
  providerName: string;
  model: string;
  temperature: number | null;
  strategy: ReplyStrategy;
  mode: SimMode;
  pace: Pace | null;
  scriptName: string | null;
}

export interface SessionDetail extends SessionSummary {
  unanswered: number[];
  orphanActions: ActionEvent[];
  error: string | null;
  snapshot: SessionSnapshot | null;
  messages: StoredMessage[];
}

export type AnchorSource = 'import' | 'manual';

export interface Anchor {
  name: string;
  code: string | null;
  source: AnchorSource;
  personaPrompt: string;
  sessionCount: number;
}

/** 回复配置：与主播解耦，开播时与任意主播组合 */
export interface AnchorConfig {
  id: string;
  name: string;
  providerId: string | null;
  model: string | null;
  temperature: number | null;
  maxTokens: number | null;
  contextTurns: number;
  replyRules: string;
  proactivePrompt: string;
  strategy: ReplyStrategy;
}

export type AnchorDetail = Anchor;

export type AnchorConfigInput = Partial<Omit<AnchorConfig, 'id' | 'strategy'>> & { strategy?: Partial<ReplyStrategy> };

export interface TrialBody {
  anchorName: string;
  input: TurnInput;
  history: AnchorExchange[];
}

export interface AnchorConfigSummary extends AnchorConfig {
  providerName: string | null;
  /** 模型在模型池里，可以开播 */
  modelAvailable: boolean;
}

export interface Script {
  id: string;
  name: string;
  content: string;
  defaultGapSec: number;
  eventCount: number;
  durationMs: number;
  speakerCount: number;
  issueCount: number;
}

export type ScriptInput = Partial<Pick<Script, 'name' | 'content' | 'defaultGapSec'>>;

export interface JudgeChoice {
  rubricId: string;
  providerId?: string;
  model?: string;
  temperature?: number | null;
  samples?: number;
}

interface StartSimBase {
  anchorName: string;
  configId: string;
  liveEval?: JudgeChoice;
}

export type StartSim = (StartSimBase & { mode: 'live' }) | (StartSimBase & { mode: 'script'; scriptId: string; pace: Pace });

export interface RunInfo {
  sessionId: string;
  mode: SimMode;
  anchorName: string;
  configName: string;
  scriptName: string | null;
  scriptDurationMs: number | null;
  pace: Pace | null;
  startedAt: string;
  evalId: string | null;
}

export type RoomEvent = SimEvent | { type: 'hello'; info: RunInfo } | { type: 'pace'; pace: Pace } | { type: 'gone' };

export interface RubricRow {
  id: string;
  name: string;
  rubric: Rubric;
}

export type EvalStatus = 'running' | 'done' | 'stopped' | 'error';

export interface EvalListItem {
  id: string;
  sessionId: string;
  sessionTitle: string | null;
  anchorName: string;
  rubricName: string;
  model: string | null;
  status: EvalStatus;
  error: string | null;
  composite: number | null;
  createdAt: string;
}

export interface EvalItemView {
  id: number;
  kind: 'turn' | 'session';
  seq: number | null;
  proactive: boolean;
  status: EvalItemStatus;
  scores: JudgeScores | null;
  error: string | null;
  calls: number;
  text: string | null;
}

export interface EvalDetail {
  id: string;
  sessionId: string;
  sessionTitle: string | null;
  anchorName: string | null;
  rubricName: string;
  rubric: Rubric;
  providerName: string | null;
  model: string | null;
  status: EvalStatus;
  error: string | null;
  rules: RuleResult;
  summary: EvalSummary;
  calls: number;
  items: EvalItemView[];
  createdAt: string;
}

export interface StartEvalBody extends JudgeChoice {
  sessionId: string;
}

export type EvalEvent =
  | { type: 'hello'; eval: EvalDetail }
  | { type: 'item'; item: EvalItemView; summary: EvalSummary; rules: RuleResult; calls: number }
  | { type: 'end'; status: EvalStatus; error: string | null }
  | { type: 'gone' };

function subscribeSim(sessionId: string, onEvent: (ev: RoomEvent) => void) {
  const source = new EventSource(`/api/sims/${sessionId}/events`);
  source.onmessage = (e) => {
    const ev = JSON.parse(e.data) as RoomEvent;
    onEvent(ev);
    if (ev.type === 'end' || ev.type === 'gone') source.close();
  };
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) onEvent({ type: 'gone' });
  };
  return () => source.close();
}

export interface Provider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKeyMasked: string | null;
  models: ModelInfo[];
  modelsFetchedAt: string | null;
  /** 模型池：启用的模型 ID */
  enabledModels: string[];
}

export interface ProviderRefresh extends Provider {
  attempts: ProbeAttempt[];
}

export interface ProviderInput {
  name?: string;
  baseUrl?: string;
  kind?: ProviderKind;
  apiKey?: string;
  enabledModels?: string[];
}

export interface ChatDone {
  model: string;
  usage: ChatUsage | null;
  firstTokenMs: number | null;
  totalMs: number;
}

export interface ChatHandlers {
  onDelta: (text: string) => void;
  onDone: (info: ChatDone) => void;
}

async function errorOf(res: Response) {
  const body = await res.json().catch(() => null);
  const message = typeof body?.error === 'string' ? body.error : res.status === 400 ? '请求参数不合法' : `请求失败（${res.status}）`;
  return new Error(message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (!res.ok) throw await errorOf(res);
  return res.status === 204 ? (undefined as T) : res.json();
}

async function streamSSE(path: string, body: unknown, handlers: ChatHandlers, signal?: AbortSignal) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw await errorOf(res);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (!data) continue;
      const payload = JSON.parse(data);
      if (event === 'delta') handlers.onDelta(payload.text);
      else if (event === 'done') handlers.onDone(payload);
      else if (event === 'error') throw new Error(payload.message);
    }
  }
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const anchorPath = (name: string) => `/anchors/${encodeURIComponent(name)}`;

export const api = {
  previewImport: (content: string) =>
    request<ImportPreview>('/imports/preview', { method: 'POST', body: JSON.stringify({ content }) }),
  commitImport: (content: string, roles: Record<string, SpeakerRole>, replace: boolean) =>
    request<{ sessionId: string }>('/imports', { method: 'POST', body: JSON.stringify({ content, roles, replace }) }),
  sessions: () => request<SessionSummary[]>('/sessions'),
  session: (id: string) => request<SessionDetail>(`/sessions/${id}`),
  deleteSession: (id: string) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),
  anchors: () => request<Anchor[]>('/anchors'),
  anchor: (name: string) => request<AnchorDetail>(anchorPath(name)),
  createAnchor: (body: { name: string; code?: string | null; personaPrompt?: string }) => request<Anchor>('/anchors', json('POST', body)),
  updateAnchor: (name: string, body: { code?: string | null; personaPrompt?: string }) => request<Anchor>(anchorPath(name), json('PATCH', body)),
  deleteAnchor: (name: string) => request<void>(anchorPath(name), { method: 'DELETE' }),
  createConfig: (body: AnchorConfigInput & { name: string }) => request<AnchorConfig>('/anchor-configs', json('POST', body)),
  updateConfig: (id: string, body: AnchorConfigInput) => request<AnchorConfig>(`/anchor-configs/${id}`, json('PATCH', body)),
  deleteConfig: (id: string) => request<void>(`/anchor-configs/${id}`, { method: 'DELETE' }),
  allConfigs: () => request<AnchorConfigSummary[]>('/anchor-configs'),
  scripts: () => request<Script[]>('/scripts'),
  createScript: (body: ScriptInput & { name: string; content: string }) => request<Script>('/scripts', json('POST', body)),
  updateScript: (id: string, body: ScriptInput) => request<Script>(`/scripts/${id}`, json('PATCH', body)),
  deleteScript: (id: string) => request<void>(`/scripts/${id}`, { method: 'DELETE' }),
  sims: () => request<RunInfo[]>('/sims'),
  startSim: (body: StartSim) => request<RunInfo>('/sims', json('POST', body)),
  injectDanmaku: (id: string, speaker: string, text: string) => request<unknown>(`/sims/${id}/danmaku`, json('POST', { speaker, text })),
  setPace: (id: string, pace: Pace) => request<void>(`/sims/${id}/pace`, json('POST', pace)),
  stepSim: (id: string) => request<void>(`/sims/${id}/step`, { method: 'POST' }),
  stopSim: (id: string) => request<void>(`/sims/${id}/stop`, { method: 'POST' }),
  subscribeSim,
  rubrics: () => request<RubricRow[]>('/rubrics'),
  createRubric: (body: { name: string; rubric: Rubric }) => request<RubricRow>('/rubrics', json('POST', body)),
  updateRubric: (id: string, body: { name?: string; rubric?: Rubric }) => request<RubricRow>(`/rubrics/${id}`, json('PATCH', body)),
  deleteRubric: (id: string) => request<void>(`/rubrics/${id}`, { method: 'DELETE' }),
  evals: (sessionId?: string) => request<EvalListItem[]>(`/evals${sessionId ? `?sessionId=${sessionId}` : ''}`),
  evalDetail: (id: string) => request<EvalDetail>(`/evals/${id}`),
  startEval: (body: StartEvalBody) => request<EvalDetail>('/evals', json('POST', body)),
  stopEval: (id: string) => request<void>(`/evals/${id}/stop`, { method: 'POST' }),
  deleteEval: (id: string) => request<void>(`/evals/${id}`, { method: 'DELETE' }),
  subscribeEval: (id: string, onEvent: (ev: EvalEvent) => void) => {
    const source = new EventSource(`/api/evals/${id}/events`);
    source.onmessage = (e) => {
      const ev = JSON.parse(e.data) as EvalEvent;
      onEvent(ev);
      if (ev.type === 'end' || ev.type === 'gone') source.close();
    };
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) onEvent({ type: 'gone' });
    };
    return () => source.close();
  },
  trialPrompt: (id: string, body: TrialBody) => request<ChatMessage[]>(`/anchor-configs/${id}/prompt`, json('POST', body)),
  trialChat: (id: string, body: TrialBody, handlers: ChatHandlers, signal?: AbortSignal) =>
    streamSSE(`/anchor-configs/${id}/chat`, body, handlers, signal),
  providers: () => request<Provider[]>('/providers'),
  detectProvider: (baseUrl: string) =>
    request<{ kind: ProviderKind; baseUrl: string }>('/providers/detect', { method: 'POST', body: JSON.stringify({ baseUrl }) }),
  createProvider: (input: ProviderInput) => request<Provider>('/providers', { method: 'POST', body: JSON.stringify(input) }),
  updateProvider: (id: string, input: ProviderInput) =>
    request<Provider>(`/providers/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteProvider: (id: string) => request<void>(`/providers/${id}`, { method: 'DELETE' }),
  refreshModels: (id: string, detect = false) => request<ProviderRefresh>(`/providers/${id}/models${detect ? '?detect=1' : ''}`, { method: 'POST' }),
  streamChat: (
    providerId: string,
    body: { model: string; messages: ChatMessage[]; temperature?: number },
    handlers: ChatHandlers,
    signal?: AbortSignal,
  ) => streamSSE(`/providers/${providerId}/chat`, body, handlers, signal),
};
