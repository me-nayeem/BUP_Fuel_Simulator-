import { setLoopPaused, trigger, waitForLoopIdle } from '@/lib/engine/loop';
import { buildFallbackPlan } from '@/lib/intelligence/baseline';
import { buildPlan, type Plan } from '@/lib/intelligence/planner';
import { logger } from '@/lib/observability/logger';
import { getPrisma } from '@/lib/prisma';
import { getSimulatorClient } from '@/lib/simulator/client';
import type { EventInjection } from '@/lib/simulator/types';
import { fetchWorld, getWorldStore, type WorldState } from '@/lib/world/snapshot';

export type Strategy = 'none' | 'naive' | 'planner';
export type ScenarioName = 'normal' | 'crisis' | 'severe';

export const STRATEGIES: { id: Strategy; label: string; description: string }[] = [
  { id: 'none', label: 'No action', description: 'Nobody ships fuel to stations.' },
  {
    id: 'naive',
    label: 'Threshold rule',
    description: 'Refill to 80% when stock drops below 35%, shortest available route.',
  },
  {
    id: 'planner',
    label: 'Our planner',
    description: 'Hour-aware forecast, risk ranking, shared depot budgets, event look-ahead.',
  },
];

export const SCENARIOS: { id: ScenarioName; label: string; description: string }[] = [
  { id: 'normal', label: 'Normal operations', description: 'Default scenario, no crisis events.' },
  {
    id: 'crisis',
    label: 'Combined crisis',
    description:
      'Dhaka demand ×1.8 (ticks 40–72), Gazipur→Mirpur route disrupted (50–74), Gazipur supply 8 ticks late and Patiya diesel supply halved (60).',
  },
  {
    id: 'severe',
    label: 'Severe crisis',
    description:
      'Demand ×2 everywhere (ticks 30–90), Gazipur→Tongi and Patiya→Karnaphuli disrupted (40–70), Gazipur constrained, all supply halved (60).',
  },
];

const SEVERE_EVENTS: EventInjection[] = [
  { type: 'demand_spike', start_tick: 30, duration_ticks: 60, parameters: { multiplier: 2 } },
  {
    type: 'route_disruption',
    start_tick: 40,
    duration_ticks: 30,
    parameters: { route_ids: ['route-gazipur-tongi', 'route-patiya-karnaphuli'] },
  },
  {
    type: 'depot_constraint',
    start_tick: 40,
    duration_ticks: 40,
    parameters: { depot_ids: ['depot-gazipur'] },
  },
  { type: 'supply_shortfall', start_tick: 60, duration_ticks: 1, parameters: { factor: 0.5 } },
];

const CRISIS_EVENTS: EventInjection[] = [
  {
    type: 'demand_spike',
    start_tick: 40,
    duration_ticks: 32,
    parameters: { region_ids: ['region-dhaka'], multiplier: 1.8 },
  },
  {
    type: 'route_disruption',
    start_tick: 50,
    duration_ticks: 24,
    parameters: { route_ids: ['route-gazipur-mirpur'] },
  },
  {
    type: 'shipment_delay',
    start_tick: 60,
    duration_ticks: 1,
    parameters: { depot_ids: ['depot-gazipur'], delay_ticks: 8 },
  },
  {
    type: 'supply_shortfall',
    start_tick: 60,
    duration_ticks: 1,
    parameters: { depot_ids: ['depot-patiya'], fuel_types: ['DIESEL'], factor: 0.5 },
  },
];

export interface RunResult {
  strategy: Strategy;
  scenario: ScenarioName;
  ticks: number;
  decisionEveryTicks: number;
  seed: number;
  serviceLevel: number;
  servedLiters: number;
  unmetLiters: number;
  shippedLiters: number;
  allocationFailures: number;
  shipmentsSent: number;
  shipmentsRejected: number;
  stockoutTicks: number;
  durationMs: number;
}

export interface ExperimentJob {
  id: string;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  ticks: number;
  decisionEveryTicks: number;
  startedAt: string;
  finishedAt: string | null;
  progress: { done: number; total: number; current: string | null };
  results: RunResult[];
  error: string | null;
}

const globalForExperiments = globalThis as unknown as { __experimentJob?: ExperimentJob | null };

export function currentJob(): ExperimentJob | null {
  return globalForExperiments.__experimentJob ?? null;
}

function planWith(strategy: Strategy, world: WorldState): Plan | null {
  if (strategy === 'planner') return buildPlan(world);
  if (strategy === 'naive') return buildFallbackPlan(world);
  return null;
}

