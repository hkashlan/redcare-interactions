/**
 * GET /api/interactions?productIds=a,b
 *
 * Validate the basket, read the ingredients and the interaction catalog from
 * the mock service (cached), match them with the pure domain rule, and answer
 * with render-ready warnings.
 *
 * Error policy:
 * - invalid input       -> 400
 * - unknown product id  -> partial success (200), id listed in meta
 * - upstream unusable   -> 502, fail closed
 * - anything else       -> 500
 *
 * Failing closed matters here: answering "no interactions" when we could not
 * read the data would suppress a medical warning.
 */

import { defineHandler } from 'nitro';
import { z } from 'zod';
import { readBasket, readCatalog, UpstreamError } from '../../client/mock-service';
import { matchInteractions } from '../../domain/match-interactions';
import { errorResponse, json, requestIdFrom } from '../../util/http';
import { logger } from '../../util/logger';

const productIdSchema = z
  .string()
  .trim()
  .min(1, 'productId must not be empty')
  .max(64, 'productId too long');

/**
 * Query: ?productIds=04114918,10019621 — comma-separated and deduplicated.
 *
 * Every occurrence of the parameter is read, because clients also serialize
 * lists by repeating it (?productIds=a&productIds=b); taking only the first
 * would silently evaluate half a basket. The 100-id cap applies after
 * deduplication, so a repeated id costs a client nothing.
 */
const productIdsSchema = z
  .array(z.string())
  .min(1, 'productIds query parameter is required')
  .transform((values) => values.flatMap((value) => value.split(',')))
  .pipe(z.array(productIdSchema).min(1, 'at least one productId is required'))
  .transform((ids) => [...new Set(ids)])
  .refine((ids) => ids.length <= 100, 'too many productIds (max 100)');

export default defineHandler(async (event) => {
  const requestId = requestIdFrom(event.req);
  const startedAt = performance.now();

  const query = productIdsSchema.safeParse(
    new URL(event.req.url).searchParams.getAll('productIds'),
  );
  if (!query.success) {
    // The schema parses the raw parameter list, so paths are re-rooted for the
    // client: `productIds` for the list itself, `productIds.0` for one bad id.
    const issues = query.error.issues.map((issue) => ({
      path: ['productIds', ...issue.path].join('.'),
      message: issue.message,
    }));
    logger.warn('invalid request rejected', { requestId, issues });
    return errorResponse(400, 'INVALID_REQUEST', 'Invalid request', requestId, issues);
  }

  const productIds = query.data;

  logger.debug('interactions request accepted', { requestId, productCount: productIds.length });

  try {
    // The catalog and the basket are independent reads, so fan out at once.
    const [catalog, basket] = await Promise.all([readCatalog(), readBasket(productIds)]);
    // Only /ingredients can legitimately 404; a missing catalog is a broken upstream.
    if (!catalog) {
      logger.error('interaction catalog missing upstream', { requestId });
      throw new UpstreamError('Mock service has no interaction catalog');
    }

    const interactions = matchInteractions(catalog.interactions, basket.known);

    logger.info('interactions request served', {
      requestId,
      productCount: productIds.length,
      interactionCount: interactions.length,
      unknownCount: basket.unknownProductIds.length,
      durationMs: Math.round(performance.now() - startedAt),
    });

    return json(
      200,
      {
        interactions,
        meta: { requestedProductIds: productIds, unknownProductIds: basket.unknownProductIds },
      },
      requestId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Math.round(performance.now() - startedAt);

    if (error instanceof UpstreamError) {
      // The read site already logged what went wrong upstream; this line records
      // the decision taken because of it — a 502 instead of an empty warning list.
      logger.error('upstream unavailable, failing closed', {
        requestId,
        productCount: productIds.length,
        error: message,
        cause: error.cause instanceof Error ? error.cause.message : undefined,
        durationMs,
      });
      return errorResponse(
        502,
        'UPSTREAM_UNAVAILABLE',
        'Interaction data is temporarily unavailable. Please retry.',
        requestId,
      );
    }

    // Nothing below is expected to happen, so keep the stack: this is the only
    // record of a bug in the handler or the domain rule.
    logger.error('unexpected error', {
      requestId,
      productCount: productIds.length,
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
      durationMs,
    });
    return errorResponse(500, 'INTERNAL_ERROR', 'Unexpected error', requestId);
  }
});
