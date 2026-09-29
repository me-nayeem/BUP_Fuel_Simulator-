# Fuel Ops Command Center

Fuel Supply Intelligence & Resilience Platform for the **BUP CSE Fest 2026 Hackathon**. It
observes the organizer-provided BUP Fuel Supply Simulator, predicts station shortages,
recommends and executes constraint-valid fuel allocations, and stays usable when the
simulator or its own dependencies fail.

> All data comes from the simulated environment. No real fuel infrastructure is accessed.

## Quick start (judges)

Requirements: Docker with Compose v2.

```bash
cp .env.example .env        # optional — defaults work out of the box
docker compose up -d --build
```

| Service                 | URL                               |
| ----------------------- | --------------------------------- |
| Command center          | http://localhost:3000             |
| Health                  | http://localhost:3000/api/health  |
| Prometheus metrics      | http://localhost:3000/api/metrics |
| Simulator admin console | http://localhost:8000/admin       |

The stack: `simulator-api` (organizer image, unchanged) · `postgres` · `migrate` (one-shot
Prisma migrations) · `app` (Next.js UI + API + intelligence engine).

## Local development

```bash
npm install                  # also generates the Prisma client (postinstall)
docker compose up -d simulator-api postgres
npx prisma migrate deploy
npm run dev                  # http://localhost:3000
```

| Script                                | Purpose                                                       |
| ------------------------------------- | ------------------------------------------------------------- |
| `npm run dev`                         | Next.js dev server                                            |
| `npm run lint` / `typecheck` / `test` | quality gates (also run in CI)                                |
| `npm run build`                       | production build (standalone output)                          |
| `npm run db:migrate`                  | create/apply a migration after editing `prisma/schema.prisma` |
| `npm run format`                      | Prettier                                                      |

## Architecture

```
simulator-api ──REST/SSE──▶ SimulatorClient (timeout · retry · stale · circuit breaker)
                                  │
                                  ▼
                          WorldStore (parallel snapshot · last-known-good)
                                  │
                   intelligence (forecast → risk → planner → what-if)
                                  │
                   decisions (autopilot / operator approval) ──▶ POST /v1/allocations
                                  │
            Next.js API + dashboard · Postgres (decision evidence) · metrics · logs
```

| Path                     | Responsibility                                                                |
| ------------------------ | ----------------------------------------------------------------------------- |
| `src/lib/simulator/`     | typed, validated simulator client and error model                             |
| `src/lib/world/`         | normalised world snapshot with last-known-good fallback                       |
| `src/lib/observability/` | structured logs, metrics registry, health report                              |
| `src/lib/prisma.ts`      | Prisma 7 client (pg driver adapter); generated code in `src/generated/prisma` |
| `src/app/api/`           | `state`, `health`, `metrics` (more as the engine lands)                       |

## Resilience (implemented)

| Failure                                      | Behaviour                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Simulator `unavailable` / `error_rate` (503) | bounded retries with backoff; circuit breaker; last-known-good state served with its age |
| `stale_data` (`X-Simulator-Stale`)           | stale payload never overwrites good state; STALE banner                                  |
| `latency`                                    | 2.5 s timeout per call, retries, latency metrics                                         |
| Invalid simulator payload                    | Zod validation rejects it; last-known-good kept                                          |
| Postgres down                                | health shows Database DOWN; simulator operations continue                                |

## Configuration

See [.env.example](.env.example). Secrets are never committed; `.env` is git-ignored.
