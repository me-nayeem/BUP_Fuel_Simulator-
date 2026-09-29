import { config } from '@/lib/config';
import { buildFallbackPlan } from '@/lib/intelligence/baseline';
import { eventAffectsStation } from '@/lib/intelligence/forecast';
import {
  buildPlan,
  routeBlockedSoon,
  type Plan,
  type Recommendation,
} from '@/lib/intelligence/planner';
import { logger } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';
import { getPrisma } from '@/lib/prisma';
import { getSimulatorClient } from '@/lib/simulator/client';
import { SimulatorError } from '@/lib/simulator/errors';
import type { WorldState } from '@/lib/world/snapshot';
import { getWorldStore, type StateEnvelope } from '@/lib/world/snapshot';

export type AutopilotMode = 'MANUAL' | 'ASSISTED' | 'AUTO';
export type DecisionAction = 'APPROVED' | 'REJECTED' | 'AUTO_EXECUTED';

export interface DecisionRecord {
  id: string;
  at: string;
  tick: number;
  recommendationId: string;
  stationId: string;
  fuel: string;
  action: DecisionAction;
  actor: string;
  quantity: number | null;
  routeId: string | null;
  riskBefore: number;
  riskAfter: number | null;
  allocationId: number | null;
  error: string | null;
}

export interface DecisionResult {
  ok: boolean;
  decision?: DecisionRecord;
  error?: { code: string; message: string };
}

interface EngineState {
  mode: AutopilotMode;
  plan: Plan | null;
  planVersion: number;
  engineError: string | null;
  fallbackActive: boolean;
  plannerFaultUntil: number;
  decisions: DecisionRecord[];
  snoozed: Map<string, number>;
  executing: Set<string>;
  cancelled: number;
}

const SNOOZE_TICKS = 4;
const DECISION_LIMIT = 100;
const UNCERTAIN_FORECAST = 0.2;

const globalForEngine = globalThis as unknown as { __fuelEngine?: EngineState };

const engine: EngineState = (globalForEngine.__fuelEngine ??= {
  mode: config.AUTOPILOT_MODE,
  plan: null,
  planVersion: -1,
  engineError: null,
  fallbackActive: false,
  plannerFaultUntil: 0,
  decisions: [],
  snoozed: new Map(),
  executing: new Set(),
  cancelled: 0,
});

function key(rec: Pick<Recommendation, 'stationId' | 'fuel'>) {
  return `${rec.stationId}:${rec.fuel}`;
}

function visible(plan: Plan): Plan {
  return {
    ...plan,
    recommendations: plan.recommendations.filter((rec) => {
      const until = engine.snoozed.get(key(rec));
      return until === undefined || plan.tick >= until;
    }),
  };
}

function reviewReason(rec: Recommendation, world: WorldState): string | null {
  if (!rec.shipment) return null;
  if (rec.engine === 'fallback') return rec.reviewReason;
  const shipment = rec.shipment;
  const depot = world.depots.find((d) => d.id === shipment.depotId);
  const station = world.stations.find((s) => s.id === rec.stationId);
  if (depot && station && depot.region_id !== station.region_id) return 'Cross-region shipment';
  if (depot?.status === 'CONSTRAINED') return 'Source depot is constrained';
  if (rec.forecastMape !== null && rec.forecastMape > UNCERTAIN_FORECAST) {
    return `Forecast is uncertain (${Math.round(rec.forecastMape * 100)}% error)`;
  }
  const stationRoutes = new Set(
    world.routes.filter((r) => r.destination_station_id === rec.stationId).map((r) => r.id),
  );
  const crisis = world.events.some((event) => {
    if (event.status !== 'ACTIVE' || !station) return false;
    if (event.type === 'demand_spike') return eventAffectsStation(event, station);
    if (event.type === 'route_disruption') {
      const ids = Array.isArray(event.parameters.route_ids)
        ? event.parameters.route_ids.map(String)
        : [];
      return ids.length === 0 || ids.some((id) => stationRoutes.has(id));
    }
    return false;
  });
  return crisis ? 'Crisis event affects this station' : null;
}

function annotate(plan: Plan, world: WorldState): Plan {
  for (const rec of plan.recommendations) rec.reviewReason = reviewReason(rec, world);
  return plan;
}

function emptyPlan(world: WorldState): Plan {
  return {
    tick: world.tick,
    engine: 'fallback',
    recommendations: [],
    watched: 0,
    forecastMape: null,
  };
}

