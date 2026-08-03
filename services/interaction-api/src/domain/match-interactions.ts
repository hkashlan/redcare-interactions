/**
 * Pure interaction-matching logic. No I/O, no framework imports — the whole
 * business rule of this service lives here and is unit-tested in isolation.
 *
 * Rule: an interaction applies iff every one of its requiredIngredientIds is
 * present in the union of ingredients across the selected products.
 */

import type {
  CatalogEntry,
  MatchedInteraction,
  ProductIngredients,
} from './match-interactions.dto';

export type * from './match-interactions.dto';

/** ingredient id -> product ids containing it, in basket order. */
type IngredientIndex = Map<string, string[]>;

export function matchInteractions(
  catalog: readonly CatalogEntry[],
  products: readonly ProductIngredients[],
): MatchedInteraction[] {
  const basket = indexIngredientsByProduct(products);

  return catalog
    .filter((entry) => appliesTo(entry, basket))
    .map((entry) => toMatchedInteraction(entry, basket));
}

function indexIngredientsByProduct(products: readonly ProductIngredients[]): IngredientIndex {
  const index: IngredientIndex = new Map();

  for (const product of products) {
    for (const ingredientId of product.ingredientIds) {
      const holders = index.get(ingredientId) ?? [];
      holders.push(product.productId);
      index.set(ingredientId, holders);
    }
  }

  return index;
}

function appliesTo(entry: CatalogEntry, basket: IngredientIndex): boolean {
  return entry.requiredIngredientIds.every((ingredientId) => basket.has(ingredientId));
}

function toMatchedInteraction(entry: CatalogEntry, basket: IngredientIndex): MatchedInteraction {
  return {
    interactionId: entry.interactionId,
    texts: [...entry.interactionTexts],
    involvedProductIds: productsContributing(entry.requiredIngredientIds, basket),
    involvedIngredientIds: [...entry.requiredIngredientIds],
  };
}

function productsContributing(ingredientIds: readonly string[], basket: IngredientIndex): string[] {
  const productIds = new Set<string>();
  for (const ingredientId of ingredientIds) {
    for (const productId of basket.get(ingredientId) ?? []) {
      productIds.add(productId);
    }
  }
  return [...productIds];
}
