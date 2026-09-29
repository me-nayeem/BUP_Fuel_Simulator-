'use client';

import { AlertTriangle, Droplets, Gauge, Loader2, Siren, Truck } from 'lucide-react';
import Link from 'next/link';
import { NetworkMap } from '@/components/overview/NetworkMap';
import { useLiveData } from '@/components/providers/LiveDataProvider';
import {
  Card,
  EmptyState,
  PageHeader,
  ProgressBar,
  StatTile,
  StatusPill,
} from '@/components/ui/primitives';
import { fillTone, FUEL_LABEL, liters, percent, stationLabel, type Tone } from '@/lib/format';
import {
  currentEvents,
  LOW_STOCK_RATIO,
  openShipments,
  shipmentsByRoute,
  stationStockLevels,
} from '@/lib/world/derived';

function serviceTone(level: number): Tone {
  if (level >= 0.98) return 'good';
  if (level >= 0.9) return 'warn';
  return 'bad';
}

export default function OverviewPage() {
  const { state, health } = useLiveData();
  const world = state?.world;

  if (!world) {
    return (
      <>
        <PageHeader
          title="Network overview"
          description="Live status of the simulated fuel supply network."
        />
        <EmptyState
          icon={Loader2}
          title="Connecting to the simulator"
          message={state?.freshness.lastError?.message ?? 'Waiting for the first network snapshot.'}
        />
      </>
    );
  }

  const stock = stationStockLevels(world);
  const lowStock = stock.filter((s) => s.ratio < LOW_STOCK_RATIO);
  const watchlist = [...stock].sort((a, b) => a.ratio - b.ratio).slice(0, 6);
  const shipments = openShipments(world);
  const shipmentLiters = shipments.reduce((sum, a) => sum + a.quantity, 0);
  const events = currentEvents(world);
  const serviceLevel = world.metrics.service_level;

  return (
    <>
      <PageHeader
        title="Network overview"
        description="Live status of the simulated fuel supply network."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Service level"
          value={percent(serviceLevel, 1)}
          hint="Since simulation start"
          icon={Gauge}
          tone={serviceTone(serviceLevel)}
        />
        <StatTile
          label="Unmet demand"
          value={liters(world.metrics.unmet_demand_liters)}
          hint={`${liters(world.metrics.served_demand_liters)} served`}
          icon={Droplets}
          tone={world.metrics.unmet_demand_liters > 0 ? 'bad' : 'good'}
        />
        <StatTile
          label="Low stock"
          value={String(lowStock.length)}
          hint={`Station fuels below ${percent(LOW_STOCK_RATIO)}`}
          icon={AlertTriangle}
          tone={lowStock.length > 0 ? 'warn' : 'good'}
        />
        <StatTile
          label="In transit"
          value={String(shipments.length)}
          hint={
            shipments.length > 0 ? `${liters(shipmentLiters)} on the road` : 'No open shipments'
          }
          icon={Truck}
          tone="info"
        />
        <StatTile
          label="Crisis events"
          value={String(events.length)}
          hint={events.length > 0 ? 'Active or scheduled' : 'None active'}
          icon={Siren}
          tone={
            events.some((e) => e.status === 'ACTIVE') ? 'bad' : events.length > 0 ? 'warn' : 'good'
          }
        />
      </div>

      <Card
        title="Supply network"
        subtitle="Depots supply stations over six routes. Bars show fill level per fuel."
      >
        <NetworkMap
          depots={world.depots}
          stations={world.stations}
          routes={world.routes}
          shipments={shipmentsByRoute(world)}
        />
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-muted">
          <span className="flex items-center gap-2">
            <span className="h-1 w-6 rounded bg-slate-400" /> Route available
          </span>
          <span className="flex items-center gap-2">
            <span className="h-1 w-6 rounded bg-blue-600" /> Shipment in transit
          </span>
          <span className="flex items-center gap-2">
            <span className="h-1 w-6 rounded border-t-2 border-dashed border-red-500" /> Route
            disrupted
          </span>
          <span>D · P · O = Diesel · Petrol · Octane</span>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
        <Card
          title="Stock watchlist"
          subtitle="Lowest station stock right now"
          action={
            <Link href="/stations" className="text-sm font-medium text-brand hover:underline">
              All stations
            </Link>
          }
        >
          <ul className="space-y-4">
            {watchlist.map((item) => (
              <li key={`${item.stationId}-${item.fuel}`}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="text-[15px] font-medium text-ink">
                    {stationLabel(item.stationId)} · {FUEL_LABEL[item.fuel]}
                  </span>
                  <span className="text-sm text-ink-muted">
                    {liters(item.inventory)} · {percent(item.ratio)}
                  </span>
                </div>
                <ProgressBar ratio={item.ratio} tone={fillTone(item.ratio)} />
              </li>
            ))}
          </ul>
        </Card>

        <Card
          title="System health"
          action={
            <Link href="/system" className="text-sm font-medium text-brand hover:underline">
              Details
            </Link>
          }
        >
          <ul className="divide-y divide-line">
            {health?.components.map((component) => (
              <li
                key={component.name}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div>
                  <div className="text-[15px] font-medium text-ink">{component.name}</div>
                  {component.detail && (
                    <div className="text-sm text-ink-muted">{component.detail}</div>
                  )}
                </div>
                <StatusPill status={component.status} />
              </li>
            ))}
          </ul>
        </Card>

        <Card
          title="Crisis events"
          action={
            <Link href="/events" className="text-sm font-medium text-brand hover:underline">
              All events
            </Link>
          }
        >
          {events.length === 0 ? (
            <p className="text-[15px] text-ink-muted">
              No active or scheduled crisis events. The network is operating normally.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <div className="text-[15px] font-medium text-ink capitalize">
                      {event.type.replaceAll('_', ' ')}
                    </div>
                    <div className="text-sm text-ink-muted">
                      Ticks {event.start_tick} – {event.end_tick}
                    </div>
                  </div>
                  <StatusPill status={event.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
