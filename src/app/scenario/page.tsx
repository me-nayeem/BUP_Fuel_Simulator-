'use client';

import { Pause, Play, RotateCcw, SkipForward, Wrench } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useLiveData } from '@/components/providers/LiveDataProvider';
import { Card, PageHeader } from '@/components/ui/primitives';
import type { EventInjection, FaultInjection } from '@/lib/simulator/types';

type ScenarioAction =
  | { action: 'step'; steps: number }
  | { action: 'run' }
  | { action: 'pause' }
  | { action: 'reset' }
  | { action: 'clearFaults' }
  | { action: 'event'; event: EventInjection }
  | { action: 'fault'; fault: FaultInjection }
  | { action: 'plannerFault'; seconds: number }
  | { action: 'clearPlannerFault' };

interface EventPreset {
  label: string;
  description: string;
  build: (tick: number) => EventInjection;
}

const EVENTS: EventPreset[] = [
  {
    label: 'Demand spike · Dhaka',
    description: 'Demand ×1.8 in Dhaka for 3 hours',
    build: (tick) => ({
      type: 'demand_spike',
      start_tick: tick + 1,
      duration_ticks: 12,
      parameters: { region_ids: ['region-dhaka'], multiplier: 1.8 },
    }),
  },
  {
    label: 'Route disruption · Gazipur → Mirpur',
    description: 'Main Mirpur route closed for 2 hours',
    build: (tick) => ({
      type: 'route_disruption',
      start_tick: tick + 1,
      duration_ticks: 8,
      parameters: { route_ids: ['route-gazipur-mirpur'] },
    }),
  },
  {
    label: 'Station outage · Tongi',
    description: 'Tongi station closed for 2 hours',
    build: (tick) => ({
      type: 'station_outage',
      start_tick: tick + 1,
      duration_ticks: 8,
      parameters: { station_ids: ['station-tongi'] },
    }),
  },
  {
    label: 'Depot constraint · Gazipur',
    description: 'Gazipur depot constrained for 3 hours',
    build: (tick) => ({
      type: 'depot_constraint',
      start_tick: tick + 1,
      duration_ticks: 12,
      parameters: { depot_ids: ['depot-gazipur'] },
    }),
  },
  {
    label: 'Shipment delay · all depots',
    description: 'Incoming supply arrives 4 ticks late',
    build: (tick) => ({
      type: 'shipment_delay',
      start_tick: tick + 1,
      duration_ticks: 1,
      parameters: { delay_ticks: 4 },
    }),
  },
  {
    label: 'Supply shortfall · Gazipur diesel',
    description: 'Next diesel supply to Gazipur halved',
    build: (tick) => ({
      type: 'supply_shortfall',
      start_tick: tick + 1,
      duration_ticks: 1,
      parameters: { factor: 0.5, depot_ids: ['depot-gazipur'], fuel_types: ['DIESEL'] },
    }),
  },
];

const FAULTS: { label: string; description: string; fault: FaultInjection }[] = [
  {
    label: 'API unavailable',
    description: 'All data calls fail with 503 for 20 s',
    fault: { type: 'unavailable', duration_seconds: 20, parameters: {} },
  },
  {
    label: 'Random errors 30%',
    description: '30% of calls fail for 30 s',
    fault: { type: 'error_rate', duration_seconds: 30, parameters: { rate: 0.3 } },
  },
  {
    label: 'Slow API',
    description: '+1.5 s on every call for 30 s',
    fault: { type: 'latency', duration_seconds: 30, parameters: { delay_ms: 1500 } },
  },
  {
    label: 'Stale data',
    description: 'Simulator marks data stale for 30 s',
    fault: { type: 'stale_data', duration_seconds: 30, parameters: {} },
  },
  {
    label: 'Stream disconnect',
    description: 'Live stream refuses connections for 30 s',
    fault: { type: 'stream_disconnect', duration_seconds: 30, parameters: {} },
  },
];

