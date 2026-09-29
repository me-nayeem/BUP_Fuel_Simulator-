import { availableParallelism } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { config } from '@/lib/config';
import { pingDatabase } from '@/lib/prisma';
import { getSimulatorClient } from '@/lib/simulator/client';
import { getWorldStore } from '@/lib/world/snapshot';
import { metrics } from './metrics';

export type ComponentStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'NOT_STARTED' | 'DISABLED';

export interface ComponentHealth {
  name: string;
  status: ComponentStatus;
  detail?: string;
  latencyMs?: number;
}

export interface HealthReport {
  status: 'HEALTHY' | 'DEGRADED';
  checkedAt: string;
  components: ComponentHealth[];
  performance: {
    apiP50Ms: number | null;
    apiP95Ms: number | null;
    apiErrorRate: number;
    simulatorP95Ms: number | null;
    simulatorErrorRate: number;
  };
  system: {
    cpuPercent: number;
    rssMb: number;
    heapUsedMb: number;
    eventLoopLagP99Ms: number;
    uptimeSec: number;
  };
}

type ComponentProbe = () => ComponentHealth;

const globalForHealth = globalThis as unknown as {
  __healthProbes?: Map<string, ComponentProbe>;
  __cpuSample?: { usage: NodeJS.CpuUsage; at: number };
  __loopDelay?: ReturnType<typeof monitorEventLoopDelay>;
};

const probes = (globalForHealth.__healthProbes ??= new Map());

/** Lets long-running components (control loop, SSE, engine) report their own health. */
export function registerHealthProbe(name: string, probe: ComponentProbe) {
  probes.set(name, probe);
}

function loopDelay() {
  if (!globalForHealth.__loopDelay) {
    globalForHealth.__loopDelay = monitorEventLoopDelay({ resolution: 20 });
    globalForHealth.__loopDelay.enable();
  }
  return globalForHealth.__loopDelay;
}

function cpuPercent(): number {
  const now = performance.now();
  const usage = process.cpuUsage();
  const previous = globalForHealth.__cpuSample;
  globalForHealth.__cpuSample = { usage, at: now };
  if (!previous) return 0;
  const elapsedMicros = (now - previous.at) * 1000;
  if (elapsedMicros <= 0) return 0;
  const used = usage.user - previous.usage.user + (usage.system - previous.usage.system);
  return Math.round((used / (elapsedMicros * availableParallelism())) * 1000) / 10;
}

function errorRate(counter: string, isError: (labelText: string) => boolean): number {
  const total = metrics.counterTotal(counter);
  if (total === 0) return 0;
  return Math.round((metrics.counterTotal(counter, isError) / total) * 10000) / 10000;
}

function describeError(kind: string, code?: string): string {
  if (kind === 'CIRCUIT_OPEN') return 'Calls paused for 3 s after repeated failures';
  if (kind === 'FAULT_INJECTED') return 'Simulator returned 503 (fault injected)';
  if (kind === 'TIMEOUT') return 'Simulator timed out';
  if (kind === 'NETWORK') return 'Simulator unreachable';
  return code ? `${kind} (${code})` : kind;
}

const round = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);

const PROBE_TTL_MS = 2000;

interface CachedProbe<T> {
  at: number;
  value: T | null;
  inFlight: Promise<T> | null;
}

const globalForProbes = globalThis as unknown as {
  __probeCache?: Map<string, CachedProbe<unknown>>;
};
const probeCache = (globalForProbes.__probeCache ??= new Map());

function cachedProbe<T>(name: string, run: () => Promise<T>): Promise<T> {
  const entry = (probeCache.get(name) ?? { at: 0, value: null, inFlight: null }) as CachedProbe<T>;
  probeCache.set(name, entry);
  if (entry.value !== null && Date.now() - entry.at < PROBE_TTL_MS)
    return Promise.resolve(entry.value);
  entry.inFlight ??= run()
    .then((value) => {
      entry.value = value;
      entry.at = Date.now();
      return value;
    })
    .finally(() => {
      entry.inFlight = null;
    });
  return entry.inFlight;
}

