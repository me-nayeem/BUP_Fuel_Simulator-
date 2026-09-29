'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { FUEL_TYPES } from '@/lib/simulator/types';
import { FUEL_COLOR, FUEL_LABEL } from '@/lib/format';
import type { DemandPoint } from '@/lib/world/derived';

export function DemandChart({ data }: { data: DemandPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="flex h-44 items-center justify-center rounded-lg bg-slate-50 text-sm text-ink-muted">
        Demand history appears once the simulation starts running.
      </div>
    );
  }

  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 13, fill: '#5b6b82' }}
            tickLine={false}
            axisLine={{ stroke: '#cbd5e1' }}
            minTickGap={24}
          />
          <YAxis tick={{ fontSize: 13, fill: '#5b6b82' }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ fontSize: 14, borderRadius: 8, borderColor: '#e2e8f0' }}
            formatter={(value, name) => [`${value} L`, FUEL_LABEL[name as keyof typeof FUEL_LABEL]]}
            labelFormatter={(label) => `Sim time ${label}`}
          />
          <Legend
            formatter={(value) => FUEL_LABEL[value as keyof typeof FUEL_LABEL]}
            wrapperStyle={{ fontSize: 14 }}
          />
          {FUEL_TYPES.map((fuel) => (
            <Line
              key={fuel}
              type="monotone"
              dataKey={fuel}
              stroke={FUEL_COLOR[fuel]}
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
