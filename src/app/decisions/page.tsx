'use client';

import { Bot, Check, CheckCircle2, Loader2, ShieldAlert, Sparkles, X } from 'lucide-react';
import { AiAnswerBox } from '@/components/ai/AiAnswerBox';
import type { AiAnswer } from '@/lib/ai/assistant';
import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, PageHeader, Pill } from '@/components/ui/primitives';
import type { DecisionRecord } from '@/lib/engine/engine';
import { depotLabel, FUEL_LABEL, liters, stationLabel, type Tone } from '@/lib/format';
import type { Plan, Recommendation, RiskLevel } from '@/lib/intelligence/planner';

type Mode = 'MANUAL' | 'ASSISTED' | 'AUTO';

interface RecommendationsResponse {
  plan: Plan | null;
  mode: Mode;
  engineError: string | null;
  fallbackActive: boolean;
  decisions: DecisionRecord[];
}

const MODES: { value: Mode; label: string; text: string }[] = [
  { value: 'MANUAL', label: 'Manual', text: 'Every shipment waits for operator approval.' },
  {
    value: 'ASSISTED',
    label: 'Assisted',
    text: 'Routine shipments are sent automatically. Cross-region, constrained-depot, crisis-related or uncertain shipments wait for you.',
  },
  {
    value: 'AUTO',
    label: 'Auto',
    text: 'Every valid shipment is sent automatically.',
  },
];

const LEVEL_TONE: Record<RiskLevel, Tone> = {
  CRITICAL: 'bad',
  HIGH: 'warn',
  MEDIUM: 'info',
  LOW: 'neutral',
};

const ACTION_TONE: Record<DecisionRecord['action'], Tone> = {
  APPROVED: 'good',
  AUTO_EXECUTED: 'info',
  REJECTED: 'neutral',
};

function hoursText(value: number | null): string {
  if (value === null) return '6 h+';
  if (value < 1) return `${Math.round(value * 60)} min`;
  return `${value.toFixed(1)} h`;
}

