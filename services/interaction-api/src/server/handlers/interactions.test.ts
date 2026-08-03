import { describe, expect, it, vi } from 'vitest';
import { UpstreamError } from '../../clients/errors';
import type { InteractionResult, InteractionService } from '../interaction-service.dto';
import { createInteractionsHandler } from './interactions';

const happyResult: InteractionResult = {
  products: [
    { productId: '04114918', status: 'resolved', name: 'Ibuprofen 400' },
    { productId: '10019621', status: 'resolved', name: 'Aspirin Complex' },
  ],
  interactions: [
    {
      interactionId: 'int-ibu-asa',
      texts: ['NSAID pair warning.'],
      involvedProductIds: ['04114918', '10019621'],
      involvedIngredientIds: ['ing-ibu-001', 'ing-asa-002'],
    },
  ],
  unknownProductIds: [],
};

function fakeService(result: InteractionResult = happyResult): InteractionService {
  return { getInteractionsForProducts: vi.fn(async () => result) };
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://test${path}`, { headers });
}

describe('createInteractionsHandler', () => {
  it('returns 200 with products, interactions and meta', async () => {
    const handler = createInteractionsHandler(fakeService());

    const response = await handler(get('/api/interactions?productIds=04114918,10019621'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.products).toHaveLength(2);
    expect(body.interactions[0].interactionId).toBe('int-ibu-asa');
    expect(body.meta).toEqual({
      requestedProductIds: ['04114918', '10019621'],
      unknownProductIds: [],
    });
  });

  it('passes deduplicated product ids to the service', async () => {
    const service = fakeService();
    const handler = createInteractionsHandler(service);

    await handler(get('/api/interactions?productIds=04114918,04114918,10019621'));

    expect(service.getInteractionsForProducts).toHaveBeenCalledWith(['04114918', '10019621']);
  });

  // Most HTTP clients serialize arrays by repeating the parameter; reading only
  // the first occurrence would evaluate half a basket and hide interactions.
  it('reads every occurrence of a repeated productIds parameter', async () => {
    const service = fakeService();
    const handler = createInteractionsHandler(service);

    await handler(get('/api/interactions?productIds=04114918&productIds=10019621'));

    expect(service.getInteractionsForProducts).toHaveBeenCalledWith(['04114918', '10019621']);
  });

  it('mixes repeated and comma-separated ids', async () => {
    const service = fakeService();
    const handler = createInteractionsHandler(service);

    await handler(get('/api/interactions?productIds=04114918,10019621&productIds=06313728'));

    expect(service.getInteractionsForProducts).toHaveBeenCalledWith([
      '04114918',
      '10019621',
      '06313728',
    ]);
  });

  it('applies the 100-id limit after deduplication', async () => {
    const service = fakeService();
    const handler = createInteractionsHandler(service);
    const repeated = Array.from({ length: 101 }, () => '04114918').join(',');

    const response = await handler(get(`/api/interactions?productIds=${repeated}`));

    expect(response.status).toBe(200);
    expect(service.getInteractionsForProducts).toHaveBeenCalledWith(['04114918']);
  });

  it('rejects more than 100 distinct product ids', async () => {
    const handler = createInteractionsHandler(fakeService());
    const distinct = Array.from({ length: 101 }, (_, i) => `id-${i}`).join(',');

    const response = await handler(get(`/api/interactions?productIds=${distinct}`));

    expect(response.status).toBe(400);
  });

  it('reports unknown products as partial success', async () => {
    const partial: InteractionResult = {
      products: [
        { productId: '04114918', status: 'resolved', name: 'Ibuprofen 400' },
        { productId: '00000000', status: 'unknown' },
      ],
      interactions: [],
      unknownProductIds: ['00000000'],
    };
    const handler = createInteractionsHandler(fakeService(partial));

    const response = await handler(get('/api/interactions?productIds=04114918,00000000'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.products[1]).toEqual({ productId: '00000000', status: 'unknown' });
    expect(body.meta.unknownProductIds).toEqual(['00000000']);
  });

  it('returns 400 with issues when productIds is missing', async () => {
    const handler = createInteractionsHandler(fakeService());

    const response = await handler(get('/api/interactions'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(body.error.requestId).toBeTruthy();
    expect(body.error.issues.length).toBeGreaterThan(0);
  });

  it('returns 400 when productIds is empty', async () => {
    const handler = createInteractionsHandler(fakeService());

    const response = await handler(get('/api/interactions?productIds='));

    expect(response.status).toBe(400);
  });

  it('returns 502 when the upstream is unavailable (fail closed)', async () => {
    const service: InteractionService = {
      getInteractionsForProducts: vi.fn(async () => {
        throw new UpstreamError('mock service down');
      }),
    };
    const handler = createInteractionsHandler(service);

    const response = await handler(get('/api/interactions?productIds=04114918'));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(body.error.requestId).toBeTruthy();
  });

  it('returns 500 on unexpected errors', async () => {
    const service: InteractionService = {
      getInteractionsForProducts: vi.fn(async () => {
        throw new Error('bug');
      }),
    };
    const handler = createInteractionsHandler(service);

    const response = await handler(get('/api/interactions?productIds=04114918'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('echoes an incoming x-request-id on success and error responses', async () => {
    const handler = createInteractionsHandler(fakeService());

    const ok = await handler(
      get('/api/interactions?productIds=04114918', { 'x-request-id': 'req-123' }),
    );
    const bad = await handler(get('/api/interactions', { 'x-request-id': 'req-456' }));

    expect(ok.headers.get('x-request-id')).toBe('req-123');
    expect(bad.headers.get('x-request-id')).toBe('req-456');
    expect((await bad.json()).error.requestId).toBe('req-456');
  });

  it('generates a request id when none is provided', async () => {
    const handler = createInteractionsHandler(fakeService());

    const response = await handler(get('/api/interactions?productIds=04114918'));

    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  // The id lands in headers, error bodies and every log line, so a client
  // must not be able to push unbounded or odd text into them. (Raw newlines
  // never get this far — the Headers API rejects them at construction.)
  it.each([
    ['too long', 'x'.repeat(129)],
    ['quotes and spaces', 'req "id" {level:error}'],
    ['empty', ''],
  ])('replaces an unusable incoming request id (%s)', async (_case, supplied) => {
    const handler = createInteractionsHandler(fakeService());

    const response = await handler(
      get('/api/interactions?productIds=04114918', { 'x-request-id': supplied }),
    );

    expect(response.headers.get('x-request-id')).not.toBe(supplied);
    expect(response.headers.get('x-request-id')).toMatch(/^[\w-]{36}$/);
  });
});
