import { useStorage } from 'nitro/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductNotFoundError, UpstreamError } from '../clients/errors';
import type { MockServiceClient } from '../clients/mock-service';
import { createInteractionService } from './interaction-service';

const ingredientsByProductId: Record<string, string[]> = {
  '04114918': ['ing-ibu-001', 'ing-exc-010'],
  '10019621': ['ing-asa-002', 'ing-exc-010'],
};

const catalog = [
  {
    interactionId: 'int-ibu-alcohol',
    requiredIngredientIds: ['ing-ibu-001'],
    interactionTexts: ['Ibuprofen and alcohol warning.'],
  },
  {
    interactionId: 'int-ibu-asa',
    requiredIngredientIds: ['ing-ibu-001', 'ing-asa-002'],
    interactionTexts: ['NSAID pair warning.'],
  },
];

function fakeClient(overrides: Partial<MockServiceClient> = {}): MockServiceClient {
  return {
    getIngredients: vi.fn(async (productId: string) => {
      const ingredientIds = ingredientsByProductId[productId];
      if (!ingredientIds) throw new ProductNotFoundError(productId);
      return { productId, ingredientIds };
    }),
    getInteractions: vi.fn(async () => catalog),
    ...overrides,
  };
}

const CATALOG_TTL_MS = 30000;
const PRODUCT_TTL_MS = 30000;

function service(client: MockServiceClient) {
  return createInteractionService(client, {
    catalogTtlMs: CATALOG_TTL_MS,
    productTtlMs: PRODUCT_TTL_MS,
  });
}

/**
 * Nitro's cache lives in process-global storage keyed by cache name, not in a
 * map owned by the service, so entries outlive the service each test builds and
 * would otherwise leak between tests. `.clear()` is a no-op on the default
 * mount here, so the keys are removed one by one.
 */
