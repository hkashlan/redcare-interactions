import { jsonResponse, requestIdFrom } from './http';

/** Liveness probe: the process is up and serving requests. */
export async function handleHealth(request: Request): Promise<Response> {
  return jsonResponse(200, { status: 'ok' }, requestIdFrom(request));
}
