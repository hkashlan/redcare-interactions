import { defineCachedFunction } from 'nitro/cache';
import { ProductNotFoundError } from '../clients/errors';
import type { MockServiceClient } from '../clients/mock-service';
import type { ProductIngredients } from '../domain/match-interactions';
import { matchInteractions } from '../domain/match-interactions';
import { logger } from '../logger';
import type {
  InteractionResult,
  InteractionService,
  InteractionServiceOptions,
  ResolvedProduct,
} from './interaction-service.dto';

export type * from './interaction-service.dto';

export function createInteractionService(
  client: MockServiceClient,
  options: InteractionServiceOptions,
): InteractionService {
  const reads = createCachedReads(client, options);

  return {
    async getInteractionsForProducts(productIds) {
      const [catalog, basket] = await Promise.all([
        reads.catalog(),
        Promise.all(productIds.map((productId) => resolveProduct(reads, productId))),
      ]);

      return toInteractionResult(catalog, basket);
    },
  };
}

async function resolveProduct(reads: CachedReads, productId: string): Promise<ResolvedProduct> {
  try {
    const ingredients = await reads.ingredients(productId);
    return { productId, ingredients: { productId, ingredientIds: ingredients.ingredientIds } };
  } catch (error) {
    if (error instanceof ProductNotFoundError) {
      // A missing product is a data fact: degrade to partial success so one
      // delisted product cannot suppress warnings for the rest of the basket.
      return { productId, ingredients: null };
    }
    // Anything else means we cannot know the ingredients: fail closed.
    throw error;
  }
}

type CachedReads = ReturnType<typeof createCachedReads>;

/**
 * All upstream reads go through Nitro's cache, which gives us the three rules
 * this service needs: a fresh entry is served from storage, concurrent callers
 * for the same key share one in-flight call, and a rejected call is evicted
 * rather than cached, so the next request retries.
 *
 * `swr: false` is load-bearing, not cosmetic. Under Nitro's default
 * (`swr: true`) an expired entry plus a failing upstream *resolves with the
 * stale value* and demotes the error to a log line — and because `staleMaxAge`
 * is unset, it would do so with no upper bound on staleness. That would
 * silently invert the fail-closed policy of decision 7, so the whole point of
 * this option is that the request waits for a fresh value and rejects if it
 * cannot get one.
 *
 * Storage is the `cache` mount point (in-memory per instance by default), so
 * moving to a shared Redis cache is a nitro.config.ts change, not a code one.
 */
function createCachedReads(client: MockServiceClient, options: InteractionServiceOptions) {
  // Only fires for cache storage faults; a failing upstream read is rethrown to
  // the caller instead, and logged by the handler that maps it to a 502.
  const onError = (error: unknown) =>
    logger.warn('cache storage error', { error: error instanceof Error ? error.message : error });

  return {
    catalog: defineCachedFunction(() => client.getInteractions(), {
      name: 'interaction-catalog',
      getKey: () => 'catalog',
      maxAge: options.catalogTtlMs / 1000, // Nitro counts seconds; config is ms.
      swr: false,
      onError,
    }),
    ingredients: defineCachedFunction((productId: string) => client.getIngredients(productId), {
      name: 'product-ingredients',
      getKey: (productId: string) => productId,
      maxAge: options.productTtlMs / 1000,
      swr: false,
      onError,
    }),
  };
}

function toInteractionResult(
  catalog: Awaited<ReturnType<MockServiceClient['getInteractions']>>,
  basket: ResolvedProduct[],
): InteractionResult {
  const known: ProductIngredients[] = [];
  const unknownProductIds: string[] = [];

  for (const entry of basket) {
    if (entry.ingredients) known.push(entry.ingredients);
    else unknownProductIds.push(entry.productId);
  }

  return { interactions: matchInteractions(catalog, known), unknownProductIds };
}
