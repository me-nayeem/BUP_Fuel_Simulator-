import { getHealthReport } from '@/lib/observability/health';
import { withApiMetrics } from '@/lib/observability/http';

export const dynamic = 'force-dynamic';

// Always 200 while the app can answer (liveness); `status` carries HEALTHY/DEGRADED.
export const GET = withApiMetrics('/api/health', async () => {
  return Response.json(await getHealthReport(), { headers: { 'Cache-Control': 'no-store' } });
});
