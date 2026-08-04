/** Request-id handling and JSON response building — nothing endpoint-specific. */

/**
 * A caller-supplied request id is echoed into headers, bodies and logs, so it
 * is only honoured when it is short and boring; anything else gets a fresh id
 * rather than letting a client shape our log lines.
 */
const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/;

export function requestIdFrom(request: Request): string {
  const supplied = request.headers.get('x-request-id');
  return supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
}

export function json(status: number, body: unknown, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': requestId },
  });
}

export type ErrorCode = 'INVALID_REQUEST' | 'UPSTREAM_UNAVAILABLE' | 'INTERNAL_ERROR';

export interface Issue {
  path: string;
  message: string;
}

/** Every error response shares this body: `{ error: { code, message, requestId, issues? } }`. */
export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  requestId: string,
  issues?: Issue[],
): Response {
  return json(status, { error: { code, message, requestId, issues } }, requestId);
}
