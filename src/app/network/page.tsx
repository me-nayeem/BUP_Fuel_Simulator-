'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { useLiveData } from '@/components/providers/LiveDataProvider';
import { Card, EmptyState, PageHeader, ProgressBar, StatusPill } from '@/components/ui/primitives';
import { FUEL_TYPES, type Depot, type SupplyArrival } from '@/lib/simulator/types';
import {
  depotLabel,
  fillTone,
  FUEL_COLOR,
  FUEL_LABEL,
  liters,
  percent,
  regionLabel,
  stationLabel,
} from '@/lib/format';
import { shipmentsByRoute } from '@/lib/world/derived';
import type { WorldState } from '@/lib/world/snapshot';

function ticksToHours(ticks: number, tickMinutes: number): string {
  const hours = (ticks * tickMinutes) / 60;
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
}

function nextArrival(arrivals: SupplyArrival[], depotId: string, fuel: string) {
  return arrivals
    .filter((a) => a.depot_id === depotId && a.fuel_type === fuel && a.status !== 'ARRIVED')
    .sort((a, b) => a.planned_tick - b.planned_tick)[0];
}

function DepotCard({ depot, world }: { depot: Depot; world: WorldState }) {
  const pendingFromDepot = world.allocations
    .filter((a) => a.source_depot_id === depot.id && a.status === 'PENDING')
    .reduce((sum, a) => sum + a.quantity, 0);
  const dispatchRatio =
    depot.dispatch_capacity_per_tick > 0 ? pendingFromDepot / depot.dispatch_capacity_per_tick : 0;

  return (
    <Card
      title={`${depotLabel(depot.id)} Depot`}
      subtitle={`${regionLabel(depot.region_id)} Division`}
      action={<StatusPill status={depot.status} />}
    >
      <div className="mb-5 rounded-lg bg-slate-50 p-4">
        <div className="flex items-baseline justify-between gap-3 text-[15px]">
          <span className="font-medium text-ink">Dispatch this tick</span>
          <span className="text-ink-muted">
            {liters(pendingFromDepot)} of {liters(depot.dispatch_capacity_per_tick)}
          </span>
        </div>
        <div className="mt-2">
          <ProgressBar ratio={dispatchRatio} tone={dispatchRatio > 0.9 ? 'warn' : 'info'} />
        </div>
      </div>

      <div className="space-y-5">
        {FUEL_TYPES.map((fuel) => {
          const inventory = depot.inventory[fuel];
          const capacity = depot.capacity[fuel];
          const ratio = capacity > 0 ? inventory / capacity : 0;
          const arrival = nextArrival(world.supplyArrivals, depot.id, fuel);
          const overflow = arrival ? Math.max(0, inventory + arrival.quantity - capacity) : 0;
          return (
            <div key={fuel}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                  <span className="size-3 rounded-full" style={{ background: FUEL_COLOR[fuel] }} />
                  {FUEL_LABEL[fuel]}
                </span>
                <span className="text-[15px] text-ink">
                  {liters(inventory)}{' '}
                  <span className="text-ink-muted">
                    / {liters(capacity)} · {percent(ratio)}
                  </span>
                </span>
              </div>
              <ProgressBar ratio={ratio} tone={fillTone(ratio)} />
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
                <span>
                  {arrival
                    ? `Next supply ${liters(arrival.quantity)} in ${ticksToHours(
                        Math.max(0, arrival.planned_tick - world.tick),
                        world.tickMinutes,
                      )} (tick ${arrival.planned_tick})`
                    : 'No supply scheduled'}
                  {arrival?.status === 'DELAYED' && (
                    <span className="ml-2 font-medium text-amber-700">Delayed</span>
                  )}
                </span>
                {overflow > 0 && (
                  <span className="flex items-center gap-1 font-medium text-amber-700">
                    <AlertTriangle className="size-4" aria-hidden />
                    {liters(overflow)} will not fit
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function NetworkPage() {
  const { state } = useLiveData();
  const world = state?.world;

  if (!world) {
    return (
      <>
        <PageHeader
          title="Depots & Routes"
          description="Depot stock, dispatch capacity, routes and incoming supply."
        />
        <EmptyState
          icon={Loader2}
          title="Connecting to the simulator"
          message="Waiting for the first network snapshot."
        />
      </>
    );
  }

  const byRoute = shipmentsByRoute(world);
  const upcoming = world.supplyArrivals
    .filter((a) => a.status !== 'ARRIVED')
    .sort((a, b) => a.planned_tick - b.planned_tick)
    .slice(0, 10);
  const arrived = world.supplyArrivals.filter((a) => a.status === 'ARRIVED').length;

  return (
    <>
      <PageHeader
        title="Depots & Routes"
        description="Depot stock, dispatch capacity, routes and incoming supply. Supply arrives at depots, never directly at stations."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {world.depots.map((depot) => (
          <DepotCard key={depot.id} depot={depot} world={world} />
        ))}
      </div>

      <Card title="Routes" subtitle="A shipment travels on one route from a depot to a station.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 text-left text-[15px]">
            <thead>
              <tr className="border-b border-line text-sm text-ink-muted">
                <th className="pb-3 font-medium">Route</th>
                <th className="pb-3 font-medium">Travel time</th>
                <th className="pb-3 font-medium">Max per shipment</th>
                <th className="pb-3 font-medium">Shipments on route</th>
                <th className="pb-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {world.routes.map((route) => {
                const open = byRoute.get(route.id) ?? [];
                const crossRegion =
                  world.depots.find((d) => d.id === route.source_depot_id)?.region_id !==
                  world.stations.find((s) => s.id === route.destination_station_id)?.region_id;
                return (
                  <tr key={route.id}>
                    <td className="py-3">
                      <div className="font-medium text-ink">
                        {depotLabel(route.source_depot_id)} →{' '}
                        {stationLabel(route.destination_station_id)}
                      </div>
                      {crossRegion && <div className="text-sm text-ink-muted">Cross-region</div>}
                    </td>
                    <td className="py-3 text-ink">
                      {route.transit_ticks} ticks ·{' '}
                      {ticksToHours(route.transit_ticks, world.tickMinutes)}
                    </td>
                    <td className="py-3 text-ink">{liters(route.max_shipment)}</td>
                    <td className="py-3 text-ink">
                      {open.length === 0
                        ? '—'
                        : `${open.length} · ${liters(open.reduce((sum, a) => sum + a.quantity, 0))}`}
                    </td>
                    <td className="py-3">
                      <StatusPill status={route.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Incoming supply"
        subtitle={`Next deliveries to depots · ${arrived} of ${world.supplyArrivals.length} already arrived`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-left text-[15px]">
            <thead>
              <tr className="border-b border-line text-sm text-ink-muted">
                <th className="pb-3 font-medium">Depot</th>
                <th className="pb-3 font-medium">Fuel</th>
                <th className="pb-3 font-medium">Quantity</th>
                <th className="pb-3 font-medium">Arrives</th>
                <th className="pb-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {upcoming.map((arrival) => (
                <tr key={arrival.id}>
                  <td className="py-3 font-medium text-ink">{depotLabel(arrival.depot_id)}</td>
                  <td className="py-3 text-ink">{FUEL_LABEL[arrival.fuel_type]}</td>
                  <td className="py-3 text-ink">{liters(arrival.quantity)}</td>
                  <td className="py-3 text-ink">
                    Tick {arrival.planned_tick}{' '}
                    <span className="text-ink-muted">
                      · in{' '}
                      {ticksToHours(
                        Math.max(0, arrival.planned_tick - world.tick),
                        world.tickMinutes,
                      )}
                    </span>
                  </td>
                  <td className="py-3">
                    <StatusPill status={arrival.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
