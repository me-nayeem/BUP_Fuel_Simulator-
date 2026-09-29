import { config } from '@/lib/config';
import type { DecisionRecord } from '@/lib/engine/engine';
import { depotLabel, FUEL_LABEL, stationLabel } from '@/lib/format';
import type { Plan, Recommendation } from '@/lib/intelligence/planner';
import { logger, type LogEntry } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';
import { FUEL_TYPES } from '@/lib/simulator/types';
import type { WorldState } from '@/lib/world/snapshot';

export interface AiAnswer {
  text: string;
  source: 'openai' | 'template';
  model: string | null;
  latencyMs: number;
  note?: string;
}

export interface AssistantContext {
  world: WorldState;
  plan: Plan | null;
  decisions: DecisionRecord[];
  logs: LogEntry[];
  healthStatus: string | null;
  stale: boolean;
}

const SYSTEM_PROMPT = [
  'You are the operations assistant of a fuel supply command center.',
  'The network is SIMULATED by the BUP Fuel Supply Simulator; never imply it is real infrastructure.',
  'Answer only from the JSON facts you are given. Never invent numbers, stations, routes or events.',
  'If the facts do not contain the answer, say so plainly.',
  'Write for a busy operator: plain English, short sentences, concrete numbers with units, no markdown headings.',
  'You explain and summarise; you do not approve or execute shipments.',
].join(' ');

const globalForAi = globalThis as unknown as {
  __aiState?: { lastError: string | null; lastOkAt: number | null; cache: Map<string, AiAnswer> };
};
const state = (globalForAi.__aiState ??= { lastError: null, lastOkAt: null, cache: new Map() });

export function aiStatus() {
  return {
    configured: Boolean(config.OPENAI_API_KEY),
    model: config.OPENAI_MODEL,
    lastError: state.lastError,
    lastOkAt: state.lastOkAt,
  };
}

function round(value: number) {
  return Math.round(value);
}

export function compactFacts(context: AssistantContext) {
  const { world, plan } = context;
  return {
    simulated: true,
    tick: world.tick,
    simTime: world.simTime,
    simulation: world.simulationStatus,
    dataStale: context.stale,
    systemHealth: context.healthStatus,
    serviceLevelPercent: Math.round(world.metrics.service_level * 1000) / 10,
    unmetDemandLiters: round(world.metrics.unmet_demand_liters),
    failedShipments: world.metrics.allocation_failures,
    stations: world.stations.map((s) => ({
      name: stationLabel(s.id),
      status: s.status,
      demandMultiplier: s.demand_multiplier,
      stockPercent: Object.fromEntries(
        FUEL_TYPES.map((f) => [f, Math.round((s.inventory[f] / s.capacity[f]) * 100)]),
      ),
    })),
    depots: world.depots.map((d) => ({
      name: depotLabel(d.id),
      status: d.status,
      stockLiters: Object.fromEntries(FUEL_TYPES.map((f) => [f, round(d.inventory[f])])),
    })),
    disruptedRoutes: world.routes.filter((r) => r.status !== 'AVAILABLE').map((r) => r.id),
    events: world.events
      .filter((e) => e.status !== 'RESOLVED')
      .map((e) => ({
        type: e.type,
        status: e.status,
        fromTick: e.start_tick,
        toTick: e.end_tick,
        parameters: e.parameters,
      })),
    openShipments: world.allocations
      .filter((a) => a.status === 'PENDING' || a.status === 'IN_TRANSIT')
      .map((a) => ({
        route: a.route_id,
        fuel: a.fuel_type,
        liters: round(a.quantity),
        status: a.status,
        arrivesTick: a.expected_arrival_tick,
      })),
    forecastErrorPercent:
      plan?.forecastMape == null ? null : Math.round(plan.forecastMape * 1000) / 10,
    recommendations: (plan?.recommendations ?? []).slice(0, 6).map((r) => ({
      station: stationLabel(r.stationId),
      fuel: r.fuel,
      level: r.level,
      risk: r.riskScore,
      riskAfter: r.riskAfter,
      hoursToEmpty: r.hoursToEmpty === null ? null : Math.round(r.hoursToEmpty * 10) / 10,
      action: r.shipment
        ? `ship ${round(r.shipment.quantity)} L via ${r.shipment.routeId}`
        : 'no valid shipment',
    })),
    recentDecisions: context.decisions.slice(0, 8).map((d) => ({
      tick: d.tick,
      station: stationLabel(d.stationId),
      fuel: d.fuel,
      action: d.action,
      liters: d.quantity,
      error: d.error,
    })),
    recentAlerts: context.logs
      .filter((l) => l.level === 'warn' || l.level === 'error')
      .slice(0, 10)
      .map((l) => ({
        at: l.ts,
        event: l.event,
        ...(l.kind ? { kind: l.kind } : {}),
        ...(l.code ? { code: l.code } : {}),
      })),
  };
}

async function callOpenAi(
  prompt: string,
  maxTokens: number,
): Promise<{ text: string; latencyMs: number }> {
  const started = performance.now();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: config.OPENAI_MODEL,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(config.OPENAI_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  } | null;
  if (!response.ok) throw new Error(body?.error?.message ?? `OpenAI responded ${response.status}`);
  const text = body?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenAI returned an empty answer');
  return { text, latencyMs: Math.round(performance.now() - started) };
}

