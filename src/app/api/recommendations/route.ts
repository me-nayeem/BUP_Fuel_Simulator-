import { engineStatus, planFor } from '@/lib/engine/engine';
import { withApiMetrics } from '@/lib/observability/http';
import { getWorldStore } from '@/lib/world/snapshot';

export const dynamic = 'force-dynamic';

export const GET = withApiMetrics('/api/recommendations', async () => {
  const envelope = await getWorldStore().get(1000);
  const plan = planFor(envelope);
  const { mode, error, fallbackActive, decisions } = engineStatus();
  return Response.json(
    {
      plan,
      mode,
      engineError: error,
      fallbackActive,
      decisions: decisions.slice(0, 30),
      freshness: envelope.freshness,
    },
    { status: plan ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
});
