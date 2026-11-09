import { PROVIDER_ADAPTERS } from './adapters.ts';
import { detectProvider, endpointFor } from './detect.ts';
import { joinUrl } from './http.ts';
import {
  PROVIDER_KIND_LABELS,
  ProviderError,
  type CallOptions,
  type ChatRequest,
  type ChatUsage,
  type ModelInfo,
  type ProviderConfig,
  type ProviderKind,
} from './types.ts';

export * from './adapters.ts';
export * from './detect.ts';
export * from './types.ts';

export function listModels(config: ProviderConfig, opts?: CallOptions): Promise<ModelInfo[]> {
  return PROVIDER_ADAPTERS[config.kind].listModels(config, opts);
}

export function chatStream(config: ProviderConfig, req: ChatRequest, opts?: CallOptions) {
  return PROVIDER_ADAPTERS[config.kind].chat(config, req, opts);
}

export async function chatText(config: ProviderConfig, req: ChatRequest, opts?: CallOptions): Promise<string> {
  let text = '';
  for await (const chunk of chatStream(config, req, opts)) if (chunk.type === 'delta') text += chunk.text;
  return text;
}

export const isOpenAIFamily = (kind: ProviderKind) => kind === 'openai' || kind === 'openai-responses';

export interface PingAttempt {
  kind: ProviderKind;
  error: string | null;
}

export interface PingResult {
  kind: ProviderKind;
  reply: string;
  usage: ChatUsage | null;
  firstTokenMs: number | null;
  totalMs: number;
  attempts: PingAttempt[];
}

const PING_MAX_TOKENS = 64;

/**
 * 发一条 ping 验证模型可用。OpenAI 系网关常只给部分模型开放 Chat Completions 或 Responses 其中一种，
 * 当前格式失败（鉴权失败除外）时改用另一种重试；返回的 kind 与配置不同就说明应该切换接口类型。
 */
export async function pingChat(config: ProviderConfig, model: string, opts?: CallOptions): Promise<PingResult> {
  const order: ProviderKind[] = isOpenAIFamily(config.kind) ? [config.kind, config.kind === 'openai' ? 'openai-responses' : 'openai'] : [config.kind];
  const attempts: PingAttempt[] = [];
  let firstError: unknown = null;
  for (const kind of order) {
    const started = performance.now();
    let firstTokenMs: number | null = null;
    let reply = '';
    let usage: ChatUsage | null = null;
    try {
      const req: ChatRequest = { model, messages: [{ role: 'user', content: 'ping' }], maxTokens: PING_MAX_TOKENS };
      for await (const chunk of chatStream({ ...config, kind }, req, opts)) {
        if (chunk.type === 'delta') {
          firstTokenMs ??= Math.round(performance.now() - started);
          reply += chunk.text;
        } else usage = chunk.usage ?? null;
      }
      attempts.push({ kind, error: null });
      return { kind, reply, usage, firstTokenMs, totalMs: Math.round(performance.now() - started), attempts };
    } catch (err) {
      if (opts?.signal?.aborted) throw err;
      firstError ??= err;
      attempts.push({ kind, error: (err as Error).message });
      if (err instanceof ProviderError && (err.status === 401 || err.status === 403)) break;
    }
  }
  if (attempts.length === 1) throw firstError;
  const summary = attempts.map((a) => `${PROVIDER_KIND_LABELS[a.kind]}：${a.error}`).join('；');
  throw new ProviderError(`两种 OpenAI 接口格式都不可用（${summary}）`, firstError instanceof ProviderError ? firstError.status : undefined);
}

/**
 * 拉取模型列表；OpenAI 系地址路径没有版本号且失败（鉴权失败除外，包括返回网页的情况）时，补 /v1 重试。
 * 返回实际可用的 baseUrl，调用方应保存它。
 */
export async function resolveModels(config: ProviderConfig, opts?: CallOptions): Promise<{ baseUrl: string; models: ModelInfo[] }> {
  try {
    return { baseUrl: config.baseUrl, models: await listModels(config, opts) };
  } catch (err) {
    const authFailed = err instanceof ProviderError && (err.status === 401 || err.status === 403);
    const canRetry = isOpenAIFamily(config.kind) && err instanceof ProviderError && !authFailed && !opts?.signal?.aborted && !/\/v\d[\w.]*$/.test(config.baseUrl);
    if (!canRetry) throw err;
    const baseUrl = joinUrl(config.baseUrl, 'v1');
    return { baseUrl, models: await listModels({ ...config, baseUrl }, opts) };
  }
}

export interface ProbeAttempt {
  kind: ProviderKind;
  baseUrl: string;
  /** 拉到的模型数；请求失败时为 null */
  count: number | null;
  error: string | null;
}

export interface ProbeResult {
  kind: ProviderKind;
  baseUrl: string;
  models: ModelInfo[];
  attempts: ProbeAttempt[];
}

const PROBE_KINDS: readonly ProviderKind[] = ['openai', 'anthropic', 'gemini'];

/**
 * 不知道接口类型时依次尝试几种格式，取第一个返回非空模型列表的。
 * API 网关常按请求格式分别返回模型（只开放 Anthropic 渠道时，OpenAI 格式会返回空列表）。
 * 都是空列表时返回第一个请求成功的格式；全部失败时抛出，状态码取首选格式的。
 */
export async function probeModels(input: string, apiKey: string | undefined, opts?: CallOptions): Promise<ProbeResult> {
  const detected = detectProvider(input).kind;
  const order = [detected, ...PROBE_KINDS.filter((k) => k !== detected && !(isOpenAIFamily(k) && isOpenAIFamily(detected)))];
  const attempts: ProbeAttempt[] = [];
  let firstEmpty: Omit<ProbeResult, 'attempts'> | null = null;
  let firstError: unknown = null;
  for (const kind of order) {
    const endpoint = endpointFor(input, kind);
    try {
      const { baseUrl, models } = await resolveModels({ ...endpoint, apiKey }, opts);
      attempts.push({ kind, baseUrl, count: models.length, error: null });
      if (models.length) return { kind, baseUrl, models, attempts };
      firstEmpty ??= { kind, baseUrl, models };
    } catch (err) {
      if (opts?.signal?.aborted) throw err;
      firstError ??= err;
      attempts.push({ kind, baseUrl: endpoint.baseUrl, count: null, error: (err as Error).message });
    }
  }
  if (firstEmpty) return { ...firstEmpty, attempts };
  const summary = attempts.map((a) => `${PROVIDER_KIND_LABELS[a.kind]}：${a.error}`).join('；');
  throw new ProviderError(`几种接口格式都没有拉到模型（${summary}）`, firstError instanceof ProviderError ? firstError.status : undefined);
}
