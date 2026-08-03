import type { z } from 'zod';
import { logger } from '../logger';
import { ProductNotFoundError, UpstreamError } from './errors';
import {
  type IngredientsResponse,
  type InteractionCatalogEntry,
  ingredientsResponseSchema,
  interactionsResponseSchema,
} from './schemas';

/**
 * The upstream's `GET /product` (name and description) is deliberately not
 * exposed: this API returns interaction warnings, and the caller already knows
 * the products it asked about. A 404 from `/ingredients` is the same data fact,
 * so unknown ids are still detected without a second read per product.
 */
export interface MockServiceClient {
  getIngredients(productId: string): Promise<IngredientsResponse>;
  getInteractions(): Promise<InteractionCatalogEntry[]>;
}

export interface MockServiceClientOptions {
  baseUrl: string;
  timeoutMs: number;
}

export function createMockServiceClient(options: MockServiceClientOptions): MockServiceClient {
  return {
    getIngredients(productId) {
      const query = new URLSearchParams({ productId });
      const notFound = () => new ProductNotFoundError(productId);
      return request(options, `/ingredients?${query}`, ingredientsResponseSchema, notFound);
    },

    async getInteractions() {
      const body = await request(options, '/interactions', interactionsResponseSchema);
      return body.interactions;
    },
  };
}

/** Logs every outcome — success, 404 and failure alike — with its duration. */
async function request<Schema extends z.ZodType>(
  options: MockServiceClientOptions,
  path: string,
  schema: Schema,
  notFound?: () => Error,
): Promise<z.infer<Schema>> {
  const startedAt = performance.now();
  const durationMs = () => Math.round(performance.now() - startedAt);

  try {
    const data = await fetchAndParse(options, path, schema, notFound);
    logger.debug('upstream read succeeded', { path, durationMs: durationMs() });
    return data;
  } catch (error) {
    logger.debug('upstream read failed', {
      path,
      durationMs: durationMs(),
      // ProductNotFoundError is an expected outcome, not an incident.
      expected: error instanceof ProductNotFoundError,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * The trust boundary: one upstream GET, turned into either validated data or a
 * typed error. Everything the upstream can do wrong — unreachable, timed out,
 * non-2xx, unparseable, off-contract — becomes an `UpstreamError`, except a 404
 * where the caller supplied a more specific error.
 */
async function fetchAndParse<Schema extends z.ZodType>(
  { baseUrl, timeoutMs }: MockServiceClientOptions,
  path: string,
  schema: Schema,
  notFound?: () => Error,
): Promise<z.infer<Schema>> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new UpstreamError(`Request to mock service failed: GET ${path}`, cause);
  }

  if (response.status === 404 && notFound) {
    throw notFound();
  }
  if (!response.ok) {
    throw new UpstreamError(`Mock service responded ${response.status} for GET ${path}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new UpstreamError(`Mock service returned invalid JSON for GET ${path}`, cause);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new UpstreamError(
      `Mock service response did not match the expected contract for GET ${path}`,
      parsed.error,
    );
  }
  return parsed.data;
}
