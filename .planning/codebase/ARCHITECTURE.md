# Architecture

**Analysis Date:** 2026-03-29

## Pattern Overview

**Overall:** Webhook-driven, layered event processing architecture with asynchronous job scheduling.

**Key Characteristics:**
- Event-driven: WhatsApp and Stripe webhooks trigger business logic
- Multi-layer separation: routes → handlers → services → database
- Immediate HTTP response, async processing for long-running operations
- State management via Redis for interactive wizards and confirmations
- Scheduled cron jobs for time-based operations (threshold checks, re-authorization, summaries)
- Stripe Connect integration for captain payouts with 10% platform commission

## Layers

**Routes Layer:**
- Purpose: HTTP endpoint handlers that verify webhook signatures and dispatch to business logic
- Location: `src/routes/`
- Contains: `whatsapp.ts`, `stripe.ts`
- Depends on: Handlers, utilities for signature verification
- Used by: Express.js server in `src/server.ts`
- Pattern: Routes immediately acknowledge webhooks to Meta/Stripe, then process async

**Handlers Layer:**
- Purpose: Business logic orchestration for interactive flows (commands, onboarding, trip creation, bookings, button taps)
- Location: `src/handlers/`
- Contains: `commandHandler.ts`, `onboardingHandler.ts`, `tripWizardHandler.ts`, `buttonHandler.ts`
- Depends on: Services (whatsapp, trips, bookings, stripe), database, Redis
- Used by: Routes layer
- Pattern: Stateful handlers manage multi-step conversational workflows; state persisted in Redis for wizards (10min TTL) and confirmations (5min TTL)

**Services Layer:**
- Purpose: API integration and database CRUD operations grouped by domain
- Location: `src/services/`
- Contains: `whatsapp.ts`, `trips.ts`, `bookings.ts`, `stripe.ts`, `stripeConnect.ts`, `notifications.ts`
- Depends on: Database client, external APIs (WhatsApp Cloud API, Stripe), logger
- Used by: Handlers, jobs, webhook processors
- Pattern: Pure functions that handle single responsibilities (e.g., `createPaymentIntent`, `sendTextMessage`, `getTripById`)

**Database Layer:**
- Purpose: Single Supabase client singleton with RLS enabled
- Location: `src/db/supabase.ts`
- Contains: Supabase client initialized with service role key (backend-only, bypasses RLS)
- Depends on: `@supabase/supabase-js` SDK
- Used by: All services and handlers

**Jobs Layer:**
- Purpose: Scheduled cron jobs for time-sensitive operations
- Location: `src/jobs/`
- Contains: `scheduler.ts`, `thresholdCheck.ts`, `reauthorize.ts`, `dailySummary.ts`
- Depends on: Database, services
- Used by: Server startup in `src/server.ts`
- Pattern: Cron schedule defined in `scheduler.ts`, individual jobs contain logic

**Utilities:**
- Purpose: Cross-cutting concerns and infrastructure
- Location: `src/utils/`
- Contains: `logger.ts` (Pino structured logging), `crypto.ts` (signature verification)
- Depends on: External libraries (pino)
- Used by: All layers

## Data Flow

**WhatsApp Inbound Message:**

1. `POST /webhooks/whatsapp` receives webhook
2. `src/routes/whatsapp.ts` verifies Meta signature (`X-Hub-Signature-256`)
3. Immediately returns `200 OK` to Meta (5-second response requirement)
4. Async processing: `processWebhook()` extracts message type (text vs interactive)
5. Routes to appropriate handler:
   - Text starting with `/` → `handleCommand()` in `src/handlers/commandHandler.ts`
   - Text without `/` → `handleOnboarding()` in `src/handlers/onboardingHandler.ts` (checks Redis for wizard/confirmation state first)
   - Interactive button tap → `handleButton()` in `src/handlers/buttonHandler.ts`
6. Handler orchestrates services: queries database, may call WhatsApp API, Stripe, update database
7. Database updated in Supabase via `src/db/supabase.ts`

**Trip Creation Flow:**

1. User types `/trip` → `handleCommand()` dispatches to `handleTripCommand()`
2. `handleTripWizardStart()` creates Redis state with TTL 600s (10min)
3. Sends first prompt ("What type of trip?")
4. User replies with text → `handleOnboarding()` detects Redis wizard state
5. `handleTripWizardStep()` processes input, advances state, persists to Redis
6. Repeats for each field: trip_type → date → time → duration → meeting_point → location_url → max_seats → threshold → price → confirm
7. On confirm, `createTrip()` inserts to database, Redis state cleared, notification sent

**Booking Flow:**

