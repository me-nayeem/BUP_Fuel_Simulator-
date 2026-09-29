import { z } from 'zod';
import { config } from '@/lib/config';
import { logger } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';
import { SimulatorError, toSimulatorError } from './errors';
import {
  AllocationRequestSchema,
  AllocationSchema,
  DemandObservationSchema,
  DepotSchema,
  EventInjectionSchema,
  FaultInjectionSchema,
  HealthSchema,
  InstanceSchema,
  RegionSchema,
  RouteSchema,
  SimEventSchema,
  SimMetricsSchema,
  StationSchema,
  StepResultSchema,
  SupplyArrivalSchema,
  type AllocationRequest,
  type EventInjection,
  type FaultInjection,
} from './types';

export interface CallMeta {
  /** True when the simulator flagged the response with `X-Simulator-Stale: true`. */
  stale: boolean;
  latencyMs: number;
  attempts: number;
  receivedAt: number;
}

export interface SimResponse<T> {
  data: T;
  meta: CallMeta;
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST';
  body?: unknown;
  schema: z.ZodType<T>;
  /** Overrides the configured retry count (e.g. 0 for non-idempotent admin calls). */
  retries?: number;
  timeoutMs?: number;
  /** Health and admin paths bypass simulator faults, so they also bypass our circuit breaker. */
  bypassCircuit?: boolean;
}

export interface ClientOptions {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  circuitFailureThreshold?: number;
  circuitOpenMs?: number;
  maxConcurrent?: number;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface DataApiStatus {
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: { kind: string; code?: string; message: string } | null;
  consecutiveFailures: number;
  circuit: CircuitState;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Metric label: method + path without query string or numeric ids. */
function endpointLabel(method: string, path: string): string {
  return `${method} ${path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id')}`;
}

export class SimulatorClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly failureThreshold: number;
  private readonly openMs: number;

  private consecutiveFailures = 0;
  private openUntil = 0;
  private lastSuccessAt: number | null = null;
  private lastFailureAt: number | null = null;
  private lastError: DataApiStatus['lastError'] = null;
  private readonly maxConcurrent: number;
  private activeRequests = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly options: ClientOptions) {
    this.maxConcurrent = options.maxConcurrent ?? 4;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.failureThreshold = options.circuitFailureThreshold ?? 5;
    this.openMs = options.circuitOpenMs ?? 3000;
  }

  // ---- public read API (/v1/*) ------------------------------------------------

  health() {
    return this.request('/v1/health', {
      schema: HealthSchema,
      retries: 0,
      timeoutMs: 1500,
      bypassCircuit: true,
    });
  }
  instance() {
    return this.request('/v1/instance', { schema: InstanceSchema });
  }
  regions() {
    return this.request('/v1/regions', { schema: z.array(RegionSchema) });
  }
  depots() {
    return this.request('/v1/depots', { schema: z.array(DepotSchema) });
  }
  stations() {
    return this.request('/v1/stations', { schema: z.array(StationSchema) });
  }
  routes() {
    return this.request('/v1/routes', { schema: z.array(RouteSchema) });
  }
  supplyArrivals() {
    return this.request('/v1/supply-arrivals', { schema: z.array(SupplyArrivalSchema) });
  }
  events() {
    return this.request('/v1/events', { schema: z.array(SimEventSchema) });
  }
  allocations() {
    return this.request('/v1/allocations', { schema: z.array(AllocationSchema) });
  }
  metrics() {
    return this.request('/v1/metrics', { schema: SimMetricsSchema });
  }
  /** Most recent observations first. `limit` is clamped by the simulator to [1, 2000]. */
  demandHistory(params: { stationId?: string; limit: number }) {
    const query = new URLSearchParams({ limit: String(Math.min(2000, Math.max(1, params.limit))) });
    if (params.stationId) query.set('station_id', params.stationId);
    return this.request(`/v1/demand-history?${query}`, {
      schema: z.array(DemandObservationSchema),
    });
  }

