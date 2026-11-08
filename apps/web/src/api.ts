import type {
  ActionEvent,
  AnchorExchange,
  ChatMessage,
  ChatUsage,
  ModelInfo,
  ProviderKind,
  ReplyStrategy,
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

export interface SessionSummary {
  id: string;
  externalId: string | null;
  anchorName: string;
  title: string | null;
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
}

export interface SessionDetail extends SessionSummary {
  unanswered: number[];
  orphanActions: ActionEvent[];
  messages: StoredMessage[];
}

export interface Anchor {
  name: string;
  code: string | null;
  personaPrompt: string;
  sessionCount: number;
  configCount: number;
}

export interface AnchorConfig {
  id: string;
  anchorName: string;
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

export interface AnchorDetail extends Omit<Anchor, 'configCount'> {
  configs: AnchorConfig[];
}

export type AnchorConfigInput = Partial<Omit<AnchorConfig, 'id' | 'anchorName' | 'strategy'>> & { strategy?: Partial<ReplyStrategy> };

export interface TrialBody {
  input: TurnInput;
  history: AnchorExchange[];
}

export interface Provider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKeyMasked: string | null;
  models: ModelInfo[];
  modelsFetchedAt: string | null;
  defaultModel: string | null;
}

export interface ProviderInput {
  name?: string;
  baseUrl?: string;
  kind?: ProviderKind;
  apiKey?: string;
  defaultModel?: string | null;
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
  createAnchor: (body: { name: string; personaPrompt?: string }) => request<Anchor>('/anchors', json('POST', body)),
  updateAnchor: (name: string, body: { code?: string | null; personaPrompt?: string }) => request<Anchor>(anchorPath(name), json('PATCH', body)),
  deleteAnchor: (name: string) => request<void>(anchorPath(name), { method: 'DELETE' }),
  createConfig: (anchorName: string, body: AnchorConfigInput & { name: string }) =>
    request<AnchorConfig>(`${anchorPath(anchorName)}/configs`, json('POST', body)),
  updateConfig: (id: string, body: AnchorConfigInput) => request<AnchorConfig>(`/anchor-configs/${id}`, json('PATCH', body)),
  deleteConfig: (id: string) => request<void>(`/anchor-configs/${id}`, { method: 'DELETE' }),
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
  refreshModels: (id: string) => request<Provider>(`/providers/${id}/models`, { method: 'POST' }),
  streamChat: (
    providerId: string,
    body: { model?: string; messages: ChatMessage[]; temperature?: number },
    handlers: ChatHandlers,
    signal?: AbortSignal,
  ) => streamSSE(`/providers/${providerId}/chat`, body, handlers, signal),
};
