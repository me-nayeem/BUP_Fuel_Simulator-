import { describe, expect, it } from 'vitest';
import { hourFactor, modelDemandPerTick } from '@/lib/intelligence/demand-model';
import { demandMultiplierAt, forecastStationFuel } from '@/lib/intelligence/forecast';
import { demandRow, demandSpike, makeWorld } from '../fixtures/world';

describe('demand model', () => {
  it('uses inclusive busy-hour ranges measured on the simulator', () => {
    expect(hourFactor('urban_high', 6)).toBe(0.7);
    expect(hourFactor('urban_high', 7)).toBe(1.45);
    expect(hourFactor('urban_high', 9)).toBe(1.45);
    expect(hourFactor('urban_high', 10)).toBe(0.7);
    expect(hourFactor('industrial', 6)).toBe(1.55);
    expect(hourFactor('industrial', 17)).toBe(1.55);
    expect(hourFactor('industrial', 18)).toBe(0.45);
    expect(hourFactor('regional', 20)).toBe(1.25);
    expect(hourFactor('regional', 21)).toBe(0.65);
  });

  it('matches the measured Mirpur diesel demand at midnight', () => {
    const value = modelDemandPerTick({
      profile: 'urban_high',
      fuel: 'DIESEL',
      hour: 0,
      regionFactor: 1,
      multiplier: 1,
      tickMinutes: 15,
    });
    expect(value).toBeCloseTo((8500 / 96) * 0.7, 6);
  });
});

describe('forecast', () => {
  it('rises when the industrial shift starts at 06:00', () => {
    const world = makeWorld({ tick: 20, simTime: '2026-01-01T05:00:00Z' });
    const tongi = world.stations[1];
    const forecast = forecastStationFuel(world, tongi, 'DIESEL', 8);
    expect(forecast.perTick[3]).toBeCloseTo((14000 / 96) * 0.45, 6);
    expect(forecast.perTick[4]).toBeCloseTo((14000 / 96) * 1.55, 6);
  });

  it('applies the chattogram region factor', () => {
    const world = makeWorld();
    const cox = world.stations[3];
    const forecast = forecastStationFuel(world, cox, 'PETROL', 1);
    expect(forecast.perTick[0]).toBeCloseTo((7600 / 96) * 0.65 * 1.08, 6);
  });

  it('includes a scheduled demand spike only inside its window', () => {
    const world = makeWorld({ events: [demandSpike()] });
    const mirpur = world.stations[0];
    expect(demandMultiplierAt(world, mirpur, 3)).toBe(1);
    expect(demandMultiplierAt(world, mirpur, 4)).toBe(2);
    expect(demandMultiplierAt(world, mirpur, 7)).toBe(2);
    expect(demandMultiplierAt(world, mirpur, 8)).toBe(1);
    expect(demandMultiplierAt(world, world.stations[2], 5)).toBe(1);
  });

  it('removes an active spike after it ends', () => {
    const spike = demandSpike({ status: 'ACTIVE', start_tick: 0, end_tick: 4 });
    const world = makeWorld({ tick: 2, events: [spike] });
    const mirpur = { ...world.stations[0], demand_multiplier: 2 };
    expect(demandMultiplierAt(world, mirpur, 3)).toBe(2);
    expect(demandMultiplierAt(world, mirpur, 4)).toBe(1);
  });

  it('calibrates toward recent actual demand and reports its error', () => {
    const base = (8500 / 96) * 0.7;
    const history = [0, 1, 2, 3].map((tick) =>
      demandRow('station-mirpur', 'DIESEL', tick, base * 1.1),
    );
    const world = makeWorld({ tick: 4, simTime: '2026-01-01T01:00:00Z', demandHistory: history });
    const forecast = forecastStationFuel(world, world.stations[0], 'DIESEL', 2);
    expect(forecast.calibration).toBeCloseTo(1.1, 6);
    expect(forecast.perTick[0]).toBeCloseTo(base * 1.1, 6);
    expect(forecast.mape).toBeCloseTo(0, 6);
    expect(forecast.samples).toBe(4);
  });

  it('forecasts zero demand for a station in outage', () => {
    const world = makeWorld();
    const closed = { ...world.stations[0], status: 'OUTAGE' as const };
    expect(forecastStationFuel(world, closed, 'DIESEL', 4).total).toBe(0);
  });
});
