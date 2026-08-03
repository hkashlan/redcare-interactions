/** The domain model of interaction matching — no I/O, no framework types. */

export interface ProductIngredients {
  productId: string;
  ingredientIds: readonly string[];
}

export interface CatalogEntry {
  interactionId: string;
  requiredIngredientIds: readonly string[];
  interactionTexts: readonly string[];
}

export interface MatchedInteraction {
  interactionId: string;
  texts: string[];
  involvedProductIds: string[];
  involvedIngredientIds: string[];
}