async function withFallback(
  kind: string,
  prompt: string,
  maxTokens: number,
  fallback: () => string,
): Promise<AiAnswer> {
  const started = performance.now();
  if (!config.OPENAI_API_KEY) {
    metrics.inc('ai_requests_total', { kind, outcome: 'not_configured' });
    return {
      text: fallback(),
      source: 'template',
      model: null,
      latencyMs: 0,
      note: 'OpenAI key not configured',
    };
  }
  try {
    const { text, latencyMs } = await callOpenAi(prompt, maxTokens);
    state.lastError = null;
    state.lastOkAt = Date.now();
    metrics.inc('ai_requests_total', { kind, outcome: 'ok' });
    metrics.observe('ai_request_duration_ms', latencyMs, { kind });
    return { text, source: 'openai', model: config.OPENAI_MODEL, latencyMs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.lastError = message;
    metrics.inc('ai_requests_total', { kind, outcome: 'fallback' });
    logger.warn('ai.fallback', { kind, error: message });
    return {
      text: fallback(),
      source: 'template',
      model: null,
      latencyMs: Math.round(performance.now() - started),
      note: `AI unavailable (${message}). Showing the built-in explanation.`,
    };
  }
}

function templateExplanation(rec: Recommendation): string {
  const lines = [...rec.reasons];
  if (rec.alternatives.length > 0)
    lines.push(`Alternatives considered: ${rec.alternatives.join(' ')}`);
  return lines.join(' ');
}

export async function explainRecommendation(
  rec: Recommendation,
  context: AssistantContext,
): Promise<AiAnswer> {
  const cached = state.cache.get(rec.id);
  if (cached) return cached;
  const prompt = [
    'Explain this fuel shipment recommendation to the operator in 3-5 sentences:',
    'why the station/fuel is at risk, why this depot, route and quantity were chosen, what it changes, and what the alternatives were.',
    `Recommendation: ${JSON.stringify({
      station: stationLabel(rec.stationId),
      fuel: FUEL_LABEL[rec.fuel],
      stockLiters: round(rec.inventory),
      capacityLiters: rec.capacity,
      alreadyInboundLiters: round(rec.inbound),
      forecastNext6hLiters: round(rec.forecastNext6h),
      hoursToEmpty: rec.hoursToEmpty,
      hoursToEmptyAfter: rec.hoursToEmptyAfter,
      riskBefore: rec.riskScore,
      riskAfter: rec.riskAfter,
      level: rec.level,
      shipment: rec.shipment,
      engineReasons: rec.reasons,
      alternatives: rec.alternatives,
      forecastErrorPercent:
        rec.forecastMape === null ? null : Math.round(rec.forecastMape * 1000) / 10,
    })}`,
    `Network facts: ${JSON.stringify(compactFacts(context))}`,
  ].join('\n');
  const answer = await withFallback('explain', prompt, 350, () => templateExplanation(rec));
  if (answer.source === 'openai') {
    state.cache.set(rec.id, answer);
    if (state.cache.size > 100) state.cache.delete(state.cache.keys().next().value as string);
  }
  return answer;
}

function templateSummary(context: AssistantContext): string {
  const facts = compactFacts(context);
  const risky = facts.recommendations.filter((r) => r.level === 'CRITICAL' || r.level === 'HIGH');
  const parts = [
    `Tick ${facts.tick}. Service level ${facts.serviceLevelPercent}% with ${facts.unmetDemandLiters.toLocaleString('en-US')} L unmet demand so far.`,
    risky.length > 0
      ? `High-risk items: ${risky.map((r) => `${r.station} ${r.fuel} (risk ${r.risk})`).join(', ')}.`
      : 'No station fuel is at high risk right now.',
    facts.events.length > 0
      ? `Crisis events: ${facts.events.map((e) => `${e.type.replaceAll('_', ' ')} (${e.status.toLowerCase()})`).join(', ')}.`
      : 'No active crisis events.',
    `${facts.openShipments.length} shipment(s) on the road.`,
    facts.dataStale ? 'Warning: simulator data is stale; automatic actions are paused.' : '',
  ];
  return parts.filter(Boolean).join(' ');
}

export async function summarizeNetwork(context: AssistantContext): Promise<AiAnswer> {
  const prompt = [
    'Write a situation report for the operator in two short parts.',
    'Part 1 "Network state": overall health, service level, which stations/fuels need attention and what is on the road.',
    'Part 2 "Incidents": explain any crisis events, disrupted routes, failed shipments or system alerts, their likely impact, and what the platform did or recommends.',
    'If there are no incidents, say the network is operating normally. Maximum 170 words.',
    `Facts: ${JSON.stringify(compactFacts(context))}`,
  ].join('\n');
  return withFallback('summary', prompt, 450, () => templateSummary(context));
}

export async function answerQuestion(
  question: string,
  context: AssistantContext,
): Promise<AiAnswer> {
  const prompt = [
    'The operator is investigating the network and asks the question below.',
    'Answer in at most 120 words using only the facts. Point to the specific station, fuel, route or event.',
    `Question: ${question}`,
    `Facts: ${JSON.stringify(compactFacts(context))}`,
  ].join('\n');
  return withFallback(
    'ask',
    prompt,
    350,
    () => `The AI assistant is unavailable. Current summary: ${templateSummary(context)}`,
  );
}