  // ---- the only domain writes -------------------------------------------------

  /**
   * Safe to retry: the simulator replays the original allocation for the same
   * idempotency key and body. Callers must reuse the key across retries.
   */
  createAllocation(request: AllocationRequest) {
    const body = AllocationRequestSchema.parse(request);
    return this.request('/v1/allocations', { method: 'POST', body, schema: AllocationSchema });
  }

  cancelAllocation(allocationId: number) {
    return this.request(`/v1/allocations/${allocationId}/cancel`, {
      method: 'POST',
      schema: AllocationSchema,
    });
  }

  // ---- admin (/admin/*, bypasses faults; used for scenario controls & experiments) ----

  step() {
    return this.admin('/admin/step', StepResultSchema);
  }
  run() {
    return this.admin('/admin/run', z.unknown());
  }
  pause() {
    return this.admin('/admin/pause', z.unknown());
  }
  reset() {
    return this.admin('/admin/reset', z.unknown());
  }
  injectEvent(event: EventInjection) {
    return this.admin('/admin/events', SimEventSchema, EventInjectionSchema.parse(event));
  }
  injectFault(fault: FaultInjection) {
    return this.admin('/admin/faults', z.unknown(), FaultInjectionSchema.parse(fault));
  }
  clearFaults() {
    return this.admin('/admin/faults/clear', z.unknown());
  }
  listFaults() {
    return this.request('/admin/faults', {
      schema: z.array(z.record(z.string(), z.unknown())),
      bypassCircuit: true,
    });
  }

  // ---- status -----------------------------------------------------------------

  dataApiStatus(): DataApiStatus {
    return {
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      lastError: this.lastError,
      consecutiveFailures: this.consecutiveFailures,
      circuit: this.circuitState(),
    };
  }

  circuitState(now = Date.now()): CircuitState {
    if (this.openUntil === 0) return 'CLOSED';
    return now < this.openUntil ? 'OPEN' : 'HALF_OPEN';
  }

  // ---- internals ----------------------------------------------------------------

  private admin<T>(path: string, schema: z.ZodType<T>, body?: unknown) {
    // Admin mutations such as /admin/step are not idempotent: never retry them.
    return this.request(path, { method: 'POST', body, schema, retries: 0, bypassCircuit: true });
  }

