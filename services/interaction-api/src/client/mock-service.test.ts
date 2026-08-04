/**
 * The client against a real upstream (see src/test/upstream-server.ts): real
 * sockets, real status codes, real JSON — no stubbed `fetch`, no injected
 * double. The module is imported after the runtime config points at the test
 * server, because it reads its configuration once at module scope.
 */

import { useRuntimeConfig } from 'nitro/runtime-config';
import { useStorage } from 'nitro/storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import nitroConfig from '../../nitro.config';
import { startUpstream, type Upstream } from '../test/upstream-server';

const TIMEOUT_MS = 250;

let upstream: Upstream;
let client: typeof import('./mock-service');

beforeAll(async () => {
  upstream = await startUpstream();

  // The Nitro build injects these defaults; plain vitest does not, so they are
  // applied here from the same nitro.config.ts, with the upstream repointed.
  Object.assign(useRuntimeConfig(), nitroConfig.runtimeConfig, {
    mockServiceUrl: upstream.url,
    upstreamTimeoutMs: TIMEOUT_MS,
    logLevel: 'silent',
  });

  client = await import('./mock-service');
});

afterAll(async () => {
  await upstream.close();
});

beforeEach(async () => {
  upstream.reset();
  await useStorage().clear(); // the cache is real, so it has to be emptied between cases
});

describe('readCatalog', () => {
  it('parses the interaction catalog', async () => {
    const catalog = await client.readCatalog();

    expect(catalog?.interactions.map((entry) => entry.interactionId)).toEqual([
      'int-ibu-alcohol',
      'int-ibu-asa',
    ]);
  });

  it('serves a second call from the cache', async () => {
    await client.readCatalog();
    await client.readCatalog();

    expect(upstream.requests).toEqual(['/interactions']);
  });

  it('returns null when the upstream has no catalog', async () => {
    upstream.catalog = null; // 404 — the route turns this into a 502

    await expect(client.readCatalog()).resolves.toBeNull();
  });

  it('rejects a catalog that breaks the contract', async () => {
    upstream.catalog = { interactions: [{ interactionId: 'int-a' }] };

    await expect(client.readCatalog()).rejects.toBeInstanceOf(client.UpstreamError);
  });
});

describe('readBasket', () => {
  it('returns the ingredients of every known product', async () => {
    const basket = await client.readBasket(['04114918', '10019621']);

    expect(basket).toEqual({
      known: [
        { productId: '04114918', ingredientIds: ['ing-ibu-001', 'ing-exc-010'] },
        { productId: '10019621', ingredientIds: ['ing-asa-002', 'ing-exc-010'] },
      ],
      unknownProductIds: [],
    });
  });

  it('reports an unknown id instead of failing the whole basket', async () => {
    const basket = await client.readBasket(['04114918', '00000000']);

    expect(basket.known.map((product) => product.productId)).toEqual(['04114918']);
    expect(basket.unknownProductIds).toEqual(['00000000']);
  });

  it('keeps a known product with no ingredients out of the unknown list', async () => {
    const basket = await client.readBasket(['99999999']);

    expect(basket.known).toEqual([{ productId: '99999999', ingredientIds: [] }]);
    expect(basket.unknownProductIds).toEqual([]);
  });

  it('caches each product separately, so a repeat across calls costs no read', async () => {
    await client.readBasket(['04114918', '10019621']);
    await client.readBasket(['04114918', '99999999']);

    expect(upstream.requests).toEqual([
      '/ingredients?productId=04114918',
      '/ingredients?productId=10019621',
      '/ingredients?productId=99999999',
    ]);
  });

  it('encodes the product id into the query string', async () => {
    await client.readBasket(['a b&productId=x']);

    expect(upstream.requests).toEqual(['/ingredients?productId=a%20b%26productId%3Dx']);
  });

  it('fails the call when the upstream errors, rather than reporting no ingredients', async () => {
    upstream.status = 500;

    await expect(client.readBasket(['04114918'])).rejects.toBeInstanceOf(client.UpstreamError);
  });

  it('fails the call when the upstream is too slow', async () => {
    upstream.delayMs = TIMEOUT_MS * 4;

    await expect(client.readBasket(['04114918'])).rejects.toBeInstanceOf(client.UpstreamError);
  });

  it('rejects a body that breaks the contract', async () => {
    upstream.ingredients.set('04114918', { productId: '04114918' });

    await expect(client.readBasket(['04114918'])).rejects.toBeInstanceOf(client.UpstreamError);
  });

  it('does not cache a failure, so the next call retries', async () => {
    upstream.status = 503;
    await expect(client.readBasket(['04114918'])).rejects.toBeInstanceOf(client.UpstreamError);

    upstream.status = undefined;
    const basket = await client.readBasket(['04114918']);

    expect(basket.known).toEqual([
      { productId: '04114918', ingredientIds: ['ing-ibu-001', 'ing-exc-010'] },
    ]);
  });
});
