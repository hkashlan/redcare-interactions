import { UpstreamError } from '../../clients/errors';
import type { InteractionService } from '../interaction-service.dto';
import { logger } from '../logger';
import type { InteractionsResponseBody } from '../schemas';
import { interactionsQuerySchema } from '../schemas';
import { errorResponse, jsonResponse, requestIdFrom } from './http';

/**
 * GET /api/interactions?productIds=a,b
 *
 * A plain (Request) => Response function so it is testable without a server.
 * Error policy: invalid input → 400; unknown products →
 * partial success (200); upstream failure → 502 fail closed; the rest → 500.
 */
export function createInteractionsHandler(service: InteractionService) {
  return async function handleGetInteractions(request: Request): Promise<Response> {
    const requestId = requestIdFrom(request);
    const startedAt = performance.now();

    const query = parseQuery(request);
    if (!query.success) {
      return errorResponse(400, 'INVALID_REQUEST', 'Invalid request', requestId, query.issues);
    }

    try {
      const result = await service.getInteractionsForProducts(query.productIds);

      const body: InteractionsResponseBody = {
        products: result.products,
        interactions: result.interactions,
        meta: {
          requestedProductIds: query.productIds,
          unknownProductIds: result.unknownProductIds,
        },
      };

      logger.info('interactions request served', {
        requestId,
        productCount: query.productIds.length,
        interactionCount: result.interactions.length,
        unknownCount: result.unknownProductIds.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return jsonResponse(200, body, requestId);
    } catch (error) {
      if (error instanceof UpstreamError) {
        logger.error('upstream unavailable, failing closed', {
          requestId,
          error: error.message,
        });
        return errorResponse(
          502,
          'UPSTREAM_UNAVAILABLE',
          'Interaction data is temporarily unavailable. Please retry.',
          requestId,
        );
      }

      logger.error('unexpected error', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return errorResponse(500, 'INTERNAL_ERROR', 'Unexpected error', requestId);
    }
  };
}

type ParsedQuery =
  | { success: true; productIds: string[] }
  | { success: false; issues: { path: string; message: string }[] };

function parseQuery(request: Request): ParsedQuery {
  const url = new URL(request.url);
  const parsed = interactionsQuerySchema.safeParse({
    productIds: url.searchParams.get('productIds') ?? undefined,
  });

  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'productIds',
        message: issue.message,
      })),
    };
  }
  return { success: true, productIds: parsed.data.productIds };
}
