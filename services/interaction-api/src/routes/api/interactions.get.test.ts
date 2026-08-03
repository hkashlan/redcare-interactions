/**
 * The endpoint end to end, minus the transport: the real handler is driven with
 * real `Request` objects and asserted on the real `Response` it returns, over a
 * real upstream (src/test/upstream-server.ts). Nothing is mocked — the route,
 * the client, the cache and the matching rule all run.
 */

import { useRuntimeConfig } from 'nitro/runtime-config';
import { useStorage } from 'nitro/storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import nitroConfig from '../../../nitro.config';
import { startUpstream, type Upstream } from '../../test/upstream-server';

const IBUPROFEN = '04114918';
const ASPIRIN = '10019621';
const NO_INGREDIENTS = '99999999';
const UNKNOWN = '00000000';

let upstream: Upstream;
let handler: typeof import('./interactions.get')['default'];

/**
 * Drives the route the way Nitro does: a Request in, a Response out. The cast
 * only drops h3's per-header literal types — the value is a plain Response.
 */
const get = (query: string, headers?: HeadersInit) =>
  handler.fetch(
    new Request(`http://localhost/api/interactions${query}`, { headers }),
  ) as unknown as Promise<Response>;

beforeAll(async () => {
  upstream = await startUpstream();

  // The Nitro build injects these defaults; plain vitest does not, so they are
  // applied here from the same nitro.config.ts, with the upstream repointed.
  Object.assign(useRuntimeConfig(), nitroConfig.runtimeConfig, {
    mockServiceUrl: upstream.url,
    logLevel: 'silent',
  });

  handler = (await import('./interactions.get')).default;
});

afterAll(async () => {
  await upstream.close();
});

beforeEach(async () => {
  upstream.reset();
  await useStorage().clear(); // the cache is real, so it has to be emptied between cases
});

