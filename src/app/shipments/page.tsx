'use client';

import { CheckCircle2, Clock, Loader2, Truck, XCircle } from 'lucide-react';
import { useLiveData } from '@/components/providers/LiveDataProvider';
import { Card, EmptyState, PageHeader, StatTile, StatusPill } from '@/components/ui/primitives';
import { depotLabel, FUEL_LABEL, liters, stationLabel } from '@/lib/format';
import type { Allocation } from '@/lib/simulator/types';

function arrivalText(allocation: Allocation, tick: number): string {
  if (allocation.status === 'ARRIVED') return `Arrived at tick ${allocation.actual_arrival_tick}`;
  if (allocation.status === 'IN_TRANSIT' && allocation.expected_arrival_tick !== null) {
    const remaining = Math.max(0, allocation.expected_arrival_tick - tick);
    return `Tick ${allocation.expected_arrival_tick} · ${remaining} tick${remaining === 1 ? '' : 's'} left`;
  }
  if (allocation.status === 'PENDING') return 'Departs next tick';
  return '—';
}

export default function ShipmentsPage() {
  const { state } = useLiveData();
  const world = state?.world;

  if (!world) {
    return (
      <>
        <PageHeader
          title="Shipments"
          description="Every allocation sent to the simulator and its lifecycle."
        />
        <EmptyState
          icon={Loader2}
          title="Connecting to the simulator"
          message="Waiting for the first network snapshot."
        />
      </>
    );
  }

  const count = (status: Allocation['status']) =>
    world.allocations.filter((a) => a.status === status).length;
  const shipments = [...world.allocations].sort((a, b) => b.id - a.id);
  const delivered = world.allocations
    .filter((a) => a.status === 'ARRIVED')
    .reduce((sum, a) => sum + a.quantity, 0);

  return (
    <>
      <PageHeader
        title="Shipments"
        description="Every allocation sent to the simulator: Pending → In transit → Arrived, or Failed / Cancelled."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Pending"
          value={String(count('PENDING'))}
          hint="Waiting to depart"
          icon={Clock}
          tone="info"
        />
        <StatTile
          label="In transit"
          value={String(count('IN_TRANSIT'))}
          hint="On the road"
          icon={Truck}
          tone="info"
        />
        <StatTile
          label="Arrived"
          value={String(count('ARRIVED'))}
          hint={`${liters(delivered)} delivered`}
          icon={CheckCircle2}
          tone="good"
        />
        <StatTile
          label="Failed or cancelled"
          value={String(count('FAILED') + count('CANCELLED'))}
          hint={`${world.metrics.allocation_failures} failed by the simulator`}
          icon={XCircle}
          tone={count('FAILED') > 0 ? 'bad' : 'neutral'}
        />
      </div>

      {shipments.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No shipments yet"
          message="Shipments appear here once the decision engine recommends them and they are approved or auto-executed."
        />
      ) : (
        <Card title="Shipment ledger" subtitle="Newest first">
          <div className="overflow-x-auto">
            <table className="w-full min-w-215 text-left text-[15px]">
              <thead>
                <tr className="border-b border-line text-sm text-ink-muted">
                  <th className="pb-3 font-medium">#</th>
                  <th className="pb-3 font-medium">Route</th>
                  <th className="pb-3 font-medium">Fuel</th>
                  <th className="pb-3 font-medium">Quantity</th>
                  <th className="pb-3 font-medium">Created</th>
                  <th className="pb-3 font-medium">Arrival</th>
                  <th className="pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shipments.map((allocation) => (
                  <tr key={allocation.id}>
                    <td className="py-3 text-ink-muted">{allocation.id}</td>
                    <td className="py-3 font-medium text-ink">
                      {depotLabel(allocation.source_depot_id)} →{' '}
                      {stationLabel(allocation.destination_station_id)}
                    </td>
                    <td className="py-3 text-ink">{FUEL_LABEL[allocation.fuel_type]}</td>
                    <td className="py-3 text-ink">{liters(allocation.quantity)}</td>
                    <td className="py-3 text-ink">Tick {allocation.created_tick}</td>
                    <td className="py-3 text-ink">
                      {arrivalText(allocation, world.tick)}
                      {allocation.failure_reason && (
                        <div className="text-sm text-red-700">{allocation.failure_reason}</div>
                      )}
                    </td>
                    <td className="py-3">
                      <StatusPill status={allocation.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