function RecommendationCard({
  rec,
  busy,
  onDecide,
}: {
  rec: Recommendation;
  busy: boolean;
  onDecide: (id: string, action: 'APPROVE' | 'REJECT') => void;
}) {
  const shipment = rec.shipment;
  const [explanation, setExplanation] = useState<AiAnswer | null>(null);
  const [explaining, setExplaining] = useState(false);

  const explain = async () => {
    setExplaining(true);
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'explain', recommendationId: rec.id }),
      });
      const data = await response.json();
      if (response.ok) setExplanation(data as AiAnswer);
    } finally {
      setExplaining(false);
    }
  };

  return (
    <section className="rounded-xl border border-line bg-surface shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-ink">
            {stationLabel(rec.stationId)} · {FUEL_LABEL[rec.fuel]}
          </h2>
          <Pill tone={LEVEL_TONE[rec.level]}>{rec.level.toLowerCase()} risk</Pill>
          {rec.engine === 'fallback' && <Pill tone="warn">Fallback rule</Pill>}
          {rec.shipment && rec.reviewReason && (
            <Pill tone="warn">Needs review: {rec.reviewReason}</Pill>
          )}
        </div>
        <div className="text-[15px] text-ink-soft">
          Risk <span className="font-semibold text-ink">{rec.riskScore}</span>
          {rec.riskAfter !== null && (
            <>
              {' → '}
              <span className="font-semibold text-emerald-700">{rec.riskAfter}</span>
            </>
          )}
          <span className="mx-2 text-line">|</span>
          Runs out in <span className="font-semibold text-ink">{hoursText(rec.hoursToEmpty)}</span>
          {rec.hoursToEmptyAfter !== rec.hoursToEmpty && shipment && (
            <>
              {' → '}
              <span className="font-semibold text-emerald-700">
                {hoursText(rec.hoursToEmptyAfter)}
              </span>
            </>
          )}
        </div>
      </header>

      <div className="grid gap-5 p-5 lg:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          {shipment ? (
            <p className="text-xl font-semibold text-ink">
              Ship {liters(shipment.quantity)} from {depotLabel(shipment.depotId)} Depot
            </p>
          ) : (
            <p className="flex items-center gap-2 text-xl font-semibold text-red-700">
              <ShieldAlert className="size-5" aria-hidden /> No valid shipment possible
            </p>
          )}
          <ul className="list-disc space-y-1 pl-5 text-[15px] text-ink-soft">
            {rec.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {rec.alternatives.length > 0 && (
            <details className="text-[15px]">
              <summary className="cursor-pointer font-medium text-brand">
                Alternatives considered ({rec.alternatives.length})
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
                {rec.alternatives.map((alt) => (
                  <li key={alt}>{alt}</li>
                ))}
              </ul>
            </details>
          )}
          <button
            type="button"
            onClick={explain}
            disabled={explaining}
            className="flex items-center gap-2 text-[15px] font-medium text-violet-700 hover:underline disabled:opacity-50"
          >
            {explaining ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-4" aria-hidden />
            )}
            {explanation ? 'Explain again' : 'Explain with AI'}
          </button>
          {explanation && <AiAnswerBox answer={explanation} />}
        </div>
        {shipment && (
          <div className="flex gap-3 lg:flex-col">
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecide(rec.id, 'APPROVE')}
              className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Check className="size-5" aria-hidden /> Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecide(rec.id, 'REJECT')}
              className="flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-5 py-2.5 text-[15px] font-semibold text-ink-soft hover:bg-slate-50 disabled:opacity-50"
            >
              <X className="size-5" aria-hidden /> Reject
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export default function DecisionsPage() {
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/recommendations', { cache: 'no-store' });
      setData((await response.json()) as RecommendationsResponse);
    } catch {}
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 2000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const decide = async (recommendationId: string, action: 'APPROVE' | 'REJECT') => {
    setBusy(true);
    try {
      const response = await fetch('/api/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendationId, action }),
      });
      const result = await response.json();
      setNotice(
        result.ok
          ? {
              tone: 'good',
              text:
                action === 'APPROVE'
                  ? `Shipment sent to the simulator (allocation #${result.decision.allocationId}).`
                  : 'Recommendation rejected for the next hour.',
            }
          : { tone: 'bad', text: result.error?.message ?? 'Action failed.' },
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  const setMode = async (mode: Mode) => {
    await fetch('/api/autopilot', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    await load();
  };

  const plan = data?.plan;
  const recs = plan?.recommendations ?? [];
  const mode = data?.mode ?? 'MANUAL';

  return (
    <>
      <PageHeader
        title="Decisions"
        description="Shipments recommended by the engine. Each one is checked against every simulator limit before it is shown."
        action={
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-1.5">
            <span className="flex items-center gap-2 pl-2 text-[15px] font-medium text-ink-soft">
              <Bot className="size-5" aria-hidden /> Autopilot
            </span>
            {MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                className={`rounded-lg px-4 py-2 text-[15px] font-semibold ${
                  mode === option.value ? 'bg-brand text-white' : 'text-ink-soft hover:bg-slate-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="rounded-xl border border-line bg-surface px-5 py-4 text-[15px] text-ink-soft">
        {MODES.find((option) => option.value === mode)?.text} Automatic actions pause when data is
        stale.
        {plan && (
          <span className="ml-2 text-ink-muted">
            Watching {plan.watched} station fuels · forecast error{' '}
            {plan.forecastMape === null ? '—' : `${(plan.forecastMape * 100).toFixed(1)}%`}
          </span>
        )}
      </div>

      {notice && (
        <div
          className={`rounded-xl border px-5 py-3 text-[15px] ${
            notice.tone === 'good'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {notice.text}
        </div>
      )}

      {data?.fallbackActive && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-[15px] text-amber-900">
          <strong className="font-semibold">Fallback planner active.</strong> The main planner is
          unavailable ({data.engineError ?? 'unknown error'}). Simple refill rules are shown and
          every shipment needs operator approval.
        </div>
      )}

      {recs.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No action needed"
          message="Every station has enough fuel for the coming hours. New recommendations appear here automatically."
        />
      ) : (
        <div className="space-y-4">
          {recs.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} busy={busy} onDecide={decide} />
          ))}
        </div>
      )}

      <Card title="Decision history" subtitle="Newest first">
        {!data || data.decisions.length === 0 ? (
          <p className="text-[15px] text-ink-muted">No decisions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-180 text-left text-[15px]">
              <thead>
                <tr className="border-b border-line text-sm text-ink-muted">
                  <th className="pb-3 font-medium">Time</th>
                  <th className="pb-3 font-medium">Station · fuel</th>
                  <th className="pb-3 font-medium">Decision</th>
                  <th className="pb-3 font-medium">Shipment</th>
                  <th className="pb-3 font-medium">Risk</th>
                  <th className="pb-3 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.decisions.map((d) => (
                  <tr key={`${d.id}-${d.at}`}>
                    <td className="py-3 text-ink-muted">
                      Tick {d.tick} · {new Date(d.at).toLocaleTimeString('en-GB')}
                    </td>
                    <td className="py-3 font-medium text-ink">
                      {stationLabel(d.stationId)} · {FUEL_LABEL[d.fuel as keyof typeof FUEL_LABEL]}
                    </td>
                    <td className="py-3">
                      <Pill tone={ACTION_TONE[d.action]}>
                        {d.action === 'AUTO_EXECUTED' ? 'Autopilot' : d.action.toLowerCase()}
                      </Pill>
                    </td>
                    <td className="py-3 text-ink">
                      {d.quantity
                        ? `${liters(d.quantity)} via ${d.routeId?.replace('route-', '')}`
                        : '—'}
                    </td>
                    <td className="py-3 text-ink">
                      {d.riskBefore}
                      {d.riskAfter !== null ? ` → ${d.riskAfter}` : ''}
                    </td>
                    <td className="py-3">
                      {d.error ? (
                        <span className="text-sm text-red-700">{d.error}</span>
                      ) : d.allocationId ? (
                        <span className="text-sm font-medium text-emerald-700">
                          Sent · shipment #{d.allocationId}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
