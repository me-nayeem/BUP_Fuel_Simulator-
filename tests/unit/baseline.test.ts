import { describe, expect, it } from 'vitest';
import { buildFallbackPlan } from '@/lib/intelligence/baseline';
import { makeWorld } from '../fixtures/world';

describe('fallback planner', () => {
  it('does nothing when every station is above the refill threshold', () => {
    expect(buildFallbackPlan(makeWorld()).recommendations).toHaveLength(0);
  });

  it('refills a low station from the shortest available route within limits', () => {
    const world = makeWorld();
    world.stations[1].inventory.DIESEL = 1000;
    const rec = buildFallbackPlan(world).recommendations.find(
      (r) => r.stationId === 'station-tongi' && r.fuel === 'DIESEL',
    );
    expect(rec?.engine).toBe('fallback');
    expect(rec?.action).toBe('SHIP');
    expect(rec?.shipment?.routeId).toBe('route-gazipur-tongi');
    expect(rec?.shipment?.quantity).toBeLessThanOrEqual(6500);
    expect(rec?.reviewReason).toMatch(/Fallback/);
  });

  it('skips disrupted routes and uses the alternative', () => {
    const world = makeWorld();
    world.stations[0].inventory.DIESEL = 1000;
    const direct = world.routes.find((r) => r.id === 'route-gazipur-mirpur');
    if (direct) direct.status = 'DISRUPTED';
    const rec = buildFallbackPlan(world).recommendations.find(
      (r) => r.stationId === 'station-mirpur' && r.fuel === 'DIESEL',
    );
    expect(rec?.shipment?.routeId).toBe('route-patiya-mirpur');
    expect(rec?.alternatives.join(' ')).toMatch(/disrupted/);
  });
});
