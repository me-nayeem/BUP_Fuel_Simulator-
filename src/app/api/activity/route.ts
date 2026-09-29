import { withApiMetrics } from '@/lib/observability/http';
import { recentLogs } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';

export const GET = withApiMetrics('/api/activity', async (request: Request) => {
  const limit = Math.min(
    200,
    Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 50),
  );
  return Response.json(
    { entries: recentLogs(limit) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
