import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const stateLatency = new Trend('latency_state', true);
const recommendationsLatency = new Trend('latency_recommendations', true);
const healthLatency = new Trend('latency_health', true);

export const options = {
  scenarios: {
    dashboard_read_path: {
      executor: 'ramping-vus',
      exec: 'dashboard',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 25 },
        { duration: '30s', target: 100 },
        { duration: '30s', target: 100 },
        { duration: '10s', target: 0 },
      ],
    },
    decision_path: {
      executor: 'constant-arrival-rate',
      exec: 'decisions',
      rate: 20,
      timeUnit: '1s',
      duration: '85s',
      preAllocatedVUs: 20,
      maxVUs: 60,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    latency_state: ['p(95)<300'],
    latency_recommendations: ['p(95)<500'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function dashboard() {
  const state = http.get(`${BASE_URL}/api/state`, { tags: { endpoint: 'state' } });
  stateLatency.add(state.timings.duration);
  check(state, { 'state 200': (r) => r.status === 200 });

  const health = http.get(`${BASE_URL}/api/health`, { tags: { endpoint: 'health' } });
  healthLatency.add(health.timings.duration);
  check(health, { 'health 200': (r) => r.status === 200 });

  sleep(1);
}

export function decisions() {
  const res = http.get(`${BASE_URL}/api/recommendations`, {
    tags: { endpoint: 'recommendations' },
  });
  recommendationsLatency.add(res.timings.duration);
  check(res, {
    'recommendations 200': (r) => r.status === 200,
    'plan present': (r) => r.json('plan') !== null,
  });
}
