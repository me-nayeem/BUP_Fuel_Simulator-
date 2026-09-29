import {
  FUEL_TYPES,
  type Allocation,
  type Depot,
  type FuelAmounts,
  type Route,
  type Station,
} from '@/lib/simulator/types';
import { depotLabel, FUEL_COLOR, stationLabel } from '@/lib/format';

interface Point {
  x: number;
  y: number;
}

const VIEW_W = 1080;
const VIEW_H = 560;
const NODE_W = 250;
const NODE_H = 112;
const REGION_SPLIT = 280;

const DEPOT_POS: Record<string, Point> = {
  'depot-gazipur': { x: 30, y: 84 },
  'depot-patiya': { x: 30, y: 364 },
};

const STATION_POS: Record<string, Point> = {
  'station-mirpur': { x: 800, y: 24 },
  'station-tongi': { x: 800, y: 148 },
  'station-karnaphuli': { x: 800, y: 300 },
  'station-coxsbazar': { x: 800, y: 424 },
};

const LABEL_POSITION: Record<string, number> = {
  'route-gazipur-karnaphuli': 0.75,
  'route-patiya-mirpur': 0.25,
};

const STATUS_STROKE: Record<string, string> = {
  OPEN: '#cbd5e1',
  CONSTRAINED: '#f59e0b',
  OUTAGE: '#ef4444',
};

