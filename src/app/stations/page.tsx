'use client';

import { Loader2 } from 'lucide-react';
import { useLiveData } from '@/components/providers/LiveDataProvider';
import { StationCard } from '@/components/stations/StationCard';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { regionLabel } from '@/lib/format';

export default function StationsPage() {
  const { state } = useLiveData();
  const world = state?.world;

  return (
    <>
      <PageHeader
        title="Stations"
        description="Stock, usage rate and recent demand for every station and fuel. Usage is the average of the last hour."
      />
      {!world ? (
        <EmptyState
          icon={Loader2}
          title="Connecting to the simulator"
          message="Waiting for the first network snapshot."
        />
      ) : (
        ['region-dhaka', 'region-chattogram'].map((regionId) => (
          <section key={regionId} className="space-y-4">
            <h2 className="text-lg font-semibold text-ink-soft">
              {regionLabel(regionId)} Division
            </h2>
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
              {world.stations
                .filter((station) => station.region_id === regionId)
                .map((station) => (
                  <StationCard key={station.id} station={station} world={world} />
                ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
