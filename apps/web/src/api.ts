import type { ActionEvent, SpeakerRole, TranscriptMeta } from '@lce/core';

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
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `请求失败（${res.status}）`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  previewImport: (content: string) =>
    request<ImportPreview>('/imports/preview', { method: 'POST', body: JSON.stringify({ content }) }),
  commitImport: (content: string, roles: Record<string, SpeakerRole>, replace: boolean) =>
    request<{ sessionId: string }>('/imports', { method: 'POST', body: JSON.stringify({ content, roles, replace }) }),
  sessions: () => request<SessionSummary[]>('/sessions'),
  session: (id: string) => request<SessionDetail>(`/sessions/${id}`),
  deleteSession: (id: string) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),
  anchors: () => request<Anchor[]>('/anchors'),
};
