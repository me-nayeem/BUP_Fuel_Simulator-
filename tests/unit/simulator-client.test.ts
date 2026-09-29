import { describe, expect, it } from 'vitest';
import { SimulatorClient } from '@/lib/simulator/client';
import { SimulatorError } from '@/lib/simulator/errors';

const METRICS = {
  served_demand_liters: 100,
  unmet_demand_liters: 0,
  service_level: 1,
  allocation_liters: 0,
  allocation_failures: 0,
};

const ALLOCATION = {
  id: 7,
  idempotency_key: 'k-1',
  source_depot_id: 'depot-gazipur',
  destination_station_id: 'station-mirpur',
  route_id: 'route-gazipur-mirpur',
  fuel_type: 'DIESEL',
  quantity: 3000,
  created_tick: 0,
  departure_tick: null,
  expected_arrival_tick: null,
  actual_arrival_tick: null,
  status: 'PENDING',
  failure_reason: null,
};

type Reply = { status: number; body: unknown; headers?: Record<string, string> } | Error;

function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const reply = replies.shift();
    if (!reply) throw new Error('no more replies');
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: reply.headers,
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function client(
  replies: Reply[],
  extra: Partial<ConstructorParameters<typeof SimulatorClient>[0]> = {},
) {
  const fake = fakeFetch(replies);
  const instance = new SimulatorClient({
    baseUrl: 'http://sim',
    timeoutMs: 100,
    maxRetries: 2,
    fetchImpl: fake.impl,
    sleep: async () => {},
    ...extra,
  });
  return { instance, calls: fake.calls };
}

const FAULT = {
  status: 503,
  body: { error: { code: 'FAULT_INJECTED', message: 'Injected transient API error.' } },
};

describe('SimulatorClient', () => {
  it('retries injected 503 faults and then succeeds', async () => {
    const { instance, calls } = client([FAULT, FAULT, { status: 200, body: METRICS }]);
    const result = await instance.metrics();
    expect(result.data.service_level).toBe(1);
    expect(result.meta.attempts).toBe(3);
    expect(calls).toHaveLength(3);
  });

  it('gives up after max retries with a FAULT_INJECTED error', async () => {
    const { instance, calls } = client([FAULT, FAULT, FAULT]);
    await expect(instance.metrics()).rejects.toMatchObject({ kind: 'FAULT_INJECTED' });
    expect(calls).toHaveLength(3);
  });

  it('never retries a 409 domain rejection', async () => {
    const { instance, calls } = client([
      { status: 409, body: { detail: { code: 'INSUFFICIENT_INVENTORY', message: 'no fuel' } } },
    ]);
    await expect(
      instance.createAllocation({
        idempotency_key: 'k-1',
        source_depot_id: 'depot-gazipur',
        destination_station_id: 'station-mirpur',
        route_id: 'route-gazipur-mirpur',
        fuel_type: 'DIESEL',
        quantity: 3000,
      }),
    ).rejects.toMatchObject({ kind: 'DOMAIN', code: 'INSUFFICIENT_INVENTORY' });
    expect(calls).toHaveLength(1);
  });

  it('reuses the same idempotency key when retrying an allocation', async () => {
    const { instance, calls } = client([
      new Error('socket hang up'),
      { status: 201, body: ALLOCATION },
    ]);
    const result = await instance.createAllocation({
      idempotency_key: 'k-1',
      source_depot_id: 'depot-gazipur',
      destination_station_id: 'station-mirpur',
      route_id: 'route-gazipur-mirpur',
      fuel_type: 'DIESEL',
      quantity: 3000,
    });
    expect(result.data.id).toBe(7);
    const keys = calls.map((c) => JSON.parse(String(c.init?.body)).idempotency_key);
    expect(keys).toEqual(['k-1', 'k-1']);
  });

  it('surfaces the X-Simulator-Stale header', async () => {
    const { instance } = client([
      { status: 200, body: METRICS, headers: { 'X-Simulator-Stale': 'true' } },
    ]);
    const result = await instance.metrics();
    expect(result.meta.stale).toBe(true);
  });

  it('rejects responses that fail schema validation', async () => {
    const { instance } = client([{ status: 200, body: { service_level: 'high' } }]);
    await expect(instance.metrics()).rejects.toMatchObject({ kind: 'INVALID_RESPONSE' });
  });

  it('opens the circuit after repeated failures and fails fast', async () => {
    const { instance, calls } = client([FAULT, FAULT], {
      maxRetries: 0,
      circuitFailureThreshold: 2,
    });
    await expect(instance.metrics()).rejects.toBeInstanceOf(SimulatorError);
    await expect(instance.metrics()).rejects.toBeInstanceOf(SimulatorError);
    expect(instance.circuitState()).toBe('OPEN');
    await expect(instance.metrics()).rejects.toMatchObject({ kind: 'CIRCUIT_OPEN' });
    expect(calls).toHaveLength(2);
  });

  it('health checks bypass the circuit breaker', async () => {
    const { instance } = client(
      [
        FAULT,
        {
          status: 200,
          body: { status: 'ok', database: 'ok', simulation: { status: 'PAUSED', tick: 0 } },
        },
      ],
      { maxRetries: 0, circuitFailureThreshold: 1 },
    );
    await expect(instance.metrics()).rejects.toBeInstanceOf(SimulatorError);
    expect(instance.circuitState()).toBe('OPEN');
    const health = await instance.health();
    expect(health.data.status).toBe('ok');
  });
});

describe('SimulatorClient concurrency', () => {
  it('never sends more than maxConcurrent requests at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const impl = (async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return new Response(JSON.stringify(METRICS), { status: 200 });
    }) as unknown as typeof fetch;
    const instance = new SimulatorClient({
      baseUrl: 'http://sim',
      timeoutMs: 1000,
      maxRetries: 0,
      fetchImpl: impl,
      maxConcurrent: 3,
    });
    await Promise.all(Array.from({ length: 12 }, () => instance.metrics()));
    expect(peak).toBe(3);
  });
});
