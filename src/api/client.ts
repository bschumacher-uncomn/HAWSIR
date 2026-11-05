import { revive } from '@contract/wire';

/**
 * The browser's only door to data: JSON over /api, with unbounded numbers
 * revived. Errors carry the API's message so the screen can say what happened.
 */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  const text = await r.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!r.ok) throw new ApiError(r.status, (json as { error?: string } | undefined)?.error ?? `${r.status} ${r.statusText}`);
  return revive<T>(json);
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => call<T>('GET', path, undefined, signal),
  post: <T>(path: string, body: unknown, signal?: AbortSignal) => call<T>('POST', path, body, signal),
};

export const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';
