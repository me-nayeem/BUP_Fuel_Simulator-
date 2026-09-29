import { config } from '@/lib/config';
import { logger } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';
import { getSimulatorClient, type SimulatorClient } from '@/lib/simulator/client';
import { SimulatorError } from '@/lib/simulator/errors';
import type {
  Allocation,
  DemandObservation,
  Depot,
  Region,
  Route,
  SimEvent,
  SimMetrics,
  Station,
  SupplyArrival,
} from '@/lib/simulator/types';

export const FUEL_ROWS_PER_TICK = 12; // 4 stations × 3 fuels

export interface WorldState {
  tick: number;
  simTime: string;
  simulationStatus: 'PAUSED' | 'RUNNING';
  tickMinutes: number;
  seed: number;
  scenarioId: string;
  regions: Region[];
  depots: Depot[];
  stations: Station[];
  routes: Route[];
  supplyArrivals: SupplyArrival[];
  events: SimEvent[];
  allocations: Allocation[];
  /** Newest first, bounded to the last DEMAND_HISTORY_TICKS ticks. */
  demandHistory: DemandObservation[];
  metrics: SimMetrics;
}

export type StateSource = 'LIVE' | 'LAST_KNOWN_GOOD' | 'NONE';

export interface Freshness {
  source: StateSource;
  /** Simulator flagged the data as stale (X-Simulator-Stale), or we are serving an old copy. */
  stale: boolean;
  staleSignal: boolean;
  fetchedAt: string | null;
  ageMs: number | null;
  fetchLatencyMs: number | null;
  lastError: { kind: string; code?: string; message: string } | null;
}

export interface StateEnvelope {
  world: WorldState | null;
  freshness: Freshness;
  /** Increments whenever a new live world is accepted. */
  version: number;
}

export function normaliseSimTime(simTime: string): string {
  return /([zZ]|[+-]\d{2}:?\d{2})$/.test(simTime) ? simTime : `${simTime}Z`;
}

/** One consistent read of every simulator resource, fetched in parallel. */
export async function fetchWorld(
  client: SimulatorClient,
): Promise<{ world: WorldState; stale: boolean }> {
  const [
    instance,
    regions,
    depots,
    stations,
    routes,
    supply,
    events,
    allocations,
    demand,
    simMetrics,
  ] = await Promise.all([
    client.instance(),
    client.regions(),
    client.depots(),
    client.stations(),
    client.routes(),
    client.supplyArrivals(),
    client.events(),
    client.allocations(),
    client.demandHistory({ limit: config.DEMAND_HISTORY_TICKS * FUEL_ROWS_PER_TICK }),
    client.metrics(),
  ]);

  const responses = [
    instance,
    regions,
    depots,
    stations,
    routes,
    supply,
    events,
    allocations,
    demand,
    simMetrics,
  ];
  const stale = responses.some((r) => r.meta.stale);

  return {
    stale,
    world: {
      tick: instance.data.tick,
      simTime: normaliseSimTime(instance.data.sim_time),
      simulationStatus: instance.data.status,
      tickMinutes: instance.data.tick_minutes,
      seed: instance.data.seed,
      scenarioId: instance.data.scenario_id,
      regions: regions.data,
      depots: depots.data,
      stations: stations.data,
      routes: routes.data,
      supplyArrivals: supply.data,
      events: events.data,
      allocations: allocations.data,
      demandHistory: demand.data.map((row) => ({
        ...row,
        sim_time: normaliseSimTime(row.sim_time),
      })),
      metrics: simMetrics.data,
    },
  };
}

class WorldStore {
  private world: WorldState | null = null;
  private fetchedAt: number | null = null;
  private fetchLatencyMs: number | null = null;
  private staleSignal = false;
  private lastError: Freshness['lastError'] = null;
  private lastAttemptFailed = false;
  private version = 0;
  private inFlight: Promise<StateEnvelope> | null = null;

  constructor(private readonly client: SimulatorClient) {}

  /** Returns cached state if younger than maxAgeMs, otherwise refreshes (deduplicated). */
  async get(maxAgeMs = 1000): Promise<StateEnvelope> {
    if (
      this.fetchedAt !== null &&
      !this.lastAttemptFailed &&
      Date.now() - this.fetchedAt < maxAgeMs
    ) {
      return this.envelope();
    }
    return this.refresh();
  }

  /** Concurrent callers share one in-flight simulator read. */
  refresh(): Promise<StateEnvelope> {
    this.inFlight ??= this.doRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  current(): StateEnvelope {
    return this.envelope();
  }

  private async doRefresh(): Promise<StateEnvelope> {
    const started = performance.now();
    try {
      const { world, stale } = await fetchWorld(this.client);
      this.fetchLatencyMs = Math.round(performance.now() - started);
      metrics.observe('world_refresh_duration_ms', this.fetchLatencyMs);

      if (stale !== this.staleSignal) {
        if (stale) logger.warn('simulator.stale', { tick: world.tick });
        else logger.info('simulator.fresh', { tick: world.tick });
      }
      this.staleSignal = stale;

      // Stale responses must not overwrite a good copy: keep last-known-good.
      if (!stale || this.world === null) {
        this.world = world;
        this.fetchedAt = Date.now();
        this.version += 1;
      }
      if (this.lastAttemptFailed) logger.info('simulator.recovered', { tick: world.tick });
      this.lastAttemptFailed = false;
      this.lastError = null;
      metrics.inc('world_refresh_total', { outcome: stale ? 'stale' : 'ok' });
    } catch (raw) {
      const error =
        raw instanceof SimulatorError ? raw : new SimulatorError('NETWORK', String(raw));
      this.lastError = { kind: error.kind, code: error.code, message: error.message };
      metrics.inc('world_refresh_total', { outcome: 'error' });
      if (!this.lastAttemptFailed) {
        logger.warn('simulator.degraded', {
          kind: error.kind,
          code: error.code,
          message: error.message,
        });
      }
      this.lastAttemptFailed = true;
    }
    return this.envelope();
  }

  private envelope(): StateEnvelope {
    const ageMs = this.fetchedAt === null ? null : Date.now() - this.fetchedAt;
    const source: StateSource =
      this.world === null
        ? 'NONE'
        : this.lastAttemptFailed || this.staleSignal
          ? 'LAST_KNOWN_GOOD'
          : 'LIVE';
    return {
      world: this.world,
      version: this.version,
      freshness: {
        source,
        stale: this.staleSignal || this.lastAttemptFailed,
        staleSignal: this.staleSignal,
        fetchedAt: this.fetchedAt === null ? null : new Date(this.fetchedAt).toISOString(),
        ageMs,
        fetchLatencyMs: this.fetchLatencyMs,
        lastError: this.lastError,
      },
    };
  }
}

const globalForWorld = globalThis as unknown as { __worldStore?: WorldStore };

export function getWorldStore(): WorldStore {
  globalForWorld.__worldStore ??= new WorldStore(getSimulatorClient());
  return globalForWorld.__worldStore;
}
