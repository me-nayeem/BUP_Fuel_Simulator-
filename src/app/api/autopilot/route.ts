import { z } from 'zod';
import { engineStatus, setMode } from '@/lib/engine/engine';
import { withApiMetrics } from '@/lib/observability/http';

export const dynamic = 'force-dynamic';

const ModeSchema = z.object({ mode: z.enum(['MANUAL', 'ASSISTED', 'AUTO']) });

export const GET = withApiMetrics('/api/autopilot', async () => {
  return Response.json({ mode: engineStatus().mode });
});

export const PUT = withApiMetrics('/api/autopilot', async (request: Request) => {
  const parsed = ModeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'INVALID_INPUT', message: 'mode must be MANUAL, ASSISTED or AUTO' } },
      { status: 400 },
    );
  }
  setMode(parsed.data.mode);
  return Response.json({ mode: engineStatus().mode });
});
