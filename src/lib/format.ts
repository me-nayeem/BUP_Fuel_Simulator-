import type { FuelType } from '@/lib/simulator/types';

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

const litersFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function liters(value: number): string {
  return `${litersFormat.format(Math.round(value))} L`;
}

export function compactLiters(value: number): string {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k L`;
  return `${Math.round(value)} L`;
}

export function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function simClock(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
  const time = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  return `${day} · ${time}`;
}

export function wallClock(epochMs: number | null): string {
  if (epochMs === null) return '—';
  return new Date(epochMs).toLocaleTimeString('en-GB');
}

export function stationLabel(id: string): string {
  const names: Record<string, string> = {
    'station-mirpur': 'Mirpur',
    'station-tongi': 'Tongi',
    'station-karnaphuli': 'Karnaphuli',
    'station-coxsbazar': "Cox's Bazar",
  };
  return names[id] ?? id.replace(/^station-/, '');
}

export function depotLabel(id: string): string {
  const names: Record<string, string> = {
    'depot-gazipur': 'Gazipur',
    'depot-patiya': 'Patiya',
  };
  return names[id] ?? id.replace(/^depot-/, '');
}

export function regionLabel(id: string): string {
  const names: Record<string, string> = {
    'region-dhaka': 'Dhaka',
    'region-chattogram': 'Chattogram',
  };
  return names[id] ?? id.replace(/^region-/, '');
}

export const FUEL_LABEL: Record<FuelType, string> = {
  DIESEL: 'Diesel',
  PETROL: 'Petrol',
  OCTANE: 'Octane',
};

export const FUEL_COLOR: Record<FuelType, string> = {
  DIESEL: 'var(--color-diesel)',
  PETROL: 'var(--color-petrol)',
  OCTANE: 'var(--color-octane)',
};

export function fillTone(ratio: number): Tone {
  if (ratio < 0.2) return 'bad';
  if (ratio < 0.4) return 'warn';
  return 'good';
}

const STATUS_TONE: Record<string, Tone> = {
  HEALTHY: 'good',
  LIVE: 'good',
  OPEN: 'good',
  AVAILABLE: 'good',
  ARRIVED: 'good',
  RUNNING: 'good',
  RESOLVED: 'neutral',
  PAUSED: 'info',
  SCHEDULED: 'info',
  PENDING: 'info',
  IN_TRANSIT: 'info',
  NOT_STARTED: 'neutral',
  DISABLED: 'neutral',
  CANCELLED: 'neutral',
  DEGRADED: 'warn',
  LAST_KNOWN_GOOD: 'warn',
  CONSTRAINED: 'warn',
  DELAYED: 'warn',
  ACTIVE: 'warn',
  DOWN: 'bad',
  OUTAGE: 'bad',
  DISRUPTED: 'bad',
  FAILED: 'bad',
  NONE: 'bad',
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? 'neutral';
}

export function statusLabel(status: string): string {
  if (status === 'LAST_KNOWN_GOOD') return 'Last known good';
  if (status === 'NOT_STARTED') return 'Not started';
  const text = status.replaceAll('_', ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
