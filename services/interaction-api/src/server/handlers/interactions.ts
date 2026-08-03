import type { ZodError } from 'zod';
import { UpstreamError } from '../../clients/errors';
import { logger } from '../../logger';
import type { InteractionService } from '../interaction-service.dto';
import type { InteractionsResponseBody } from '../schemas';
import { interactionsQuerySchema } from '../schemas';
import { errorResponse, jsonResponse, requestIdFrom } from './http';

/** Binds the service to the handler, so route files stay dependency-free. */
export function createInteractionsHandler(service: InteractionService) {
  return (request: Request) => handleGetInteractions(service, request);
}

/**
 * GET /api/interactions?productIds=a,b
 *
 * A plain (Request) => Response function so it is testable without a server.
 * Error policy: invalid input → 400; unknown products →
 * partial success (200); upstream failure → 502 fail closed; the rest → 500.
 */
async function handleGetInteractions(
  service: InteractionService,
  request: Request,
): Promise<Response> {
  const requestId = requestIdFrom(request);
  const startedAt = performance.now();

  const query = parseQuery(request);
  if (!query.success) {
    const issues = toIssues(query.error);
    logger.warn('invalid request rejected', { requestId, issues });
    return errorResponse(400, 'INVALID_REQUEST', 'Invalid request', requestId, issues);
  }
  const { productIds } = query.data;

  try {
    const result = await service.getInteractionsForProducts(productIds);

    logger.info('interactions request served', {
      requestId,
      productCount: productIds.length,
      interactionCount: result.interactions.length,
      unknownCount: result.unknownProductIds.length,
      durationMs: Math.round(performance.now() - startedAt),
    });

    const body: InteractionsResponseBody = {
      interactions: result.interactions,
      meta: { requestedProductIds: productIds, unknownProductIds: result.unknownProductIds },
    };
    return jsonResponse(200, body, requestId);
  } catch (error) {
    return failureResponse(error, requestId);
  }
}

/** Fail closed: an unusable upstream must never look like "no interactions". */
function failureResponse(error: unknown, requestId: string): Response {
  if (error instanceof UpstreamError) {
    logger.error('upstream unavailable, failing closed', { requestId, error: error.message });
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

function parseQuery(request: Request) {
  const productIds = new URL(request.url).searchParams.getAll('productIds');
  return interactionsQuerySchema.safeParse({ productIds });
}

function toIssues(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'productIds',
    message: issue.message,
  }));
}
