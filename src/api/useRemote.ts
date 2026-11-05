import { useEffect, useRef, useState } from 'react';
import { isAbort } from './client';

/**
 * Keyed fetch with a small shared cache. While a new key loads, the last good
 * value stays on screen (a view never blanks between pictures); a stale
 * response for an old key is dropped.
 */
const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
const MAX = 160;

function remember(key: string, v: unknown) {
  cache.delete(key);
  cache.set(key, v);
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
}

export function load<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  if (cache.has(key)) return Promise.resolve(cache.get(key) as T);
  let p = inflight.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fetcher().then((v) => {
      remember(key, v);
      return v;
    });
    inflight.set(key, p);
    const clear = () => inflight.delete(key);
    p.then(clear, clear);
  }
  return p;
}

export function peek<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

export interface Remote<T> {
  data: T | undefined;
  /** The key `data` belongs to (lags `key` while a new value loads). */
  dataKey: string | null;
  error: Error | undefined;
  loading: boolean;
}

export function useRemote<T>(key: string | null, fetcher: () => Promise<T>): Remote<T> {
  const [state, setState] = useState<Remote<T>>(() => {
    const hit = key ? peek<T>(key) : undefined;
    return { data: hit, dataKey: hit !== undefined ? key : null, error: undefined, loading: !!key && hit === undefined };
  });
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  useEffect(() => {
    if (!key) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    const hit = peek<T>(key);
    if (hit !== undefined) {
      setState({ data: hit, dataKey: key, error: undefined, loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    load(key, () => fetchRef.current())
      .then((v) => alive && setState({ data: v, dataKey: key, error: undefined, loading: false }))
      .catch((e) => {
        if (alive && !isAbort(e)) setState((s) => ({ ...s, error: e as Error, loading: false }));
      });
    return () => {
      alive = false;
    };
  }, [key]);
  return state;
}