function FuelBars({
  origin,
  inventory,
  capacity,
}: {
  origin: Point;
  inventory: FuelAmounts;
  capacity: FuelAmounts;
}) {
  const barX = origin.x + 34;
  const barWidth = NODE_W - 92;
  return (
    <g>
      {FUEL_TYPES.map((fuel, index) => {
        const ratio = capacity[fuel] > 0 ? Math.min(1, inventory[fuel] / capacity[fuel]) : 0;
        const y = origin.y + 46 + index * 20;
        const low = ratio < 0.25;
        return (
          <g key={fuel}>
            <text x={origin.x + 16} y={y + 11} fontSize="14" fontWeight="600" fill="#475569">
              {fuel[0]}
            </text>
            <rect x={barX} y={y} width={barWidth} height="12" rx="6" fill="#eef2f7" />
            <rect
              x={barX}
              y={y}
              width={Math.max(6, barWidth * ratio)}
              height="12"
              rx="6"
              fill={low ? '#ef4444' : FUEL_COLOR[fuel]}
            />
            <text
              x={origin.x + NODE_W - 14}
              y={y + 11}
              fontSize="14"
              fontWeight="500"
              fill={low ? '#b91c1c' : '#334155'}
              textAnchor="end"
            >
              {Math.round(ratio * 100)}%
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Node({
  origin,
  title,
  subtitle,
  status,
  inventory,
  capacity,
}: {
  origin: Point;
  title: string;
  subtitle: string;
  status: string;
  inventory: FuelAmounts;
  capacity: FuelAmounts;
}) {
  const stroke = STATUS_STROKE[status] ?? '#cbd5e1';
  const alert = status !== 'OPEN';
  return (
    <g>
      <rect
        x={origin.x}
        y={origin.y}
        width={NODE_W}
        height={NODE_H}
        rx="14"
        fill="#ffffff"
        stroke={stroke}
        strokeWidth={alert ? 3 : 1.5}
      />
      <text x={origin.x + 16} y={origin.y + 28} fontSize="18" fontWeight="600" fill="#0f172a">
        {title}
      </text>
      <text
        x={origin.x + NODE_W - 14}
        y={origin.y + 27}
        fontSize="13.5"
        fontWeight={alert ? 700 : 400}
        fill={alert ? (status === 'CONSTRAINED' ? '#b45309' : '#b91c1c') : '#5b6b82'}
        textAnchor="end"
      >
        {subtitle}
      </text>
      <FuelBars origin={origin} inventory={inventory} capacity={capacity} />
    </g>
  );
}

function routeGeometry(route: Route) {
  const depot = DEPOT_POS[route.source_depot_id];
  const station = STATION_POS[route.destination_station_id];
  if (!depot || !station) return null;
  const start = { x: depot.x + NODE_W, y: depot.y + NODE_H / 2 };
  const end = { x: station.x, y: station.y + NODE_H / 2 };
  const t = LABEL_POSITION[route.id] ?? 0.5;
  const label = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
  return { start, end, label };
}

function routeLabel(route: Route, trucks: number, liters: number) {
  if (route.status !== 'AVAILABLE') return 'Disrupted';
  if (trucks > 0)
    return `${trucks} truck${trucks > 1 ? 's' : ''} · ${(liters / 1000).toFixed(1)}k L`;
  return `${route.transit_ticks} ticks · max ${(route.max_shipment / 1000).toFixed(1)}k`;
}

export function NetworkMap({
  depots,
  stations,
  routes,
  shipments,
}: {
  depots: Depot[];
  stations: Station[];
  routes: Route[];
  shipments: Map<string, Allocation[]>;
}) {
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-auto w-full"
      role="img"
      aria-label="Fuel network map"
    >
      <rect x="0" y="0" width={VIEW_W} height={REGION_SPLIT - 4} rx="16" fill="#f4f7ff" />
      <rect
        x="0"
        y={REGION_SPLIT + 4}
        width={VIEW_W}
        height={VIEW_H - REGION_SPLIT - 4}
        rx="16"
        fill="#f7f5ff"
      />
      <text
        x={VIEW_W / 2}
        y="30"
        fontSize="15"
        fontWeight="700"
        fill="#64748b"
        textAnchor="middle"
        letterSpacing="1.5"
      >
        DHAKA DIVISION
      </text>
      <text
        x={VIEW_W / 2}
        y={VIEW_H - 16}
        fontSize="15"
        fontWeight="700"
        fill="#64748b"
        textAnchor="middle"
        letterSpacing="1.5"
      >
        CHATTOGRAM DIVISION
      </text>

      {routes.map((route) => {
        const geometry = routeGeometry(route);
        if (!geometry) return null;
        const disrupted = route.status !== 'AVAILABLE';
        const active = (shipments.get(route.id) ?? []).length > 0;
        return (
          <line
            key={route.id}
            x1={geometry.start.x}
            y1={geometry.start.y}
            x2={geometry.end.x}
            y2={geometry.end.y}
            stroke={disrupted ? '#ef4444' : active ? '#2563eb' : '#94a3b8'}
            strokeWidth={active ? 5 : 3}
            strokeDasharray={disrupted ? '10 8' : undefined}
          />
        );
      })}

      {routes.map((route) => {
        const geometry = routeGeometry(route);
        if (!geometry) return null;
        const disrupted = route.status !== 'AVAILABLE';
        const open = shipments.get(route.id) ?? [];
        const liters = open.reduce((sum, a) => sum + a.quantity, 0);
        const active = open.length > 0;
        const text = routeLabel(route, open.length, liters);
        const width = Math.max(128, text.length * 8.4 + 24);
        return (
          <g
            key={`${route.id}-label`}
            transform={`translate(${geometry.label.x} ${geometry.label.y})`}
          >
            <rect
              x={-width / 2}
              y="-16"
              width={width}
              height="32"
              rx="16"
              fill={disrupted ? '#fef2f2' : active ? '#eff6ff' : '#ffffff'}
              stroke={disrupted ? '#fca5a5' : active ? '#93c5fd' : '#cbd5e1'}
            />
            <text
              y="5.5"
              fontSize="14.5"
              fontWeight={disrupted || active ? 600 : 500}
              fill={disrupted ? '#b91c1c' : active ? '#1d4ed8' : '#334155'}
              textAnchor="middle"
            >
              {text}
            </text>
          </g>
        );
      })}

      {depots.map((depot) => {
        const origin = DEPOT_POS[depot.id];
        if (!origin) return null;
        return (
          <Node
            key={depot.id}
            origin={origin}
            title={`${depotLabel(depot.id)} Depot`}
            subtitle={depot.status === 'OPEN' ? 'depot' : depot.status.toLowerCase()}
            status={depot.status}
            inventory={depot.inventory}
            capacity={depot.capacity}
          />
        );
      })}

      {stations.map((station) => {
        const origin = STATION_POS[station.id];
        if (!origin) return null;
        return (
          <Node
            key={station.id}
            origin={origin}
            title={stationLabel(station.id)}
            subtitle={
              station.status === 'OPEN'
                ? station.demand_profile.replace('_', ' ')
                : station.status.toLowerCase()
            }
            status={station.status}
            inventory={station.inventory}
            capacity={station.capacity}
          />
        );
      })}
    </svg>
  );
}
