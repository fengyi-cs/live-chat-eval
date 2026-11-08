import { describe, expect, it } from 'vitest';
import {
  chatStream,
  chatText,
  detectProvider,
  listModels,
  ProviderError,
  resolveModels,
  type ChatChunk,
  type FetchLike,
  type ProviderConfig,
} from '../src/index.ts';

interface Call {
  url: string;
  init?: RequestInit;
}

function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Call[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fn, calls };
}

function streamOf(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(encoder.encode(ch));
        c.close();
      },
    }),
  );
}

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const bodyOf = (call: Call) => JSON.parse(call.init!.body as string);
const headersOf = (call: Call) => call.init!.headers as Record<string, string>;

async function collect(it: AsyncIterable<ChatChunk>) {
  const out: ChatChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe('detectProvider', () => {
  it.each([
    ['https://api.openai.com/v1/chat/completions', 'openai', 'https://api.openai.com/v1'],
    ['api.deepseek.com', 'openai', 'http://api.deepseek.com'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1/', 'openai', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
    ['https://api.anthropic.com/v1/messages', 'anthropic', 'https://api.anthropic.com'],
    ['https://open.bigmodel.cn/api/anthropic', 'anthropic', 'https://open.bigmodel.cn/api/anthropic'],
    ['https://generativelanguage.googleapis.com', 'gemini', 'https://generativelanguage.googleapis.com/v1beta'],
    ['https://generativelanguage.googleapis.com/v1/models', 'gemini', 'https://generativelanguage.googleapis.com/v1'],
    ['localhost:11434/api/chat', 'ollama', 'http://localhost:11434'],
    ['http://127.0.0.1:11434/v1', 'ollama', 'http://127.0.0.1:11434'],
    ['http://10.0.0.5:8000/v1', 'openai', 'http://10.0.0.5:8000/v1'],
  ])('%s -> %s', (input, kind, baseUrl) => {
    expect(detectProvider(input)).toEqual({ kind, baseUrl });
  });

  it('rejects non-http urls', () => {
    expect(() => detectProvider('ftp://example.com')).toThrow(ProviderError);
    expect(() => detectProvider('http://')).toThrow(ProviderError);
  });
});

describe('openai adapter', () => {
  const config: ProviderConfig = { kind: 'openai', baseUrl: 'https://llm.local/v1', apiKey: 'sk-test' };

  it('lists models sorted and sends bearer auth', async () => {
    const f = fakeFetch(() => jsonRes({ data: [{ id: 'qwen-max' }, { id: 'deepseek-chat' }] }));
    expect(await listModels(config, { fetch: f.fn })).toEqual([{ id: 'deepseek-chat' }, { id: 'qwen-max' }]);
    expect(f.calls[0]!.url).toBe('https://llm.local/v1/models');
    expect(headersOf(f.calls[0]!).authorization).toBe('Bearer sk-test');
  });

  it('streams deltas across split chunks and reports usage', async () => {
    const f = fakeFetch(() =>
      streamOf([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"哈喽"}}]}\n\ndata: {"choi',
        'ces":[{"delta":{"content":"宝子"}}]}\r\n\r\n',
        'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4}}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const chunks = await collect(chatStream(config, { model: 'm', messages: [{ role: 'user', content: 'hi' }], temperature: 0.7 }, { fetch: f.fn }));
    expect(chunks).toEqual([
      { type: 'delta', text: '哈喽' },
      { type: 'delta', text: '宝子' },
      { type: 'done', usage: { inputTokens: 12, outputTokens: 4 } },
    ]);
    expect(f.calls[0]!.url).toBe('https://llm.local/v1/chat/completions');
    expect(bodyOf(f.calls[0]!)).toMatchObject({ model: 'm', stream: true, temperature: 0.7 });
  });

  it('turns http errors into ProviderError with status and body', async () => {
    const f = fakeFetch(() => new Response('{"error":"invalid key"}', { status: 401 }));
    const err = await listModels(config, { fetch: f.fn }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ status: 401 });
    expect(err.message).toContain('invalid key');
  });

  it('resolveModels retries with /v1 on 404 when no version is present', async () => {
    const f = fakeFetch((url) => (url === 'https://llm.local/v1/models' ? jsonRes({ data: [{ id: 'a' }] }) : new Response('', { status: 404 })));
    const res = await resolveModels({ ...config, baseUrl: 'https://llm.local' }, { fetch: f.fn });
    expect(res).toEqual({ baseUrl: 'https://llm.local/v1', models: [{ id: 'a' }] });
    expect(f.calls.map((c) => c.url)).toEqual(['https://llm.local/models', 'https://llm.local/v1/models']);
  });

  it('resolveModels does not retry when the url already has a version', async () => {
    const f = fakeFetch(() => new Response('', { status: 404 }));
    await expect(resolveModels(config, { fetch: f.fn })).rejects.toMatchObject({ status: 404 });
    expect(f.calls).toHaveLength(1);
  });
});

describe('anthropic adapter', () => {
  const config: ProviderConfig = { kind: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'ak' };

  it('moves system messages to the system field and parses events', async () => {
    const f = fakeFetch(() =>
      streamOf([
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":20}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"来啦"}}\n\n',
        'event: ping\ndata: {"type":"ping"}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
    );
    const text = await chatText(
      config,
      { model: 'claude', messages: [{ role: 'system', content: '你是主播' }, { role: 'user', content: '在吗' }] },
      { fetch: f.fn },
    );
    expect(text).toBe('来啦');
    const call = f.calls[0]!;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(headersOf(call)).toMatchObject({ 'x-api-key': 'ak', 'anthropic-version': '2023-06-01' });
    expect(bodyOf(call)).toMatchObject({ system: '你是主播', messages: [{ role: 'user', content: '在吗' }], max_tokens: 1024 });
  });

  it('surfaces in-stream errors', async () => {
    const f = fakeFetch(() => streamOf(['data: {"type":"error","error":{"message":"overloaded"}}\n\n']));
    await expect(chatText(config, { model: 'c', messages: [{ role: 'user', content: 'x' }] }, { fetch: f.fn })).rejects.toThrow('overloaded');
  });
});

describe('gemini adapter', () => {
  const config: ProviderConfig = { kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'gk' };

  it('pages through models and keeps only chat-capable ones', async () => {
    const f = fakeFetch((url) =>
      url.includes('pageToken=p2')
        ? jsonRes({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] })
        : jsonRes({
            models: [
              { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
              { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
            ],
            nextPageToken: 'p2',
          }),
    );
    expect(await listModels(config, { fetch: f.fn })).toEqual([{ id: 'gemini-2.5-flash', name: undefined }, { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }]);
    expect(headersOf(f.calls[0]!)['x-goog-api-key']).toBe('gk');
  });

  it('maps roles, skips thought parts and streams text', async () => {
    const f = fakeFetch(() =>
      streamOf([
        'data: {"candidates":[{"content":{"parts":[{"text":"想一下","thought":true}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"晚上好"}]}}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":2}}\n\n',
      ]),
    );
    const chunks = await collect(
      chatStream(
        config,
        {
          model: 'gemini-2.5-flash',
          messages: [
            { role: 'system', content: 'S' },
            { role: 'user', content: 'U' },
            { role: 'assistant', content: 'A' },
          ],
        },
        { fetch: f.fn },
      ),
    );
    expect(chunks).toEqual([
      { type: 'delta', text: '晚上好' },
      { type: 'done', usage: { inputTokens: 9, outputTokens: 2 } },
    ]);
    expect(f.calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
    expect(bodyOf(f.calls[0]!)).toMatchObject({
      systemInstruction: { parts: [{ text: 'S' }] },
      contents: [
        { role: 'user', parts: [{ text: 'U' }] },
        { role: 'model', parts: [{ text: 'A' }] },
      ],
    });
  });
});

describe('ollama adapter', () => {
  const config: ProviderConfig = { kind: 'ollama', baseUrl: 'http://localhost:11434' };

  it('lists tags and streams ndjson', async () => {
    const f = fakeFetch((url) =>
      url.endsWith('/api/tags')
        ? jsonRes({ models: [{ name: 'qwen3:8b' }] })
        : streamOf(['{"message":{"content":"你"},"done":false}\n{"message":{"content":"好"},', '"done":false}\n{"message":{"content":""},"done":true,"prompt_eval_count":5,"eval_count":2}\n']),
    );
    expect(await listModels(config, { fetch: f.fn })).toEqual([{ id: 'qwen3:8b' }]);
    const chunks = await collect(chatStream(config, { model: 'qwen3:8b', messages: [{ role: 'user', content: 'hi' }] }, { fetch: f.fn }));
    expect(chunks.map((c) => (c.type === 'delta' ? c.text : 'DONE'))).toEqual(['你', '好', 'DONE']);
    expect(chunks.at(-1)).toEqual({ type: 'done', usage: { inputTokens: 5, outputTokens: 2 } });
    expect(f.calls[0]!.init?.headers).toEqual({});
  });
});
