import { createMockServiceClient } from '../clients/mock-service';
import { getConfig } from '../config';
import { logger } from '../logger';
import { createInteractionsHandler } from './handlers/interactions';
import { createInteractionService } from './interaction-service';

/**
 * Composition root: builds the config → client → service → handler chain once
 * per process. Kept lazy so config is read at first request, not import time.
 */

let interactionsHandler: ((request: Request) => Promise<Response>) | undefined;

export function getInteractionsHandler(): (request: Request) => Promise<Response> {
  if (!interactionsHandler) {
    const config = getConfig();
    // Nested under `config` so a key can never shadow the log envelope.
    logger.info('configuration resolved, handler ready', { config });
    const client = createMockServiceClient({
      baseUrl: config.mockServiceUrl,
      timeoutMs: config.upstreamTimeoutMs,
    });
    const service = createInteractionService(client, {
      catalogTtlMs: config.catalogTtlMs,
      productTtlMs: config.productTtlMs,
    });
    interactionsHandler = createInteractionsHandler(service);
  }
  return interactionsHandler;
}
