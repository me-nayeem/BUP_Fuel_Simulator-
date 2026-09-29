import {
  FUEL_TYPES,
  type Depot,
  type FuelType,
  type Route,
  type Station,
} from '@/lib/simulator/types';
import type { WorldState } from '@/lib/world/snapshot';
import { depotLabel, FUEL_LABEL, stationLabel } from '@/lib/format';
import { DEFAULT_HORIZON_TICKS, forecastAll, type FuelForecast } from './forecast';

const REVIEW_TICKS = 8;
const TARGET_FILL = 0.9;
const LOW_FILL = 0.25;
const MIN_SHIPMENT = 500;

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Shipment {
  depotId: string;
  routeId: string;
  transitTicks: number;
  quantity: number;
}

export interface Recommendation {
  id: string;
  tick: number;
  stationId: string;
  fuel: FuelType;
  inventory: number;
  capacity: number;
  inbound: number;
  forecastNext6h: number;
  hoursToEmpty: number | null;
  riskScore: number;
  level: RiskLevel;
  action: 'SHIP' | 'BLOCKED';
  shipment: Shipment | null;
  riskAfter: number | null;
  hoursToEmptyAfter: number | null;
  reasons: string[];
  alternatives: string[];
  forecastMape: number | null;
  engine: 'planner' | 'fallback';
  reviewReason: string | null;
}

export interface Plan {
  tick: number;
  recommendations: Recommendation[];
  watched: number;
  forecastMape: number | null;
  engine: 'planner' | 'fallback';
}

interface Arrival {
  offset: number;
  quantity: number;
}

function ticksToEmpty(inventory: number, arrivals: Arrival[], demand: number[]): number | null {
  let stock = inventory;
  for (let t = 0; t < demand.length; t += 1) {
    for (const arrival of arrivals) if (arrival.offset === t) stock += arrival.quantity;
    stock -= demand[t];
    if (stock <= 0) return t;
  }
  return null;
}

function stockAt(inventory: number, arrivals: Arrival[], demand: number[], offset: number): number {
  let stock = inventory;
  for (let t = 0; t <= Math.min(offset, demand.length - 1); t += 1) {
    for (const arrival of arrivals) if (arrival.offset === t) stock += arrival.quantity;
    stock = Math.max(0, stock - demand[t]);
  }
  return stock;
}

export function riskScore(emptyInTicks: number | null, fillRatio: number, horizon: number): number {
  const urgency = emptyInTicks === null ? 0 : 1 - emptyInTicks / horizon;
  return Math.round(Math.min(100, Math.max(0, urgency * 75 + (1 - fillRatio) * 25)));
}

