// Minimal in-process metrics registry: counters, gauges and windowed summaries.
// Exposed as JSON for the dashboard and as Prometheus text for scraping.

type Labels = Record<string, string | number>;

const WINDOW_SIZE = 1000;

class Summary {
  private window: number[] = [];
  count = 0;
  sum = 0;

  observe(value: number) {
    this.count += 1;
    this.sum += value;
    this.window.push(value);
    if (this.window.length > WINDOW_SIZE) this.window.shift();
  }

  values(): readonly number[] {
    return this.window;
  }

  quantile(q: number): number | null {
    return quantileOf([...this.window], q);
  }
}

function quantileOf(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const index = Math.min(values.length - 1, Math.ceil(q * values.length) - 1);
  return values[Math.max(0, index)];
}

function key(name: string, labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) return name;
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${String(labels[k]).replace(/"/g, '\\"')}"`);
  return `${name}{${parts.join(',')}}`;
}

function splitKey(fullKey: string): { name: string; labelText: string } {
  const brace = fullKey.indexOf('{');
  if (brace === -1) return { name: fullKey, labelText: '' };
  return { name: fullKey.slice(0, brace), labelText: fullKey.slice(brace + 1, -1) };
}

const globalForMetrics = globalThis as unknown as {
  __fuelMetrics?: {
    counters: Map<string, number>;
    gauges: Map<string, number>;
    summaries: Map<string, Summary>;
  };
};

const registry = (globalForMetrics.__fuelMetrics ??= {
  counters: new Map(),
  gauges: new Map(),
  summaries: new Map(),
});

export const metrics = {
  inc(name: string, labels?: Labels, by = 1) {
    const k = key(name, labels);
    registry.counters.set(k, (registry.counters.get(k) ?? 0) + by);
  },

  set(name: string, value: number, labels?: Labels) {
    registry.gauges.set(key(name, labels), value);
  },

  observe(name: string, value: number, labels?: Labels) {
    const k = key(name, labels);
    let summary = registry.summaries.get(k);
    if (!summary) {
      summary = new Summary();
      registry.summaries.set(k, summary);
    }
    summary.observe(value);
  },

  counter(name: string, labels?: Labels): number {
    return registry.counters.get(key(name, labels)) ?? 0;
  },

  /** Sum of a counter across all label combinations. */
  counterTotal(name: string, filter?: (labelText: string) => boolean): number {
    let total = 0;
    for (const [k, v] of registry.counters) {
      const { name: n, labelText } = splitKey(k);
      if (n === name && (!filter || filter(labelText))) total += v;
    }
    return total;
  },

  /** Quantile over every sample window of a summary, across label combinations. */
  quantileAll(name: string, q: number): number | null {
    const values: number[] = [];
    for (const [k, s] of registry.summaries) {
      if (splitKey(k).name === name) values.push(...s.values());
    }
    return quantileOf(values, q);
  },

  toPrometheus(): string {
    const lines: string[] = [];
    const typed = new Set<string>();
    const typeLine = (name: string, type: string) => {
      if (typed.has(name)) return;
      typed.add(name);
      lines.push(`# TYPE ${name} ${type}`);
    };

    for (const [k, v] of registry.counters) {
      typeLine(splitKey(k).name, 'counter');
      lines.push(`${k} ${v}`);
    }
    for (const [k, v] of registry.gauges) {
      typeLine(splitKey(k).name, 'gauge');
      lines.push(`${k} ${v}`);
    }
    for (const [k, s] of registry.summaries) {
      const { name, labelText } = splitKey(k);
      typeLine(name, 'summary');
      for (const q of [0.5, 0.95, 0.99]) {
        const value = s.quantile(q);
        if (value === null) continue;
        const labels = labelText ? `${labelText},quantile="${q}"` : `quantile="${q}"`;
        lines.push(`${name}{${labels}} ${value}`);
      }
      const suffix = labelText ? `{${labelText}}` : '';
      lines.push(`${name}_sum${suffix} ${s.sum}`, `${name}_count${suffix} ${s.count}`);
    }
    return lines.join('\n') + '\n';
  },
};
