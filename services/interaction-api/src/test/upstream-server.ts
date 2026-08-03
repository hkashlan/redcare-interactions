/**
 * A real HTTP server that speaks the mock service's contract
 * (services/mock-service/openapi.yml).
 *
 * It stands in for the Java service so the tests need no mocks: `fetch` is not
 * stubbed and nothing is injected, so the code under test does real requests
 * over a real socket and sees real status codes, real latency and real JSON.
 *
 * Behaviour is data rather than code — a test sets `catalog`, `ingredients`,
 * `status` or `delayMs` between cases instead of swapping an implementation.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Two catalog entries: one single-ingredient, one pair. Shapes mirror the mock data. */
export const CATALOG = {
  interactions: [
    {
      interactionId: 'int-ibu-alcohol',
      requiredIngredientIds: ['ing-ibu-001'],
      interactionTexts: ['Ibuprofen and alcohol warning.', 'Second advisory line.'],
    },
    {
      interactionId: 'int-ibu-asa',
      requiredIngredientIds: ['ing-ibu-001', 'ing-asa-002'],
      interactionTexts: ['NSAID pair warning.'],
    },
  ],
};

/** Ibuprofen, acetylsalicylic acid, and a product the upstream knows but has no ingredients for. */
export const INGREDIENTS: Record<string, unknown> = {
  '04114918': { productId: '04114918', ingredientIds: ['ing-ibu-001', 'ing-exc-010'] },
  '10019621': { productId: '10019621', ingredientIds: ['ing-asa-002', 'ing-exc-010'] },
  '99999999': { productId: '99999999', ingredientIds: [] },
};

export type Upstream = Awaited<ReturnType<typeof startUpstream>>;

export async function startUpstream() {
  const state = {
    /** Body for `GET /interactions`; `null` answers 404. */
    catalog: CATALOG as unknown,
    /** productId -> body for `GET /ingredients`; an id that is not here answers 404. */
    ingredients: new Map<string, unknown>(Object.entries(INGREDIENTS)),
    /** When set, every request answers with this status and an empty body. */
    status: undefined as number | undefined,
    /** Latency before answering — used to drive the client past its timeout. */
    delayMs: 0,
    /** Every request line served, in order. A cache hit shows up as a missing entry. */
    requests: [] as string[],
  };

  const server = createServer((req, res) => {
    state.requests.push(req.url ?? '/');
    const url = new URL(req.url ?? '/', 'http://upstream');

    const answer = () => {
      if (res.destroyed) return; // the client already gave up (timeout case)
      if (state.status !== undefined) return void res.writeHead(state.status).end();

      if (url.pathname === '/interactions') return void send(res, state.catalog);
      if (url.pathname === '/ingredients') {
        const productId = url.searchParams.get('productId') ?? '';
        return void send(res, state.ingredients.get(productId) ?? null);
      }
      res.writeHead(404).end();
    };

    if (state.delayMs > 0) setTimeout(answer, state.delayMs).unref();
    else answer();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return Object.assign(state, {
    url: `http://127.0.0.1:${port}`,

    /** Back to the healthy defaults, with an empty request log. */
    reset() {
      state.catalog = CATALOG;
      state.ingredients = new Map(Object.entries(INGREDIENTS));
      state.status = undefined;
      state.delayMs = 0;
      state.requests.length = 0;
    },

    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  });
}

/** `null` is the upstream's "I do not know this id" — a 404, not a failure. */
function send(res: import('node:http').ServerResponse, body: unknown): void {
  if (body === null) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
