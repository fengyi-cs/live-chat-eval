export type ProviderKind = 'openai' | 'anthropic' | 'gemini' | 'ollama';

export const PROVIDER_KINDS: readonly ProviderKind[] = ['openai', 'anthropic', 'gemini', 'ollama'];

export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  openai: 'OpenAI 兼容',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  ollama: 'Ollama',
};

export interface ProviderConfig {
  kind: ProviderKind;
  baseUrl: string;
  apiKey?: string;
}

export interface ModelInfo {
  id: string;
  name?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export type ChatChunk = { type: 'delta'; text: string } | { type: 'done'; usage?: ChatUsage };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CallOptions {
  fetch?: FetchLike;
  signal?: AbortSignal;
}

/** 新的服务商（例如公司自有大脑）实现这个接口并在 registry 注册即可 */
export interface ProviderAdapter {
  listModels(config: ProviderConfig, opts?: CallOptions): Promise<ModelInfo[]>;
  chat(config: ProviderConfig, req: ChatRequest, opts?: CallOptions): AsyncIterable<ChatChunk>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
