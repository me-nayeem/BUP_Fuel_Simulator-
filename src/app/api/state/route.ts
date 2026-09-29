import { withApiMetrics } from '@/lib/observability/http';
import { getWorldStore } from '@/lib/world/snapshot';

export const dynamic = 'force-dynamic';

const MAX_AGE_MS = 1000;

export const GET = withApiMetrics('/api/state', async () => {
  const envelope = await getWorldStore().get(MAX_AGE_MS);
  // Serve last-known-good with 200 and explicit freshness; 503 only when nothing was ever fetched.
  const status = envelope.world ? 200 : 503;
  return Response.json(envelope, { status, headers: { 'Cache-Control': 'no-store' } });
});
