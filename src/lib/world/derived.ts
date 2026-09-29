import { FUEL_TYPES, type Allocation, type FuelType, type SimEvent } from '@/lib/simulator/types';
import type { WorldState } from './snapshot';

export interface StockLevel {
  stationId: string;
  stationName: string;
  regionId: string;
  stationStatus: string;
  fuel: FuelType;
  inventory: number;
  capacity: number;
  ratio: number;
}

export function stationStockLevels(world: WorldState): StockLevel[] {
  return world.stations.flatMap((station) =>
    FUEL_TYPES.map((fuel) => ({
      stationId: station.id,
      stationName: station.name,
      regionId: station.region_id,
      stationStatus: station.status,
      fuel,
      inventory: station.inventory[fuel],
      capacity: station.capacity[fuel],
      ratio: station.capacity[fuel] > 0 ? station.inventory[fuel] / station.capacity[fuel] : 0,
    })),
  );
}

export function openShipments(world: WorldState): Allocation[] {
  return world.allocations.filter((a) => a.status === 'PENDING' || a.status === 'IN_TRANSIT');
}

export function shipmentsByRoute(world: WorldState): Map<string, Allocation[]> {
  const byRoute = new Map<string, Allocation[]>();
  for (const allocation of openShipments(world)) {
    const list = byRoute.get(allocation.route_id) ?? [];
    list.push(allocation);
    byRoute.set(allocation.route_id, list);
  }
  return byRoute;
}

export function currentEvents(world: WorldState): SimEvent[] {
  return world.events.filter((e) => e.status === 'ACTIVE' || e.status === 'SCHEDULED');
}

export const LOW_STOCK_RATIO = 0.25;

export interface DemandPoint {
  tick: number;
  time: string;
  DIESEL: number;
  PETROL: number;
  OCTANE: number;
  unmet: number;
}

export function stationDemandSeries(world: WorldState, stationId: string): DemandPoint[] {
  const byTick = new Map<number, DemandPoint>();
  for (const row of world.demandHistory) {
    if (row.station_id !== stationId) continue;
    const point = byTick.get(row.tick) ?? {
      tick: row.tick,
      time: row.sim_time.slice(11, 16),
      DIESEL: 0,
      PETROL: 0,
      OCTANE: 0,
      unmet: 0,
    };
    point[row.fuel_type] = Math.round(row.demand_liters);
    point.unmet += row.unmet_liters;
    byTick.set(row.tick, point);
  }
  return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

export interface UsageRate {
  litersPerHour: number | null;
  hoursLeft: number | null;
  recentUnmet: number;
}

export function recentUsage(
  world: WorldState,
  stationId: string,
  fuel: FuelType,
  inventory: number,
  windowTicks = 4,
): UsageRate {
  const rows = world.demandHistory
    .filter((r) => r.station_id === stationId && r.fuel_type === fuel)
    .sort((a, b) => b.tick - a.tick)
    .slice(0, windowTicks);
  if (rows.length === 0) return { litersPerHour: null, hoursLeft: null, recentUnmet: 0 };
  const perTick = rows.reduce((sum, r) => sum + r.demand_liters, 0) / rows.length;
  const ticksPerHour = 60 / world.tickMinutes;
  const litersPerHour = perTick * ticksPerHour;
  return {
    litersPerHour,
    hoursLeft: litersPerHour > 0 ? inventory / litersPerHour : null,
    recentUnmet: rows.reduce((sum, r) => sum + r.unmet_liters, 0),
  };
}
