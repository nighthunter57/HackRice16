import { z } from 'zod';
import { NessieError } from './errors';

export interface NessieClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export function createNessieClient(options: NessieClientOptions = {}) {
  async function request<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const key = options.apiKey ?? process.env.NESSIE_API_KEY;
    let url: URL;
    try {
      const base = new URL(options.baseUrl ?? process.env.NESSIE_BASE_URL ?? 'https://api.nessieisreal.com');
      if (base.protocol !== 'https:' || base.username || base.password || !path.startsWith('/') || path.startsWith('//')) throw new Error();
      url = new URL(path, base);
      if (url.origin !== base.origin || !key?.trim()) throw new Error();
      url.searchParams.set('key', key);
    } catch { throw new NessieError('configuration'); }
    const timeout = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) throw new NessieError('configuration');
    const signal = AbortSignal.timeout(timeout);
    for (let attempt = 0; attempt < (method === 'GET' ? 2 : 1); attempt++) {
      try {
        const response = await (options.fetcher ?? fetch)(url, {
          method, redirect: 'error', signal,
          headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok) {
          if (method === 'GET' && attempt === 0 && (response.status === 429 || response.status >= 500)) {
            const seconds = Number(response.headers.get('retry-after') ?? '0.25');
            if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 2) {
              await new Promise(resolve => setTimeout(resolve, seconds * 1000));
              continue;
            }
          }
          throw new NessieError('http', response.status);
        }
        try { return schema.parse(response.status === 204 ? undefined : await response.json()); }
        catch { throw new NessieError(signal.aborted ? 'timeout' : 'invalid-response'); }
      } catch (error) {
        if (error instanceof NessieError) throw error;
        throw new NessieError(signal.aborted ? 'timeout' : 'network');
      }
    }
    throw new NessieError('http');
  }
  return {
    nessieGet: <T>(path: string, schema: z.ZodType<T>) => request('GET', path, schema),
    nessiePost: <T>(path: string, body: unknown, schema: z.ZodType<T>) => request('POST', path, schema, body),
    nessiePut: <T>(path: string, body: unknown, schema: z.ZodType<T>) => request('PUT', path, schema, body),
    nessieDelete: <T>(path: string, schema: z.ZodType<T>) => request('DELETE', path, schema),
  };
}

export const { nessieGet, nessiePost, nessiePut, nessieDelete } = createNessieClient();
