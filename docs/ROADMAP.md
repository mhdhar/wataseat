# ROADMAP.md — WataSeat

> Phase-by-phase build plan. Each phase is a Claude Code session. Start a new session for each phase and paste the CLAUDE.md context + the phase prompt.

---

## Timeline Overview

| Phase | What Gets Built | Duration |
|---|---|---|
| Phase 0 | Repo + env setup, MCP install, Supabase migrations | Day 1 (2–3 hrs) |
| Phase 1 | WhatsApp webhook + bot command foundation | Days 2–4 |
| Phase 2 | Captain onboarding + Stripe Connect | Days 5–7 |
| Phase 3 | Trip creation + group announcement | Days 8–10 |
| Phase 4 | Guest booking + Stripe auth hold | Days 11–14 |
| Phase 5 | Threshold logic + capture/cancel + payouts | Days 15–18 |
| Phase 6 | Notifications + re-authorization cron | Days 19–21 |
| Phase 7 | Captain commands (status, trips, cancel) | Days 22–24 |
| Phase 8 | Production hardening + Railway deploy | Days 25–28 |

**Total: 4 weeks to production-ready MVP**

---

## Phase 0 — Repository & Environment Setup

**Goal**: Clean project scaffold, all dependencies installed, database live, MCPs connected.

**Deliverables**:
- `wataseat` repo created on `mhdhar` GitHub
- Project structure per ARCHITECTURE.md `File Structure` section
- `.env` filled from REQUIREMENTS.md (all keys pasted)
- `package.json` with all dependencies from REQUIREMENTS.md Section 7
- `tsconfig.json` configured for Node 20
- All Supabase migrations run (DATABASE_SCHEMA.md migrations 001–007)
- All MCPs installed (REQUIREMENTS.md Section 4)
- Stripe Claude plugin installed
- `npm run dev` starts Express server on port 3000

**Claude Code session prompt**:
```
Read REQUIREMENTS.md, ARCHITECTURE.md, and DATABASE_SCHEMA.md in full.
Set up the WataSeat project from scratch:
1. Initialize Node.js TypeScript project with the file structure in ARCHITECTURE.md
2. Install all dependencies from REQUIREMENTS.md Section 7
3. Create .env.example from REQUIREMENTS.md Section 1
4. Set up Supabase client in src/db/supabase.ts
5. Run all 7 migrations from DATABASE_SCHEMA.md in order
6. Create basic Express server in src/server.ts with health check route GET /health
7. Set up pino logger in src/utils/logger.ts
Verify: npm run dev starts without errors, GET /health returns 200.
```

---

## Phase 1 — WhatsApp Webhook Foundation

**Goal**: Receive and verify WhatsApp messages. Parse commands. Send replies.

**Deliverables**:
- `POST /webhooks/whatsapp` endpoint with Meta signature verification
- `GET /webhooks/whatsapp` endpoint for Meta verification challenge
- Message type detection (text, interactive button, group join)
- Basic command parser that recognizes `/trip`, `/trips`, `/status`, `/cancel`, `/connect`, `/help`
- `src/services/whatsapp.ts` with functions: `sendTextMessage()`, `sendTemplateMessage()`, `sendInteractiveMessage()`
- `/help` command fully working (returns list of commands)
- ngrok tunnel documented and tested
- Webhook registered and verified in Meta Developer Console

**Claude Code session prompt**:
```
Read ARCHITECTURE.md (Key Design Decision 1 and 2), REQUIREMENTS.md, and WHATSAPP_SETUP.md.
Build the WhatsApp webhook layer:
1. POST /webhooks/whatsapp with X-Hub-Signature-256 verification using META_APP_SECRET
2. GET /webhooks/whatsapp for Meta hub.challenge verification
3. Message type router: detect text messages, interactive button replies, group join events
4. Command parser in src/handlers/commandHandler.ts — extract command and args from messages starting with /
5. WhatsApp service in src/services/whatsapp.ts — sendTextMessage, sendInteractiveMessage, sendTemplateMessage using Meta Cloud API
6. Implement /help command that replies with formatted command list
7. Log all incoming webhook payloads to notification_log table
Test: Send /help to bot number, verify response received.
```

---

## Phase 2 — Captain Onboarding + Stripe Connect

