import { describe, expect, it } from 'vitest';
import {
  chatStream,
  chatText,
  detectProvider,
  listModels,
  pingChat,
  ProviderError,
  probeModels,
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
    ['api.deepseek.com', 'openai', 'https://api.deepseek.com'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1/', 'openai', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
    ['https://cch.example/v1/responses', 'openai-responses', 'https://cch.example/v1'],
    ['https://api.anthropic.com/v1/messages', 'anthropic', 'https://api.anthropic.com'],
    ['https://gw.example/v1/messages', 'anthropic', 'https://gw.example'],
    ['https://open.bigmodel.cn/api/anthropic', 'anthropic', 'https://open.bigmodel.cn/api/anthropic'],
    ['https://generativelanguage.googleapis.com', 'gemini', 'https://generativelanguage.googleapis.com/v1beta'],
    ['https://generativelanguage.googleapis.com/v1/models', 'gemini', 'https://generativelanguage.googleapis.com/v1'],
    ['https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse', 'gemini', 'https://generativelanguage.googleapis.com/v1beta'],
    ['https://gw.example/gemini', 'gemini', 'https://gw.example/gemini/v1beta'],
    ['https://gw.example/v1beta', 'gemini', 'https://gw.example/v1beta'],
    ['https://gw.example/v1/models/gemini-2.5-pro:generateContent', 'gemini', 'https://gw.example/v1beta'],
    ['localhost:11434/api/chat', 'ollama', 'http://localhost:11434'],
    ['http://127.0.0.1:11434/v1', 'ollama', 'http://127.0.0.1:11434'],
    ['http://10.0.0.5:8000/v1', 'openai', 'http://10.0.0.5:8000/v1'],
    ['10.0.0.5:8000/v1', 'openai', 'http://10.0.0.5:8000/v1'],
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

  it('resolveModels does not retry auth failures', async () => {
    const f = fakeFetch(() => new Response('', { status: 401 }));
    await expect(resolveModels({ ...config, baseUrl: 'https://llm.local' }, { fetch: f.fn })).rejects.toMatchObject({ status: 401 });
    expect(f.calls).toHaveLength(1);
  });

  it('resolveModels retries with /v1 when the bare host serves an html page with 200', async () => {
    const f = fakeFetch((url) => (url === 'https://llm.local/v1/models' ? jsonRes({ data: [{ id: 'a' }] }) : new Response('<!DOCTYPE html><html></html>')));
    expect(await resolveModels({ ...config, baseUrl: 'https://llm.local' }, { fetch: f.fn })).toEqual({ baseUrl: 'https://llm.local/v1', models: [{ id: 'a' }] });
  });

  it('reports an html page as a missing path instead of a json parse crash', async () => {
    const f = fakeFetch(() => new Response('<!DOCTYPE html><html></html>'));
    await expect(listModels(config, { fetch: f.fn })).rejects.toThrow('网页');
  });
});

describe('openai responses adapter', () => {
  const config: ProviderConfig = { kind: 'openai-responses', baseUrl: 'https://llm.local/v1', apiKey: 'sk-test' };

  it('posts to /responses with instructions and input, streams text deltas and usage', async () => {
    const f = fakeFetch(() =>
      streamOf([
        'event: response.created\ndata: {"type":"response.created","response":{"usage":null}}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"P"}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ong"}\n\n',
        'event: response.output_text.done\ndata: {"type":"response.output_text.done","text":"Pong"}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":13,"output_tokens":5}}}\n\n',
      ]),
    );
    const chunks = await collect(
      chatStream(config, { model: 'm', messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'ping' }], temperature: 0.5, maxTokens: 32 }, { fetch: f.fn }),
    );
    expect(chunks).toEqual([
      { type: 'delta', text: 'P' },
      { type: 'delta', text: 'ong' },
      { type: 'done', usage: { inputTokens: 13, outputTokens: 5 } },
    ]);
    expect(f.calls[0]!.url).toBe('https://llm.local/v1/responses');
    expect(headersOf(f.calls[0]!).authorization).toBe('Bearer sk-test');
    expect(bodyOf(f.calls[0]!)).toEqual({
      model: 'm',
      instructions: 'S',
      input: [{ role: 'user', content: 'ping' }],
      temperature: 0.5,
      max_output_tokens: 32,
      store: false,
      stream: true,
    });
  });

  it('surfaces failed responses and in-stream errors', async () => {
    const failed = fakeFetch(() => streamOf(['data: {"type":"response.failed","response":{"error":{"message":"model overloaded"}}}\n\n']));
    await expect(chatText(config, { model: 'm', messages: [{ role: 'user', content: 'x' }] }, { fetch: failed.fn })).rejects.toThrow('model overloaded');
    const errored = fakeFetch(() => streamOf(['data: {"type":"error","message":"bad input"}\n\n']));
    await expect(chatText(config, { model: 'm', messages: [{ role: 'user', content: 'x' }] }, { fetch: errored.fn })).rejects.toThrow('bad input');
  });
});