export function riskLevel(score: number): RiskLevel {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

function hours(ticks: number, tickMinutes: number): number {
  return (ticks * tickMinutes) / 60;
}

function formatHours(value: number | null): string {
  if (value === null) return 'more than 6 h';
  if (value < 1) return `${Math.round(value * 60)} min`;
  return `${value.toFixed(1)} h`;
}

function liters(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} L`;
}

export function routeBlockedSoon(world: WorldState, route: Route): boolean {
  return world.events.some((event) => {
    if (event.type !== 'route_disruption' || event.status === 'RESOLVED') return false;
    const ids = Array.isArray(event.parameters.route_ids)
      ? event.parameters.route_ids.map(String)
      : [];
    const affected = ids.length === 0 || ids.includes(route.id);
    return affected && event.start_tick <= world.tick + 1 && event.end_tick > world.tick;
  });
}

function incomingArrivals(world: WorldState, stationId: string, fuel: FuelType): Arrival[] {
  return world.allocations
    .filter(
      (a) =>
        a.destination_station_id === stationId &&
        a.fuel_type === fuel &&
        (a.status === 'PENDING' || a.status === 'IN_TRANSIT'),
    )
    .map((a) => {
      const route = world.routes.find((r) => r.id === a.route_id);
      const arrivalTick = a.expected_arrival_tick ?? a.created_tick + (route?.transit_ticks ?? 2);
      return { offset: Math.max(0, arrivalTick - world.tick), quantity: a.quantity };
    });
}

export function buildPlan(world: WorldState, horizon = DEFAULT_HORIZON_TICKS): Plan {
  const forecasts = forecastAll(world, horizon);
  const forecastFor = (stationId: string, fuel: FuelType) =>
    forecasts.find((f) => f.stationId === stationId && f.fuel === fuel) as FuelForecast;

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

  const candidates: Recommendation[] = [];
  const ticksIn6h = Math.round(360 / world.tickMinutes);

  for (const station of world.stations) {
    if (station.status !== 'OPEN') continue;
    for (const fuel of FUEL_TYPES) {
      const forecast = forecastFor(station.id, fuel);
      const inventory = station.inventory[fuel];
      const capacity = station.capacity[fuel];
      const arrivals = incomingArrivals(world, station.id, fuel);
      const inbound = arrivals.reduce((sum, a) => sum + a.quantity, 0);
      const routes = world.routes.filter((r) => r.destination_station_id === station.id);
      const fastest = Math.min(...routes.map((r) => r.transit_ticks));
      const checkpoint = fastest + REVIEW_TICKS;
      const projected = stockAt(inventory, arrivals, forecast.perTick, checkpoint);
      const empty = ticksToEmpty(inventory, arrivals, forecast.perTick);
      const score = riskScore(empty, inventory / capacity, horizon);

      if (projected >= capacity * LOW_FILL && score < 60) continue;

      candidates.push({
        id: `${world.tick}-${station.id}-${fuel}`,
        tick: world.tick,
        stationId: station.id,
        fuel,
        inventory,
        capacity,
        inbound,
        forecastNext6h: forecast.perTick.slice(0, ticksIn6h).reduce((a, b) => a + b, 0),
        hoursToEmpty: empty === null ? null : hours(empty, world.tickMinutes),
        riskScore: score,
        level: riskLevel(score),
        action: 'BLOCKED',
        shipment: null,
        riskAfter: null,
        hoursToEmptyAfter: null,
        reasons: [],
        alternatives: [],
        forecastMape: forecast.mape,
        engine: 'planner',
        reviewReason: null,
      });
    }
  }

  candidates.sort((a, b) => b.riskScore - a.riskScore);

  for (const rec of candidates) {
    const station = world.stations.find((s) => s.id === rec.stationId) as Station;
    const forecast = forecastFor(rec.stationId, rec.fuel);
    const arrivals = incomingArrivals(world, rec.stationId, rec.fuel);
    const room = rec.capacity - rec.inventory - rec.inbound;
    const wanted = Math.min(room, rec.capacity * TARGET_FILL - rec.inventory - rec.inbound);

    rec.reasons.push(
      `Stock ${liters(rec.inventory)} (${Math.round((rec.inventory / rec.capacity) * 100)}% full)${
        rec.inbound > 0 ? ` with ${liters(rec.inbound)} already on the way` : ''
      }.`,
      `Forecast demand next 6 h: ${liters(rec.forecastNext6h)}. Runs out in ${formatHours(rec.hoursToEmpty)}.`,
    );

    const routes = world.routes
      .filter((r) => r.destination_station_id === rec.stationId)
      .sort((a, b) => {
        const depotA = world.depots.find((d) => d.id === a.source_depot_id) as Depot;
        const depotB = world.depots.find((d) => d.id === b.source_depot_id) as Depot;
        const constrained = Number(depotA.status !== 'OPEN') - Number(depotB.status !== 'OPEN');
        return constrained !== 0 ? constrained : a.transit_ticks - b.transit_ticks;
      });

    for (const route of routes) {
      const depot = world.depots.find((d) => d.id === route.source_depot_id) as Depot;
      const name = `${depotLabel(depot.id)} → ${stationLabel(rec.stationId)}`;
      const stock = depotStock.get(depot.id)?.[rec.fuel] ?? 0;
      const dispatch = dispatchLeft.get(depot.id) ?? 0;

      if (route.status !== 'AVAILABLE' || routeBlockedSoon(world, route)) {
        rec.alternatives.push(`${name}: route disrupted.`);
        continue;
      }
      if (rec.shipment) {
        rec.alternatives.push(
          `${name}: slower (${route.transit_ticks} ticks) or lower priority depot.`,
        );
        continue;
      }

      const quantity =
        Math.floor(Math.min(wanted, route.max_shipment, stock, dispatch) / 100) * 100;
      if (quantity < MIN_SHIPMENT) {
        const why =
          wanted < MIN_SHIPMENT
            ? 'station tank is nearly full or fuel is already on the way'
            : stock < MIN_SHIPMENT
              ? 'depot has no stock of this fuel'
              : dispatch < MIN_SHIPMENT
                ? 'depot dispatch capacity for this tick is used up'
                : 'shipment too small';
        rec.alternatives.push(`${name}: ${why}.`);
        continue;
      }

      const withShipment = [...arrivals, { offset: route.transit_ticks, quantity }];
      const emptyAfter = ticksToEmpty(rec.inventory, withShipment, forecast.perTick);
      const scoreAfter = riskScore(emptyAfter, (rec.inventory + quantity) / rec.capacity, horizon);

      rec.action = 'SHIP';
      rec.shipment = {
        depotId: depot.id,
        routeId: route.id,
        transitTicks: route.transit_ticks,
        quantity,
      };
      rec.riskAfter = scoreAfter;
      rec.hoursToEmptyAfter = emptyAfter === null ? null : hours(emptyAfter, world.tickMinutes);
      rec.reasons.push(
        `${name} is the fastest usable route: arrives in ${formatHours(hours(route.transit_ticks, world.tickMinutes))}${
          depot.status === 'CONSTRAINED' ? ' (depot constrained)' : ''
        }.`,
        `Ship ${liters(quantity)} ${FUEL_LABEL[rec.fuel].toLowerCase()} → risk ${rec.riskScore} to ${scoreAfter}.`,
      );

      depotStock.set(depot.id, {
        ...(depotStock.get(depot.id) ?? depot.inventory),
        [rec.fuel]: stock - quantity,
      });
      dispatchLeft.set(depot.id, dispatch - quantity);
    }

    if (!rec.shipment) rec.reasons.push('No valid shipment is possible right now.');
    if (station.demand_multiplier !== 1) {
      rec.reasons.push(
        `Demand is running at ×${station.demand_multiplier.toFixed(2)} due to a demand spike.`,
      );
    }
  }

  const withMape = forecasts.filter((f) => f.mape !== null);
  return {
    tick: world.tick,
    engine: 'planner',
    recommendations: candidates,
    watched: world.stations.filter((s) => s.status === 'OPEN').length * FUEL_TYPES.length,
    forecastMape:
      withMape.length > 0
        ? withMape.reduce((sum, f) => sum + (f.mape ?? 0), 0) / withMape.length
        : null,
  };
}
