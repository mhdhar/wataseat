# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**WataSeat** — WhatsApp-native SaaS booking bot for boat captains. Guests book seats via WhatsApp, pay via Apple Pay (Stripe authorization holds), and are only charged when a minimum passenger threshold is met. 10% platform commission captured automatically via Stripe Connect.

## Build & Dev Commands

```bash
npm run dev          # Start dev server (tsx watch src/server.ts)
npm run build        # TypeScript compilation
npm start            # Production (node dist/server.js)
npx tsc --noEmit     # Type check without emitting
```

## Deployment

**Production:** Vercel at `wataseat.com`
- Backend: Express app exported as Vercel serverless function (`api/index.ts`)
- Landing page: Static HTML (`public/index.html`) — bilingual EN/AR
- Admin dashboard: Next.js app in `admin/`
- Cron jobs: Vercel Cron hitting `/api/cron/threshold`, `/api/cron/reauth`, `/api/cron/summary`
- Config: `vercel.json` routes all traffic to the appropriate handler

**Local dev:** `npm run dev` starts Express on `PORT` from `.env`, use ngrok for webhook testing

## Architecture

Express.js backend receiving webhooks from Meta WhatsApp Cloud API and Stripe, backed by Supabase (PostgreSQL) and Upstash Redis.

**Request flow:**
- `POST /webhooks/whatsapp` — Meta signature verified, routes to command/button/onboarding handlers
- `POST /webhooks/stripe` — Stripe signature verified, handles payment lifecycle events
- `GET /health` — Service health check (database + Redis connectivity)

**Key directories:**
- `src/routes/` — Express route handlers (whatsapp.ts, stripe.ts)
- `src/handlers/` — Business logic for commands, button taps, onboarding wizard, trip wizard
- `src/services/` — External API integrations (WhatsApp, Stripe, Supabase CRUD)
- `src/jobs/` — Cron jobs: threshold check (hourly), re-authorization (daily 2am UTC), captain summary (daily 4am UTC)
- `src/db/supabase.ts` — Supabase client singleton (service_role key, bypasses RLS)
- `src/types/index.ts` — All TypeScript types, enums, and the WataSeatError class

**State machines:**
- Captain onboarding: `start → name → boat_name → license → stripe → complete` (persisted in `captains.onboarding_step`)
- Trip wizard: `trip_type → date → time → duration → emirate → meeting_point → location_url → max_seats → threshold → price → [vessel_image] → confirm` (stored in Redis with 10min TTL, vessel_image step conditional)
- Cancel confirmation: stored in Redis with 5min TTL

## Critical Rules

1. **`capture_method: 'manual'`** on every PaymentIntent — the entire business model depends on authorization holds, not immediate charges
2. **`SUPABASE_SERVICE_ROLE_KEY`** — backend only, never in client-side code, bypasses RLS
3. **Webhook signatures** — always verify Meta `X-Hub-Signature-256` and Stripe `Stripe-Signature` before processing
4. **Payment links → private DM only** — never post in group chat
5. **AED amounts** — store as `NUMERIC(10,2)` in Supabase, multiply by 100 for Stripe: `Math.round(aed * 100)`
6. **Short IDs** — first 6 characters of UUID for trip references in WhatsApp commands
7. **Pino logger** — no `console.log` in production code
8. **User-facing errors** — friendly text only, never expose stack traces or internal errors in WhatsApp messages

## Database

7 tables in Supabase PostgreSQL (all with RLS enabled):
`captains`, `whatsapp_groups`, `trips`, `bookings`, `stripe_intents`, `reauth_jobs`, `notification_log`

Migrations in `supabase/migrations/run_migrations.ts` — run with `npx tsx supabase/migrations/run_migrations.ts`

## Stripe Connect Flow

- Captains: Standard Connect accounts (own KYC via Stripe)
- Booking: `PaymentIntent` with `capture_method: 'manual'` + `application_fee_amount` (10%) + `transfer_data.destination` (captain account)
- Threshold met: `stripe.paymentIntents.capture()` — 10% stays on platform, 90% auto-routed to captain
- Threshold not met: `stripe.paymentIntents.cancel()` — hold released
- Re-authorization: cancel + recreate PI every 6 days (Stripe holds expire at 7 days)

## Environment Variables

All in `.env` — see `.env.example` for the full list. Key ones: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_URL`

## Documentation

Detailed specs in `docs/`: ARCHITECTURE.md, DATABASE_SCHEMA.md, STRIPE_FLOW.md, WHATSAPP_SETUP.md, API_SPEC.md, ROADMAP.md, GO_LIVE_CHECKLIST.md, MIGRATION_PLAN.md
