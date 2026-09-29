import { aiStatus } from '@/lib/ai/assistant';
import { config } from '@/lib/config';
import { registerHealthProbe } from '@/lib/observability/health';
import { logger } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';
import { getWorldStore } from '@/lib/world/snapshot';
import { cancelDoomedShipments, engineStatus, planFor, runAutopilot } from './engine';
import { startSimulatorStream, streamStatus } from './stream';

const MIN_GAP_MS = 250;

interface LoopState {
  started: boolean;
  running: boolean;
  dirty: boolean;
  paused: boolean;
  pending: ReturnType<typeof setTimeout> | null;
  lastStartAt: number;
  lastCycleAt: number | null;
  lastCycleMs: number | null;
  cycles: number;
  timer: ReturnType<typeof setInterval> | null;
}

const globalForLoop = globalThis as unknown as { __fuelLoop?: LoopState };

const loop: LoopState = (globalForLoop.__fuelLoop ??= {
  started: false,
  running: false,
  dirty: false,
  paused: false,
  pending: null,
  lastStartAt: 0,
  lastCycleAt: null,
  lastCycleMs: null,
  cycles: 0,
  timer: null,
});

async function cycle() {
  loop.running = true;
  loop.lastStartAt = Date.now();
  const started = performance.now();
  try {
    const envelope = await getWorldStore().refresh();
    planFor(envelope);
    const cancelled = await cancelDoomedShipments(envelope);
    const executed = await runAutopilot(envelope);
    if (cancelled > 0 || executed > 0) {
      if (executed > 0)
        logger.info('autopilot.executed', { count: executed, tick: envelope.world?.tick });
      await getWorldStore().refresh();
    }
  } catch (error) {
    logger.error('loop.cycle_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    loop.lastCycleMs = Math.round(performance.now() - started);
    loop.lastCycleAt = Date.now();
    loop.cycles += 1;
    metrics.observe('loop_cycle_duration_ms', loop.lastCycleMs);
    loop.running = false;
    if (loop.dirty) {
      loop.dirty = false;
      trigger();
    }
  }
}

export function trigger() {
  if (loop.paused) return;
  if (loop.running) {
    loop.dirty = true;
    return;
  }
  if (loop.pending) return;
  const wait = MIN_GAP_MS - (Date.now() - loop.lastStartAt);
  if (wait > 0) {
    loop.pending = setTimeout(() => {
      loop.pending = null;
      void cycle();
    }, wait);
    return;
  }
  void cycle();
}

export function setLoopPaused(paused: boolean) {
  loop.paused = paused;
  logger.info(paused ? 'loop.paused' : 'loop.resumed');
}

export async function waitForLoopIdle(timeoutMs = 10000) {
  const until = Date.now() + timeoutMs;
  while (loop.running && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export function loopStatus() {
  return {
    cycles: loop.cycles,
    paused: loop.paused,
    lastCycleAt: loop.lastCycleAt,
    lastCycleMs: loop.lastCycleMs,
    intervalMs: config.LOOP_POLL_MS,
  };
}

export function startControlLoop() {
  if (loop.started) return;
  loop.started = true;

  registerHealthProbe('Control loop', () => {
    if (loop.paused) {
      return { name: 'Control loop', status: 'DEGRADED', detail: 'Paused for an experiment run' };
    }
    const age = loop.lastCycleAt === null ? null : Date.now() - loop.lastCycleAt;
    if (age === null)
      return { name: 'Control loop', status: 'NOT_STARTED', detail: 'Waiting for first cycle' };
    const late = age > Math.max(5000, config.LOOP_POLL_MS * 5);
    return {
      name: 'Control loop',
      status: late ? 'DEGRADED' : 'HEALTHY',
      latencyMs: loop.lastCycleMs ?? undefined,
      detail: `Tick-driven, fallback poll ${config.LOOP_POLL_MS} ms · ${loop.cycles} cycles`,
    };
  });

  registerHealthProbe('Simulator stream', () => {
    const stream = streamStatus();
    if (stream.connected) {
      return {
        name: 'Simulator stream',
        status: 'HEALTHY',
        detail: `SSE connected${stream.reconnects > 0 ? ` · ${stream.reconnects} reconnects` : ''}`,
      };
    }
    return {
      name: 'Simulator stream',
      status: 'DEGRADED',
      detail: `SSE down, polling instead${stream.lastError ? ` · ${stream.lastError.slice(0, 60)}` : ''}`,
    };
  });

  registerHealthProbe('Decision engine', () => {
    const { mode, fallbackActive, error } = engineStatus();
    const modeText =
      mode === 'AUTO'
        ? 'Autopilot AUTO'
        : mode === 'ASSISTED'
          ? 'Autopilot ASSISTED'
          : 'Manual approval';
    return {
      name: 'Decision engine',
      status: fallbackActive ? 'DEGRADED' : 'HEALTHY',
      detail: fallbackActive
        ? `Fallback planner active: ${error ?? 'planner error'}`
        : `Forecast planner · ${modeText}`,
    };
  });

  registerHealthProbe('AI assistant', () => {
    const ai = aiStatus();
    if (!ai.configured)
      return {
        name: 'AI assistant',
        status: 'DISABLED',
        detail: 'No OpenAI key · built-in explanations',
      };
    if (ai.lastError)
      return {
        name: 'AI assistant',
        status: 'DEGRADED',
        detail: `Fallback active: ${ai.lastError.slice(0, 80)}`,
      };
    return { name: 'AI assistant', status: 'HEALTHY', detail: `OpenAI ${ai.model}` };
  });

  startSimulatorStream(() => trigger());
  loop.timer = setInterval(trigger, config.LOOP_POLL_MS);
  logger.info('loop.started', { pollMs: config.LOOP_POLL_MS });
  trigger();
}