describe('pingChat', () => {
  const responsesOnly = (url: string) =>
    url.endsWith('/responses')
      ? streamOf(['data: {"type":"response.output_text.delta","delta":"pong"}\n\n', 'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n'])
      : new Response('{"error":{"message":"No available providers"}}', { status: 503 });

  it('falls back from chat completions to responses and reports the working kind', async () => {
    const f = fakeFetch(responsesOnly);
    const res = await pingChat({ kind: 'openai', baseUrl: 'https://gw.example/v1', apiKey: 'k' }, 'm', { fetch: f.fn });
    expect(res).toMatchObject({ kind: 'openai-responses', reply: 'pong', usage: { inputTokens: 1, outputTokens: 1 } });
    expect(res.attempts.map((a) => [a.kind, a.error === null])).toEqual([
      ['openai', false],
      ['openai-responses', true],
    ]);
    expect(f.calls.map((c) => c.url)).toEqual(['https://gw.example/v1/chat/completions', 'https://gw.example/v1/responses']);
  });

  it('does not fall back on auth failures, and reports both errors when both formats fail', async () => {
    const denied = fakeFetch(() => new Response('bad key', { status: 401 }));
    await expect(pingChat({ kind: 'openai', baseUrl: 'https://gw.example/v1', apiKey: 'k' }, 'm', { fetch: denied.fn })).rejects.toMatchObject({ status: 401 });
    expect(denied.calls).toHaveLength(1);

    const down = fakeFetch(() => new Response('down', { status: 503 }));
    const err = await pingChat({ kind: 'openai-responses', baseUrl: 'https://gw.example/v1' }, 'm', { fetch: down.fn }).catch((e) => e);
    expect(err).toMatchObject({ status: 503 });
    expect(err.message).toContain('Chat Completions');
    expect(down.calls).toHaveLength(2);
  });

  it('does not try openai formats for other kinds', async () => {
    const f = fakeFetch(() => new Response('nope', { status: 500 }));
    await expect(pingChat({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com' }, 'c', { fetch: f.fn })).rejects.toMatchObject({ status: 500 });
    expect(f.calls).toHaveLength(1);
  });
});

describe('probeModels', () => {
  it('falls through to the anthropic format when a gateway returns an empty openai list', async () => {
    const f = fakeFetch((url, init) => {
      const h = init!.headers as Record<string, string>;
      if (url === 'https://gw.example/v1/models?limit=1000' && h['anthropic-version']) return jsonRes({ data: [{ id: 'claude-x', display_name: 'Claude X' }] });
      if (url === 'https://gw.example/v1/models') return jsonRes({ object: 'list', data: [] });
      return new Response('', { status: 404 });
    });
    const res = await probeModels('https://gw.example', 'k', { fetch: f.fn });
    expect(res).toMatchObject({ kind: 'anthropic', baseUrl: 'https://gw.example', models: [{ id: 'claude-x', name: 'Claude X' }] });
    expect(res.attempts.map((a) => [a.kind, a.count])).toEqual([
      ['openai', 0],
      ['anthropic', 1],
    ]);
  });

  it('returns the first reachable format when every list is empty, and throws when all fail', async () => {
    const empty = fakeFetch((url) => (url.endsWith('/v1/models') ? jsonRes({ data: [] }) : jsonRes({ models: [] })));
    expect(await probeModels('https://gw.example/v1', 'k', { fetch: empty.fn })).toMatchObject({ kind: 'openai', baseUrl: 'https://gw.example/v1', models: [] });

    const denied = fakeFetch(() => new Response('bad key', { status: 401 }));
    await expect(probeModels('https://gw.example', 'k', { fetch: denied.fn })).rejects.toMatchObject({ status: 401 });
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
