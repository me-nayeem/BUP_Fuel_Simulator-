'use client';

import {
  Activity,
  BarChart3,
  AlertTriangle,
  ClipboardCheck,
  FlaskConical,
  Fuel,
  LayoutDashboard,
  Network,
  Siren,
  Sparkles,
  Truck,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useLiveData } from '@/components/providers/LiveDataProvider';
import { Pill, StatusPill } from '@/components/ui/primitives';
import { simClock, wallClock } from '@/lib/format';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/decisions', label: 'Decisions', icon: ClipboardCheck },
  { href: '/stations', label: 'Stations', icon: Fuel },
  { href: '/network', label: 'Depots & Routes', icon: Network },
  { href: '/shipments', label: 'Shipments', icon: Truck },
  { href: '/events', label: 'Events & Alerts', icon: Siren },
  { href: '/assistant', label: 'AI Assistant', icon: Sparkles },
  { href: '/system', label: 'System Health', icon: Activity },
  { href: '/scenario', label: 'Scenario Control', icon: FlaskConical },
  { href: '/experiments', label: 'Strategy Comparison', icon: BarChart3 },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

function Sidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-sidebar text-white lg:flex">
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="flex size-10 items-center justify-center rounded-lg bg-blue-600">
          <Fuel className="size-6" aria-hidden />
        </div>
        <div>
          <div className="text-base font-semibold leading-tight">Fuel Ops</div>
          <div className="text-sm text-slate-300">Command Center</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors ${
                active
                  ? 'bg-sidebar-active text-white'
                  : 'text-slate-300 hover:bg-sidebar-hover hover:text-white'
              }`}
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-6 py-4 text-sm text-slate-400">
        BUP Fuel Supply Simulator
        <br />
        Simulated data only
      </div>
    </aside>
  );
}

function MobileNav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-3 py-2 lg:hidden">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
            isActive(pathname, href) ? 'bg-brand-soft text-brand' : 'text-ink-soft'
          }`}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}

function TopBar() {
  const { state, health, backendReachable, lastUpdatedAt } = useLiveData();
  const world = state?.world;

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <div>
            <div className="text-sm text-ink-muted">Simulation time</div>
            <div className="text-lg font-semibold text-ink">
              {world ? simClock(world.simTime) : '—'}
            </div>
          </div>
          <div>
            <div className="text-sm text-ink-muted">Tick</div>
            <div className="text-lg font-semibold text-ink">{world?.tick ?? '—'}</div>
          </div>
          {world && <StatusPill status={world.simulationStatus} />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!backendReachable && <Pill tone="bad">Backend unreachable</Pill>}
          {state && (
            <Pill tone={state.freshness.source === 'LIVE' ? 'good' : 'warn'}>
              {state.freshness.source === 'LIVE' ? 'Live data' : 'Last known good'}
            </Pill>
          )}
          {health && (
            <Pill tone={health.status === 'HEALTHY' ? 'good' : 'warn'}>
              System {health.status.toLowerCase()}
            </Pill>
          )}
          <span className="text-sm text-ink-muted">Updated {wallClock(lastUpdatedAt)}</span>
        </div>
      </div>
    </header>
  );
}

function DegradedBanner() {
  const { state, backendReachable } = useLiveData();
  const freshness = state?.freshness;

  if (!backendReachable) {
    return (
      <div className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-3 text-[15px] text-red-900 sm:px-8">
        <WifiOff className="size-5 shrink-0" aria-hidden />
        Cannot reach the backend. Showing the last data received.
      </div>
    );
  }
  if (!freshness?.stale) return null;

  const age =
    freshness.ageMs === null ? '' : ` · data is ${Math.round(freshness.ageMs / 1000)} s old`;
  const reason = freshness.staleSignal
    ? 'The simulator is reporting stale data.'
    : `Simulator data API degraded (${freshness.lastError?.kind ?? 'unknown error'}).`;

  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-[15px] text-amber-900 sm:px-8">
      <AlertTriangle className="size-5 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">{reason}</strong> Showing last known good state{age}.
        Automatic actions are paused.
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen">
      <Sidebar pathname={pathname} />
      <div className="lg:pl-64">
        <TopBar />
        <MobileNav pathname={pathname} />
        <DegradedBanner />
        <main className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-8 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
