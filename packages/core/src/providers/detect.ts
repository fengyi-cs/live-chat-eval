import { ProviderError, type ProviderKind } from './types.ts';

const PASTED_ENDPOINT_SUFFIXES = [
  /\/chat\/completions$/,
  /\/completions$/,
  /\/responses$/,
  /\/messages$/,
  /\/models\/[^/]+:\w+$/,
  /\/models$/,
  /\/api\/(chat|tags|generate)$/,
];
// 粘贴的完整接口地址本身就说明了协议，优先于按域名的默认推断
const PASTED_ENDPOINT_KINDS: [RegExp, ProviderKind][] = [
  [/\/chat\/completions$/, 'openai'],
  [/\/responses$/, 'openai-responses'],
  [/\/v1\/messages$/, 'anthropic'],
  [/\/models\/[^/]+:(stream)?[gG]enerateContent$/, 'gemini'],
  [/\/api\/(chat|tags|generate)$/, 'ollama'],
];
const VERSION_SUFFIX = /\/v\d[\w.]*$/;
const GOOGLE_HOST = 'generativelanguage.googleapis.com';

export interface DetectedProvider {
  kind: ProviderKind;
  baseUrl: string;
}

function defaultScheme(authority: string) {
  const host = authority.replace(/:\d+$/, '').toLowerCase();
  const local = host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.endsWith('.local') || /:\d+$/.test(authority);
  return local ? 'http' : 'https';
}

function parseInput(input: string): URL {
  const trimmed = input.trim();
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
  try {
    return new URL(hasScheme ? trimmed : `${defaultScheme(trimmed.split(/[/?#]/)[0] ?? '')}://${trimmed}`);
  } catch {
    throw new ProviderError(`不是合法的地址：${input}`);
  }
}

export function normalizeBaseUrl(input: string): string {
  const url = parseInput(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ProviderError('地址只支持 http 或 https');
  if (!url.hostname) throw new ProviderError(`不是合法的地址：${input}`);
  let path = url.pathname.replace(/\/+$/, '');
  for (const suffix of PASTED_ENDPOINT_SUFFIXES) path = path.replace(suffix, '');
  return `${url.origin}${path}`;
}

export function detectProviderKind(baseUrl: string): ProviderKind {
  const url = new URL(baseUrl);
  const host = url.hostname.toLowerCase();
  if (host === 'api.anthropic.com' || /\/anthropic(\/|$)/.test(url.pathname)) return 'anthropic';
  if (host === GOOGLE_HOST || /\/(gemini|v1beta)(\/|$)/.test(url.pathname)) return 'gemini';
  if (url.port === '11434' || /(^|\.)ollama(\.|$)/.test(host)) return 'ollama';
  return 'openai';
}

function adjustFor(baseUrl: string, kind: ProviderKind): string {
  if (kind === 'anthropic') return baseUrl.replace(/\/v1$/, '');
  if (kind === 'ollama') return baseUrl.replace(/\/(api|v1)$/, '');
  if (kind === 'gemini') {
    if (!VERSION_SUFFIX.test(baseUrl)) return `${baseUrl}/v1beta`;
    // 网关的 Gemini 渠道通常只开放 /v1beta；官方地址的 /v1 保持不变
    if (new URL(baseUrl).hostname !== GOOGLE_HOST) return baseUrl.replace(/\/v1$/, '/v1beta');
  }
  return baseUrl;
}

/** 按指定类型规整地址 */
export function endpointFor(input: string, kind: ProviderKind): DetectedProvider {
  return { kind, baseUrl: adjustFor(normalizeBaseUrl(input), kind) };
}

/**
 * 规整地址并推断类型：
 * - 粘贴的完整接口地址（/chat/completions、/responses、/v1/messages、:generateContent 等）按接口推断类型并去掉接口路径；
 * - 否则按域名和路径推断（/anthropic、/gemini、/v1beta、:11434 等）；
 * - Anthropic 去掉 /v1，Gemini 缺版本时补 /v1beta，Ollama 去掉 /api 或 /v1；
 * - OpenAI 兼容地址保持原样，缺 /v1 时由 resolveModels 自动补试。
 */
export function detectProvider(input: string): DetectedProvider {
  const baseUrl = normalizeBaseUrl(input);
  const pastedPath = parseInput(input).pathname.replace(/\/+$/, '');
  const pastedKind = PASTED_ENDPOINT_KINDS.find(([re]) => re.test(pastedPath))?.[1];
  const kind = pastedKind ?? detectProviderKind(baseUrl);
  return { kind, baseUrl: adjustFor(baseUrl, kind) };
}
