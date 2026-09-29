import { depotLabel, FUEL_LABEL, stationLabel } from '@/lib/format';
import { FUEL_TYPES } from '@/lib/simulator/types';
import type { WorldState } from '@/lib/world/snapshot';
import { riskLevel, routeBlockedSoon, type Plan, type Recommendation } from './planner';

const REFILL_BELOW = 0.35;
const REFILL_TO = 0.8;
const MIN_SHIPMENT = 500;

export function buildFallbackPlan(world: WorldState): Plan {
  const depotStock = new Map(world.depots.map((d) => [d.id, { ...d.inventory }]));
  const dispatchLeft = new Map(
    world.depots.map((d) => [
      d.id,
      d.dispatch_capacity_per_tick -
        world.allocations
          .filter((a) => a.source_depot_id === d.id && a.status === 'PENDING')
          .reduce((sum, a) => sum + a.quantity, 0),
    ]),
  );

  const recommendations: Recommendation[] = [];

  for (const station of world.stations) {
    if (station.status !== 'OPEN') continue;
    for (const fuel of FUEL_TYPES) {
      const inventory = station.inventory[fuel];
      const capacity = station.capacity[fuel];
      const inbound = world.allocations
        .filter(
          (a) =>
            a.destination_station_id === station.id &&
            a.fuel_type === fuel &&
            (a.status === 'PENDING' || a.status === 'IN_TRANSIT'),
        )
        .reduce((sum, a) => sum + a.quantity, 0);
      const ratio = (inventory + inbound) / capacity;
      if (ratio >= REFILL_BELOW) continue;

      const score = Math.round(Math.min(100, (1 - inventory / capacity) * 100));
      const rec: Recommendation = {
        id: `${world.tick}-${station.id}-${fuel}`,
        tick: world.tick,
        stationId: station.id,
        fuel,
        inventory,
        capacity,
        inbound,
        forecastNext6h: 0,
        hoursToEmpty: null,
        riskScore: score,
        level: riskLevel(score),
        action: 'BLOCKED',
        shipment: null,
        riskAfter: null,
        hoursToEmptyAfter: null,
        reasons: [
          `Fallback rule: stock ${Math.round((inventory / capacity) * 100)}% is below ${REFILL_BELOW * 100}%.`,
        ],
        alternatives: [],
        forecastMape: null,
        engine: 'fallback',
        reviewReason: 'Fallback planner active (main planner unavailable)',
      };

      const routes = world.routes
        .filter((r) => r.destination_station_id === station.id)
        .sort((a, b) => a.transit_ticks - b.transit_ticks);

      for (const route of routes) {
        const name = `${depotLabel(route.source_depot_id)} → ${stationLabel(station.id)}`;
        if (route.status !== 'AVAILABLE' || routeBlockedSoon(world, route)) {
          rec.alternatives.push(`${name}: route disrupted.`);
          continue;
        }
        const stock = depotStock.get(route.source_depot_id)?.[fuel] ?? 0;
        const dispatch = dispatchLeft.get(route.source_depot_id) ?? 0;
        const wanted = capacity * REFILL_TO - inventory - inbound;
        const quantity =
          Math.floor(Math.min(wanted, route.max_shipment, stock, dispatch) / 100) * 100;
        if (quantity < MIN_SHIPMENT) {
          rec.alternatives.push(`${name}: not enough depot stock or dispatch capacity.`);
          continue;
        }
        rec.action = 'SHIP';
        rec.shipment = {
          depotId: route.source_depot_id,
          routeId: route.id,
          transitTicks: route.transit_ticks,
          quantity,
        };
        rec.reasons.push(
          `Refill ${quantity.toLocaleString('en-US')} L ${FUEL_LABEL[fuel].toLowerCase()} via ${name}, the shortest available route.`,
        );
        const depotFuel = depotStock.get(route.source_depot_id);
        if (depotFuel) depotFuel[fuel] = stock - quantity;
        dispatchLeft.set(route.source_depot_id, dispatch - quantity);
        break;
      }
      recommendations.push(rec);
    }
  }

  recommendations.sort((a, b) => b.riskScore - a.riskScore);
  return {
    tick: world.tick,
    engine: 'fallback',
    recommendations,
    watched: world.stations.filter((s) => s.status === 'OPEN').length * FUEL_TYPES.length,
    forecastMape: null,
  };
}