async function runOne(
  job: ExperimentJob,
  strategy: Strategy,
  scenario: ScenarioName,
): Promise<RunResult> {
  const client = getSimulatorClient();
  const started = Date.now();
  await client.pause();
  await client.reset();
  const events = scenario === 'crisis' ? CRISIS_EVENTS : scenario === 'severe' ? SEVERE_EVENTS : [];
  for (const event of events) await client.injectEvent(event);

  let shipmentsSent = 0;
  let shipmentsRejected = 0;
  let stockoutTicks = 0;
  let seed = 0;

  for (let tick = 0; tick < job.ticks; tick += 1) {
    if (strategy !== 'none' && tick % job.decisionEveryTicks === 0) {
      const { world } = await fetchWorld(client);
      seed = world.seed;
      const plan = planWith(strategy, world);
      for (const rec of plan?.recommendations ?? []) {
        if (rec.action !== 'SHIP' || !rec.shipment) continue;
        try {
          await client.createAllocation({
            idempotency_key: `exp-${job.id}-${strategy}-${scenario}-${rec.id}`,
            source_depot_id: rec.shipment.depotId,
            destination_station_id: rec.stationId,
            route_id: rec.shipment.routeId,
            fuel_type: rec.fuel,
            quantity: rec.shipment.quantity,
          });
          shipmentsSent += 1;
        } catch {
          shipmentsRejected += 1;
        }
      }
    }
    await client.step();
  }

  const [metrics, instance] = await Promise.all([client.metrics(), client.instance()]);
  seed = instance.data.seed;
  for (const station of [
    'station-mirpur',
    'station-tongi',
    'station-karnaphuli',
    'station-coxsbazar',
  ]) {
    const rows = await client.demandHistory({ stationId: station, limit: 2000 });
    stockoutTicks += rows.data.filter((r) => r.unmet_liters > 0).length;
  }

  return {
    strategy,
    scenario,
    ticks: job.ticks,
    decisionEveryTicks: job.decisionEveryTicks,
    seed,
    serviceLevel: metrics.data.service_level,
    servedLiters: metrics.data.served_demand_liters,
    unmetLiters: metrics.data.unmet_demand_liters,
    shippedLiters: metrics.data.allocation_liters,
    allocationFailures: metrics.data.allocation_failures,
    shipmentsSent,
    shipmentsRejected,
    stockoutTicks,
    durationMs: Date.now() - started,
  };
}

async function persist(result: RunResult) {
  const prisma = getPrisma();
  if (!prisma) return;
  try {
    await prisma.experiment.create({
      data: {
        strategy: result.strategy,
        scenario: result.scenario,
        ticks: result.ticks,
        seed: result.seed,
        results: { ...result },
      },
    });
  } catch (error) {
    logger.warn('db.write_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function startExperiments(ticks: number, decisionEveryTicks: number): ExperimentJob {
  const running = currentJob();
  if (running?.status === 'RUNNING') return running;

  const job: ExperimentJob = {
    id: Date.now().toString(36),
    status: 'RUNNING',
    ticks,
    decisionEveryTicks,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: { done: 0, total: SCENARIOS.length * STRATEGIES.length, current: null },
    results: [],
    error: null,
  };
  globalForExperiments.__experimentJob = job;

  void (async () => {
    setLoopPaused(true);
    await waitForLoopIdle();
    logger.info('experiment.started', { id: job.id, ticks });
    try {
      for (const scenario of SCENARIOS) {
        for (const strategy of STRATEGIES) {
          job.progress.current = `${strategy.label} · ${scenario.label}`;
          const result = await runOne(job, strategy.id, scenario.id);
          job.results.push(result);
          job.progress.done += 1;
          await persist(result);
          logger.info('experiment.run_finished', {
            strategy: strategy.id,
            scenario: scenario.id,
            serviceLevel: Math.round(result.serviceLevel * 10000) / 100,
          });
        }
      }
      job.status = 'DONE';
    } catch (error) {
      job.status = 'FAILED';
      job.error = error instanceof Error ? error.message : String(error);
      logger.error('experiment.failed', { error: job.error });
    } finally {
      job.progress.current = null;
      job.finishedAt = new Date().toISOString();
      try {
        const client = getSimulatorClient();
        await client.pause();
        await client.reset();
      } catch {}
      setLoopPaused(false);
      await getWorldStore().refresh();
      trigger();
    }
  })();

  return job;
}

export async function storedResults(): Promise<RunResult[]> {
  const prisma = getPrisma();
  if (!prisma) return [];
  try {
    const rows = await prisma.experiment.findMany({ orderBy: { createdAt: 'desc' }, take: 60 });
    const latest = new Map<string, RunResult>();
    for (const row of rows) {
      const key = `${row.strategy}:${row.scenario}`;
      if ((row.results as { decisionEveryTicks?: number }).decisionEveryTicks === undefined)
        continue;
      if (!latest.has(key)) latest.set(key, row.results as unknown as RunResult);
    }
    return [...latest.values()];
  } catch {
    return [];
  }
}