export function planFor(envelope: StateEnvelope): Plan | null {
  const world = envelope.world;
  if (!world) return null;
  if (engine.plan && engine.planVersion === envelope.version) return visible(engine.plan);
  const started = performance.now();
  try {
    if (Date.now() < engine.plannerFaultUntil) throw new Error('Injected planner fault');
    engine.plan = annotate(buildPlan(world), world);
    if (engine.fallbackActive) logger.info('engine.recovered', { tick: world.tick });
    engine.engineError = null;
    engine.fallbackActive = false;
    metrics.observe('engine_plan_duration_ms', performance.now() - started);
    if (engine.plan.forecastMape !== null) metrics.set('forecast_mape', engine.plan.forecastMape);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!engine.fallbackActive)
      logger.error('engine.fallback', { error: message, tick: world.tick });
    engine.engineError = message;
    engine.fallbackActive = true;
    metrics.inc('engine_fallback_total');
    try {
      engine.plan = annotate(buildFallbackPlan(world), world);
    } catch (fallbackError) {
      logger.error('engine.fallback_failed', {
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
      engine.plan = emptyPlan(world);
    }
  }
  engine.planVersion = envelope.version;
  metrics.set('engine_recommendations', engine.plan.recommendations.length);
  metrics.set('engine_fallback_active', engine.fallbackActive ? 1 : 0);
  return visible(engine.plan);
}

export async function currentPlan(): Promise<Plan | null> {
  return planFor(await getWorldStore().get(1000));
}

export function engineStatus() {
  return {
    mode: engine.mode,
    error: engine.engineError,
    fallbackActive: engine.fallbackActive,
    plannerFaultUntil: engine.plannerFaultUntil > Date.now() ? engine.plannerFaultUntil : null,
    decisions: engine.decisions,
    cancelled: engine.cancelled,
  };
}

export function setMode(mode: AutopilotMode) {
  if (engine.mode !== mode) logger.info('autopilot.mode_changed', { mode });
  engine.mode = mode;
}

export function injectPlannerFault(seconds: number) {
  engine.plannerFaultUntil = Date.now() + seconds * 1000;
  engine.planVersion = -1;
  logger.warn('engine.fault_injected', { seconds });
}

export function clearPlannerFault() {
  engine.plannerFaultUntil = 0;
  engine.planVersion = -1;
}

function record(decision: DecisionRecord, rec?: Recommendation) {
  engine.decisions.unshift(decision);
  if (engine.decisions.length > DECISION_LIMIT) engine.decisions.pop();
  metrics.inc('decisions_total', {
    action: decision.action,
    outcome: decision.error ? 'error' : 'ok',
  });
  void persist(decision, rec);
}

async function persist(decision: DecisionRecord, rec?: Recommendation) {
  const prisma = getPrisma();
  if (!prisma) return;
  const status =
    decision.action === 'REJECTED' ? 'REJECTED' : decision.error ? 'FAILED' : 'EXECUTED';
  try {
    await prisma.recommendation.upsert({
      where: { id: decision.recommendationId },
      update: { status },
      create: {
        id: decision.recommendationId,
        generatedTick: decision.tick,
        stationId: decision.stationId,
        fuelType: decision.fuel,
        sourceDepotId: rec?.shipment?.depotId ?? '',
        routeId: decision.routeId ?? '',
        quantity: decision.quantity ?? 0,
        riskBefore: decision.riskBefore,
        riskAfter: decision.riskAfter ?? decision.riskBefore,
        stockoutProbBefore: 0,
        stockoutProbAfter: 0,
        forecastLiters: rec?.forecastNext6h ?? 0,
        confidence:
          rec?.forecastMape !== null && (rec?.forecastMape ?? 1) < 0.1 ? 'HIGH' : 'MEDIUM',
        engine: rec?.engine ?? 'planner',
        status,
        explanation: rec?.reasons ?? [],
        alternatives: rec?.alternatives ?? [],
      },
    });
    await prisma.decision.create({
      data: {
        recommendationId: decision.recommendationId,
        action: decision.action,
        actor: decision.actor,
        reason: decision.error,
        tick: decision.tick,
      },
    });
  } catch (error) {
    metrics.inc('db_write_failures_total');
    logger.warn('db.write_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function execute(
  rec: Recommendation,
  action: DecisionAction,
  actor: string,
): Promise<DecisionResult> {
  const shipment = rec.shipment;
  if (!shipment)
    return {
      ok: false,
      error: { code: 'NO_SHIPMENT', message: 'This recommendation has no valid shipment.' },
    };

  const idempotencyKey = `fo-${rec.id}-${shipment.routeId}-${shipment.quantity}`;
  if (engine.executing.has(idempotencyKey)) {
    return {
      ok: false,
      error: { code: 'IN_PROGRESS', message: 'This shipment is already being sent.' },
    };
  }
  engine.executing.add(idempotencyKey);

  const base: DecisionRecord = {
    id: idempotencyKey,
    at: new Date().toISOString(),
    tick: rec.tick,
    recommendationId: rec.id,
    stationId: rec.stationId,
    fuel: rec.fuel,
    action,
    actor,
    quantity: shipment.quantity,
    routeId: shipment.routeId,
    riskBefore: rec.riskScore,
    riskAfter: rec.riskAfter,
    allocationId: null,
    error: null,
  };

  try {
    const response = await getSimulatorClient().createAllocation({
      idempotency_key: idempotencyKey,
      source_depot_id: shipment.depotId,
      destination_station_id: rec.stationId,
      route_id: shipment.routeId,
      fuel_type: rec.fuel,
      quantity: shipment.quantity,
    });
    const decision = { ...base, allocationId: response.data.id };
    record(decision, rec);
    engine.snoozed.set(key(rec), rec.tick + 1);
    logger.info('allocation.executed', {
      station: rec.stationId,
      fuel: rec.fuel,
      quantity: shipment.quantity,
      route: shipment.routeId,
      allocationId: response.data.id,
      by: actor,
    });
    return { ok: true, decision };
  } catch (raw) {
    const error = raw instanceof SimulatorError ? raw : new SimulatorError('NETWORK', String(raw));
    const decision = { ...base, error: `${error.code ?? error.kind}: ${error.message}` };
    record(decision, rec);
    logger.warn('allocation.failed', {
      station: rec.stationId,
      fuel: rec.fuel,
      code: error.code ?? error.kind,
    });
    return {
      ok: false,
      decision,
      error: { code: error.code ?? error.kind, message: error.message },
    };
  } finally {
    engine.executing.delete(idempotencyKey);
  }
}

export async function approve(
  recommendationId: string,
  actor = 'operator',
): Promise<DecisionResult> {
  const shown = engine.plan?.recommendations.find((r) => r.id === recommendationId);
  if (!shown)
    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Recommendation not found or expired.' },
    };

  const envelope = await getWorldStore().refresh();
  if (envelope.freshness.stale) {
    return {
      ok: false,
      error: {
        code: 'STALE_DATA',
        message: 'Simulator data is stale. Wait for fresh data before approving.',
      },
    };
  }
  const fresh = planFor(envelope)?.recommendations.find((r) => key(r) === key(shown));
  if (!fresh || fresh.action !== 'SHIP') {
    return {
      ok: false,
      error: {
        code: 'NO_LONGER_NEEDED',
        message: 'After re-checking the latest state, no shipment is needed or possible.',
      },
    };
  }
  const result = await execute(fresh, 'APPROVED', actor);
  if (result.ok) await getWorldStore().refresh();
  return result;
}

export function reject(
  recommendationId: string,
  actor = 'operator',
  reason?: string,
): DecisionResult {
  const rec = engine.plan?.recommendations.find((r) => r.id === recommendationId);
  if (!rec)
    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Recommendation not found or expired.' },
    };
  engine.snoozed.set(key(rec), rec.tick + SNOOZE_TICKS);
  const decision: DecisionRecord = {
    id: `reject-${rec.id}`,
    at: new Date().toISOString(),
    tick: rec.tick,
    recommendationId: rec.id,
    stationId: rec.stationId,
    fuel: rec.fuel,
    action: 'REJECTED',
    actor,
    quantity: rec.shipment?.quantity ?? null,
    routeId: rec.shipment?.routeId ?? null,
    riskBefore: rec.riskScore,
    riskAfter: rec.riskAfter,
    allocationId: null,
    error: reason ?? null,
  };
  record(decision, rec);
  logger.info('recommendation.rejected', { station: rec.stationId, fuel: rec.fuel, by: actor });
  return { ok: true, decision };
}

export async function cancelDoomedShipments(envelope: StateEnvelope): Promise<number> {
  const world = envelope.world;
  if (!world || envelope.freshness.stale || engine.mode === 'MANUAL') return 0;
  let cancelled = 0;
  for (const allocation of world.allocations) {
    if (allocation.status !== 'PENDING') continue;
    const route = world.routes.find((r) => r.id === allocation.route_id);
    if (!route || (route.status === 'AVAILABLE' && !routeBlockedSoon(world, route))) continue;
    try {
      await getSimulatorClient().cancelAllocation(allocation.id);
      cancelled += 1;
      engine.cancelled += 1;
      engine.snoozed.delete(`${allocation.destination_station_id}:${allocation.fuel_type}`);
      metrics.inc('allocations_cancelled_total');
      logger.warn('allocation.cancelled', {
        allocationId: allocation.id,
        route: allocation.route_id,
        reason: 'Route disrupted before departure; fuel returned to depot for re-planning',
      });
    } catch (error) {
      if (!(error instanceof SimulatorError && error.code === 'CANNOT_CANCEL')) {
        logger.warn('allocation.cancel_failed', {
          allocationId: allocation.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return cancelled;
}

export async function runAutopilot(envelope: StateEnvelope): Promise<number> {
  if (engine.mode === 'MANUAL' || envelope.freshness.stale || engine.fallbackActive) return 0;
  const plan = planFor(envelope);
  if (!plan) return 0;
  let executed = 0;
  for (const rec of plan.recommendations) {
    if (rec.action !== 'SHIP') continue;
    if (engine.mode === 'ASSISTED' && rec.reviewReason) continue;
    const result = await execute(rec, 'AUTO_EXECUTED', 'autopilot');
    if (result.ok) executed += 1;
  }
  return executed;
}
