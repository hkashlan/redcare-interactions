/**
 * Everything that knows the mock service exists: its contract, its failure
 * modes, and the two cached reads this API needs from it.
 *
 * The upstream's `GET /product` (name, description) is deliberately not used —
 * the caller supplied the basket, so it already has whatever names it renders,
 * and a 404 from `/ingredients` reports an unknown id just as well.
 */

import { defineCachedFunction } from 'nitro/cache';
import { useRuntimeConfig } from 'nitro/runtime-config';
import { z } from 'zod';
import { logger } from '../util/logger';

/**
 * Defaults are declared in nitro.config.ts and overlaid from the environment
 * (`MOCK_SERVICE_URL`, `UPSTREAM_TIMEOUT_MS`, `CACHE_TTL_SECONDS`). Environment
 * overrides always arrive as strings, hence the coercion on the numeric ones.
 */
const config = useRuntimeConfig();
const MOCK_SERVICE_URL = String(config.mockServiceUrl);
const UPSTREAM_TIMEOUT_MS = Number(config.upstreamTimeoutMs);
const CACHE_TTL_SECONDS = Number(config.cacheTtlSeconds);

// --- contract -----------------------------------------------------------

/** The upstream contract (services/mock-service/openapi.yml) — parsed, so drift is loud. */
const ingredientsSchema = z.object({
  productId: z.string(),
  ingredientIds: z.array(z.string()),
});

const catalogSchema = z.object({
  interactions: z.array(
    z.object({
      interactionId: z.string(),
      requiredIngredientIds: z.array(z.string()).min(1).max(2),
      interactionTexts: z.array(z.string()),
    }),
  ),
});

// --- reads --------------------------------------------------------------

/** Everything the upstream can do wrong, except a 404, which is a data fact. */
export class UpstreamError extends Error {}

/** One upstream GET, turned into validated data, `null` for 404, or an UpstreamError. */
async function read<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
): Promise<z.infer<Schema> | null> {
  const startedAt = performance.now();

  let response: Response;
  try {
    response = await fetch(`${MOCK_SERVICE_URL}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new UpstreamError(`Request to mock service failed: GET ${path}`, { cause });
  }

  logger.debug('upstream read', {
    path,
    status: response.status,
    durationMs: Math.round(performance.now() - startedAt),
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new UpstreamError(`Mock service responded ${response.status} for GET ${path}`);
  }

  const body = await response.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new UpstreamError(`Mock service returned an unexpected body for GET ${path}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/**
 * Nitro's cache gives these reads exactly the three rules they need: a fresh
 * entry is served from storage, concurrent callers for the same key share one
 * in-flight call, and a rejected call is evicted rather than cached.
 *
 * `swr: false` is load-bearing, not cosmetic. Under the default (`swr: true`)
 * an expired entry plus a failing upstream *resolves with the stale value* and
 * demotes the error to a log line — and with `staleMaxAge` unset it would do so
 * with no upper bound on staleness, silently inverting the caller's fail-closed
 * policy. With it off, a request waits for a fresh value or rejects.
 *
 * Storage is the `cache` mount point (in-memory per instance by default), so
 * moving to a shared Redis cache is a nitro.config.ts change, not a code one.
 */
export const readCatalog = defineCachedFunction(() => read('/interactions', catalogSchema), {
  name: 'interaction-catalog',
  getKey: () => 'catalog',
  maxAge: CACHE_TTL_SECONDS,
  swr: false,
});

const readIngredients = defineCachedFunction(
  (productId: string) =>
    read(`/ingredients?productId=${encodeURIComponent(productId)}`, ingredientsSchema),
  {
    name: 'product-ingredients',
    getKey: (productId: string) => productId,
    maxAge: CACHE_TTL_SECONDS,
    swr: false,
  },
);

/** What the upstream knows about a basket: ingredients per product, plus the ids it does not have. */
export interface Basket {
  known: { productId: string; ingredientIds: string[] }[];
  unknownProductIds: string[];
}

/**
 * Reads every product at once — they are independent, and each read is cached
 * separately, so a repeated id across requests costs nothing.
 *
 * A product the upstream does not know (404) lands in `unknownProductIds`
 * rather than failing the call, so one delisted id cannot suppress the warnings
 * for the rest of the basket. Every other failure still throws `UpstreamError`:
 * not knowing a product's ingredients is not the same as knowing it has none.
 */
export async function readBasket(productIds: readonly string[]): Promise<Basket> {
  const entries = await Promise.all(
    productIds.map(async (productId) => ({
      productId,
      ingredients: await readIngredients(productId),
    })),
  );

  return {
    known: entries.flatMap(({ productId, ingredients }) =>
      ingredients ? [{ productId, ingredientIds: ingredients.ingredientIds }] : [],
    ),
    unknownProductIds: entries
      .filter(({ ingredients }) => ingredients === null)
      .map(({ productId }) => productId),
  };
}
