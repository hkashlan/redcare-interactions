import type { ErrorResponseBody } from '../schemas';

/** Small helpers shared by the route handlers. */

export function requestIdFrom(request: Request): string {
  return request.headers.get('x-request-id') ?? crypto.randomUUID();
}

export function jsonResponse(status: number, body: unknown, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-request-id': requestId,
    },
  });
}

export function errorResponse(
  status: number,
  code: ErrorResponseBody['error']['code'],
  message: string,
  requestId: string,
  issues?: ErrorResponseBody['error']['issues'],
): Response {
  const body: ErrorResponseBody = { error: { code, message, requestId, issues } };
  return jsonResponse(status, body, requestId);
}
