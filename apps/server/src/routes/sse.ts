import { chatStream, type ChatRequest, type FetchLike, type ProviderConfig } from '@lce/core';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';

export function streamChatSSE(c: Context, config: ProviderConfig, req: ChatRequest, fetchImpl?: FetchLike) {
  const signal = c.req.raw.signal;
  return streamSSE(c, async (stream) => {
    const started = performance.now();
    let firstTokenMs: number | null = null;
    try {
      for await (const chunk of chatStream(config, req, { fetch: fetchImpl, signal })) {
        if (chunk.type === 'delta') {
          firstTokenMs ??= Math.round(performance.now() - started);
          await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: chunk.text }) });
        } else {
          const totalMs = Math.round(performance.now() - started);
          await stream.writeSSE({ event: 'done', data: JSON.stringify({ model: req.model, usage: chunk.usage ?? null, firstTokenMs, totalMs }) });
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: (err as Error).message }) });
    }
  });
}
