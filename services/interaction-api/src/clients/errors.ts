/**
 * Error taxonomy for the mock-service client.
 *
 * The distinction matters for the API's error policy:
 * - ProductNotFoundError (upstream 404) is a data fact: the product does not
 *   exist. The API degrades to partial success and reports the id as unknown.
 * - UpstreamError (5xx, timeout, network failure, malformed body) means we
 *   cannot know the ingredients. The API fails closed (502) rather than
 *   risk suppressing an interaction warning.
 */

export class ProductNotFoundError extends Error {
  readonly productId: string;

  constructor(productId: string) {
    super(`Product not found: ${productId}`);
    this.name = 'ProductNotFoundError';
    this.productId = productId;
  }
}

export class UpstreamError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'UpstreamError';
    this.cause = cause;
  }
}
