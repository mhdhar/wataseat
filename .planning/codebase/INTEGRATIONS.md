# External Integrations

**Analysis Date:** 2026-03-29

## APIs & External Services

**Meta WhatsApp Cloud API:**
- Sending messages (text, interactive, templates) — `src/services/whatsapp.ts`
- Receiving webhooks with signature verification — `src/routes/whatsapp.ts`
  - SDK/Client: `axios` 1.13.6 + raw HTTP
  - Auth: `WHATSAPP_ACCESS_TOKEN` (Bearer token)
  - Verification: `X-Hub-Signature-256` header with `META_APP_SECRET`
  - Verification function: `verifyMetaSignature()` in `src/utils/crypto.ts`
  - Webhook verify token: `WHATSAPP_WEBHOOK_VERIFY_TOKEN` for initial subscription challenge
  - Endpoints:
    - `GET /webhooks/whatsapp` — Meta verification challenge
    - `POST /webhooks/whatsapp` — Incoming messages, button taps, events
  - Graph API URL: `https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages`

**Stripe Payment Processing:**
- Payment intents with manual capture — `src/services/stripe.ts`
- Stripe Connect onboarding for captains — `src/services/stripeConnect.ts`
- Payment webhooks with signature verification — `src/routes/stripe.ts`
  - SDK/Client: `stripe` 21.0.1 (official Node.js SDK)
  - Auth: `STRIPE_SECRET_KEY` (sk_test_ or sk_live_)
  - Webhook verification: `Stripe-Signature` header with `STRIPE_WEBHOOK_SECRET`
  - Verification method: `stripe.webhooks.constructEvent()`
  - Key operations:
    - `stripe.paymentIntents.create()` — Create authorization hold with `capture_method: 'manual'`
    - `stripe.paymentIntents.capture()` — Charge customer when threshold met
    - `stripe.paymentIntents.cancel()` — Release hold if threshold not met
    - `stripe.checkout.sessions.create()` — Checkout link for guests
    - `stripe.accountLinks.create()` — Onboarding link for captain Connect accounts
    - `stripe.accounts.create()` — Express account for captain (type: 'express', country: 'AE')
    - `stripe.accounts.retrieve()` — Check account status (charges_enabled, payouts_enabled)
  - Platform account ID: `STRIPE_PLATFORM_ACCOUNT_ID`
  - Flow: All payments use `application_fee_amount` (10% platform commission) and `transfer_data.destination` (captain account)
  - Re-authorization: Automatic daily job at 2am UTC via `src/jobs/reauthorize.ts`

## Data Storage

**Databases:**
- Supabase PostgreSQL (managed)
  - Connection: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  - Client: `@supabase/supabase-js` 2.100.1
  - Singleton instance: `src/db/supabase.ts`
  - Auth level: Service role (bypasses Row-Level Security)
  - Tables: `captains`, `whatsapp_groups`, `trips`, `bookings`, `stripe_intents`, `reauth_jobs`, `notification_log`
  - All tables have RLS enabled
  - Migrations: `supabase/migrations/run_migrations.ts` (run with `npx tsx supabase/migrations/run_migrations.ts`)

**Cache:**
- Upstash Redis (REST API, managed)
  - Connection: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
  - Client: `@upstash/redis` 1.37.0
  - Usage: State machines with TTLs
    - Captain onboarding state: 10min TTL
    - Trip wizard state: 10min TTL
    - Cancel confirmation state: 5min TTL
  - Health check: `redis.ping()` in `src/server.ts` /health endpoint

**File Storage:**
- Not detected (no file uploads in current implementation)

## Authentication & Identity

**Auth Provider:**
- Custom per-service integration (no unified auth platform)

**WhatsApp Authentication:**
- Phone number IDs and WAIDs (WhatsApp IDs) from Meta
- Webhook signature verification with HMAC-SHA256

