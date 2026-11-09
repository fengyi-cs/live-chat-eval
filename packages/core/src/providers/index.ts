import { PROVIDER_ADAPTERS } from './adapters.ts';
import { detectProvider, endpointFor } from './detect.ts';
import { joinUrl } from './http.ts';
import {
  PROVIDER_KIND_LABELS,
  ProviderError,
  type CallOptions,
  type ChatRequest,
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

/**
 * 拉取模型列表；OpenAI 兼容地址路径没有版本号且失败（鉴权失败除外）时，补 /v1 重试。
 * 返回实际可用的 baseUrl，调用方应保存它。
 */
export async function resolveModels(config: ProviderConfig, opts?: CallOptions): Promise<{ baseUrl: string; models: ModelInfo[] }> {
  try {
    return { baseUrl: config.baseUrl, models: await listModels(config, opts) };
  } catch (err) {
    const authFailed = err instanceof ProviderError && (err.status === 401 || err.status === 403);
    const canRetry = config.kind === 'openai' && err instanceof ProviderError && !authFailed && !opts?.signal?.aborted && !/\/v\d[\w.]*$/.test(config.baseUrl);
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
  const order = [detected, ...PROBE_KINDS.filter((k) => k !== detected)];
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
