import { withApiMetrics } from '@/lib/observability/http';
import { metrics } from '@/lib/observability/metrics';

export const dynamic = 'force-dynamic';

// Prometheus text exposition format.
export const GET = withApiMetrics('/api/metrics', async () => {
  return new Response(metrics.toPrometheus(), {
    headers: { 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'no-store' },
  });
});
