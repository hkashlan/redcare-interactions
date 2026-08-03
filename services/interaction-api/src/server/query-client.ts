import { QueryClient } from '@tanstack/query-core';

/**
 * Server-side TanStack Query utility (framework-agnostic @tanstack/query-core).
 *
 * All upstream reads go through a QueryClient: `fetchQuery` returns cached data
 * while it is fresh (staleTime = TTL), dedupes concurrent fetches of the same
 * key, and never caches failures — an errored query is refetched on the next
 * call. `retry` is disabled so upstream failures surface immediately (the API
 * fails closed); in production this is the knob for retry-with-backoff.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

/** Read-through cache: serve fresh data from cache, otherwise fetch and cache. */
export function cachedQuery<T>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
  staleTimeMs: number,
): Promise<T> {
  return queryClient.fetchQuery({
    queryKey,
    queryFn,
    staleTime: staleTimeMs,
  });
}
