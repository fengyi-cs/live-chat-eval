import { joinUrl, ndjson, parseJson, readJson, send, sseData } from './http.ts';
import {
  ProviderError,
  type ChatMessage,
  type ChatUsage,
  type ModelInfo,
  type ProviderAdapter,
  type ProviderConfig,
  type ProviderKind,
} from './types.ts';

const json = (headers: Record<string, string>) => ({ 'content-type': 'application/json', ...headers });
const DEFAULT_MAX_TOKENS = 1024;

function splitSystem(messages: ChatMessage[]) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  return { system: system || undefined, rest: messages.filter((m) => m.role !== 'system') };
}

const sortModels = (models: ModelInfo[]) => models.sort((a, b) => a.id.localeCompare(b.id));

const openaiHeaders = (c: ProviderConfig): Record<string, string> => (c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {});

export const openaiAdapter: ProviderAdapter = {
  async listModels(c, opts) {
    const res = await send(joinUrl(c.baseUrl, 'models'), { headers: openaiHeaders(c) }, opts);
    const body = await readJson<{ data?: { id: string }[] }>(res);
    if (!Array.isArray(body.data)) throw new ProviderError('返回内容不是 OpenAI 格式的模型列表');
    return sortModels(body.data.map((m) => ({ id: m.id })));
  },
  async *chat(c, req, opts) {
    const res = await send(
      joinUrl(c.baseUrl, 'chat/completions'),
      {
        method: 'POST',
        headers: json(openaiHeaders(c)),
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
        }),
      },
      opts,
    );
    let usage: ChatUsage | undefined;
    for await (const data of sseData(res)) {
      if (data === '[DONE]') break;
      const ev = parseJson<{
        choices?: { delta?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      }>(data);
      const text = ev.choices?.[0]?.delta?.content;
      if (text) yield { type: 'delta', text };
      if (ev.usage) usage = { inputTokens: ev.usage.prompt_tokens, outputTokens: ev.usage.completion_tokens };
    }
    yield { type: 'done', usage };
  },
};

/** OpenAI Responses 接口（/v1/responses）：模型列表与 Chat Completions 共用 /models */
export const openaiResponsesAdapter: ProviderAdapter = {
  listModels: openaiAdapter.listModels,
  async *chat(c, req, opts) {
    const { system, rest } = splitSystem(req.messages);
    const res = await send(
      joinUrl(c.baseUrl, 'responses'),
      {
        method: 'POST',
        headers: json(openaiHeaders(c)),
        body: JSON.stringify({
          model: req.model,
          instructions: system,
          input: rest.map((m) => ({ role: m.role, content: m.content })),
          temperature: req.temperature,
          max_output_tokens: req.maxTokens,
          store: false,
          stream: true,
        }),
      },
      opts,
    );
    let usage: ChatUsage | undefined;
    for await (const data of sseData(res)) {
      if (data === '[DONE]') break;
      const ev = parseJson<{
        type?: string;
        delta?: string;
        message?: string;
        response?: { usage?: { input_tokens?: number; output_tokens?: number } | null; error?: { message?: string } | null; incomplete_details?: { reason?: string } | null };
        error?: { message?: string };
      }>(data);
      if (ev.type === 'response.output_text.delta' && ev.delta) yield { type: 'delta', text: ev.delta };
      else if (ev.type === 'error') throw new ProviderError(ev.message ?? ev.error?.message ?? '服务商返回错误');
      else if (ev.type === 'response.failed') throw new ProviderError(ev.response?.error?.message ?? '服务商生成失败');
      else if (ev.type === 'response.completed' || ev.type === 'response.incomplete') {
        const u = ev.response?.usage;
        if (u) usage = { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
        break;
      }
    }
    yield { type: 'done', usage };
  },
};

const anthropicHeaders = (c: ProviderConfig): Record<string, string> => ({
  'anthropic-version': '2023-06-01',
  ...(c.apiKey ? { 'x-api-key': c.apiKey } : {}),
});

export const anthropicAdapter: ProviderAdapter = {
  async listModels(c, opts) {
    const res = await send(joinUrl(c.baseUrl, 'v1/models?limit=1000'), { headers: anthropicHeaders(c) }, opts);
    const body = await readJson<{ data?: { id: string; display_name?: string }[] }>(res);
    if (!Array.isArray(body.data)) throw new ProviderError('返回内容不是 Anthropic 格式的模型列表');
    return sortModels(body.data.map((m) => ({ id: m.id, name: m.display_name })));
  },
  async *chat(c, req, opts) {
    const { system, rest } = splitSystem(req.messages);
    const res = await send(
      joinUrl(c.baseUrl, 'v1/messages'),
      {
        method: 'POST',
        headers: json(anthropicHeaders(c)),
        body: JSON.stringify({
          model: req.model,
          system,
          messages: rest,
          temperature: req.temperature,
          max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
          stream: true,
        }),
      },
      opts,
    );
    const usage: ChatUsage = {};
    for await (const data of sseData(res)) {
      const ev = parseJson<{
        type: string;
        delta?: { type?: string; text?: string };
        message?: { usage?: { input_tokens?: number } };
        usage?: { output_tokens?: number };
        error?: { message?: string };
      }>(data);
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) yield { type: 'delta', text: ev.delta.text };
      else if (ev.type === 'message_start') usage.inputTokens = ev.message?.usage?.input_tokens;
      else if (ev.type === 'message_delta') usage.outputTokens = ev.usage?.output_tokens;
      else if (ev.type === 'error') throw new ProviderError(ev.error?.message ?? '服务商返回错误');
      else if (ev.type === 'message_stop') break;
    }
    yield { type: 'done', usage };
  },
};

