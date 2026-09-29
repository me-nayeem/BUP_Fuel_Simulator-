import { FUEL_TYPES, type FuelType, type SimEvent, type Station } from '@/lib/simulator/types';
import type { WorldState } from '@/lib/world/snapshot';
import {
  DEMAND_NOISE,
  isDemandProfile,
  modelDemandPerTick,
  type DemandProfile,
} from './demand-model';

export const DEFAULT_HORIZON_TICKS = 24;
const CALIBRATION_WINDOW_TICKS = 16;
const CALIBRATION_MIN = 0.7;
const CALIBRATION_MAX = 1.3;

export interface FuelForecast {
  stationId: string;
  fuel: FuelType;
  startTick: number;
  perTick: number[];
  perTickSd: number[];
  total: number;
  calibration: number;
  mape: number | null;
  samples: number;
}

export function tickTime(world: WorldState, tick: number): Date {
  return new Date(Date.parse(world.simTime) + (tick - world.tick) * world.tickMinutes * 60_000);
}

function listParam(event: SimEvent, key: string): string[] {
  const value = event.parameters[key];
  return Array.isArray(value) ? value.map(String) : [];
}

export function eventAffectsStation(event: SimEvent, station: Station): boolean {
  const stationIds = listParam(event, 'station_ids');
  const regionIds = listParam(event, 'region_ids');
  if (stationIds.length === 0 && regionIds.length === 0) return true;
  return stationIds.includes(station.id) || regionIds.includes(station.region_id);
}

function spikeMultiplier(event: SimEvent): number {
  const value = event.parameters.multiplier;
  return typeof value === 'number' && value > 0 ? value : 1.5;
}

function eventSpikeProduct(events: SimEvent[], station: Station, tick: number): number {
  let product = 1;
  for (const event of events) {
    if (event.type !== 'demand_spike' || !eventAffectsStation(event, station)) continue;
    if (tick >= event.start_tick && tick < event.end_tick) product *= spikeMultiplier(event);
  }
  return product;
}

export function demandMultiplierAt(world: WorldState, station: Station, tick: number): number {
  const activeNow = world.events.filter((e) => e.status === 'ACTIVE');
  const explainedNow = eventSpikeProduct(activeNow, station, world.tick);
  const baseline =
    explainedNow > 0 ? station.demand_multiplier / explainedNow : station.demand_multiplier;
  return baseline * eventSpikeProduct(world.events, station, tick);
}

function regionFactor(world: WorldState, station: Station): number {
  return world.regions.find((r) => r.id === station.region_id)?.demand_factor ?? 1;
}

function modelAt(
  world: WorldState,
  station: Station,
  profile: DemandProfile,
  fuel: FuelType,
  tick: number,
) {
  return modelDemandPerTick({
    profile,
    fuel,
    hour: tickTime(world, tick).getUTCHours(),
    regionFactor: regionFactor(world, station),
    multiplier: demandMultiplierAt(world, station, tick),
    tickMinutes: world.tickMinutes,
  });
}

function calibrate(world: WorldState, station: Station, profile: DemandProfile, fuel: FuelType) {
  const rows = world.demandHistory
    .filter((r) => r.station_id === station.id && r.fuel_type === fuel)
    .sort((a, b) => b.tick - a.tick)
    .slice(0, CALIBRATION_WINDOW_TICKS);
  if (rows.length === 0) return { calibration: 1, mape: null, residualSd: 0, samples: 0 };

  const pairs = rows.map((row) => ({
    actual: row.demand_liters,
    model: modelAt(world, station, profile, fuel, row.tick),
  }));
  const modelSum = pairs.reduce((sum, p) => sum + p.model, 0);
  const actualSum = pairs.reduce((sum, p) => sum + p.actual, 0);
  const raw = modelSum > 0 ? actualSum / modelSum : 1;
  const calibration = Math.min(CALIBRATION_MAX, Math.max(CALIBRATION_MIN, raw));

  const errors = pairs
    .filter((p) => p.actual > 0)
    .map((p) => Math.abs(p.actual - p.model * calibration) / p.actual);
  const mape = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : null;
  const ratios = pairs.filter((p) => p.model > 0).map((p) => p.actual / (p.model * calibration));
  const mean = ratios.reduce((a, b) => a + b, 0) / Math.max(1, ratios.length);
  const residualSd = Math.sqrt(
    ratios.reduce((sum, r) => sum + (r - mean) ** 2, 0) / Math.max(1, ratios.length - 1),
  );

  return { calibration, mape, residualSd, samples: rows.length };
}

export function forecastStationFuel(
  world: WorldState,
  station: Station,
  fuel: FuelType,
  horizonTicks = DEFAULT_HORIZON_TICKS,
): FuelForecast {
  const empty: FuelForecast = {
    stationId: station.id,
    fuel,
    startTick: world.tick,
    perTick: [],
    perTickSd: [],
    total: 0,
    calibration: 1,
    mape: null,
    samples: 0,
  };
  if (!isDemandProfile(station.demand_profile)) return empty;
  const profile = station.demand_profile;

  const { calibration, mape, residualSd, samples } = calibrate(world, station, profile, fuel);
  const relativeSd = Math.max(DEMAND_NOISE[profile] / Math.sqrt(3), residualSd);

  const perTick: number[] = [];
  const perTickSd: number[] = [];
  for (let offset = 0; offset < horizonTicks; offset += 1) {
    const value =
      station.status === 'OPEN'
        ? modelAt(world, station, profile, fuel, world.tick + offset) * calibration
        : 0;
    perTick.push(value);
    perTickSd.push(value * relativeSd);
  }

  return {
    ...empty,
    perTick,
    perTickSd,
    total: perTick.reduce((a, b) => a + b, 0),
    calibration,
    mape,
    samples,
  };
}

export function forecastAll(
  world: WorldState,
  horizonTicks = DEFAULT_HORIZON_TICKS,
): FuelForecast[] {
  return world.stations.flatMap((station) =>
    FUEL_TYPES.map((fuel) => forecastStationFuel(world, station, fuel, horizonTicks)),
  );
}

export function networkForecastMape(forecasts: FuelForecast[]): number | null {
  const withError = forecasts.filter((f) => f.mape !== null);
  if (withError.length === 0) return null;
  return withError.reduce((sum, f) => sum + (f.mape ?? 0), 0) / withError.length;
}
