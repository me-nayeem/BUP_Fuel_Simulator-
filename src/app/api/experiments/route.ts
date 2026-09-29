import { z } from 'zod';
import { config } from '@/lib/config';
import {
  currentJob,
  SCENARIOS,
  startExperiments,
  storedResults,
  STRATEGIES,
} from '@/lib/experiments/runner';
import { withApiMetrics } from '@/lib/observability/http';

export const dynamic = 'force-dynamic';

const StartSchema = z.object({
  ticks: z.number().int().min(24).max(384).default(192),
  decisionEveryTicks: z.number().int().min(1).max(8).default(4),
});

export const GET = withApiMetrics('/api/experiments', async () => {
  const job = currentJob();
  const results = job?.results.length ? job.results : await storedResults();
  return Response.json(
    { job, results, strategies: STRATEGIES, scenarios: SCENARIOS },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

export const POST = withApiMetrics('/api/experiments', async (request: Request) => {
  if (!config.ENABLE_SCENARIO_CONTROLS) {
    return Response.json(
      { error: { code: 'DISABLED', message: 'Experiments need ENABLE_SCENARIO_CONTROLS=true.' } },
      { status: 403 },
    );
  }
  const parsed = StartSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'INVALID_INPUT', message: z.prettifyError(parsed.error) } },
      { status: 400 },
    );
  }
  return Response.json(
    { job: startExperiments(parsed.data.ticks, parsed.data.decisionEveryTicks) },
    { status: 202 },
  );
});
