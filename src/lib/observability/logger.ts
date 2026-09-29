import { config } from '@/lib/config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  [field: string]: unknown;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const RECENT_LIMIT = 200;

// Recent info+ entries, newest last, for the in-app activity feed.
// Kept on globalThis so route handlers and the control loop share one buffer.
const globalForLogs = globalThis as unknown as { __fuelRecentLogs?: LogEntry[] };
const recent = (globalForLogs.__fuelRecentLogs ??= []);

function write(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  if (LEVEL_RANK[level] < LEVEL_RANK[config.LOG_LEVEL]) return;
  const entry: LogEntry = { ts: new Date().toISOString(), level, event, ...fields };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  if (LEVEL_RANK[level] >= LEVEL_RANK.info) {
    recent.push(entry);
    if (recent.length > RECENT_LIMIT) recent.shift();
  }
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => write('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
};

export function recentLogs(limit = 50): LogEntry[] {
  return recent.slice(-limit).reverse();
}
