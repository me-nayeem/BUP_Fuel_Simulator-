import { Clock, TrendingUp } from 'lucide-react';
import { DemandChart } from '@/components/stations/DemandChart';
import { Card, ProgressBar, StatusPill } from '@/components/ui/primitives';
import { FUEL_TYPES, type Station } from '@/lib/simulator/types';
import {
  fillTone,
  FUEL_COLOR,
  FUEL_LABEL,
  liters,
  percent,
  regionLabel,
  stationLabel,
} from '@/lib/format';
import { recentUsage, stationDemandSeries } from '@/lib/world/derived';
import type { WorldState } from '@/lib/world/snapshot';

function hoursText(hours: number | null): string {
  if (hours === null) return '—';
  if (hours > 48) return '48 h+';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toFixed(1)} h`;
}

function hoursTone(hours: number | null): string {
  if (hours === null) return 'text-ink';
  if (hours < 4) return 'text-red-700';
  if (hours < 8) return 'text-amber-700';
  return 'text-ink';
}

export function StationCard({ station, world }: { station: Station; world: WorldState }) {
  const series = stationDemandSeries(world, station.id);
  const multiplier = station.demand_multiplier;

  return (
    <Card
      title={stationLabel(station.id)}
      subtitle={`${regionLabel(station.region_id)} · ${station.demand_profile.replace('_', ' ')} demand${
        multiplier !== 1 ? ` · demand ×${multiplier.toFixed(2)}` : ''
      }`}
      action={<StatusPill status={station.status} />}
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {FUEL_TYPES.map((fuel) => {
          const inventory = station.inventory[fuel];
          const capacity = station.capacity[fuel];
          const ratio = capacity > 0 ? inventory / capacity : 0;
          const usage = recentUsage(world, station.id, fuel, inventory);
          return (
            <div key={fuel} className="rounded-lg border border-line p-4">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                <span className="size-3 rounded-full" style={{ background: FUEL_COLOR[fuel] }} />
                {FUEL_LABEL[fuel]}
              </div>
              <div className="mt-2 text-2xl font-semibold text-ink">{liters(inventory)}</div>
              <div className="mb-2 text-sm text-ink-muted">
                of {liters(capacity)} · {percent(ratio)}
              </div>
              <ProgressBar ratio={ratio} tone={fillTone(ratio)} />
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-1.5 text-ink-muted">
                    <TrendingUp className="size-4" aria-hidden /> Using
                  </dt>
                  <dd className="font-medium text-ink">
                    {usage.litersPerHour === null ? '—' : `${Math.round(usage.litersPerHour)} L/h`}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-1.5 text-ink-muted">
                    <Clock className="size-4" aria-hidden /> Lasts about
                  </dt>
                  <dd className={`font-medium ${hoursTone(usage.hoursLeft)}`}>
                    {hoursText(usage.hoursLeft)}
                  </dd>
                </div>
                {usage.recentUnmet > 0 && (
                  <div className="flex items-center justify-between gap-2 text-red-700">
                    <dt>Unmet (last hour)</dt>
                    <dd className="font-medium">{liters(usage.recentUnmet)}</dd>
                  </div>
                )}
              </dl>
            </div>
          );
        })}
      </div>

      <div className="mt-5">
        <div className="mb-2 text-sm font-medium text-ink-soft">
          Demand per 15 minutes · last {Math.max(0, series.length)} ticks
        </div>
        <DemandChart data={series} />
      </div>
    </Card>
  );
}
