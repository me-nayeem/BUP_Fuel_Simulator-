'use client';

import { useEffect, useState } from 'react';

export function usePolling<T>(url: string, intervalMs = 3000): T | null {
  const [data, setData] = useState<T | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (response.ok && active) setData((await response.json()) as T);
      } catch {}
    };
    load();
    const timer = setInterval(load, intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [url, intervalMs]);

  return data;
}
