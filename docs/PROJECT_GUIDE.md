# Project Guide — what every folder and file does

This guide explains the Fuel Ops Command Center codebase in plain words. Read the
**big picture** first, then look up any file in the tables.

## The big picture in one line

```
Simulator  →  simulator client  →  world store  →  control loop  →  forecast → planner  →  decision  →  back to simulator
                                                         ↓
                                          UI pages · AI assistant · health/metrics · database
```

- The **simulator** (organizer's Docker image) is the "world". It has the real stock,
  routes and demand.
- Our app is the **brain**. It reads the world, predicts shortages, decides shipments,
  sends them back, and shows everything to the operator.
- The app is **one Next.js project**: the pages (UI), the API routes and the engine all
  live in `src/`.

## Folder map

```
BUP_Onsite/
├── src/                     All application code
│   ├── app/                 Pages (what you see) and API routes (/api/...)
│   ├── components/          Reusable UI pieces used by the pages
│   ├── lib/                 The brain: simulator client, engine, intelligence, AI, monitoring
│   ├── generated/prisma/    Auto-generated database client (never edit, not in git)
│   └── instrumentation.ts   Starts the control loop when the server boots
├── prisma/                  Database schema and migrations
├── tests/                   Unit tests (Vitest)
├── load/                    k6 load test
├── docs/                    Architecture PDF/PNG and this guide
├── .github/workflows/       CI pipeline (GitHub Actions)
├── context/                 Hackathon brief, simulator guide, plan (not in git)
└── root config files        Docker, Next.js, TypeScript, lint, env, package files
```

---

## `src/lib/` — the brain

### `src/lib/simulator/` — talking to the simulator

| File | What it does |
|---|---|
| `client.ts` | The **only** place that calls the simulator over HTTP. Adds a 2.5 s timeout, retries temporary errors (503, timeout) but never 409 rejections, a circuit breaker (stops calling for 3 s after 5 failures), a limit of 4 requests at once, and detects the `X-Simulator-Stale` header. Also has the admin calls (step, run, pause, reset, inject event/fault). |
| `types.ts` | The shape of every simulator response (depots, stations, routes, allocations, events…) written as Zod schemas. Bad data from the simulator is rejected here. |
| `errors.ts` | Turns the simulator's three different error formats into one `SimulatorError` and decides whether an error is worth retrying. |

### `src/lib/world/` — one clean picture of the network

| File | What it does |
|---|---|
| `snapshot.ts` | Reads all 10 simulator resources in parallel and builds one `WorldState`. Keeps the **last-known-good** copy when the simulator fails or sends stale data, and tells the UI how fresh the data is. Many callers share one read, so the simulator is never flooded. |
| `derived.ts` | Small helpers that compute numbers for the UI: stock levels, shipments per route, active events, demand history per station, usage per hour. |

### `src/lib/intelligence/` — prediction and decision logic

| File | What it does |
|---|---|
| `demand-model.ts` | The simulator's demand pattern we measured: daily demand per profile and fuel, busy/quiet hour factors, noise levels. |
| `forecast.ts` | Predicts demand for the next 24 ticks for every station and fuel. Uses the demand model, the station's current spike multiplier, **scheduled** demand spikes, and corrects itself against real recent demand. Also measures forecast error (MAPE). |
| `planner.ts` | The main decision maker. Projects each station's stock forward, scores risk (0–100), picks the best route and quantity while respecting every simulator limit (route open, depot stock, dispatch per tick, max shipment, tank space) and shares depot budgets across all shipments. Produces recommendations with reasons, alternatives and "risk before → after". |
| `baseline.ts` | The **fallback planner**: a simple "refill below 35%" rule used when the main planner fails. Also used as the "Threshold rule" in the strategy comparison. |

### `src/lib/engine/` — the control loop that acts

| File | What it does |
|---|---|
| `loop.ts` | The heartbeat. Runs a cycle on every simulator event (and every 500 ms as backup): refresh world → plan → cancel doomed shipments → autopilot → refresh. Registers the health checks for loop, stream, engine and AI. Can be paused while experiments run. |
| `stream.ts` | Listens to the simulator's live event stream (SSE). Each event only *triggers* a cycle — the real data is always re-read from REST. Reconnects automatically and detects silent drops. |
| `engine.ts` | Holds the current plan and the autopilot mode (MANUAL / ASSISTED / AUTO). Decides which shipments need operator review, executes approved shipments with a stable idempotency key, handles approve/reject, cancels pending shipments on disrupted routes, switches to the fallback planner on errors, and saves decisions to the database. |

### Other `src/lib/` files

| File | What it does |
|---|---|
| `ai/assistant.ts` | OpenAI integration: explains a recommendation, writes a network/incident situation report, answers operator questions. Uses only live facts, never executes anything, and returns a built-in text if OpenAI fails. |
| `experiments/runner.ts` | Strategy comparison: resets the simulator and plays the same scenario with *No action*, *Threshold rule* and *Our planner*, then records the simulator's own metrics. Pauses the live loop while it runs. |
| `observability/logger.ts` | Structured JSON logs to the console, plus the recent-activity list shown on the Events page. |
| `observability/metrics.ts` | Counters, gauges and latency summaries; exported in Prometheus format. |
| `observability/health.ts` | Builds the health report: every component's status, p50/p95 latency, error rates, CPU, memory, event-loop lag. Caches the simulator and database checks for 2 s. |
| `observability/http.ts` | Wrapper for API routes that records latency and errors and returns a safe 500 on crashes. |
| `config.ts` | Reads and validates environment variables (simulator URL, database URL, OpenAI key, autopilot mode…). The app refuses to start with invalid config. |
| `prisma.ts` | Creates the database client (Prisma 7 + PostgreSQL). Returns nothing if no database is configured, so the app still works. |
| `format.ts` | Display helpers: liters, percentages, simulation clock, station/depot names, status colors. |

### `src/instrumentation.ts`

Runs once when the server starts and launches the control loop. This is why the app
keeps working even when no browser is open.

---

## `src/app/` — pages and API

### Pages (what the operator sees)

| URL | File | What it shows |
|---|---|---|
| `/` | `page.tsx` | Overview: key numbers, network map, stock watchlist, health, crisis events |
| `/decisions` | `decisions/page.tsx` | Recommended shipments with reasons, alternatives, risk before → after, Approve/Reject, "Explain with AI", autopilot mode switch, decision history |
| `/stations` | `stations/page.tsx` | Every station: stock per fuel, usage per hour, hours left, demand chart |
| `/network` | `network/page.tsx` | Depots, dispatch capacity, next supply, routes table, supply schedule |
| `/shipments` | `shipments/page.tsx` | All shipments and their status (pending → in transit → arrived / failed / cancelled) |
| `/events` | `events/page.tsx` | Crisis events in plain words and the system activity feed |
| `/assistant` | `assistant/page.tsx` | AI situation report and question box |
| `/system` | `system/page.tsx` | System health: components, latency, error rates, resources, data freshness |
| `/scenario` | `scenario/page.tsx` | Test controls: run/pause/step/reset, inject crises and faults, break the planner |
| `/experiments` | `experiments/page.tsx` | Strategy comparison charts and results table |

Shared page files: `layout.tsx` (wraps every page with the sidebar and live data),
`globals.css` (colors, font, theme), `favicon.ico` (browser tab icon).

### API routes (`src/app/api/…/route.ts`)

| Route | Purpose |
|---|---|
| `GET /api/state` | Current world snapshot plus data freshness |
| `GET /api/health` | Health report for the System Health page and Docker health check |
| `GET /api/metrics` | Prometheus metrics |
| `GET /api/activity` | Recent notable log events |
| `GET /api/recommendations` | Current plan, autopilot mode, decision history |
| `POST /api/decisions` | Approve or reject a recommendation |
| `GET/PUT /api/autopilot` | Read or change MANUAL / ASSISTED / AUTO |
| `POST /api/assistant` | AI summary, explanation or question |
| `POST /api/scenario` | Scenario controls (only when `ENABLE_SCENARIO_CONTROLS=true`) |
| `GET/POST /api/experiments` | Read results or start a strategy comparison |

Every API input is validated with Zod, and errors come back as
`{ "error": { "code", "message" } }`.

---

## `src/components/` — reusable UI pieces

| File | What it does |
|---|---|
| `layout/AppShell.tsx` | Sidebar navigation, top status bar (sim time, tick, live/stale, health) and the yellow/red warning banners |
| `providers/LiveDataProvider.tsx` | Fetches `/api/state` and `/api/health` every 2 s and shares them with all pages |
| `providers/usePolling.ts` | Small hook to refresh any API on a timer |
| `ui/primitives.tsx` | Basic building blocks: Card, status Pill, StatTile, ProgressBar, PageHeader, EmptyState |
| `overview/NetworkMap.tsx` | The depot → station network drawing with fill bars and route status |
| `stations/StationCard.tsx` | One station's card on the Stations page |
| `stations/DemandChart.tsx` | Demand line chart per fuel |
| `ai/AiAnswerBox.tsx` | Shows an AI answer and whether it came from OpenAI or the built-in fallback |

---

## Database — `prisma/` and `prisma.config.ts`

| File | What it does |
|---|---|
| `prisma/schema.prisma` | Tables for **our** evidence only: Recommendation, Decision, AllocationExecution, Incident, MetricSnapshot, Experiment. The simulator stays the source of truth for stock and routes. |
| `prisma/migrations/…/migration.sql` | SQL that creates those tables; applied by the `migrate` Docker service |
| `prisma.config.ts` | Prisma 7 settings: where the schema and migrations are, which database URL to use |
| `src/generated/prisma/` | Generated by `prisma generate` (runs automatically on `npm install`). Never edit. |

---

## Tests, load test, docs

| Path | What it does |
|---|---|
| `tests/fixtures/world.ts` | A fake but realistic world used by tests |
| `tests/unit/simulator-client.test.ts` | Retries, no retry on 409, same idempotency key on retry, stale header, circuit breaker, 4-request limit |
| `tests/unit/simulator-errors.test.ts` | Parsing of the simulator's error formats |
| `tests/unit/forecast.test.ts` | Forecast follows hour factors and spikes |
| `tests/unit/planner.test.ts` | Planner ships before shortages and respects every limit |
| `tests/unit/baseline.test.ts` | Fallback planner refills and avoids disrupted routes |
| `load/dashboard.js` | k6 load test: 100 users on the dashboard path + 20 requests/s on the decision API |
| `docs/architecture.pdf` / `.png` / `.html` | Architecture and workflow diagrams for judges |
| `docs/PROJECT_GUIDE.md` | This file |

---

## Root configuration files

| File | What it does |
|---|---|
| `docker-compose.yml` | Starts 4 services: `simulator-api` (organizer image), `postgres`, `migrate` (one-time DB setup), `app` (our Next.js app) |
| `Dockerfile` | Builds our app image in stages; runs as a non-root user with a health check |
| `.dockerignore` | Keeps `node_modules`, `.env`, `context/` etc. out of the image |
| `.github/workflows/ci.yml` | CI: lint → typecheck → tests → build → start the stack → health and API smoke test |
| `package.json` / `package-lock.json` | Dependencies and scripts (`dev`, `build`, `test`, `lint`, `typecheck`, `db:migrate`) |
| `next.config.ts` | Next.js settings (standalone output for Docker) |
| `tsconfig.json` | TypeScript settings; `@/` means `src/` |
| `vitest.config.ts` | Test runner settings |
| `eslint.config.mjs` | Lint rules |
| `.prettierrc` / `.prettierignore` | Code formatting rules |
| `postcss.config.mjs` | Tailwind CSS setup |
| `.env.example` | Template of all environment variables (copy to `.env`) |
| `.env` | Your real settings and secrets (OpenAI key). **Never committed.** |
| `.gitignore` / `.gitattributes` | What git ignores; forces LF line endings |
| `README.md` | How to run the project |

---

## Follow a request end to end

### 1. A tick happens and a shipment is sent automatically

1. The simulator finishes a tick and sends a `simulation.tick` event → `engine/stream.ts`.
2. `engine/loop.ts` starts a cycle.
3. `world/snapshot.ts` reads all resources through `simulator/client.ts`.
4. `engine/engine.ts` asks `intelligence/planner.ts` for a plan (which uses `forecast.ts`
   and `demand-model.ts`).
5. The engine marks which shipments need review. In ASSISTED mode it sends the routine
   ones with `POST /v1/allocations` and saves the decision to the database.
6. The next cycle sees the new shipment as "in transit", so it is never sent twice.

### 2. The operator approves a shipment

1. Decisions page → **Approve** → `POST /api/decisions`.
2. `engine.ts` re-reads the latest world, refuses if data is stale, re-checks the
   recommendation, then sends it to the simulator with the same idempotency key on retry.

### 3. The simulator API fails

1. `client.ts` retries, then opens the circuit breaker.
2. `snapshot.ts` keeps serving the last-known-good world with its age.
3. The UI shows the yellow banner; autopilot pauses; `health.ts` marks the data API
   DEGRADED. When the simulator recovers, everything returns to LIVE automatically.

---

## Where do I change…?

| I want to… | Edit |
|---|---|
| Change how risky a station must be before shipping | `src/lib/intelligence/planner.ts` (`LOW_FILL`, `REVIEW_TICKS`, `TARGET_FILL`) |
| Change when a shipment needs operator review | `reviewReason` in `src/lib/engine/engine.ts` |
| Change the fallback rule | `src/lib/intelligence/baseline.ts` |
| Change the AI prompts | `src/lib/ai/assistant.ts` |
| Add a crisis scenario to the comparison | `src/lib/experiments/runner.ts` |
| Change colors or fonts | `src/app/globals.css` |
| Add a page to the sidebar | `NAV` list in `src/components/layout/AppShell.tsx` |
| Add a scenario button | `src/app/scenario/page.tsx` |
| Change timeouts, retries, autopilot default | `.env` (validated in `src/lib/config.ts`) |
| Add a database table | `prisma/schema.prisma`, then `npm run db:migrate` |

## Common commands

```bash
docker compose up -d --build     start everything (official way)
npm run dev                      local development (stop the Docker app first)
npm test                         unit tests
npm run lint && npm run typecheck
```