const geminiHeaders = (c: ProviderConfig): Record<string, string> => (c.apiKey ? { 'x-goog-api-key': c.apiKey } : {});

export const geminiAdapter: ProviderAdapter = {
  async listModels(c, opts) {
    const models: ModelInfo[] = [];
    let pageToken: string | undefined;
    do {
      const query = `pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const res = await send(joinUrl(c.baseUrl, `models?${query}`), { headers: geminiHeaders(c) }, opts);
      const body = await readJson<{
        models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
        nextPageToken?: string;
      }>(res);
      if (!Array.isArray(body.models)) throw new ProviderError('返回内容不是 Gemini 格式的模型列表');
      for (const m of body.models) {
        if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) continue;
        models.push({ id: m.name.replace(/^models\//, ''), name: m.displayName });
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
    return sortModels(models);
  },
  async *chat(c, req, opts) {
    const { system, rest } = splitSystem(req.messages);
    const model = encodeURIComponent(req.model.replace(/^models\//, ''));
    const res = await send(
      joinUrl(c.baseUrl, `models/${model}:streamGenerateContent?alt=sse`),
      {
        method: 'POST',
        headers: json(geminiHeaders(c)),
        body: JSON.stringify({
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          contents: rest.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens },
        }),
      },
      opts,
    );
    let usage: ChatUsage | undefined;
    for await (const data of sseData(res)) {
      const ev = parseJson<{
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      }>(data);
      for (const part of ev.candidates?.[0]?.content?.parts ?? []) {
        if (part.text && !part.thought) yield { type: 'delta', text: part.text };
      }
      if (ev.usageMetadata) usage = { inputTokens: ev.usageMetadata.promptTokenCount, outputTokens: ev.usageMetadata.candidatesTokenCount };
    }
    yield { type: 'done', usage };
  },
};

export const ollamaAdapter: ProviderAdapter = {
  async listModels(c, opts) {
    const res = await send(joinUrl(c.baseUrl, 'api/tags'), { headers: openaiHeaders(c) }, opts);
    const body = await readJson<{ models?: { name: string }[] }>(res);
    if (!Array.isArray(body.models)) throw new ProviderError('返回内容不是 Ollama 格式的模型列表');
    return sortModels(body.models.map((m) => ({ id: m.name })));
  },
  async *chat(c, req, opts) {
    const res = await send(
      joinUrl(c.baseUrl, 'api/chat'),
      {
        method: 'POST',
        headers: json(openaiHeaders(c)),
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream: true,
          options: { temperature: req.temperature, num_predict: req.maxTokens },
        }),
      },
      opts,
    );
    let usage: ChatUsage | undefined;
    for await (const raw of ndjson(res)) {
      const ev = raw as { message?: { content?: string }; done?: boolean; error?: string; prompt_eval_count?: number; eval_count?: number };
      if (ev.error) throw new ProviderError(ev.error);
      if (ev.message?.content) yield { type: 'delta', text: ev.message.content };
      if (ev.done) {
        usage = { inputTokens: ev.prompt_eval_count, outputTokens: ev.eval_count };
        break;
      }
    }
    yield { type: 'done', usage };
  },
};

export const PROVIDER_ADAPTERS: Record<ProviderKind, ProviderAdapter> = {
  openai: openaiAdapter,
  'openai-responses': openaiResponsesAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  ollama: ollamaAdapter,
};
