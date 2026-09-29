'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { HealthReport } from '@/lib/observability/health';
import type { StateEnvelope } from '@/lib/world/snapshot';

const POLL_MS = 2000;

interface LiveData {
  state: StateEnvelope | null;
  health: HealthReport | null;
  backendReachable: boolean;
  lastUpdatedAt: number | null;
}

const LiveDataContext = createContext<LiveData>({
  state: null,
  health: null,
  backendReachable: true,
  lastUpdatedAt: null,
});

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function LiveDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<LiveData>({
    state: null,
    health: null,
    backendReachable: true,
    lastUpdatedAt: null,
  });

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [state, health] = await Promise.all([
        fetchJson<StateEnvelope>('/api/state'),
        fetchJson<HealthReport>('/api/health'),
      ]);
      if (!active) return;
      setData((previous) => ({
        state: state ?? previous.state,
        health: health ?? previous.health,
        backendReachable: state !== null || health !== null,
        lastUpdatedAt: state || health ? Date.now() : previous.lastUpdatedAt,
      }));
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return <LiveDataContext.Provider value={data}>{children}</LiveDataContext.Provider>;
}

export function useLiveData(): LiveData {
  return useContext(LiveDataContext);
}
