import { z } from 'zod';

/**
 * The public contract of GET /api/interactions.
 *
 * - Interaction-centric response: one entry per applicable interaction, so the
 *   widget renders one warning card per entry without further joins.
 * - Products are referenced by id only. The caller supplied the basket, so it
 *   already has whatever names it renders; fetching them here would double the
 *   upstream reads to add data nobody asked for.
 * - Unknown product ids degrade to partial success: they are listed in
 *   `meta.unknownProductIds`, while warnings for the rest of the basket are
 *   still returned.
 */

const productIdSchema = z
  .string()
  .trim()
  .min(1, 'productId must not be empty')
  .max(64, 'productId too long');

/**
 * Query: ?productIds=04114918,10019621 — comma-separated and deduplicated.
 *
 * Takes every occurrence of the parameter, because clients also serialize
 * lists by repeating it (?productIds=a&productIds=b); reading only the first
 * would silently evaluate half a basket. The 100-id cap is applied after
 * deduplication, so a repeated id costs a client nothing.
 */
export const interactionsQuerySchema = z.object({
  productIds: z
    .array(z.string())
    .min(1, 'productIds query parameter is required')
    .transform((values) => values.flatMap((value) => value.split(',')))
    .pipe(z.array(productIdSchema).min(1, 'at least one productId is required'))
    .transform((ids) => [...new Set(ids)])
    .pipe(z.array(z.string()).max(100, 'too many productIds (max 100)')),
});

/** One applicable interaction — the widget renders one warning card per entry. */
export const apiInteractionSchema = z.object({
  interactionId: z.string(),
  texts: z.array(z.string()),
  involvedProductIds: z.array(z.string()),
  involvedIngredientIds: z.array(z.string()),
});

/**
 * `meta.requestedProductIds` is the basket as this service evaluated it —
 * deduplicated and in first-seen order — so a client can tell which of its ids
 * were actually considered, and `unknownProductIds` is a subset of it.
 */
export const interactionsResponseBodySchema = z.object({
  interactions: z.array(apiInteractionSchema),
  meta: z.object({
    requestedProductIds: z.array(z.string()),
    unknownProductIds: z.array(z.string()),
  }),
});

/** Error body shape shared by 400/500/502 responses. */
export const errorResponseBodySchema = z.object({
  error: z.object({
    code: z.enum(['INVALID_REQUEST', 'UPSTREAM_UNAVAILABLE', 'INTERNAL_ERROR']),
    message: z.string(),
    requestId: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

export type InteractionsQuery = z.infer<typeof interactionsQuerySchema>;
export type ApiInteraction = z.infer<typeof apiInteractionSchema>;
export type InteractionsResponseBody = z.infer<typeof interactionsResponseBodySchema>;
export type ErrorResponseBody = z.infer<typeof errorResponseBodySchema>;
