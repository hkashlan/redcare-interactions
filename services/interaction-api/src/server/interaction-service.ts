import { ProductNotFoundError } from '../clients/errors';
import type { MockServiceClient } from '../clients/mock-service';
import type { ProductIngredients } from '../domain/match-interactions';
import { matchInteractions } from '../domain/match-interactions';
import { createFetchCache } from './fetch-cache';
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

/** All upstream reads go through the per-instance fetch cache (TTL + dedup). */
function createCachedReads(client: MockServiceClient, options: InteractionServiceOptions) {
  const cache = createFetchCache();

  return {
    catalog: () =>
      cache.fetch('interactions', () => client.getInteractions(), options.catalogTtlMs),
    ingredients: (productId: string) =>
      cache.fetch(
        `ingredients:${productId}`,
        () => client.getIngredients(productId),
        options.productTtlMs,
      ),
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
