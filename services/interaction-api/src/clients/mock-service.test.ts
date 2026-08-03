import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductNotFoundError, UpstreamError } from './errors';
import { createMockServiceClient } from './mock-service';

const BASE_URL = 'http://mock:8080';

function client(timeoutMs = 1000) {
  return createMockServiceClient({ baseUrl: BASE_URL, timeoutMs });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createMockServiceClient', () => {
  it('fetches and parses ingredients', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ productId: '04114918', ingredientIds: ['ing-ibu-001'] }));
    vi.stubGlobal('fetch', fetchMock);

    const ingredients = await client().getIngredients('04114918');

    expect(ingredients.ingredientIds).toEqual(['ing-ibu-001']);
    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toBe(`${BASE_URL}/ingredients?productId=04114918`);
  });

  it('fetches and parses the interaction catalog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          interactions: [
            {
              interactionId: 'int-x',
              requiredIngredientIds: ['ing-a'],
              interactionTexts: ['text'],
            },
          ],
        }),
      ),
    );

    const catalog = await client().getInteractions();

    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.interactionId).toBe('int-x');
  });

  it('URL-encodes the product id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ productId: 'a b', ingredientIds: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await client().getIngredients('a b');

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${BASE_URL}/ingredients?productId=a+b`);
  });

  it('throws ProductNotFoundError on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    const error = await client()
      .getIngredients('00000000')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProductNotFoundError);
    expect((error as ProductNotFoundError).productId).toBe('00000000');
  });

  it('throws UpstreamError on 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(client().getIngredients('04114918')).rejects.toBeInstanceOf(UpstreamError);
  });

  it('throws UpstreamError when the request times out', async () => {
    // A fetch that never resolves but honors its AbortSignal.
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }),
    );

    await expect(client(10).getIngredients('04114918')).rejects.toBeInstanceOf(UpstreamError);
  });

  it('throws UpstreamError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(client().getInteractions()).rejects.toBeInstanceOf(UpstreamError);
  });

  it('throws UpstreamError on a malformed body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ productId: '04114918', unexpected: true })),
    );

    await expect(client().getIngredients('04114918')).rejects.toBeInstanceOf(UpstreamError);
  });

  it('throws UpstreamError on invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));

    await expect(client().getIngredients('04114918')).rejects.toBeInstanceOf(UpstreamError);
  });
});
