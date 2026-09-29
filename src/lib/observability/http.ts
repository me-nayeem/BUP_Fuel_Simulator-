import { logger } from './logger';
import { metrics } from './metrics';

/** Wraps a route handler with latency/error metrics and a safe JSON 500. */
export function withApiMetrics<Args extends unknown[]>(
  route: string,
  handler: (request: Request, ...args: Args) => Promise<Response>,
) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    const started = performance.now();
    let status = 500;
    try {
      const response = await handler(request, ...args);
      status = response.status;
      return response;
    } catch (error) {
      logger.error('api.unhandled_error', {
        route,
        error: error instanceof Error ? error.message : String(error),
      });
      return Response.json(
        { error: { code: 'INTERNAL', message: 'Internal server error' } },
        { status: 500 },
      );
    } finally {
      metrics.observe('http_request_duration_ms', performance.now() - started, { route });
      metrics.inc('http_requests_total', { route, status });
    }
  };
}