**Goal**: A new captain can onboard entirely through WhatsApp and connect their Stripe account.

**Deliverables**:
- `src/handlers/onboardingHandler.ts` — multi-step conversation flow
- Steps: greeting → name → boat name → license number → Stripe Connect link
- `src/services/stripeConnect.ts` — create Connect onboarding link, check account status
- Supabase: Captain record created at step 1, updated through each step
- Stripe webhook handler: listen for `account.updated` to set `stripe_charges_enabled`
- `/connect` command: re-send Stripe onboarding link for existing captains
- Onboarding state persisted in `captains.onboarding_step` — survives bot restarts

**Claude Code session prompt**:
```
Read ARCHITECTURE.md (Key Design Decisions 4 and 7), DATABASE_SCHEMA.md (captains table), and STRIPE_FLOW.md.
Build captain onboarding:
1. onboardingHandler.ts — state machine using captains.onboarding_step
   States: start → name → boat_name → license → stripe → complete
   Bot asks one question per message, waits for reply, advances state
2. stripeConnect.ts — createConnectAccount(), createOnboardingLink(), getAccountStatus()
   Use Stripe Connect Standard flow
3. Stripe webhook at POST /webhooks/stripe — handle account.updated event
   Update captains.stripe_charges_enabled and stripe_payouts_enabled
4. /connect command — check if captain exists, send onboarding link or re-send if incomplete
5. Guard: no captain can post a trip until onboarding_step = 'complete' AND stripe_charges_enabled = true
Test: Complete full onboarding flow for a test captain through WhatsApp.
```

---

## Phase 3 — Trip Creation + Group Announcement

**Goal**: Captain can create a trip via WhatsApp wizard. Bot posts trip card to group.