describe('GET /api/interactions', () => {
  it('returns the interactions that apply to the basket', async () => {
    const response = await get(`?productIds=${IBUPROFEN},${ASPIRIN}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      interactions: [
        {
          interactionId: 'int-ibu-alcohol',
          texts: ['Ibuprofen and alcohol warning.', 'Second advisory line.'],
          involvedProductIds: [IBUPROFEN],
          involvedIngredientIds: ['ing-ibu-001'],
        },
        {
          interactionId: 'int-ibu-asa',
          texts: ['NSAID pair warning.'],
          involvedProductIds: [IBUPROFEN, ASPIRIN],
          involvedIngredientIds: ['ing-ibu-001', 'ing-asa-002'],
        },
      ],
      meta: { requestedProductIds: [IBUPROFEN, ASPIRIN], unknownProductIds: [] },
    });
  });

  it('answers JSON and echoes a safe request id', async () => {
    const response = await get(`?productIds=${IBUPROFEN}`, { 'x-request-id': 'trace-abc.1' });

    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('x-request-id')).toBe('trace-abc.1');
  });

  it('replaces a request id a client should not get to put in our logs', async () => {
    // Not in /^[\w.:-]{1,128}$/, so it is dropped for a generated uuid rather
    // than being echoed into headers, error bodies and log lines.
    const hostile = '{"level":"error"} /../..';

    const response = await get(`?productIds=${IBUPROFEN}`, { 'x-request-id': hostile });

    expect(response.headers.get('x-request-id')).not.toBe(hostile);
    expect(response.headers.get('x-request-id')).toMatch(/^[\da-f-]{36}$/);
  });

  it('accepts the repeated and comma forms together, deduplicated in first-seen order', async () => {
    const response = await get(
      `?productIds=${ASPIRIN},${IBUPROFEN}&productIds=${ASPIRIN}&productIds=${NO_INGREDIENTS}`,
    );

    expect(await response.json()).toMatchObject({
      meta: { requestedProductIds: [ASPIRIN, IBUPROFEN, NO_INGREDIENTS] },
    });
  });

  it('trims surrounding whitespace off an id', async () => {
    const response = await get(`?productIds=%20${IBUPROFEN}%20`);

    expect(response.status).toBe(200);
    expect(upstream.requests).toContain(`/ingredients?productId=${IBUPROFEN}`);
  });

  it('still warns about the rest of the basket when one id is unknown', async () => {
    const response = await get(`?productIds=${IBUPROFEN},${UNKNOWN},${ASPIRIN}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.interactions.map((entry: { interactionId: string }) => entry.interactionId),
    ).toEqual(['int-ibu-alcohol', 'int-ibu-asa']);
    expect(body.meta.unknownProductIds).toEqual([UNKNOWN]);
    expect(body.meta.requestedProductIds).toEqual([IBUPROFEN, UNKNOWN, ASPIRIN]);
  });

  it('returns no interactions for a basket that triggers none', async () => {
    const response = await get(`?productIds=${NO_INGREDIENTS}`);

    expect(await response.json()).toEqual({
      interactions: [],
      meta: { requestedProductIds: [NO_INGREDIENTS], unknownProductIds: [] },
    });
  });

  describe('invalid input', () => {
    const issuesOf = async (response: Response) => (await response.json()).error.issues;

    it('rejects a missing productIds parameter', async () => {
      const response = await get('');
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid request',
          requestId: body.error.requestId,
          issues: [{ path: 'productIds', message: 'productIds query parameter is required' }],
        },
      });
    });

    it('points at the offending element of the list', async () => {
      const response = await get(`?productIds=${IBUPROFEN},,${ASPIRIN}`);

      expect(response.status).toBe(400);
      expect(await issuesOf(response)).toEqual([
        { path: 'productIds.1', message: 'productId must not be empty' },
      ]);
    });

    it('rejects an id that is too long', async () => {
      const response = await get(`?productIds=${'x'.repeat(65)}`);

      expect(await issuesOf(response)).toEqual([
        { path: 'productIds.0', message: 'productId too long' },
      ]);
    });

    it('rejects more than 100 distinct ids', async () => {
      const ids = Array.from({ length: 101 }, (_, index) => `id-${index}`);

      const response = await get(`?productIds=${ids.join(',')}`);

      expect(response.status).toBe(400);
      expect(await issuesOf(response)).toEqual([
        { path: 'productIds', message: 'too many productIds (max 100)' },
      ]);
    });

    it('counts the 100-id cap after deduplication', async () => {
      const ids = Array.from({ length: 150 }, () => IBUPROFEN);

      const response = await get(`?productIds=${ids.join(',')}`);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ meta: { requestedProductIds: [IBUPROFEN] } });
    });

    it('does not touch the upstream for an invalid request', async () => {
      await get('');

      expect(upstream.requests).toEqual([]);
    });
  });

  describe('failing closed', () => {
    it('answers 502 rather than "no interactions" when the upstream errors', async () => {
      upstream.status = 500;

      const response = await get(`?productIds=${IBUPROFEN}`);
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body.error.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(body).not.toHaveProperty('interactions');
    });

    it('answers 502 when the upstream has no catalog', async () => {
      upstream.catalog = null; // 404: only /ingredients may legitimately 404

      const response = await get(`?productIds=${IBUPROFEN}`);

      expect(response.status).toBe(502);
      expect((await response.json()).error.code).toBe('UPSTREAM_UNAVAILABLE');
    });

    it('answers 502 when the upstream drifts from its contract', async () => {
      upstream.ingredients.set(IBUPROFEN, { productId: IBUPROFEN, ingredientIds: 'ing-ibu-001' });

      const response = await get(`?productIds=${IBUPROFEN}`);

      expect(response.status).toBe(502);
    });

    it('carries the request id into the error body and header', async () => {
      upstream.status = 500;

      const response = await get(`?productIds=${IBUPROFEN}`, { 'x-request-id': 'trace-502' });

      expect(response.headers.get('x-request-id')).toBe('trace-502');
      expect((await response.json()).error.requestId).toBe('trace-502');
    });

    it('recovers on the next request once the upstream is healthy again', async () => {
      upstream.status = 500;
      expect((await get(`?productIds=${IBUPROFEN}`)).status).toBe(502);

      upstream.status = undefined;
      expect((await get(`?productIds=${IBUPROFEN}`)).status).toBe(200);
    });
  });
});
