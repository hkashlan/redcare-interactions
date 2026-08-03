/**
 * Per-instance read-through cache for upstream fetches.
 *
 * Everything the service needs from a cache, and nothing else: data is served
 * while it is fresh (TTL), concurrent calls for the same key share one in-flight
 * fetch, and failures are never cached — an errored key is refetched on the next
 * call, so upstream errors surface immediately and the API fails closed.
 * Retry-with-backoff would wrap the fetcher here in production.
 */
export interface FetchCache {
  fetch<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T>;
}

interface Entry {
  value: Promise<unknown>;
  /** In flight until the fetch settles, so concurrent callers dedupe onto it. */
  expiresAt: number;
}

/**
 * Expired entries are only swept once the map grows past `maxEntries`, which
 * bounds it to the keys actually read within one TTL window.
 */
export function createFetchCache(maxEntries = 1000): FetchCache {
  const entries = new Map<string, Entry>();

  return {
    fetch<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
      const cached = entries.get(key);
      if (cached && Date.now() < cached.expiresAt) return cached.value as Promise<T>;

      const value = fetcher();
      const entry: Entry = { value, expiresAt: Number.POSITIVE_INFINITY };
      entries.set(key, entry);

      value.then(
        () => {
          entry.expiresAt = Date.now() + ttlMs;
        },
        () => {
          // Drop the failure so the next call retries, unless a newer fetch for
          // this key already replaced us.
          if (entries.get(key) === entry) entries.delete(key);
        },
      );

      if (entries.size > maxEntries) sweepExpired(entries);
      return value;
    },
  };
}

function sweepExpired(entries: Map<string, Entry>): void {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (now >= entry.expiresAt) entries.delete(key);
  }
}