**Deliverables**:
- `/trip` command triggers a DM wizard with the captain
- Wizard collects: trip type, date/time, duration, meeting point, max seats, threshold, price/person
- Input validation with helpful error messages (e.g. threshold can't exceed max seats)
- `src/services/trips.ts` — createTrip(), getTripById(), getTripsByGroup()
- Trip card posted to group as WhatsApp interactive message with "Book Now" button
- Message ID saved to `trips.announcement_message_id`
- `/trips` command: list all upcoming open trips for captain's groups

**Claude Code session prompt**:
```
Read ARCHITECTURE.md (Data Flow section, step 1), DATABASE_SCHEMA.md (trips table), and API_SPEC.md.
Build trip creation:
1. /trip command handler — initiates DM wizard with captain
   Collect in sequence: trip_type, departure date (parse natural language dates), departure_time, duration_hours, meeting_point, max_seats, threshold, price_per_person_aed
   Validate each input before advancing (threshold <= max_seats, date must be future, price > 0)
2. trips.ts service — createTrip(), getTripsByCapture(), getOpenTrips()
3. After captain confirms all details, create Trip record (status: open)
4. Post trip announcement card to the WhatsApp group using sendInteractiveMessage()
   Card format: title, date, type, price, threshold progress ("Book by [date] — need 6 minimum")
   Include "Book Now" button with payload: booking_intent:{trip_id}
5. /trips command — list captain's upcoming trips with seat counts
Test: Create a trip end-to-end, verify card appears in test group.
```

---

## Phase 4 — Guest Booking + Stripe Authorization Hold

**Goal**: Guest taps "Book Now" and their card is authorized (held, not charged).

**Deliverables**:
- Button tap handler: detects `booking_intent:{trip_id}` payload
- Seat availability check before creating booking
- `src/services/stripe.ts` — createPaymentIntent (capture_method: manual), createPaymentLink
- Booking record created in `pending_payment` status
- Stripe Payment Link sent to guest via DM (private, not in group)
- Stripe webhook: `payment_intent.succeeded` (with capture_method: manual) → booking → `authorized`
- Group updated: "X/Y seats booked"
- Guest DM confirmation: "You're in! Seat secured. Trip confirms when X more join."

**Claude Code session prompt**:
```
Read ARCHITECTURE.md (Data Flow steps 2 and 3), DATABASE_SCHEMA.md (bookings + stripe_intents tables), and STRIPE_FLOW.md.
Build guest booking flow:
1. Button handler in buttonHandler.ts — detect booking_intent:{trip_id} from interactive message reply
   Check: trip is open, seats available, guest hasn't already booked this trip
   Create booking record (status: pending_payment)
2. stripe.ts service:
   createPaymentIntent(amount, currency, captureMethod: 'manual', captureAccountId, guestWaId)
   createStripePaymentLink(paymentIntentId, bookingId) — returns URL
3. Send payment link to guest via private DM (not in group)
4. Stripe webhook handler at POST /webhooks/stripe:
   Handle payment_intent.amount_capturable_updated (this fires when manual-capture PI is authorized)
   Update booking status to 'authorized'
   Update stripe_intents table
   Update trip.current_bookings += 1
   Send group status update: "X/Y seats booked"
   Send guest DM confirmation
5. Create reauth_job record scheduled 6 days from now
Test: Guest taps Book Now → receives DM link → completes Apple Pay → booking shows as authorized.
```

---

## Phase 5 — Threshold Logic + Capture + Payouts

**Goal**: Automatic trip confirmation when threshold is met. Automatic cancellation if not met by 12h mark.

**Deliverables**:
- `src/jobs/thresholdCheck.ts` — QStash cron job, runs every hour
- On threshold met: capture all authorized PaymentIntents, distribute payouts
- On threshold not met at T-12h: cancel all PaymentIntents, cancel trip
- `src/services/stripe.ts` additions: capturePaymentIntent(), cancelPaymentIntent()
- Platform fee deducted automatically via `application_fee_amount` on Stripe capture
- 90% automatically transferred to captain's Connect account
- All bookings updated to `confirmed` or `cancelled`
- QStash job registration documented

**Claude Code session prompt**:
```
Read ARCHITECTURE.md (Key Design Decisions 3, 4, 5), DATABASE_SCHEMA.md (all tables), and STRIPE_FLOW.md.
Build threshold logic:
1. thresholdCheck.ts job:
   Query: trips WHERE status='open' AND departure_at <= now() + 12 hours AND current_bookings < threshold
   For each: cancel all authorized PaymentIntents → update bookings to cancelled → update trip to cancelled
   Send cancellation notifications (Phase 6 handles the messages — create stubs here)
2. Real-time threshold check: after each new booking authorization, check if current_bookings >= threshold
   If yes: immediately trigger capture flow (don't wait for cron)
3. captureAllForTrip(tripId):
   Get all authorized bookings with stripe_intents
   For each: stripe.paymentIntents.capture(pi_id, { application_fee_amount: fee_in_cents })
   The transfer_data.destination was set when PI was created (captain's Connect account)
   Update booking to confirmed, set confirmed_at
   Update trip to confirmed
4. cancelAllForTrip(tripId, reason):
   For each authorized booking: stripe.paymentIntents.cancel(pi_id)
   Update bookings to cancelled
   Update trip to cancelled
5. Register thresholdCheck job with QStash to run every hour
Test: Create trip with threshold=2, have 2 guests book → both cards captured automatically.
Test: Create trip with threshold=3, have 1 guest book → 12h before departure → booking released.
```

---

## Phase 6 — Notifications + Re-authorization Cron

**Goal**: All WhatsApp notifications wired up. 6-day re-auth job working.

**Deliverables**:
- `src/services/notifications.ts` — all message templates assembled and sent
- Full notification matrix implemented (see WHATSAPP_SETUP.md templates section)
- `src/jobs/reauthorize.ts` — QStash job, runs daily, re-auths 6-day-old holds
- Re-auth flow: cancel old PI → create new PI → send new payment link to guest DM
- All notification_log entries created for audit trail
- Template messages approved in Meta console (or test templates for dev)

**Claude Code session prompt**:
```
Read WHATSAPP_SETUP.md (templates section) and DATABASE_SCHEMA.md (notification_log).
Build all notifications:
1. notifications.ts service with functions for every event:
   notifyTripPosted(trip, group) — group message with trip card
   notifyPaymentLinkSent(booking, link) — DM to guest
   notifyBookingConfirmed(booking, trip) — DM to guest after authorization
   notifyThresholdReached(trip, bookings) — group + DM to each guest
   notifyTripCancelled(trip, bookings) — group + DM to each guest
   notifyCaptainSummary(captain, upcomingTrips) — DM to captain
   notifyReauthRequired(booking, newLink) — DM to guest
2. Wire all stubs from Phase 5 to real notifications
3. reauthorize.ts job:
   Query: reauth_jobs WHERE scheduled_for <= now() AND is_complete = false
   For each: cancel old PI, create new PI, send new link to guest, update reauth_jobs
   Register with QStash to run daily at 6am UAE time (UTC+4 = 2am UTC)
4. Log all outbound messages to notification_log
Test: Full booking flow end-to-end — verify guest receives DM at each step.
```

---

## Phase 7 — Captain Management Commands

**Goal**: Captains can manage all trips and see booking details via WhatsApp commands.

**Deliverables**:
- `/trips` — formatted list of upcoming trips with fill rate
- `/status [trip_id]` — detailed view: date, type, seats booked vs threshold, list of guests (first name only)
- `/cancel [trip_id]` — cancel trip with confirmation step ("Reply YES to confirm")
- Short trip IDs (first 6 chars of UUID) for easy WhatsApp typing
- Captain receives daily summary at 8am UAE time (QStash scheduled)

**Claude Code session prompt**:
```
Read ARCHITECTURE.md (Key Design Decision 6 — WhatsApp Commands table).
Build captain management commands:
1. /trips command:
   List captain's trips for next 30 days
   Format: "🚢 [Trip ID] Fishing - Fri 28 Mar - 3/6 booked (need 3 more)"
   Use short IDs (first 6 chars of UUID)
2. /status [short_id] command:
   Full trip details + list of booked guests (first name only, privacy)
   Show threshold progress bar: "████░░ 4/6 seats filled"
   Show time until 12h deadline
3. /cancel [short_id] command:
   Send confirmation request: "Reply YES to cancel [trip name]. All guests will be notified and no one will be charged."
   On YES reply: trigger cancelAllForTrip() from Phase 5
4. Captain daily summary (QStash at 4am UTC = 8am UAE):
   DM captain with upcoming trips and their fill rates
   Flag any trips within 24h that haven't hit threshold yet
Test: Full captain command flow.
```

---

## Phase 8 — Production Hardening + Railway Deploy

**Goal**: Live, stable, monitored production deployment on Railway.

**Deliverables**:
- Railway project created, environment variables set from `.env`
- GitHub Actions CI: TypeScript compile check + basic test suite on push
- Production Meta webhook registered pointing to Railway URL
- Production Stripe webhook registered pointing to Railway URL
- Stripe test mode → live mode keys swapped (requires Stripe review for Connect)
- Rate limiting on webhook endpoints (prevent bot abuse)
- Error handling: all uncaught errors logged, critical ones DM the admin WhatsApp number
- README.md with operational runbook

**Claude Code session prompt**:
```
Read ARCHITECTURE.md (Security Considerations) and REQUIREMENTS.md.
Production hardening:
1. Add rate limiting middleware (express-rate-limit): 100 req/min on /webhooks/* endpoints
2. Add input sanitization on all WhatsApp message text inputs (prevent injection)
3. Global error handler in Express that catches unhandled errors and sends DM to ADMIN_WA_ID
4. Health check endpoint GET /health returns: { status, uptime, db: 'connected', queue: 'connected' }
5. Set up Railway project: connect GitHub repo, set all env vars from .env, enable auto-deploy on main branch
6. Update webhook URLs in Meta Developer Console and Stripe Dashboard to Railway URL
7. Create GitHub Actions workflow: .github/workflows/ci.yml that runs tsc --noEmit on push
8. Write README.md with: what this is, how to run locally, how to add the bot to a WhatsApp group, how to deploy
9. PM2 process file (optional): ecosystem.config.js for process restart on crash
Verify: Hit /health on Railway URL, send /help to bot, verify full booking flow in production.
```

---

## Post-MVP Backlog (Phase 9+)

These are deferred until after the MVP is validated with real captains:

- Web dashboard for captains (Next.js, optional alternative to WhatsApp commands)
- Captain analytics: revenue charts, popular trip types, repeat guest rate
- Guest profiles (opt-in, for repeat bookers)
- Waitlist: auto-invite next guest when a booking is cancelled
- Group discovery: allow guests to find and join captain groups
- Multi-language support (Arabic)
- SaaS billing: AED 99/month subscription tier with unlimited trips
- White-label API for SeaSeatShare integration
- iOS/Android PWA wrapper
