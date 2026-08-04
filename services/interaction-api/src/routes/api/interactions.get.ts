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

import { defineHandler, defineRouteMeta } from 'nitro';
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


const { $schema: _, ...productIdsParamSchema } = z.toJSONSchema(
  z.array(productIdSchema).min(1).max(100),
);

const routeMeta = defineRouteMeta({
  openAPI: {
    operationId: 'getInteractions',
    tags: ['interactions'],
    summary: 'List interactions for a basket of products',
    description:
      'Returns every interaction whose required ingredients are all present in the basket. Unknown product ids are skipped and reported in `meta.unknownProductIds` alongside a 200; an unreadable upstream answers 502 rather than an empty list, because reporting "no interactions" would suppress a medical warning.',
    parameters: [
      {
        in: 'query',
        name: 'productIds',
        required: true,
        description:
          'Product ids to evaluate, comma-separated. Repeating the parameter (`?productIds=a&productIds=b`) works too and is merged with the comma-separated form; ids are deduplicated before the 100-id cap applies.',
        // `form` + `explode: false` is the comma-separated spelling; the repeated
        // spelling cannot be expressed at the same time, hence the description.
        style: 'form',
        explode: false,
        schema: productIdsParamSchema,
        example: '04114918,10019621',
      },
    ],
    responses: {
      200: {
        description:
          'Interactions that apply to the basket. An empty `interactions` array means the basket was read successfully and nothing matched.',
      },
      400: {
        description: 'The `productIds` parameter is missing, empty, malformed or over the cap.',
      },
      502: {
        description: 'Interaction data could not be read upstream; failing closed, safe to retry.',
      },
      500: { description: 'Unexpected error in the service itself.' },
    },
  },
});

const handler = defineHandler(async (event) => {
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

// `?meta` collapses to this module's default export (see routeMeta above), so
// the OpenAPI operation rides on the handler itself.
export default Object.assign(handler, routeMeta);