function ActionButton({
  children,
  onClick,
  disabled,
  tone = 'default',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled: boolean;
  tone?: 'default' | 'primary' | 'danger';
}) {
  const styles = {
    default: 'border border-line bg-surface text-ink hover:bg-slate-50',
    primary: 'bg-brand text-white hover:bg-blue-800',
    danger: 'border border-red-200 bg-red-50 text-red-800 hover:bg-red-100',
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-[15px] font-semibold disabled:opacity-50 ${styles[tone]}`}
    >
      {children}
    </button>
  );
}

export default function ScenarioPage() {
  const { state } = useLiveData();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const tick = state?.world?.tick ?? 0;
  const running = state?.world?.simulationStatus === 'RUNNING';

  const send = async (body: ScenarioAction) => {
    setBusy(true);
    try {
      const response = await fetch('/api/scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      setMessage(
        result.ok
          ? { ok: true, text: result.message }
          : { ok: false, text: result.error?.message ?? 'Action failed.' },
      );
    } catch {
      setMessage({ ok: false, text: 'Backend unreachable.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Scenario Control"
        description="Drive the simulation and inject crises or software faults to see how the platform reacts."
      />

      {message && (
        <div
          className={`rounded-xl border px-5 py-3 text-[15px] ${
            message.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {message.text}
        </div>
      )}

      <Card
        title="Simulation clock"
        subtitle={`Current tick ${tick} · each tick is 15 simulated minutes`}
      >
        <div className="flex flex-wrap gap-3">
          <ActionButton disabled={busy} onClick={() => send({ action: 'step', steps: 1 })}>
            <SkipForward className="size-5" aria-hidden /> Step 15 min
          </ActionButton>
          <ActionButton disabled={busy} onClick={() => send({ action: 'step', steps: 4 })}>
            <SkipForward className="size-5" aria-hidden /> Step 1 hour
          </ActionButton>
          <ActionButton disabled={busy} onClick={() => send({ action: 'step', steps: 16 })}>
            <SkipForward className="size-5" aria-hidden /> Step 4 hours
          </ActionButton>
          {running ? (
            <ActionButton disabled={busy} tone="primary" onClick={() => send({ action: 'pause' })}>
              <Pause className="size-5" aria-hidden /> Pause
            </ActionButton>
          ) : (
            <ActionButton disabled={busy} tone="primary" onClick={() => send({ action: 'run' })}>
              <Play className="size-5" aria-hidden /> Run
            </ActionButton>
          )}
          <ActionButton
            disabled={busy}
            tone="danger"
            onClick={() => {
              if (
                window.confirm(
                  'Reset the simulation to tick 0? All shipments and events are cleared.',
                )
              ) {
                void send({ action: 'reset' });
              }
            }}
          >
            <RotateCcw className="size-5" aria-hidden /> Reset
          </ActionButton>
        </div>
      </Card>

      <Card title="Crisis events" subtitle="Changes to the simulated world, starting next tick">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {EVENTS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={busy}
              onClick={() => send({ action: 'event', event: preset.build(tick) })}
              className="rounded-lg border border-line bg-surface p-4 text-left hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50"
            >
              <div className="text-[15px] font-semibold text-ink">{preset.label}</div>
              <div className="mt-1 text-sm text-ink-muted">{preset.description}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card
        title="Software faults"
        subtitle="Break the simulator API to test resilience. Faults expire on their own."
        action={
          <ActionButton disabled={busy} onClick={() => send({ action: 'clearFaults' })}>
            <Wrench className="size-5" aria-hidden /> Clear faults
          </ActionButton>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {FAULTS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={busy}
              onClick={() => send({ action: 'fault', fault: preset.fault })}
              className="rounded-lg border border-line bg-surface p-4 text-left hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
            >
              <div className="text-[15px] font-semibold text-ink">{preset.label}</div>
              <div className="mt-1 text-sm text-ink-muted">{preset.description}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card
        title="Platform faults"
        subtitle="Break parts of our own platform to show fallback behaviour"
        action={
          <ActionButton disabled={busy} onClick={() => send({ action: 'clearPlannerFault' })}>
            <Wrench className="size-5" aria-hidden /> Restore planner
          </ActionButton>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => send({ action: 'plannerFault', seconds: 60 })}
            className="rounded-lg border border-line bg-surface p-4 text-left hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
          >
            <div className="text-[15px] font-semibold text-ink">Planner failure · 60 s</div>
            <div className="mt-1 text-sm text-ink-muted">
              The forecast planner stops working. The fallback refill rules take over and every
              shipment needs operator approval.
            </div>
          </button>
        </div>
      </Card>
    </>
  );
}
