'use client';

import { FlaskConical, Loader2, Play } from 'lucide-react';
import { useState } from 'react';
import { usePolling } from '@/components/providers/usePolling';
import { Card, EmptyState, PageHeader, ProgressBar } from '@/components/ui/primitives';
import type { ExperimentJob, RunResult, ScenarioName, Strategy } from '@/lib/experiments/runner';
import { liters } from '@/lib/format';

interface ExperimentsResponse {
  job: ExperimentJob | null;
  results: RunResult[];
  strategies: { id: Strategy; label: string; description: string }[];
  scenarios: { id: ScenarioName; label: string; description: string }[];
}

const STRATEGY_COLOR: Record<Strategy, string> = {
  planner: '#2a78d6',
  naive: '#eb6834',
  none: '#1baf7a',
};

const DISPLAY_ORDER: Strategy[] = ['none', 'naive', 'planner'];

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function ServiceLevelBars({
  results,
  labels,
}: {
  results: RunResult[];
  labels: Record<Strategy, string>;
}) {
  const [hover, setHover] = useState<Strategy | null>(null);
  const rows = DISPLAY_ORDER.map((id) => results.find((r) => r.strategy === id)).filter(
    (r): r is RunResult => Boolean(r),
  );

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div
          key={row.strategy}
          className="relative grid grid-cols-[8.5rem_1fr] items-center gap-3"
          onMouseEnter={() => setHover(row.strategy)}
          onMouseLeave={() => setHover(null)}
        >
          <span className="text-[15px] font-medium text-ink">{labels[row.strategy]}</span>
          <div className="flex items-center gap-2">
            <div className="h-7 flex-1 rounded-r-md bg-slate-100">
              <div
                className="h-full rounded-r-md transition-opacity"
                style={{
                  width: `${Math.max(1, row.serviceLevel * 100)}%`,
                  background: STRATEGY_COLOR[row.strategy],
                  opacity: hover && hover !== row.strategy ? 0.45 : 1,
                }}
              />
            </div>
            <span className="w-16 text-right text-[15px] font-semibold text-ink tabular-nums">
              {pct(row.serviceLevel)}
            </span>
          </div>
          {hover === row.strategy && (
            <div className="absolute top-full left-[8.5rem] z-10 mt-1 w-64 rounded-lg border border-line bg-surface p-3 text-sm shadow-lg">
              <div className="mb-1 flex items-center gap-2 font-semibold text-ink">
                <span
                  className="size-2.5 rounded-sm"
                  style={{ background: STRATEGY_COLOR[row.strategy] }}
                />
                {labels[row.strategy]}
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-ink-soft">
                <dt>Service level</dt>
                <dd className="text-right font-medium text-ink">{pct(row.serviceLevel)}</dd>
                <dt>Unmet demand</dt>
                <dd className="text-right font-medium text-ink">{liters(row.unmetLiters)}</dd>
                <dt>Fuel shipped</dt>
                <dd className="text-right font-medium text-ink">{liters(row.shippedLiters)}</dd>
                <dt>Failed shipments</dt>
                <dd className="text-right font-medium text-ink">{row.allocationFailures}</dd>
              </dl>
            </div>
          )}
        </div>
      ))}
      <div className="grid grid-cols-[8.5rem_1fr] gap-3 text-sm text-ink-muted">
        <span />
        <div className="flex gap-2">
          <div className="relative h-5 flex-1">
            <span className="absolute left-0">0%</span>
            <span className="absolute left-1/2 -translate-x-1/2">50%</span>
            <span className="absolute right-0">100%</span>
          </div>
          <span className="w-16" />
        </div>
      </div>
    </div>
  );
}

