import { z } from 'zod';

/**
 * Zod schemas for the mock-service responses (the upstream contract,
 * see services/mock-service/openapi.yml). Parsing upstream bodies at the
 * boundary turns silent contract drift into an explicit UpstreamError.
 */

export const ingredientsResponseSchema = z.object({
  productId: z.string(),
  ingredientIds: z.array(z.string()),
});

export const interactionCatalogEntrySchema = z.object({
  interactionId: z.string(),
  requiredIngredientIds: z.array(z.string()).min(1).max(2),
  interactionTexts: z.array(z.string()),
});

export const interactionsResponseSchema = z.object({
  interactions: z.array(interactionCatalogEntrySchema),
});

export type IngredientsResponse = z.infer<typeof ingredientsResponseSchema>;
export type InteractionCatalogEntry = z.infer<typeof interactionCatalogEntrySchema>;
export type InteractionsResponse = z.infer<typeof interactionsResponseSchema>;
