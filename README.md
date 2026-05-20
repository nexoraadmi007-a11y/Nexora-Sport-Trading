# NEXORA Elite Signals

Production-grade Telegram sports intelligence infrastructure for disciplined singles signals.

This phase is Telegram signal delivery infrastructure only. It intentionally does not include subscriptions, payments, dashboards, or user portals.

## Phase 1 Foundation

- Monorepo structure
- NestJS API scaffold
- Worker scaffold with cron and queue boundaries
- Prisma/PostgreSQL schema
- Telegram delivery service
- Data, signal, market, risk, CLV, analytics service boundaries
- Specialized engine package boundaries
- Python analytics health check scaffold

## Required Before Production Startup

Copy `.env.example` into `.env` and provide every required credential. Production startup must fail if required API, Supabase, Redis, Telegram, or deployment values are missing.

Current preserved `.env` already contains Telegram, The Odds API, and linked Supabase values. Redis, database URL, GitHub, and Railway/Render credentials are still required. SportMonks, API-Football, and NBA-specific providers are optional fallback/enrichment sources for later phases.

## Commands

```bash
npm install
npm run build
npm run api:dev
npm run worker:dev
npm run analytics:check
```
