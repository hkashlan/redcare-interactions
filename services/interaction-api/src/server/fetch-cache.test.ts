import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFetchCache } from './fetch-cache';

const TTL_MS = 30000;

afterEach(() => {
  vi.useRealTimers();
});

describe('createFetchCache', () => {
  it('serves cached data within the TTL', async () => {
    vi.useFakeTimers();
    const cache = createFetchCache();
    const fetcher = vi.fn(async () => 'value');

    await cache.fetch('key', fetcher, TTL_MS);
    vi.advanceTimersByTime(TTL_MS - 1);
    await expect(cache.fetch('key', fetcher, TTL_MS)).resolves.toBe('value');

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refetches once the TTL has expired', async () => {
    vi.useFakeTimers();
    const cache = createFetchCache();
    const fetcher = vi.fn(async () => 'value');

    await cache.fetch('key', fetcher, TTL_MS);
    vi.advanceTimersByTime(TTL_MS + 1);
    await cache.fetch('key', fetcher, TTL_MS);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent fetches of the same key', async () => {
    const cache = createFetchCache();
    const fetcher = vi.fn(async () => 'value');

    const results = await Promise.all([
      cache.fetch('key', fetcher, TTL_MS),
      cache.fetch('key', fetcher, TTL_MS),
    ]);

    expect(results).toEqual(['value', 'value']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps keys independent', async () => {
    const cache = createFetchCache();

    await expect(cache.fetch('a', async () => 'a', TTL_MS)).resolves.toBe('a');
    await expect(cache.fetch('b', async () => 'b', TTL_MS)).resolves.toBe('b');
  });

  it('never caches a failure', async () => {
    const cache = createFetchCache();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockResolvedValue('ok');

    await expect(cache.fetch('key', fetcher, TTL_MS)).rejects.toThrow('upstream down');
    await expect(cache.fetch('key', fetcher, TTL_MS)).resolves.toBe('ok');

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects every concurrent caller of a failing fetch', async () => {
    const cache = createFetchCache();
    const fetcher = vi.fn(async () => {
      throw new Error('upstream down');
    });

    const results = await Promise.allSettled([
      cache.fetch('key', fetcher, TTL_MS),
      cache.fetch('key', fetcher, TTL_MS),
    ]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('sweeps expired entries once it grows past its cap', async () => {
    vi.useFakeTimers();
    const cache = createFetchCache(2);
    const fetcher = vi.fn(async (key: string) => key);

    await cache.fetch('a', () => fetcher('a'), TTL_MS);
    vi.advanceTimersByTime(TTL_MS + 1);
    // 'a' is expired; adding two more keys pushes the map past the cap.
    await cache.fetch('b', () => fetcher('b'), TTL_MS);
    await cache.fetch('c', () => fetcher('c'), TTL_MS);

    // 'b' and 'c' are still fresh, so only the expired 'a' was dropped.
    await cache.fetch('b', () => fetcher('b'), TTL_MS);
    await cache.fetch('a', () => fetcher('a'), TTL_MS);

    expect(fetcher.mock.calls.map(([key]) => key)).toEqual(['a', 'b', 'c', 'a']);
  });
});
