import { ProviderError, type CallOptions } from './types.ts';

const MAX_ERROR_BODY = 300;

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export async function send(url: string, init: RequestInit, opts: CallOptions = {}): Promise<Response> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, { ...init, signal: opts.signal });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new ProviderError(`无法连接 ${new URL(url).host}：${(err as Error).message}`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, MAX_ERROR_BODY);
    throw new ProviderError(`服务商返回 ${res.status}${body ? `：${body}` : ''}`, res.status);
  }
  return res;
}

async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      yield buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) yield buffer;
}

/** 解析 SSE，只返回 data 字段（多行 data 按规范用换行拼接） */
export async function* sseData(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new ProviderError('服务商没有返回流式内容');
  let data: string[] = [];
  for await (const line of lines(res.body)) {
    if (line === '') {
      if (data.length) yield data.join('\n');
      data = [];
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (data.length) yield data.join('\n');
}

export async function* ndjson(res: Response): AsyncGenerator<unknown> {
  if (!res.body) throw new ProviderError('服务商没有返回流式内容');
  for await (const line of lines(res.body)) {
    if (line.trim()) yield JSON.parse(line);
  }
}

export function parseJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ProviderError(`无法解析服务商返回的数据：${raw.slice(0, MAX_ERROR_BODY)}`);
  }
}

/** 读取 JSON 响应；地址指向网页等非接口内容时抛 ProviderError，调用方据此重试其他路径 */
export async function readJson<T>(res: Response): Promise<T> {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    const isHtml = /^\s*</.test(raw);
    throw new ProviderError(isHtml ? '地址返回的是网页而不是接口数据，请检查是否缺少 /v1 等路径' : `无法解析服务商返回的数据：${raw.slice(0, MAX_ERROR_BODY)}`);
  }
}
