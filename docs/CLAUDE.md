# CLAUDE.md — WataSeat Project Instructions

> Claude Code reads this file at the start of every session. This is the persistent project context.

---

## What We're Building

**WataSeat** — a WhatsApp-native SaaS booking bot. Boat captains add it to their existing WhatsApp groups. Guests book seats, pay via Apple Pay (Stripe), and are only charged when a minimum passenger threshold is met. 10% platform commission captured automatically.

**Stack**: Node.js 20 + TypeScript, Express.js, Meta WhatsApp Cloud API, Stripe Connect, Supabase (PostgreSQL), Upstash Redis + QStash, Railway.

**Developer**: Mo (GitHub: `mhdhar`). Vibe coder — prefers guided terminal instructions over raw theory.

---

## Key Documents (Read Before Each Phase)

| Document | Read When |
|---|---|
| `REQUIREMENTS.md` | Phase 0 setup, whenever you need API key names |
| `ARCHITECTURE.md` | Any time you're building a new service or making structural decisions |
| `DATABASE_SCHEMA.md` | Any time you're writing SQL or touching Supabase |
| `WHATSAPP_SETUP.md` | Phase 1 and when working on message templates |
| `STRIPE_FLOW.md` | Phase 2, 4, 5, 6 — any Stripe-related work |
| `ROADMAP.md` | Start of each phase to get the phase prompt |

---

## Critical Rules For This Project

### 1. Never expose service role key
`SUPABASE_SERVICE_ROLE_KEY` is only used in the backend. Never reference it in any file that runs client-side. It bypasses RLS.

### 2. Always verify webhook signatures
- Meta webhook: verify `X-Hub-Signature-256` header using `META_APP_SECRET`
- Stripe webhook: use `stripe.webhooks.constructEvent()` with `STRIPE_WEBHOOK_SECRET`
Never skip signature verification even in development.

### 3. Stripe capture_method is always manual
PaymentIntents for guest bookings MUST use `capture_method: 'manual'`. This is the entire business model. If you create a PI without this flag, guests get charged immediately which breaks everything.

### 4. Use template messages for outbound-initiated WhatsApp messages
When the bot sends a message to a user who hasn't messaged in 24 hours (e.g. booking confirmations, cancellations), it MUST use a pre-approved template. Free-form text only works within 24h of the last guest message.

### 5. Short IDs for captain commands
Use the first 6 characters of the UUID for trip IDs in WhatsApp commands (e.g. `abc123` not the full UUID). Store a `short_id` field or derive it at query time. Captains can't type full UUIDs in WhatsApp.

### 6. Amount handling
All monetary amounts stored in Supabase as `NUMERIC(10,2)` in AED. When passing to Stripe, multiply by 100 and round: `Math.round(aed * 100)`. Never use floats for money.

### 7. Group messages vs DMs
- Trip announcements → group chat (everyone sees)
- Payment links → private DM to guest (never in group)
- Booking confirmations → private DM to guest
- Captain commands + responses → wherever captain typed the command (DM or group)
- Cancellations → group + individual DMs to each guest

---

## TypeScript Conventions

```typescript
// Always type Supabase responses
const { data, error } = await supabase.from('trips').select('*');
if (error) throw new Error(`Supabase error: ${error.message}`);

// Use Zod for all external input validation (WhatsApp messages, webhook payloads)
import { z } from 'zod';

// Logger usage (never use console.log in production code)
import { logger } from '../utils/logger';
logger.info({ tripId, guestWaId }, 'Booking created');
logger.error({ err, bookingId }, 'Failed to capture payment');
```

---

## Environment Variables Reference

All env vars are in `.env`. See `REQUIREMENTS.md` Section 1 for the full list. Key ones:

```
WHATSAPP_PHONE_NUMBER_ID    — used in every Meta API call
WHATSAPP_ACCESS_TOKEN       — bearer token for Meta API
META_APP_SECRET             — webhook signature verification
STRIPE_SECRET_KEY           — Stripe API calls
STRIPE_WEBHOOK_SECRET       — Stripe webhook verification
SUPABASE_URL                — Supabase project URL
SUPABASE_SERVICE_ROLE_KEY   — backend-only, bypasses RLS
UPSTASH_REDIS_REST_URL      — Redis cache + QStash queue
```

---

## File Structure Reference

```
src/
├── server.ts                 ← Express app + routes registration
├── routes/
│   ├── whatsapp.ts           ← POST /webhooks/whatsapp, GET /webhooks/whatsapp
│   └── stripe.ts             ← POST /webhooks/stripe
├── handlers/
│   ├── commandHandler.ts     ← Parse and route /commands
│   ├── buttonHandler.ts      ← Handle interactive button taps
│   └── onboardingHandler.ts  ← Captain onboarding state machine
├── services/
│   ├── whatsapp.ts           ← Meta API calls
│   ├── stripe.ts             ← PaymentIntent CRUD
│   ├── stripeConnect.ts      ← Connect account management
│   ├── trips.ts              ← Trip business logic
│   ├── bookings.ts           ← Booking business logic
│   └── notifications.ts      ← Message assembly + dispatch
├── jobs/
│   ├── thresholdCheck.ts     ← 12h threshold cron
│   └── reauthorize.ts        ← 6-day re-auth cron
├── db/
│   └── supabase.ts           ← Supabase client singleton
├── types/
│   └── index.ts              ← Shared types and enums
└── utils/
    ├── logger.ts             ← Pino logger
    └── crypto.ts             ← Signature verification utilities
```

---

## WhatsApp Bot Command Reference

| Command | Who | Where | What it does |
|---|---|---|---|
| `/help` | Anyone | Group or DM | Shows available commands |
| `/trip` | Captain | Group or DM | Starts trip creation wizard |
| `/trips` | Captain | Group or DM | Lists upcoming trips |
| `/status [id]` | Captain | Group or DM | Shows trip details + bookings |
| `/cancel [id]` | Captain | Group or DM | Cancels trip (with confirmation) |
| `/connect` | Captain | DM | Gets or re-sends Stripe onboarding link |

---

## Useful Meta API Endpoints

Base URL: `https://graph.facebook.com/v18.0/`

```
POST /{PHONE_NUMBER_ID}/messages     — Send any message type
GET  /{PHONE_NUMBER_ID}/messages     — Get message status
POST /{WABA_ID}/message_templates    — Submit template for approval
GET  /{WABA_ID}/message_templates    — List templates and their status
```

Authorization header: `Bearer ${WHATSAPP_ACCESS_TOKEN}`

---

## Common Gotchas

1. **WhatsApp group IDs** end in `@g.us` (groups) vs `@s.whatsapp.net` (individuals). Parse accordingly.
2. **Meta webhook** sends `entry[0].changes[0].value.messages` — always null-check, webhook fires for delivery receipts too (no `messages` field).
3. **Stripe Connect** requires captains to complete full KYC before `charges_enabled` is true. Don't let them post trips until this is done.
4. **AED in Stripe** — make sure currency is `'aed'` not `'usd'`. Stripe supports AED but it's not the default.
5. **QStash delays** — QStash jobs have eventual delivery, not real-time. The 12h threshold check cron runs every hour — a trip could be T-11:30h when checked. Factor in a buffer.
6. **Context window** — when session approaches 75% context usage, create a handoff summary and start a new session for the next phase.