**Stripe Authentication:**
- API keys: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`
- Webhook signature verification with HMAC-SHA256

**Supabase Authentication:**
- Service role key for backend operations (no client-side auth)
- RLS policies on database tables (not enforced in backend — service role bypasses)

## Monitoring & Observability

**Error Tracking:**
- Not detected (no Sentry, Rollbar, etc.)

**Logs:**
- Pino JSON structured logging — `src/utils/logger.ts`
- Output: Pretty-printed in development, raw JSON in production
- Log levels: DEBUG in development, INFO in production
- Critical errors: Bot sends DM to TEST_WHATSAPP_NUMBER via `sendTextMessage()` in `src/server.ts` error handler

**Health Monitoring:**
- `GET /health` endpoint at `src/server.ts` returns:
  - Database connectivity check (Supabase query)
  - Redis connectivity check (ping)
  - Uptime and version metadata

## CI/CD & Deployment

**Hosting:**
- Self-managed or Railway (referenced in `.env.example` as `RAILWAY_TOKEN`)
- Entry point: `dist/server.js` via `npm start`

**CI Pipeline:**
- Not detected (no GitHub Actions, CircleCI, etc. config in codebase)

**Build:**
```bash
npm run build        # TypeScript compilation to dist/
npm start            # Production: node dist/server.js
npm run dev          # Development: tsx watch src/server.ts
```

## Environment Configuration

**Required env vars:**
- `WHATSAPP_PHONE_NUMBER_ID` — Meta phone number ID for API calls
- `WHATSAPP_BUSINESS_ACCOUNT_ID` — Meta business account ID
- `WHATSAPP_ACCESS_TOKEN` — Meta Graph API bearer token
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — Custom token for webhook subscription challenge
- `META_APP_SECRET` — App secret for webhook signature verification
- `STRIPE_SECRET_KEY` — Stripe secret API key (sk_test_ or sk_live_)
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook endpoint secret (whsec_)
- `STRIPE_PLATFORM_ACCOUNT_ID` — Platform's Stripe account ID (acct_)
- `SUPABASE_URL` — Supabase project URL (https://YOUR_PROJECT_REF.supabase.co)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (unrestricted access)
- `UPSTASH_REDIS_REST_URL` — Upstash Redis REST endpoint
- `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis authentication token
- `PORT` — Server port (default 3000)
- `APP_URL` — Public URL for callbacks (e.g., https://wataseat.com)
- `NODE_ENV` — `development` or `production`
- `PLATFORM_COMMISSION_RATE` — Platform fee (default 0.10 for 10%)
- `THRESHOLD_CHECK_HOURS_BEFORE` — Hours before departure to check minimum threshold (default 12)
- `STRIPE_AUTH_REAUTH_DAYS` — Days between re-authorizations (default 6, Stripe holds last 7 days)

**Secrets location:**
- `.env` file (local development, never committed)
- Deployment platform environment variables (Railway, etc.)

## Webhooks & Callbacks

**Incoming Webhooks:**
- `POST /webhooks/whatsapp` — Meta WhatsApp Cloud API events
  - Messages: incoming text, buttons, reactions
  - Status updates: message delivery, read receipts
  - Signature verification: HMAC-SHA256 with `META_APP_SECRET`
  - Rate limit: 100 req/min per `express-rate-limit` config

- `POST /webhooks/stripe` — Stripe payment events
  - Signature verification: HMAC-SHA256 with `STRIPE_WEBHOOK_SECRET`
  - Handled events:
    - `account.updated` — Captain Stripe Connect status changes
    - `payment_intent.amount_capturable_updated` — Payment authorized
    - `payment_intent.canceled` — Payment hold cancelled
    - `charge.captured` — Payment charged successfully
  - Rate limit: 100 req/min per webhook limiter

**Outgoing Callbacks/Redirects:**
- Stripe redirect URLs (set in `src/services/stripe.ts`):
  - Success: `{APP_URL}/booking/success?booking_id={bookingId}`
  - Cancel: `{APP_URL}/booking/cancel?booking_id={bookingId}`
  - Connect completion: `{APP_URL}/connect/complete`
  - Connect refresh/expired: `{APP_URL}/connect/refresh`

**Outbound Messages:**
- WhatsApp text, interactive, and template messages sent via `src/services/whatsapp.ts`
- All outbound messages logged to `notification_log` table with status and metadata

---

*Integration audit: 2026-03-29*
