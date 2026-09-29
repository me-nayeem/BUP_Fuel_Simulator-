import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { statusLabel, statusTone, type Tone } from '@/lib/format';

const PILL_TONE: Record<Tone, string> = {
  good: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  bad: 'bg-red-50 text-red-800 ring-red-200',
  info: 'bg-blue-50 text-blue-800 ring-blue-200',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
};

const DOT_TONE: Record<Tone, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  info: 'bg-blue-500',
  neutral: 'bg-slate-400',
};

const BAR_TONE: Record<Tone, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  info: 'bg-blue-500',
  neutral: 'bg-slate-400',
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-medium whitespace-nowrap ring-1 ring-inset ${PILL_TONE[tone]}`}
    >
      <span className={`size-2 rounded-full ${DOT_TONE[tone]}`} />
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={statusTone(status)}>{statusLabel(status)}</Pill>;
}

export function Card({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface shadow-sm ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
}) {
  const iconTone: Record<Tone, string> = {
    good: 'bg-emerald-50 text-emerald-700',
    warn: 'bg-amber-50 text-amber-700',
    bad: 'bg-red-50 text-red-700',
    info: 'bg-blue-50 text-blue-700',
    neutral: 'bg-slate-100 text-slate-700',
  };
  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink-muted">{label}</span>
        <span className={`rounded-lg p-2 ${iconTone[tone]}`}>
          <Icon className="size-5" aria-hidden />
        </span>
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-ink">{value}</div>
      {hint && <div className="mt-1 text-sm text-ink-muted">{hint}</div>}
    </div>
  );
}

export function ProgressBar({ ratio, tone }: { ratio: number; tone: Tone }) {
  const width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${BAR_TONE[tone]}`} style={{ width }} />
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 text-base text-ink-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  message,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
      <Icon className="size-8 text-ink-muted" aria-hidden />
      <p className="mt-3 text-base font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{message}</p>
    </div>
  );
}
