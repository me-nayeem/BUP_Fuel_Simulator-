import { config } from '@/lib/config';
import { logger } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';

const BACKOFF_MS = [1000, 2000, 5000, 10000];
const SILENCE_LIMIT_MS = 40000;

interface StreamState {
  started: boolean;
  connected: boolean;
  lastDataAt: number | null;
  lastEvent: string | null;
  reconnects: number;
  lastError: string | null;
}

const globalForStream = globalThis as unknown as { __simStream?: StreamState };

const state: StreamState = (globalForStream.__simStream ??= {
  started: false,
  connected: false,
  lastDataAt: null,
  lastEvent: null,
  reconnects: 0,
  lastError: null,
});

export function streamStatus() {
  return { ...state };
}

export function startSimulatorStream(onEvent: (name: string) => void) {
  if (state.started) return;
  state.started = true;
  let attempt = 0;

  const connect = async () => {
    const controller = new AbortController();
    const watchdog = setInterval(() => {
      if (state.lastDataAt !== null && Date.now() - state.lastDataAt > SILENCE_LIMIT_MS) {
        controller.abort(new Error('No data or keepalive for 40 s'));
      }
    }, 5000);

    try {
      const response = await fetch(`${config.SIMULATOR_BASE_URL.replace(/\/$/, '')}/v1/stream`, {
        headers: { Accept: 'text/event-stream' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`Stream responded ${response.status}`);

      state.connected = true;
      state.lastDataAt = Date.now();
      state.lastError = null;
      if (attempt > 0) {
        state.reconnects += 1;
        logger.info('sse.reconnected', { attempts: attempt });
      } else {
        logger.info('sse.connected');
      }
      attempt = 0;
      onEvent('reconnected');

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        state.lastDataAt = Date.now();
        buffer += value;
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const name = /^event: *(.+)$/m.exec(chunk)?.[1]?.trim();
          if (name) {
            state.lastEvent = name;
            metrics.inc('sse_events_total', { event: name });
            onEvent(name);
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
      throw new Error('Stream closed by simulator');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? 'Stream connection failed');
      if (state.connected || attempt === 0) logger.warn('sse.disconnected', { error: message });
      state.connected = false;
      state.lastError = message;
      metrics.inc('sse_disconnects_total');
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt += 1;
      setTimeout(() => void connect(), delay);
    } finally {
      clearInterval(watchdog);
    }
  };

  void connect();
}
