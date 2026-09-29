import { z } from 'zod';
import { approve, reject } from '@/lib/engine/engine';
import { withApiMetrics } from '@/lib/observability/http';

export const dynamic = 'force-dynamic';

const DecisionSchema = z.object({
  recommendationId: z.string().min(1).max(200),
  action: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().max(500).optional(),
});

export const POST = withApiMetrics('/api/decisions', async (request: Request) => {
  const parsed = DecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'INVALID_INPUT', message: z.prettifyError(parsed.error) } },
      { status: 400 },
    );
  }
  const { recommendationId, action, reason } = parsed.data;
  const result =
    action === 'APPROVE'
      ? await approve(recommendationId)
      : reject(recommendationId, 'operator', reason);
  const status = result.ok ? 200 : result.error?.code === 'NOT_FOUND' ? 404 : 409;
  return Response.json(result, { status });
});
