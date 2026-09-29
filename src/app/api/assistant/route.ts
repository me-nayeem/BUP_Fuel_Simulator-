import { z } from 'zod';
import {
  aiStatus,
  answerQuestion,
  explainRecommendation,
  summarizeNetwork,
  type AssistantContext,
} from '@/lib/ai/assistant';
import { engineStatus, planFor } from '@/lib/engine/engine';
import { withApiMetrics } from '@/lib/observability/http';
import { recentLogs } from '@/lib/observability/logger';
import { getWorldStore } from '@/lib/world/snapshot';

export const dynamic = 'force-dynamic';

const AssistantSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('summary') }),
  z.object({ kind: z.literal('explain'), recommendationId: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('ask'), question: z.string().trim().min(3).max(500) }),
]);

export const GET = withApiMetrics('/api/assistant', async () => {
  return Response.json(aiStatus());
});

export const POST = withApiMetrics('/api/assistant', async (request: Request) => {
  const parsed = AssistantSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'INVALID_INPUT', message: z.prettifyError(parsed.error) } },
      { status: 400 },
    );
  }

  const envelope = await getWorldStore().get(2000);
  if (!envelope.world) {
    return Response.json(
      { error: { code: 'NO_DATA', message: 'No simulator data available yet.' } },
      { status: 503 },
    );
  }

  const plan = planFor(envelope);
  const context: AssistantContext = {
    world: envelope.world,
    plan,
    decisions: engineStatus().decisions,
    logs: recentLogs(40),
    healthStatus: envelope.freshness.stale ? 'DEGRADED' : 'HEALTHY',
    stale: envelope.freshness.stale,
  };

  const input = parsed.data;
  if (input.kind === 'summary') return Response.json(await summarizeNetwork(context));
  if (input.kind === 'ask') return Response.json(await answerQuestion(input.question, context));

  const rec = plan?.recommendations.find((r) => r.id === input.recommendationId);
  if (!rec) {
    return Response.json(
      { error: { code: 'NOT_FOUND', message: 'Recommendation not found or expired.' } },
      { status: 404 },
    );
  }
  return Response.json(await explainRecommendation(rec, context));
});