beforeEach(async () => {
  const storage = useStorage();
  await Promise.all((await storage.getKeys('cache')).map((key) => storage.removeItem(key)));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createInteractionService', () => {
  it('resolves products and matches interactions across the basket', async () => {
    const result = await service(fakeClient()).getInteractionsForProducts(['04114918', '10019621']);

    expect(result.interactions.map((i) => i.interactionId)).toEqual([
      'int-ibu-alcohol',
      'int-ibu-asa',
    ]);
    expect(result.unknownProductIds).toEqual([]);
  });

  it('degrades to partial success when a product is unknown (upstream 404)', async () => {
    const result = await service(fakeClient()).getInteractionsForProducts(['04114918', '00000000']);

    expect(result.interactions.map((i) => i.interactionId)).toEqual(['int-ibu-alcohol']);
    expect(result.unknownProductIds).toEqual(['00000000']);
  });

  it('fails closed when ingredients cannot be fetched (upstream error)', async () => {
    const client = fakeClient({
      getIngredients: vi.fn(async () => {
        throw new UpstreamError('boom');
      }),
    });

    await expect(service(client).getInteractionsForProducts(['04114918'])).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });

  it('fails closed when the interaction catalog cannot be fetched', async () => {
    const client = fakeClient({
      getInteractions: vi.fn(async () => {
        throw new UpstreamError('catalog down');
      }),
    });

    await expect(service(client).getInteractionsForProducts(['04114918'])).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });

  it('fetches ingredients once per product and the catalog once', async () => {
    const client = fakeClient();

    await service(client).getInteractionsForProducts(['04114918', '10019621']);

    expect(client.getIngredients).toHaveBeenCalledTimes(2);
    expect(client.getInteractions).toHaveBeenCalledTimes(1);
  });

  it('caches the interaction catalog within the TTL', async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    const svc = service(client);

    await svc.getInteractionsForProducts(['04114918']);
    vi.advanceTimersByTime(CATALOG_TTL_MS - 1);
    await svc.getInteractionsForProducts(['04114918']);

    expect(client.getInteractions).toHaveBeenCalledTimes(1);
  });

  it('refetches the interaction catalog after the TTL expires', async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    const svc = service(client);

    await svc.getInteractionsForProducts(['04114918']);
    vi.advanceTimersByTime(CATALOG_TTL_MS + 1);
    await svc.getInteractionsForProducts(['04114918']);

    expect(client.getInteractions).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent catalog fetches on a cold cache', async () => {
    const client = fakeClient();
    const svc = service(client);

    await Promise.all([
      svc.getInteractionsForProducts(['04114918']),
      svc.getInteractionsForProducts(['10019621']),
    ]);

    expect(client.getInteractions).toHaveBeenCalledTimes(1);
  });

  it('caches product ingredients within the TTL across requests', async () => {
    const client = fakeClient();
    const svc = service(client);

    await svc.getInteractionsForProducts(['04114918']);
    await svc.getInteractionsForProducts(['04114918']);

    expect(client.getIngredients).toHaveBeenCalledTimes(1);
  });

  it('refetches product ingredients after the TTL expires', async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    const svc = service(client);

    await svc.getInteractionsForProducts(['04114918']);
    vi.advanceTimersByTime(PRODUCT_TTL_MS + 1);
    await svc.getInteractionsForProducts(['04114918']);

    expect(client.getIngredients).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent lookups of the same product', async () => {
    const client = fakeClient();
    const svc = service(client);

    await Promise.all([
      svc.getInteractionsForProducts(['04114918']),
      svc.getInteractionsForProducts(['04114918', '10019621']),
    ]);

    expect(client.getIngredients).toHaveBeenCalledTimes(2);
  });

  it('does not cache an unknown-product result as a hard failure', async () => {
    const svc = service(fakeClient());

    const first = await svc.getInteractionsForProducts(['00000000']);
    const second = await svc.getInteractionsForProducts(['00000000']);

    expect(first.unknownProductIds).toEqual(['00000000']);
    expect(second.unknownProductIds).toEqual(['00000000']);
  });

  it('does not cache a failed catalog fetch', async () => {
    const getInteractions = vi
      .fn()
      .mockRejectedValueOnce(new UpstreamError('catalog down'))
      .mockResolvedValue(catalog);
    const client = fakeClient({ getInteractions });
    const svc = service(client);

    await expect(svc.getInteractionsForProducts(['04114918'])).rejects.toBeInstanceOf(
      UpstreamError,
    );
    const result = await svc.getInteractionsForProducts(['04114918']);

    expect(result.interactions.map((i) => i.interactionId)).toEqual(['int-ibu-alcohol']);
    expect(getInteractions).toHaveBeenCalledTimes(2);
  });

  // Guards `swr: false`. Under Nitro's default (`swr: true`) this resolves with
  // the stale catalog and demotes the upstream failure to a log line, which
  // would turn a fail-closed 502 into a silently outdated 200.
  it('fails closed rather than serving a stale catalog when the upstream is down', async () => {
    vi.useFakeTimers();
    const getInteractions = vi
      .fn()
      .mockResolvedValueOnce(catalog)
      .mockRejectedValue(new UpstreamError('catalog down'));
    const svc = service(fakeClient({ getInteractions }));

    await svc.getInteractionsForProducts(['04114918']);
    vi.advanceTimersByTime(CATALOG_TTL_MS + 1);

    await expect(svc.getInteractionsForProducts(['04114918'])).rejects.toBeInstanceOf(
      UpstreamError,
    );
    expect(getInteractions).toHaveBeenCalledTimes(2);
  });

  it('rejects every concurrent caller when a shared fetch fails', async () => {
    const client = fakeClient({
      getInteractions: vi.fn(async () => {
        throw new UpstreamError('catalog down');
      }),
    });
    const svc = service(client);

    const outcomes = await Promise.allSettled([
      svc.getInteractionsForProducts(['04114918']),
      svc.getInteractionsForProducts(['10019621']),
    ]);

    expect(outcomes.map((o) => o.status)).toEqual(['rejected', 'rejected']);
    expect(client.getInteractions).toHaveBeenCalledTimes(1);
  });
});