1. Guest taps "Book" interactive button in WhatsApp group
2. `POST /webhooks/whatsapp` receives button_reply event
3. Routes to `handleButton()` → `handleBookingIntent()`
4. Validates: trip open, seats available, guest not already booked
5. Creates booking record via `createBooking()`
6. Creates Stripe PaymentIntent via `createPaymentIntent()` (capture_method: manual, 10% fee, routed to captain's Stripe Connect account)
7. Records payment intent in `stripe_intents` table
8. Creates payment link via `createPaymentLink()`
9. Sends payment link to guest via private DM `sendTextMessage()`
10. Guest completes payment in Stripe Checkout
11. Stripe sends `payment_intent.amount_capturable_updated` webhook

**Payment Authorization Flow:**

1. `POST /webhooks/stripe` receives `payment_intent.amount_capturable_updated`
2. `src/routes/stripe.ts` verifies Stripe signature
3. Immediately returns `200 OK` to Stripe
4. Updates booking status to `authorized` in `stripe_intents` table
5. Sends confirmation notification to guest

**Threshold Check & Capture/Cancel Flow:**

1. Cron job runs hourly: `runThresholdCheck()` in `src/jobs/thresholdCheck.ts`
2. Queries trips with `status='open'` departing within threshold window (default 12 hours)
3. For each trip:
   - If `current_bookings >= threshold`: calls `captureAllForTrip()`
   - If `current_bookings < threshold`: calls `cancelAllForTrip()`
4. `captureAllForTrip()`:
   - Fetches all authorized bookings for trip
   - Calls `stripe.paymentIntents.capture()` for each (locks in funds, 90% transfers to captain, 10% stays on platform)
   - Updates booking status to `confirmed`
   - Sends trip confirmed notification
5. `cancelAllForTrip()`:
   - Fetches all authorized bookings for trip
   - Calls `stripe.paymentIntents.cancel()` for each (releases authorization hold)
   - Updates booking status to `cancelled`
   - Sends trip cancelled notification

**Re-authorization Flow:**

1. Cron job runs daily at 2am UTC: `runReauthorization()` in `src/jobs/reauthorize.ts`
2. Finds all authorized bookings with `reauth_count < 1` (first re-auth only after 6 days)
3. For each:
   - Gets current PaymentIntent from `stripe_intents`
   - Cancels it via `stripe.paymentIntents.cancel()`
   - Creates new PaymentIntent for same amount
   - Updates `stripe_intents` table: marks old as not current, inserts new with is_current=true
   - Increments `reauth_count` (prevents re-authorizing beyond Stripe's 7-day hold limit)

**State Management:**

- **Wizard state (Redis):** Captain creating trip stores progress in `trip_wizard:{waId}` with 600s TTL. Contains step, captain_id, group_id, and partially-filled trip details
- **Confirmation state (Redis):** Captain cancelling trip stores `cancel_confirm:{waId}` with 300s TTL. Contains trip_id, trip_title, booking_count. Awaits YES/NO reply
- **Persistent state (Supabase):** Captain onboarding step stored in `captains.onboarding_step` field; trip and booking statuses in respective tables

## Key Abstractions

**Captain Onboarding State Machine:**
- Purpose: Multi-step captain registration and Stripe Connect setup
- Examples: `src/handlers/onboardingHandler.ts`, captain onboarding wizard in `src/handlers/commandHandler.ts`
- Pattern: State persisted in `captains.onboarding_step` field. Steps: `start → name → boat_name → license → iban → complete`. Webhook signature verification ensures only authorized captains complete flow

**Trip Wizard State Machine:**
- Purpose: Multi-step trip creation from captain command
- Examples: `src/handlers/tripWizardHandler.ts`
- Pattern: State stored in Redis (`trip_wizard:{waId}`) with 10-minute TTL. Each step prompts user, validates input, advances state. On confirm, creates trip record and clears Redis

**Booking Lifecycle:**
- Purpose: Tracks guest booking from creation through payment, authorization, and final capture/cancellation
- Examples: `src/services/bookings.ts`, `src/handlers/buttonHandler.ts`, `src/routes/stripe.ts`
- Pattern: Status flow: `pending_payment → authorized → confirmed` (or `cancelled`). Payment intent lifecycle tracked in parallel in `stripe_intents` table

**Trip Lifecycle:**
- Purpose: Tracks trip from creation through threshold check to completion or cancellation
- Examples: `src/services/trips.ts`, `src/jobs/thresholdCheck.ts`
- Pattern: Status flow: `open → confirmed/cancelled → completed`. Threshold check job determines outcome based on current bookings vs threshold

**Stripe Connect Integration:**
- Purpose: Captain payment setup and payout routing
- Examples: `src/services/stripeConnect.ts`, `src/handlers/commandHandler.ts`
- Pattern: Captains create Express account via `/connect` command, complete KYC via Stripe-hosted onboarding, account_updated webhook advances onboarding step

## Entry Points

**Server Initialization:**
- Location: `src/server.ts`
- Triggers: `npm run dev` (development) or `npm start` (production)
- Responsibilities:
  - Initialize Express app with security middleware (helmet, CORS, rate limiting)
  - Mount webhook routes for WhatsApp and Stripe
  - Start cron job scheduler
  - Expose health check endpoint that tests database and Redis connectivity
  - Set up global error handler (sends critical errors to admin via WhatsApp, never exposes internals)

**WhatsApp Webhook Route:**
- Location: `src/routes/whatsapp.ts`
- Triggers: Webhook from Meta Cloud API whenever captain or guest sends message
- Responsibilities:
  - Verify Meta webhook signature
  - Acknowledge receipt immediately (200 OK)
  - Async parse message type and dispatch to appropriate handler
  - Log all inbound/outbound messages to `notification_log` table

**Stripe Webhook Route:**
- Location: `src/routes/stripe.ts`
- Triggers: Webhook from Stripe for payment, account, or payout events
- Responsibilities:
  - Verify Stripe webhook signature
  - Acknowledge receipt immediately (200 OK)
  - Async handle event type: `account.updated`, `payment_intent.amount_capturable_updated`, etc.
  - Update captain and booking records based on payment state

**Cron Job Scheduler:**
- Location: `src/jobs/scheduler.ts` (started in `src/server.ts`)
- Triggers: Clock-based schedule
- Responsibilities:
  - Hourly (0 * * * *): Threshold check (capture or cancel authorized bookings based on booking count vs threshold)
  - Daily 2am UTC (0 2 * * *): Re-authorization (recreate expired payment intents before 7-day Stripe hold expires)
  - Daily 4am UTC (0 4 * * *): Captain summary (send daily booking/revenue stats to captains)

## Error Handling

**Strategy:** Fail gracefully, log internally, never expose stack traces to users. Critical errors sent to admin via WhatsApp.

**Patterns:**

**Webhook Signature Verification Failure:**
- Meta/Stripe signature invalid → return 401 Unauthorized
- No attempt to process further
- Logged with warn level

**Missing Required Data:**
- Booking without captain Stripe account → send user-friendly error via WhatsApp, log with error level
- Trip not found → return error to user, log
- Database operation fails → catch error, log, send friendly message to user

**Business Logic Errors:**
- Threshold check job fails → logged, cron continues next cycle
- Re-authorization fails for one booking → logged with context, continues to next booking
- Payment capture fails → logged with payment intent ID, captain notified

**Database Errors:**
- Supabase query fails → caught, logged with error message, operation aborted with user notification
- Never expose `error.message` to WhatsApp users

**External API Failures:**
- Stripe API timeout/error → logged with error details, operation retried on next webhook/job cycle
- WhatsApp API send failure → logged, no retry built-in (relies on cron jobs or user re-triggering)

**Global Error Handler:**
- `src/server.ts` has middleware that catches unhandled errors
- Logs with full stack trace
- Sends message to admin test number if configured
- Returns 500 generic error to client

## Cross-Cutting Concerns

**Logging:**
- Framework: Pino structured logger (`src/utils/logger.ts`)
- Pattern: All significant operations logged with context (user IDs, amounts, payment intent IDs). Development uses pretty-print; production uses JSON. Log level controlled by `NODE_ENV`
- When to log: Webhook receipt, command execution, state transitions, external API calls, database operations, errors

**Validation:**
- No centralized validation framework; each handler validates input inline
- Trip wizard validates: date format (past/future), time format, numeric fields (seats, threshold, price)
- Onboarding validates: name length, boat name presence, license format (basic check)
- Stripe webhook validates signature before any processing

**Authentication:**
- Pattern: WhatsApp ID (`from` field in webhook) serves as user identity
- No session tokens; each webhook authenticated by Meta signature
- Supabase service role key used for all database access (backend-only, not exposed)
- Stripe webhooks authenticated by Stripe signature
- Webhook verify tokens used for Meta subscription confirmation

**Rate Limiting:**
- Applied globally to `/webhooks` endpoints: 100 requests/minute
- Prevents webhook replay attacks and DDoS
- Configured in `src/server.ts` middleware

**Message Logging:**
- All inbound/outbound WhatsApp messages logged to `notification_log` table
- Captures: direction (inbound/outbound), message type, template name (for templates), status, error messages
- Used for compliance, debugging, and analytics

---

*Architecture analysis: 2026-03-29*