export default function ExperimentsPage() {
  const data = usePolling<ExperimentsResponse>('/api/experiments', 2000);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const job = data?.job;
  const running = job?.status === 'RUNNING';
  const results = data?.results ?? [];
  const labels = Object.fromEntries((data?.strategies ?? []).map((s) => [s.id, s.label])) as Record<
    Strategy,
    string
  >;

  const start = async () => {
    if (
      !window.confirm(
        'This resets the simulator and runs 9 simulations of 192 ticks each (about 2 minutes). Live operations pause meanwhile. Continue?',
      )
    )
      return;
    setStarting(true);
    setError(null);
    try {
      const response = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticks: 192, decisionEveryTicks: 4 }),
      });
      if (!response.ok) setError((await response.json())?.error?.message ?? 'Could not start');
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Strategy comparison"
        description="Evidence, not claims: the same deterministic scenario (same seed, same events, 192 ticks = 2 days) played with three strategies that each review the network once per simulated hour. Numbers are the simulator's own metrics."
        action={
          <button
            type="button"
            onClick={start}
            disabled={running || starting}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-[15px] font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {running ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            {running ? 'Running…' : 'Run comparison'}
          </button>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-[15px] text-red-900">
          {error}
        </div>
      )}

      {running && job && (
        <Card title="Experiment in progress" subtitle={job.progress.current ?? 'Preparing'}>
          <div className="mb-2 text-[15px] text-ink-soft">
            {job.progress.done} of {job.progress.total} runs finished · live operations paused
          </div>
          <ProgressBar ratio={job.progress.done / job.progress.total} tone="info" />
        </Card>
      )}

      {job?.status === 'FAILED' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-[15px] text-red-900">
          Experiment failed: {job.error}
        </div>
      )}

      {results.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="No results yet"
          message="Run the comparison to measure service level, unmet demand and failures for each strategy."
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[15px] text-ink-soft">
            {(data?.strategies ?? []).map((s) => (
              <span key={s.id} className="flex items-center gap-2">
                <span className="size-3 rounded-sm" style={{ background: STRATEGY_COLOR[s.id] }} />
                <span className="font-medium text-ink">{s.label}</span>
                <span className="text-ink-muted">· {s.description}</span>
              </span>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {(data?.scenarios ?? []).map((scenario) => {
              const scenarioResults = results.filter((r) => r.scenario === scenario.id);
              if (scenarioResults.length === 0) return null;
              return (
                <Card
                  key={scenario.id}
                  title={`Service level · ${scenario.label}`}
                  subtitle={scenario.description}
                >
                  <ServiceLevelBars results={scenarioResults} labels={labels} />
                </Card>
              );
            })}
          </div>

          <Card title="All results" subtitle="Simulator ground-truth metrics after each run">
            <div className="overflow-x-auto">
              <table className="w-full min-w-215 text-left text-[15px]">
                <thead>
                  <tr className="border-b border-line text-sm text-ink-muted">
                    <th className="pb-3 font-medium">Scenario</th>
                    <th className="pb-3 font-medium">Strategy</th>
                    <th className="pb-3 text-right font-medium">Service level</th>
                    <th className="pb-3 text-right font-medium">Unmet demand</th>
                    <th className="pb-3 text-right font-medium">Fuel shipped</th>
                    <th className="pb-3 text-right font-medium">Shipments</th>
                    <th className="pb-3 text-right font-medium">Failed</th>
                    <th className="pb-3 text-right font-medium">Stockout ticks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(data?.scenarios ?? []).flatMap((scenario) =>
                    DISPLAY_ORDER.map((id) =>
                      results.find((r) => r.scenario === scenario.id && r.strategy === id),
                    )
                      .filter((r): r is RunResult => Boolean(r))
                      .map((r) => (
                        <tr key={`${r.scenario}-${r.strategy}`}>
                          <td className="py-3 text-ink-soft">{scenario.label}</td>
                          <td className="py-3 font-medium text-ink">
                            <span className="flex items-center gap-2">
                              <span
                                className="size-2.5 rounded-sm"
                                style={{ background: STRATEGY_COLOR[r.strategy] }}
                              />
                              {labels[r.strategy]}
                            </span>
                          </td>
                          <td className="py-3 text-right font-semibold text-ink tabular-nums">
                            {pct(r.serviceLevel)}
                          </td>
                          <td className="py-3 text-right text-ink tabular-nums">
                            {liters(r.unmetLiters)}
                          </td>
                          <td className="py-3 text-right text-ink tabular-nums">
                            {liters(r.shippedLiters)}
                          </td>
                          <td className="py-3 text-right text-ink tabular-nums">
                            {r.shipmentsSent}
                          </td>
                          <td className="py-3 text-right text-ink tabular-nums">
                            {r.allocationFailures}
                          </td>
                          <td className="py-3 text-right text-ink tabular-nums">
                            {r.stockoutTicks}
                          </td>
                        </tr>
                      )),
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
