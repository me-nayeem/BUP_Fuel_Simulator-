'use client';

import { Cpu, Gauge, HeartPulse, Loader2, MemoryStick, Timer, TriangleAlert } from 'lucide-react';
import { useLiveData } from '@/components/providers/LiveDataProvider';
import { Card, EmptyState, PageHeader, StatTile, StatusPill } from '@/components/ui/primitives';
import { percent, statusTone, type Tone } from '@/lib/format';

function ms(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)} ms`;
}

function latencyTone(value: number | null): Tone {
  if (value === null) return 'neutral';
  if (value > 1000) return 'bad';
  if (value > 300) return 'warn';
  return 'good';
}

function errorTone(rate: number): Tone {
  if (rate > 0.05) return 'bad';
  if (rate > 0.01) return 'warn';
  return 'good';
}

function uptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min ${seconds % 60} s`;
}

export default function SystemPage() {
  const { state, health } = useLiveData();

  if (!health) {
    return (
      <>
        <PageHeader
          title="System Health"
          description="Component health, latency, error rates and resource usage."
        />
        <EmptyState
          icon={Loader2}
          title="Loading health report"
          message="Waiting for the backend health check."
        />
      </>
    );
  }

  const freshness = state?.freshness;
  const healthy = health.status === 'HEALTHY';

  return (
    <>
      <PageHeader
        title="System Health"
        description="Is the platform itself working? Component status, response times, errors and resources."
        action={
          <a
            href="/api/metrics"
            target="_blank"
            className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-brand hover:bg-brand-soft"
          >
            Prometheus metrics
          </a>
        }
      />

      <div
        className={`flex items-center gap-4 rounded-xl border px-6 py-5 ${
          healthy ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
        }`}
      >
        {healthy ? (
          <HeartPulse className="size-8 text-emerald-700" aria-hidden />
        ) : (
          <TriangleAlert className="size-8 text-amber-700" aria-hidden />
        )}
        <div>
          <div
            className={`text-xl font-semibold ${healthy ? 'text-emerald-900' : 'text-amber-900'}`}
          >
            {healthy ? 'All systems healthy' : 'Running in degraded mode'}
          </div>
          <div className={`text-[15px] ${healthy ? 'text-emerald-800' : 'text-amber-800'}`}>
            {healthy
              ? 'Every component is responding normally.'
              : 'Some components have problems. The platform keeps working with the last known good data.'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {health.components.map((component) => (
          <div
            key={component.name}
            className={`rounded-xl border bg-surface p-5 shadow-sm ${
              statusTone(component.status) === 'bad'
                ? 'border-red-200'
                : statusTone(component.status) === 'warn'
                  ? 'border-amber-200'
                  : 'border-line'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-base font-semibold text-ink">{component.name}</div>
              <StatusPill status={component.status} />
            </div>
            {component.detail && (
              <p className="mt-2 text-[15px] text-ink-soft">{component.detail}</p>
            )}
            {component.latencyMs !== undefined && (
              <p className="mt-1 text-sm text-ink-muted">Response time {component.latencyMs} ms</p>
            )}
          </div>
        ))}
      </div>

      <h2 className="pt-2 text-lg font-semibold text-ink-soft">Performance</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="API response p95"
          value={ms(health.performance.apiP95Ms)}
          hint={`p50 ${ms(health.performance.apiP50Ms)}`}
          icon={Timer}
          tone={latencyTone(health.performance.apiP95Ms)}
        />
        <StatTile
          label="API error rate"
          value={percent(health.performance.apiErrorRate, 1)}
          hint="Server errors from our API"
          icon={TriangleAlert}
          tone={errorTone(health.performance.apiErrorRate)}
        />
        <StatTile
          label="Simulator response p95"
          value={ms(health.performance.simulatorP95Ms)}
          hint="Including retries"
          icon={Gauge}
          tone={latencyTone(health.performance.simulatorP95Ms)}
        />
        <StatTile
          label="Simulator error rate"
          value={percent(health.performance.simulatorErrorRate, 1)}
          hint="Failed simulator calls"
          icon={TriangleAlert}
          tone={errorTone(health.performance.simulatorErrorRate)}
        />
      </div>

      <h2 className="pt-2 text-lg font-semibold text-ink-soft">Resources</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="CPU"
          value={`${health.system.cpuPercent}%`}
          hint="Share of all CPU cores"
          icon={Cpu}
        />
        <StatTile
          label="Memory"
          value={`${health.system.rssMb} MB`}
          hint={`Heap ${health.system.heapUsedMb} MB`}
          icon={MemoryStick}
        />
        <StatTile
          label="Event loop lag p99"
          value={`${health.system.eventLoopLagP99Ms} ms`}
          hint="Backend responsiveness"
          icon={Gauge}
          tone={health.system.eventLoopLagP99Ms > 100 ? 'warn' : 'good'}
        />
        <StatTile
          label="Uptime"
          value={uptime(health.system.uptimeSec)}
          hint="Since last start"
          icon={HeartPulse}
        />
      </div>

      {freshness && (
        <Card title="Simulator data freshness" subtitle="Where the numbers on every page come from">
          <dl className="grid grid-cols-1 gap-4 text-[15px] sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt className="text-sm text-ink-muted">Source</dt>
              <dd className="mt-1">
                <StatusPill status={freshness.source} />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">Data age</dt>
              <dd className="mt-1 font-medium text-ink">
                {freshness.ageMs === null ? '—' : `${(freshness.ageMs / 1000).toFixed(1)} s`}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">Snapshot fetch time</dt>
              <dd className="mt-1 font-medium text-ink">{ms(freshness.fetchLatencyMs)}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">Last error</dt>
              <dd className="mt-1 font-medium text-ink">
                {freshness.lastError
                  ? `${freshness.lastError.kind}: ${freshness.lastError.message}`
                  : 'None'}
              </dd>
            </div>
          </dl>
        </Card>
      )}
    </>
  );
}
