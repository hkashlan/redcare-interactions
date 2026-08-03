import type { ErrorResponseBody } from '../schemas';

/** Small helpers shared by the route handlers. */

/**
 * A caller-supplied request id is echoed into headers, error bodies and logs,
 * so it is only honoured when it is short and boring; anything else gets a
 * fresh id rather than letting a client shape our log lines.
 */
const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/;

export function requestIdFrom(request: Request): string {
  const supplied = request.headers.get('x-request-id');
  return supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
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
