import type { FuelAmounts, FuelType } from '@/lib/simulator/types';

export type DemandProfile = 'urban_high' | 'industrial' | 'highway' | 'regional';

export const DAILY_DEMAND: Record<DemandProfile, FuelAmounts> = {
  urban_high: { DIESEL: 8500, PETROL: 10500, OCTANE: 5600 },
  industrial: { DIESEL: 14000, PETROL: 4500, OCTANE: 2200 },
  highway: { DIESEL: 10500, PETROL: 11000, OCTANE: 6200 },
  regional: { DIESEL: 7200, PETROL: 7600, OCTANE: 3600 },
};

export const DEMAND_NOISE: Record<DemandProfile, number> = {
  urban_high: 0.1,
  industrial: 0.08,
  highway: 0.12,
  regional: 0.1,
};

interface HourPattern {
  busyHours: [number, number][];
  busy: number;
  quiet: number;
}

const HOUR_PATTERN: Record<DemandProfile, HourPattern> = {
  urban_high: {
    busyHours: [
      [7, 9],
      [16, 20],
    ],
    busy: 1.45,
    quiet: 0.7,
  },
  industrial: { busyHours: [[6, 17]], busy: 1.55, quiet: 0.45 },
  highway: {
    busyHours: [
      [6, 9],
      [16, 20],
    ],
    busy: 1.35,
    quiet: 0.75,
  },
  regional: { busyHours: [[7, 20]], busy: 1.25, quiet: 0.65 },
};

export function isDemandProfile(value: string): value is DemandProfile {
  return value in DAILY_DEMAND;
}

export function hourFactor(profile: DemandProfile, hour: number): number {
  const pattern = HOUR_PATTERN[profile];
  const busy = pattern.busyHours.some(([from, to]) => hour >= from && hour <= to);
  return busy ? pattern.busy : pattern.quiet;
}

export function isBusyHour(profile: DemandProfile, hour: number): boolean {
  return hourFactor(profile, hour) === HOUR_PATTERN[profile].busy;
}

export function modelDemandPerTick(params: {
  profile: DemandProfile;
  fuel: FuelType;
  hour: number;
  regionFactor: number;
  multiplier: number;
  tickMinutes: number;
}): number {
  const ticksPerDay = 1440 / params.tickMinutes;
  return (
    (DAILY_DEMAND[params.profile][params.fuel] / ticksPerDay) *
    hourFactor(params.profile, params.hour) *
    params.regionFactor *
    params.multiplier
  );
}
