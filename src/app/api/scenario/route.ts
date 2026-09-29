import { z } from 'zod';
import { config } from '@/lib/config';
import { clearPlannerFault, injectPlannerFault } from '@/lib/engine/engine';
import { withApiMetrics } from '@/lib/observability/http';
import { logger } from '@/lib/observability/logger';
import { getSimulatorClient } from '@/lib/simulator/client';
import { EventInjectionSchema, FaultInjectionSchema } from '@/lib/simulator/types';
import { getWorldStore } from '@/lib/world/snapshot';

export const dynamic = 'force-dynamic';

const ScenarioSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('step'), steps: z.number().int().min(1).max(96).default(1) }),
  z.object({ action: z.literal('run') }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('reset') }),
  z.object({ action: z.literal('clearFaults') }),
  z.object({ action: z.literal('event'), event: EventInjectionSchema }),
  z.object({ action: z.literal('fault'), fault: FaultInjectionSchema }),
  z.object({
    action: z.literal('plannerFault'),
    seconds: z.number().int().min(5).max(600).default(60),
  }),
  z.object({ action: z.literal('clearPlannerFault') }),
]);

export const GET = withApiMetrics('/api/scenario', async () => {
  return Response.json({ enabled: config.ENABLE_SCENARIO_CONTROLS });
});

export const POST = withApiMetrics('/api/scenario', async (request: Request) => {
  if (!config.ENABLE_SCENARIO_CONTROLS) {
    return Response.json(
      {
        error: {
          code: 'DISABLED',
          message: 'Scenario controls are disabled (ENABLE_SCENARIO_CONTROLS).',
        },
      },
      { status: 403 },
    );
  }
  const parsed = ScenarioSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'INVALID_INPUT', message: z.prettifyError(parsed.error) } },
      { status: 400 },
    );
  }

  const client = getSimulatorClient();
  const input = parsed.data;
  try {
    let message = '';
    if (input.action === 'step') {
      let tick = 0;
      for (let i = 0; i < input.steps; i += 1) tick = (await client.step()).data.tick;
      message = `Advanced ${input.steps} tick${input.steps > 1 ? 's' : ''} to tick ${tick}.`;
    } else if (input.action === 'run') {
      await client.run();
      message = 'Simulation running.';
    } else if (input.action === 'pause') {
      await client.pause();
      message = 'Simulation paused.';
    } else if (input.action === 'reset') {
      await client.reset();
      message = 'Simulation reset to tick 0.';
    } else if (input.action === 'clearFaults') {
      await client.clearFaults();
      message = 'All faults cleared.';
    } else if (input.action === 'plannerFault') {
      injectPlannerFault(input.seconds);
      message = `Main planner disabled for ${input.seconds} s. The fallback planner takes over.`;
    } else if (input.action === 'clearPlannerFault') {
      clearPlannerFault();
      message = 'Main planner restored.';
    } else if (input.action === 'event') {
      await client.injectEvent(input.event);
      message = `Injected ${input.event.type.replaceAll('_', ' ')} from tick ${input.event.start_tick}.`;
    } else {
      await client.injectFault(input.fault);
      message = `Injected ${input.fault.type.replaceAll('_', ' ')} fault for ${input.fault.duration_seconds} s.`;
    }
    logger.info('scenario.action', { action: input.action, message });
    await getWorldStore().refresh();
    return Response.json({ ok: true, message });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('scenario.failed', { action: input.action, error: message });
    return Response.json(
      { ok: false, error: { code: 'SIMULATOR_ERROR', message } },
      { status: 502 },
    );
  }
});
