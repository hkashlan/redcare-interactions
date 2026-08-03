import type { z } from 'zod';
import { ProductNotFoundError, UpstreamError } from './errors';
import {
  type IngredientsResponse,
  type InteractionCatalogEntry,
  ingredientsResponseSchema,
  interactionsResponseSchema,
  type ProductResponse,
  productResponseSchema,
} from './schemas';

export interface MockServiceClient {
  getProduct(productId: string): Promise<ProductResponse>;
  getIngredients(productId: string): Promise<IngredientsResponse>;
  getInteractions(): Promise<InteractionCatalogEntry[]>;
}

export interface MockServiceClientOptions {
  baseUrl: string;
  timeoutMs: number;
}

export function createMockServiceClient(options: MockServiceClientOptions): MockServiceClient {
  const { baseUrl, timeoutMs } = options;

  async function request<Schema extends z.ZodType>(
    path: string,
    schema: Schema,
    notFound?: () => Error,
  ): Promise<z.infer<Schema>> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new UpstreamError(`Request to mock service failed: GET ${path}`, cause);
    }

    if (response.status === 404 && notFound) {
      throw notFound();
    }
    if (!response.ok) {
      throw new UpstreamError(`Mock service responded ${response.status} for GET ${path}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new UpstreamError(`Mock service returned invalid JSON for GET ${path}`, cause);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new UpstreamError(
        `Mock service response did not match the expected contract for GET ${path}`,
        parsed.error,
      );
    }
    return parsed.data;
  }

  return {
    getProduct(productId) {
      const query = new URLSearchParams({ productId });
      return request(
        `/product?${query}`,
        productResponseSchema,
        () => new ProductNotFoundError(productId),
      );
    },

    getIngredients(productId) {
      const query = new URLSearchParams({ productId });
      return request(
        `/ingredients?${query}`,
        ingredientsResponseSchema,
        () => new ProductNotFoundError(productId),
      );
    },

    async getInteractions() {
      const body = await request('/interactions', interactionsResponseSchema);
      return body.interactions;
    },
  };
}
