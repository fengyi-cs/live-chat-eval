import { chatStream } from '../providers/index.ts';
import type { CallOptions, ChatMessage, ChatRequest, ProviderConfig } from '../providers/types.ts';

export interface GenerateResult {
  text: string;
  firstTokenMs: number | null;
  totalMs: number;
}

export interface GenerateOptions {
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}

export type Generate = (messages: ChatMessage[], opts?: GenerateOptions) => Promise<GenerateResult>;

export function createGenerate(config: ProviderConfig, req: Omit<ChatRequest, 'messages'>, call: Pick<CallOptions, 'fetch'> = {}): Generate {
  return async (messages, opts = {}) => {
    const started = performance.now();
    let firstTokenMs: number | null = null;
    let text = '';
    for await (const chunk of chatStream(config, { ...req, messages }, { fetch: call.fetch, signal: opts.signal })) {
      if (chunk.type !== 'delta') continue;
      firstTokenMs ??= Math.round(performance.now() - started);
      text += chunk.text;
      opts.onDelta?.(chunk.text);
    }
    return { text, firstTokenMs, totalMs: Math.round(performance.now() - started) };
  };
}
