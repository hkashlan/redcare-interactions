import type { MatchedInteraction, ProductIngredients } from '../domain/match-interactions';

/** What the service returns to the route layer. */
export interface InteractionResult {
  interactions: MatchedInteraction[];
  unknownProductIds: string[];
}

export interface InteractionService {
  getInteractionsForProducts(productIds: readonly string[]): Promise<InteractionResult>;
}

export interface InteractionServiceOptions {
  catalogTtlMs: number;
  productTtlMs: number;
}

/** One basket entry after upstream resolution: unknown products carry no ingredients. */
export interface ResolvedProduct {
  productId: string;
  ingredients: ProductIngredients | null;
}
