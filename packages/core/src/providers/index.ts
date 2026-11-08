import { PROVIDER_ADAPTERS } from './adapters.ts';
import { joinUrl } from './http.ts';
import { ProviderError, type CallOptions, type ChatRequest, type ModelInfo, type ProviderConfig } from './types.ts';

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
 * 拉取模型列表；OpenAI 兼容地址 404 且路径没有版本号时，补 /v1 重试。
 * 返回实际可用的 baseUrl，调用方应保存它。
 */
export async function resolveModels(config: ProviderConfig, opts?: CallOptions): Promise<{ baseUrl: string; models: ModelInfo[] }> {
  try {
    return { baseUrl: config.baseUrl, models: await listModels(config, opts) };
  } catch (err) {
    const canRetry = config.kind === 'openai' && err instanceof ProviderError && err.status === 404 && !/\/v\d[\w.]*$/.test(config.baseUrl);
    if (!canRetry) throw err;
    const baseUrl = joinUrl(config.baseUrl, 'v1');
    return { baseUrl, models: await listModels({ ...config, baseUrl }, opts) };
  }
}