export async function getHealthReport(): Promise<HealthReport> {
  const client = getSimulatorClient();
  const [liveness, database] = await Promise.all([
    cachedProbe('simulator', () =>
      client.health().then(
        (r) => ({
          ok: r.data.status === 'ok',
          latencyMs: r.meta.latencyMs,
          detail: `${r.data.simulation.status} · tick ${r.data.simulation.tick}`,
        }),
        (e: unknown) => ({
          ok: false,
          latencyMs: undefined,
          detail: e instanceof Error ? e.message : String(e),
        }),
      ),
    ),
    config.DATABASE_URL ? cachedProbe('database', () => pingDatabase()) : Promise.resolve(null),
  ]);

  const { freshness } = getWorldStore().current();
  const circuit = client.circuitState();

  const dataApi: ComponentHealth = (() => {
    if (freshness.source === 'NONE' && !freshness.lastError) {
      return {
        name: 'Simulator data API',
        status: 'NOT_STARTED',
        detail: 'No snapshot fetched yet',
      };
    }
    if (freshness.lastError) {
      return {
        name: 'Simulator data API',
        status: freshness.source === 'NONE' ? 'DOWN' : 'DEGRADED',
        detail: `${describeError(freshness.lastError.kind, freshness.lastError.code)} · serving last known state`,
      };
    }
    if (freshness.staleSignal) {
      return {
        name: 'Simulator data API',
        status: 'DEGRADED',
        detail: 'Simulator reports STALE data · holding last known good',
      };
    }
    return {
      name: 'Simulator data API',
      status: 'HEALTHY',
      latencyMs: freshness.fetchLatencyMs ?? undefined,
      detail: `circuit ${circuit}`,
    };
  })();

  const components: ComponentHealth[] = [
    {
      name: 'Backend API',
      status: 'HEALTHY',
      detail: `Up ${Math.floor(process.uptime() / 60)} min`,
    },
    {
      name: 'Fuel simulator',
      status: liveness.ok ? 'HEALTHY' : 'DOWN',
      latencyMs: liveness.latencyMs,
      detail: liveness.detail,
    },
    dataApi,
    database === null
      ? { name: 'Database', status: 'DISABLED', detail: 'DATABASE_URL not set · running in memory' }
      : {
          name: 'Database',
          status: database.ok ? 'HEALTHY' : 'DOWN',
          latencyMs: database.latencyMs,
          detail: database.ok ? 'PostgreSQL' : database.error,
        },
    ...[...probes.values()].map((probe) => probe()),
  ];

  const degraded = components.some((c) => c.status === 'DOWN' || c.status === 'DEGRADED');
  const memory = process.memoryUsage();
  const lag = loopDelay();

  return {
    status: degraded ? 'DEGRADED' : 'HEALTHY',
    checkedAt: new Date().toISOString(),
    components,
    performance: {
      apiP50Ms: round(metrics.quantileAll('http_request_duration_ms', 0.5)),
      apiP95Ms: round(metrics.quantileAll('http_request_duration_ms', 0.95)),
      apiErrorRate: errorRate('http_requests_total', (labels) => /status="5\d\d"/.test(labels)),
      simulatorP95Ms: round(metrics.quantileAll('simulator_request_duration_ms', 0.95)),
      simulatorErrorRate: errorRate(
        'simulator_requests_total',
        (labels) => !labels.includes('outcome="ok"'),
      ),
    },
    system: {
      cpuPercent: cpuPercent(),
      rssMb: Math.round(memory.rss / 1048576),
      heapUsedMb: Math.round(memory.heapUsed / 1048576),
      eventLoopLagP99Ms: Math.round((lag.percentile(99) / 1e6) * 10) / 10,
      uptimeSec: Math.round(process.uptime()),
    },
  };
}
