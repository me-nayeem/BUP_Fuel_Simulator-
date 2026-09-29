'use client';

import { Loader2 } from 'lucide-react';
import { useLiveData } from '@/components/providers/LiveDataProvider';
import { usePolling } from '@/components/providers/usePolling';
import { Card, EmptyState, PageHeader, Pill, StatusPill } from '@/components/ui/primitives';
import { depotLabel, regionLabel, stationLabel, type Tone } from '@/lib/format';
import type { LogEntry } from '@/lib/observability/logger';
import type { SimEvent } from '@/lib/simulator/types';

const EVENT_TITLE: Record<SimEvent['type'], string> = {
  demand_spike: 'Demand spike',
  route_disruption: 'Route disruption',
  station_outage: 'Station outage',
  depot_constraint: 'Depot constraint',
  shipment_delay: 'Shipment delay',
  supply_shortfall: 'Supply shortfall',
};

const LEVEL_TONE: Record<string, Tone> = {
  info: 'info',
  warn: 'warn',
  error: 'bad',
  debug: 'neutral',
};

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function routeName(id: string): string {
  const [, depot, station] = id.split('-');
  return depot && station
    ? `${depotLabel(`depot-${depot}`)} → ${stationLabel(`station-${station}`)}`
    : id;
}

function affects(event: SimEvent): string {
  const p = event.parameters;
  const parts: string[] = [];
  const regions = list(p.region_ids).map(regionLabel);
  const stations = list(p.station_ids).map(stationLabel);
  const depots = list(p.depot_ids).map(depotLabel);
  const routes = list(p.route_ids).map(routeName);
  const fuels = list(p.fuel_types).map((f) => f.charAt(0) + f.slice(1).toLowerCase());

  if (regions.length) parts.push(regions.join(', '));
  if (stations.length) parts.push(stations.join(', '));
  if (depots.length) parts.push(depots.join(', '));
  if (routes.length) parts.push(routes.join(', '));
  if (fuels.length) parts.push(fuels.join(', '));
  if (parts.length === 0) parts.push('Whole network');

  if (typeof p.multiplier === 'number') parts.push(`demand ×${p.multiplier}`);
  if (typeof p.factor === 'number') parts.push(`supply ×${p.factor}`);
  if (typeof p.delay_ticks === 'number') parts.push(`${p.delay_ticks} ticks late`);
  return parts.join(' · ');
}

function humanise(event: string): string {
  const text = event.replaceAll('.', ' ').replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function details(entry: LogEntry): string {
  return Object.entries(entry)
    .filter(([key]) => !['ts', 'level', 'event'].includes(key))
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
    )
    .join(' · ');
}

export default function EventsPage() {
  const { state } = useLiveData();
  const activity = usePolling<{ entries: LogEntry[] }>('/api/activity?limit=50', 3000);
  const world = state?.world;

  if (!world) {
    return (
      <>
        <PageHeader
          title="Events & Alerts"
          description="Crisis events, incidents and system alerts."
        />
        <EmptyState
          icon={Loader2}
          title="Connecting to the simulator"
          message="Waiting for the first network snapshot."
        />
      </>
    );
  }

  const events = [...world.events].sort((a, b) => b.id - a.id);

  return (
    <>
      <PageHeader
        title="Events & Alerts"
        description="Crisis events in the simulated network and what our system noticed and did."
      />

      <Card title="Crisis events" subtitle="Injected or scheduled changes to the simulated world">
        {events.length === 0 ? (
          <p className="text-[15px] text-ink-muted">
            No crisis events so far. The network is operating normally.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-180 text-left text-[15px]">
              <thead>
                <tr className="border-b border-line text-sm text-ink-muted">
                  <th className="pb-3 font-medium">Event</th>
                  <th className="pb-3 font-medium">Affects</th>
                  <th className="pb-3 font-medium">Window</th>
                  <th className="pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="py-3 font-medium text-ink">{EVENT_TITLE[event.type]}</td>
                    <td className="py-3 text-ink">{affects(event)}</td>
                    <td className="py-3 text-ink">
                      Tick {event.start_tick} – {event.end_tick}
                    </td>
                    <td className="py-3">
                      <StatusPill status={event.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="System activity" subtitle="What the platform detected and did, newest first">
        {!activity || activity.entries.length === 0 ? (
          <p className="text-[15px] text-ink-muted">No notable activity yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {activity.entries.map((entry, index) => (
              <li
                key={`${entry.ts}-${index}`}
                className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3"
              >
                <span className="w-20 shrink-0 font-mono text-sm text-ink-muted">
                  {new Date(entry.ts).toLocaleTimeString('en-GB')}
                </span>
                <Pill tone={LEVEL_TONE[entry.level] ?? 'neutral'}>{entry.level}</Pill>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium text-ink">{humanise(entry.event)}</div>
                  {details(entry) && (
                    <div className="truncate text-sm text-ink-muted">{details(entry)}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
