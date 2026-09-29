import { describe, expect, it } from 'vitest';
import { buildPlan, riskLevel } from '@/lib/intelligence/planner';
import { makeWorld } from '../fixtures/world';

function lowTongiDiesel(inventory = 900) {
  const world = makeWorld({ tick: 20, simTime: '2026-01-01T05:00:00Z' });
  world.stations[1].inventory.DIESEL = inventory;
  return world;
}

describe('planner', () => {
  it('recommends nothing for a healthy network at midnight', () => {
    const plan = buildPlan(makeWorld());
    expect(plan.recommendations).toHaveLength(0);
  });

  it('ships diesel to Tongi before the industrial shift drains it', () => {
    const plan = buildPlan(lowTongiDiesel());
    const rec = plan.recommendations.find(
      (r) => r.stationId === 'station-tongi' && r.fuel === 'DIESEL',
    );
    expect(rec?.action).toBe('SHIP');
    expect(rec?.shipment?.routeId).toBe('route-gazipur-tongi');
    expect(rec?.shipment?.quantity).toBeLessThanOrEqual(6500);
    expect(rec?.riskAfter).toBeLessThan(rec?.riskScore ?? 0);
    expect(rec?.level).toBe('CRITICAL');
  });

  it('respects station tank space', () => {
    const plan = buildPlan(lowTongiDiesel());
    const rec = plan.recommendations.find(
      (r) => r.stationId === 'station-tongi' && r.fuel === 'DIESEL',
    );
    expect((rec?.inventory ?? 0) + (rec?.shipment?.quantity ?? 0)).toBeLessThanOrEqual(18000);
  });

  it('uses the alternate route when the direct route is disrupted', () => {
    const world = makeWorld({ tick: 20, simTime: '2026-01-01T05:00:00Z' });
    world.stations[0].inventory.DIESEL = 500;
    world.routes[0].status = 'DISRUPTED';
    const rec = buildPlan(world).recommendations.find(
      (r) => r.stationId === 'station-mirpur' && r.fuel === 'DIESEL',
    );
    expect(rec?.shipment?.routeId).toBe('route-patiya-mirpur');
    expect(rec?.alternatives.some((a) => a.includes('disrupted'))).toBe(true);
  });

  it('shares depot dispatch capacity across recommendations', () => {
    const world = makeWorld({ tick: 20, simTime: '2026-01-01T05:00:00Z' });
    world.stations[0].inventory.DIESEL = 300;
    world.stations[0].inventory.PETROL = 300;
    world.stations[1].inventory.DIESEL = 300;
    const shipped = buildPlan(world)
      .recommendations.filter((r) => r.shipment?.depotId === 'depot-gazipur')
      .reduce((sum, r) => sum + (r.shipment?.quantity ?? 0), 0);
    expect(shipped).toBeLessThanOrEqual(12000);
  });

  it('does not ship to a station in outage', () => {
    const world = lowTongiDiesel();
    world.stations[1].status = 'OUTAGE';
    expect(buildPlan(world).recommendations.some((r) => r.stationId === 'station-tongi')).toBe(
      false,
    );
  });

  it('maps scores to levels', () => {
    expect(riskLevel(85)).toBe('CRITICAL');
    expect(riskLevel(65)).toBe('HIGH');
    expect(riskLevel(35)).toBe('MEDIUM');
    expect(riskLevel(10)).toBe('LOW');
  });
});
