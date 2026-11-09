import { ProviderError, type ProviderKind } from './types.ts';

const PASTED_ENDPOINT_SUFFIXES = [/\/chat\/completions$/, /\/completions$/, /\/messages$/, /\/models$/, /\/api\/(chat|tags|generate)$/];

export interface DetectedProvider {
  kind: ProviderKind;
  baseUrl: string;
}

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  } catch {
    throw new ProviderError(`不是合法的地址：${input}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ProviderError('地址只支持 http 或 https');
  let path = url.pathname.replace(/\/+$/, '');
  for (const suffix of PASTED_ENDPOINT_SUFFIXES) path = path.replace(suffix, '');
  return `${url.origin}${path}`;
}

export function detectProviderKind(baseUrl: string): ProviderKind {
  const url = new URL(baseUrl);
  const host = url.hostname.toLowerCase();
  if (host === 'api.anthropic.com' || /\/anthropic(\/|$)/.test(url.pathname)) return 'anthropic';
  if (host === 'generativelanguage.googleapis.com') return 'gemini';
  if (url.port === '11434' || /(^|\.)ollama(\.|$)/.test(host)) return 'ollama';
  return 'openai';
}

/**
 * 规整地址并推断类型。补全规则：
 * - Anthropic 官方地址统一去掉 /v1，由适配器拼接；
 * - Gemini 官方地址缺版本时补 /v1beta；
 * - OpenAI 兼容地址保持原样，缺 /v1 时由 resolveModels 自动补试。
 */
export function detectProvider(input: string): DetectedProvider {
  let baseUrl = normalizeBaseUrl(input);
  const kind = detectProviderKind(baseUrl);
  if (kind === 'anthropic') baseUrl = baseUrl.replace(/\/v1$/, '');
  if (kind === 'gemini' && !/\/v\d[\w]*$/.test(baseUrl)) baseUrl = `${baseUrl}/v1beta`;
  if (kind === 'ollama') baseUrl = baseUrl.replace(/\/(api|v1)$/, '');
  return { kind, baseUrl };
}

/** 按指定类型规整地址：识别结果一致时用识别的补全，否则只做该类型必要的路径整理 */
export function endpointFor(input: string, kind: ProviderKind): DetectedProvider {
  const detected = detectProvider(input);
  if (detected.kind === kind) return detected;
  let baseUrl = normalizeBaseUrl(input);
  if (kind === 'anthropic') baseUrl = baseUrl.replace(/\/v1$/, '');
  if (kind === 'ollama') baseUrl = baseUrl.replace(/\/(api|v1)$/, '');
  return { kind, baseUrl };
}
