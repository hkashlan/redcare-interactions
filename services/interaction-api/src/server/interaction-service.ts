import { ProductNotFoundError } from '../clients/errors';
import type { MockServiceClient } from '../clients/mock-service';
import type { ProductIngredients } from '../domain/match-interactions';
import { matchInteractions } from '../domain/match-interactions';
import type {
  InteractionResult,
  InteractionService,
  InteractionServiceOptions,
  ResolvedProduct,
} from './interaction-service.dto';
import { cachedQuery, createQueryClient } from './query-client';

export type * from './interaction-service.dto';

export function createInteractionService(
  client: MockServiceClient,
  options: InteractionServiceOptions,
): InteractionService {
  const reads = createCachedReads(client, options);

  async function resolveProduct(productId: string): Promise<ResolvedProduct> {
    try {
      // Product metadata and ingredients are independent — fetch in parallel.
      const [product, ingredients] = await Promise.all([
        reads.product(productId),
        reads.ingredients(productId),
      ]);
      return {
        product: { productId, status: 'resolved', name: product.name },
        ingredients: { productId, ingredientIds: ingredients.ingredientIds },
      };
    } catch (error) {
      if (error instanceof ProductNotFoundError) {
        // A missing product is a data fact: degrade to partial success so one
        // delisted product cannot suppress warnings for the rest of the basket.
        return { product: { productId, status: 'unknown' }, ingredients: null };
      }
      // Anything else means we cannot know the ingredients: fail closed.
      throw error;
    }
  }

  return {
    async getInteractionsForProducts(productIds) {
      const [catalog, basket] = await Promise.all([
        reads.catalog(),
        Promise.all(productIds.map(resolveProduct)),
      ]);

      return toInteractionResult(catalog, basket);
    },
  };
}

/** All upstream reads go through the TanStack Query cache (TTL + dedup). */
function createCachedReads(client: MockServiceClient, options: InteractionServiceOptions) {
  const queryClient = createQueryClient();

  return {
    catalog: () =>
      cachedQuery(
        queryClient,
        ['interactions'],
        () => client.getInteractions(),
        options.catalogTtlMs,
      ),
    product: (productId: string) =>
      cachedQuery(
        queryClient,
        ['product', productId],
        () => client.getProduct(productId),
        options.productTtlMs,
      ),
    ingredients: (productId: string) =>
      cachedQuery(
        queryClient,
        ['ingredients', productId],
        () => client.getIngredients(productId),
        options.productTtlMs,
      ),
  };
}

function toInteractionResult(
  catalog: Awaited<ReturnType<MockServiceClient['getInteractions']>>,
  basket: ResolvedProduct[],
): InteractionResult {
  const knownProducts = basket
    .map((entry) => entry.ingredients)
    .filter((ingredients): ingredients is ProductIngredients => ingredients !== null);

  return {
    products: basket.map((entry) => entry.product),
    interactions: matchInteractions(catalog, knownProducts),
    unknownProductIds: basket
      .filter((entry) => entry.ingredients === null)
      .map((entry) => entry.product.productId),
  };
}
