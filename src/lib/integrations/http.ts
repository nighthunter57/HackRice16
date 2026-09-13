import { z } from 'zod';

export type FetchLike = typeof fetch;

export class IntegrationError extends Error {
  constructor(public readonly service: string, public readonly code: 'configuration' | 'network' | 'timeout' | 'http' | 'invalid-response', public readonly status?: number) {
    super(`${service}: ${code}${status === undefined ? '' : ` (${status})`}`);
    this.name = 'IntegrationError';
  }
}

/** Never expose URLs, response bodies, credentials, or provider exception text. */
export async function requestJson<T>(service: string, url: URL | string, schema: z.ZodType<T>, init: RequestInit = {}, fetcher: FetchLike = fetch, timeoutMs = 10_000, onTiming?:(timing:{requestMs:number;parseMs:number})=>void): Promise<T> {
  const attempts = !init.method || init.method === 'GET' ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    const started = Date.now();
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      response = await fetcher(url, { ...init, redirect: 'error', signal });
    } catch {
      if(service==='Gemini') console.info('[recognition.gemini]',{code:signal.aborted?'timeout':'network',elapsedMs:Date.now()-started});
      throw new IntegrationError(service, signal.aborted ? 'timeout' : 'network');
    }
    if(service==='Gemini') console.info('[recognition.gemini]',{httpStatus:response.status,elapsedMs:Date.now()-started});
    if (!response.ok) {
      if (attempt + 1 < attempts && (response.status === 429 || response.status >= 500)) {
        const seconds = Number(response.headers.get('retry-after') ?? '0.25');
        if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 2) {
          await new Promise(resolve => setTimeout(resolve, seconds * 1000));
          continue;
        }
      }
      throw new IntegrationError(service, 'http', response.status);
    }
    try {
      const body: unknown = await response.json();
      const parseStarted=Date.now();
      const parsed = schema.parse(body);
      onTiming?.({requestMs:parseStarted-started,parseMs:Date.now()-parseStarted});
      if(service==='Gemini') console.info('[recognition.gemini]',{responseValidated:true});
      return parsed;
    } catch {
      throw new IntegrationError(service, signal.aborted ? 'timeout' : 'invalid-response');
    }
  }
  throw new IntegrationError(service, 'http');
}

export function safeReason(error: unknown): string {
  return error instanceof IntegrationError ? error.message : 'Integration data failed validation.';
}

export const utcDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, 'Expected a real UTC date');

export const centsSchema = z.number().int().safe();
