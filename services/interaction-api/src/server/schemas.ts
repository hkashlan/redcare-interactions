import { z } from 'zod';

/**
 * The public contract of GET /api/interactions.
 *
 * Design (see docs/plan.md, Phase 3):
 * - Interaction-centric response: one entry per applicable interaction, so the
 *   widget renders one warning card per entry without further joins.
 * - Product names are inlined (`products`), so the widget needs no extra calls.
 * - Unknown product ids degrade to partial success: they appear with
 *   status "unknown" and in `meta.unknownProductIds`, while warnings for the
 *   rest of the basket are still returned.
 */

const productIdSchema = z
  .string()
  .trim()
  .min(1, 'productId must not be empty')
  .max(64, 'productId too long');

/** Query: ?productIds=04114918,10019621 — comma-separated, deduplicated. */
export const interactionsQuerySchema = z.object({
  productIds: z
    .string({ error: 'productIds query parameter is required' })
    .transform((value) => value.split(','))
    .pipe(
      z
        .array(productIdSchema)
        .min(1, 'at least one productId is required')
        .max(100, 'too many productIds (max 100)'),
    )
    .transform((ids) => [...new Set(ids)]),
});

export const apiProductSchema = z.discriminatedUnion('status', [
  z.object({
    productId: z.string(),
    status: z.literal('resolved'),
    name: z.string(),
  }),
  z.object({
    productId: z.string(),
    status: z.literal('unknown'),
  }),
]);

export const apiInteractionSchema = z.object({
  interactionId: z.string(),
  texts: z.array(z.string()),
  involvedProductIds: z.array(z.string()),
  involvedIngredientIds: z.array(z.string()),
});

export const interactionsResponseBodySchema = z.object({
  products: z.array(apiProductSchema),
  interactions: z.array(apiInteractionSchema),
  meta: z.object({
    requestedProductIds: z.array(z.string()),
    unknownProductIds: z.array(z.string()),
  }),
});

/** Error body shape shared by 400/502 responses. */
export const errorResponseBodySchema = z.object({
  error: z.object({
    code: z.enum(['INVALID_REQUEST', 'UPSTREAM_UNAVAILABLE']),
    message: z.string(),
    requestId: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

export type InteractionsQuery = z.infer<typeof interactionsQuerySchema>;
export type ApiProduct = z.infer<typeof apiProductSchema>;
export type ApiInteraction = z.infer<typeof apiInteractionSchema>;
export type InteractionsResponseBody = z.infer<typeof interactionsResponseBodySchema>;
export type ErrorResponseBody = z.infer<typeof errorResponseBodySchema>;