  private async request<T>(path: string, options: RequestOptions<T>): Promise<SimResponse<T>> {
    const method = options.method ?? 'GET';
    const label = endpointLabel(method, path);
    const maxRetries = options.retries ?? this.options.maxRetries;
    const useCircuit = !options.bypassCircuit;

    if (useCircuit && this.circuitState() === 'OPEN') {
      metrics.inc('simulator_requests_total', { endpoint: label, outcome: 'CIRCUIT_OPEN' });
      throw new SimulatorError(
        'CIRCUIT_OPEN',
        'Simulator data API circuit is open; using last known state',
      );
    }

    const started = performance.now();
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const result = await this.attempt(path, method, options);
        const latencyMs = performance.now() - started;
        metrics.observe('simulator_request_duration_ms', latencyMs, { endpoint: label });
        metrics.inc('simulator_requests_total', { endpoint: label, outcome: 'ok' });
        if (result.stale) metrics.inc('simulator_stale_responses_total', { endpoint: label });
        if (useCircuit) this.recordSuccess();
        return {
          data: result.data,
          meta: {
            stale: result.stale,
            latencyMs: Math.round(latencyMs),
            attempts: attempt,
            receivedAt: Date.now(),
          },
        };
      } catch (raw) {
        const error =
          raw instanceof SimulatorError ? raw : new SimulatorError('NETWORK', String(raw));
        if (error.retryable && attempt <= maxRetries) {
          metrics.inc('simulator_retries_total', { endpoint: label, kind: error.kind });
          const backoff = 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
          logger.debug('simulator.retry', {
            endpoint: label,
            attempt,
            kind: error.kind,
            backoffMs: backoff,
          });
          await this.sleep(backoff);
          continue;
        }

        const latencyMs = performance.now() - started;
        metrics.observe('simulator_request_duration_ms', latencyMs, { endpoint: label });
        metrics.inc('simulator_requests_total', { endpoint: label, outcome: error.kind });
        if (useCircuit) {
          // Domain rejections (409 etc.) mean the API works; only transient failures trip the circuit.
          if (error.retryable) this.recordFailure(error, label);
          else if (error.kind === 'DOMAIN' || error.kind === 'VALIDATION') this.recordSuccess();
          else this.lastError = { kind: error.kind, code: error.code, message: error.message };
        }
        throw error;
      }
    }
  }

  private async withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeRequests >= this.maxConcurrent) {
      metrics.inc('simulator_requests_queued_total');
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.activeRequests += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.activeRequests -= 1;
    }
  }

  private async attempt<T>(
    path: string,
    method: 'GET' | 'POST',
    options: RequestOptions<T>,
  ): Promise<{ data: T; stale: boolean }> {
    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs;
    let response: Response;
    let text: string;
    try {
      [response, text] = await this.withSlot(async () => {
        const res = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
          method,
          headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
          cache: 'no-store',
        });
        return [res, await res.text()] as const;
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new SimulatorError('TIMEOUT', `Simulator did not respond within ${timeoutMs} ms`);
      }
      throw new SimulatorError(
        'NETWORK',
        `Simulator unreachable: ${error instanceof Error ? error.message : error}`,
      );
    }

    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        if (response.ok)
          throw new SimulatorError(
            'INVALID_RESPONSE',
            'Simulator returned non-JSON body',
            response.status,
          );
      }
    }

    if (!response.ok) throw toSimulatorError(response.status, body);

    const parsed = options.schema.safeParse(body);
    if (!parsed.success) {
      metrics.inc('simulator_invalid_responses_total', { endpoint: endpointLabel(method, path) });
      logger.warn('simulator.invalid_response', { path, issues: parsed.error.issues.slice(0, 3) });
      throw new SimulatorError(
        'INVALID_RESPONSE',
        `Simulator response for ${path} failed validation`,
        response.status,
      );
    }

    return { data: parsed.data, stale: response.headers.get('x-simulator-stale') === 'true' };
  }

  private recordSuccess() {
    if (this.openUntil !== 0) logger.info('simulator.circuit_closed');
    this.consecutiveFailures = 0;
    this.openUntil = 0;
    this.lastSuccessAt = Date.now();
  }

  private recordFailure(error: SimulatorError, endpoint: string) {
    this.consecutiveFailures += 1;
    this.lastFailureAt = Date.now();
    this.lastError = { kind: error.kind, code: error.code, message: error.message };
    const halfOpen = this.circuitState() === 'HALF_OPEN';
    if (halfOpen || this.consecutiveFailures >= this.failureThreshold) {
      if (this.circuitState() !== 'OPEN') {
        logger.warn('simulator.circuit_opened', {
          endpoint,
          kind: error.kind,
          failures: this.consecutiveFailures,
        });
        metrics.inc('simulator_circuit_open_total');
      }
      this.openUntil = Date.now() + this.openMs;
    }
  }
}

const globalForSimulator = globalThis as unknown as { __simulatorClient?: SimulatorClient };

/** Process-wide client, shared across route handlers and the control loop. */
export function getSimulatorClient(): SimulatorClient {
  globalForSimulator.__simulatorClient ??= new SimulatorClient({
    baseUrl: config.SIMULATOR_BASE_URL.replace(/\/$/, ''),
    timeoutMs: config.SIMULATOR_TIMEOUT_MS,
    maxRetries: config.SIMULATOR_MAX_RETRIES,
  });
  return globalForSimulator.__simulatorClient;
}
