import type { DemandObservation, SimEvent } from '@/lib/simulator/types';
import type { WorldState } from '@/lib/world/snapshot';

export function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  return {
    tick: 0,
    simTime: '2026-01-01T00:00:00Z',
    simulationStatus: 'PAUSED',
    tickMinutes: 15,
    seed: 12345,
    scenarioId: 'baseline',
    regions: [
      { id: 'region-dhaka', name: 'Dhaka Division', demand_factor: 1 },
      { id: 'region-chattogram', name: 'Chattogram Division', demand_factor: 1.08 },
    ],
    depots: [
      {
        id: 'depot-gazipur',
        name: 'Gazipur Depot',
        region_id: 'region-dhaka',
        status: 'OPEN',
        dispatch_capacity_per_tick: 12000,
        capacity: { DIESEL: 90000, PETROL: 70000, OCTANE: 45000 },
        inventory: { DIESEL: 60000, PETROL: 45000, OCTANE: 26000 },
      },
      {
        id: 'depot-patiya',
        name: 'Patiya Depot',
        region_id: 'region-chattogram',
        status: 'OPEN',
        dispatch_capacity_per_tick: 11000,
        capacity: { DIESEL: 85000, PETROL: 65000, OCTANE: 40000 },
        inventory: { DIESEL: 55000, PETROL: 42000, OCTANE: 24000 },
      },
    ],
    stations: [
      {
        id: 'station-mirpur',
        name: 'Mirpur Fuel Station',
        region_id: 'region-dhaka',
        status: 'OPEN',
        demand_profile: 'urban_high',
        demand_multiplier: 1,
        capacity: { DIESEL: 15000, PETROL: 14000, OCTANE: 9000 },
        inventory: { DIESEL: 9000, PETROL: 9000, OCTANE: 5000 },
      },
      {
        id: 'station-tongi',
        name: 'Tongi Industrial Station',
        region_id: 'region-dhaka',
        status: 'OPEN',
        demand_profile: 'industrial',
        demand_multiplier: 1,
        capacity: { DIESEL: 18000, PETROL: 9000, OCTANE: 6000 },
        inventory: { DIESEL: 11000, PETROL: 6000, OCTANE: 3500 },
      },
      {
        id: 'station-karnaphuli',
        name: 'Karnaphuli Highway Station',
        region_id: 'region-chattogram',
        status: 'OPEN',
        demand_profile: 'highway',
        demand_multiplier: 1,
        capacity: { DIESEL: 14000, PETROL: 15000, OCTANE: 9000 },
        inventory: { DIESEL: 8500, PETROL: 9500, OCTANE: 5200 },
      },
      {
        id: 'station-coxsbazar',
        name: "Cox's Bazar Regional Station",
        region_id: 'region-chattogram',
        status: 'OPEN',
        demand_profile: 'regional',
        demand_multiplier: 1,
        capacity: { DIESEL: 12000, PETROL: 12000, OCTANE: 7000 },
        inventory: { DIESEL: 7500, PETROL: 7500, OCTANE: 4200 },
      },
    ],
    routes: [
      {
        id: 'route-gazipur-mirpur',
        source_depot_id: 'depot-gazipur',
        destination_station_id: 'station-mirpur',
        transit_ticks: 2,
        max_shipment: 7000,
        status: 'AVAILABLE',
      },
      {
        id: 'route-gazipur-tongi',
        source_depot_id: 'depot-gazipur',
        destination_station_id: 'station-tongi',
        transit_ticks: 2,
        max_shipment: 6500,
        status: 'AVAILABLE',
      },
      {
        id: 'route-patiya-karnaphuli',
        source_depot_id: 'depot-patiya',
        destination_station_id: 'station-karnaphuli',
        transit_ticks: 2,
        max_shipment: 7000,
        status: 'AVAILABLE',
      },
      {
        id: 'route-patiya-coxsbazar',
        source_depot_id: 'depot-patiya',
        destination_station_id: 'station-coxsbazar',
        transit_ticks: 3,
        max_shipment: 6000,
        status: 'AVAILABLE',
      },
      {
        id: 'route-gazipur-karnaphuli',
        source_depot_id: 'depot-gazipur',
        destination_station_id: 'station-karnaphuli',
        transit_ticks: 4,
        max_shipment: 5000,
        status: 'AVAILABLE',
      },
      {
        id: 'route-patiya-mirpur',
        source_depot_id: 'depot-patiya',
        destination_station_id: 'station-mirpur',
        transit_ticks: 4,
        max_shipment: 5000,
        status: 'AVAILABLE',
      },
    ],
    supplyArrivals: [],
    events: [],
    allocations: [],
    demandHistory: [],
    metrics: {
      served_demand_liters: 0,
      unmet_demand_liters: 0,
      service_level: 1,
      allocation_liters: 0,
      allocation_failures: 0,
    },
    ...overrides,
  };
}

export function demandRow(
  stationId: string,
  fuel: DemandObservation['fuel_type'],
  tick: number,
  demand: number,
): DemandObservation {
  const minutes = tick * 15;
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return {
    id: tick * 100,
    station_id: stationId,
    fuel_type: fuel,
    tick,
    sim_time: `2026-01-01T${hh}:${mm}:00Z`,
    demand_liters: demand,
    served_liters: demand,
    unmet_liters: 0,
  };
}

export function demandSpike(overrides: Partial<SimEvent> = {}): SimEvent {
  return {
    id: 1,
    type: 'demand_spike',
    start_tick: 4,
    end_tick: 8,
    status: 'SCHEDULED',
    parameters: { region_ids: ['region-dhaka'], multiplier: 2 },
    ...overrides,
  };
}
