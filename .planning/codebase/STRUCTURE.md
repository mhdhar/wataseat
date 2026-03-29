# Codebase Structure

**Analysis Date:** 2026-03-29

## Directory Layout

```
/Users/mohamadharastani/Documents/Workspace/Claude/Whatsapp App/
├── src/                          # Application source code (TypeScript)
│   ├── server.ts                 # Express app initialization, middleware, routes mounting
│   ├── db/                       # Database layer
│   │   └── supabase.ts           # Supabase client singleton
│   ├── routes/                   # HTTP webhook handlers
│   │   ├── whatsapp.ts           # WhatsApp Cloud API webhook receiver
│   │   └── stripe.ts             # Stripe webhook receiver
│   ├── handlers/                 # Business logic for interactive flows
│   │   ├── commandHandler.ts     # /help, /trip, /trips, /status, /cancel, /connect commands
│   │   ├── onboardingHandler.ts  # Captain onboarding flow (name, boat, license, IBAN)
│   │   ├── tripWizardHandler.ts  # Multi-step trip creation wizard
│   │   └── buttonHandler.ts      # Interactive button tap handler (booking intent)
│   ├── services/                 # Domain-specific API integrations and CRUD
│   │   ├── whatsapp.ts           # WhatsApp Cloud API client (send text, interactive, templates)
│   │   ├── stripe.ts             # Stripe PaymentIntent creation and capture/cancel
│   │   ├── stripeConnect.ts      # Stripe Connect account and onboarding link creation
│   │   ├── trips.ts              # Trip CRUD operations (create, get, update booking count)
│   │   ├── bookings.ts           # Booking CRUD operations (create, fetch, update status)
│   │   └── notifications.ts      # Notification sending for template-based messages
│   ├── jobs/                     # Scheduled cron tasks
│   │   ├── scheduler.ts          # Cron schedule definitions (hourly, daily tasks)
│   │   ├── thresholdCheck.ts     # Hourly: check trip thresholds, capture/cancel payments
│   │   ├── reauthorize.ts        # Daily 2am UTC: re-create expired payment intents
│   │   └── dailySummary.ts       # Daily 4am UTC: send captain revenue summaries
│   ├── types/                    # TypeScript types and enums
│   │   └── index.ts              # All interfaces (Captain, Trip, Booking, etc.), WataSeatError class
│   ├── utils/                    # Cross-cutting utilities
│   │   ├── logger.ts             # Pino structured logger
│   │   └── crypto.ts             # HMAC signature verification (Meta, Stripe)
│   └── handlers/                 # (see above)
├── supabase/                     # Database migrations
│   └── migrations/
│       └── run_migrations.ts     # Migration runner (creates/updates all tables)
├── docs/                         # External documentation
│   ├── ARCHITECTURE.md           # System architecture details
│   ├── DATABASE_SCHEMA.md        # Table definitions and relationships
│   ├── STRIPE_FLOW.md            # Payment and Connect flow documentation
│   ├── WHATSAPP_SETUP.md         # Meta Cloud API setup guide
│   ├── API_SPEC.md               # API endpoint specifications
│   └── ROADMAP.md                # Feature roadmap
├── .planning/                    # GSD planning documents (auto-generated)
│   └── codebase/                 # Architecture and structure analysis
├── .github/                      # GitHub workflows
│   └── workflows/                # CI/CD pipeline configurations
├── tsconfig.json                 # TypeScript compiler configuration
├── package.json                  # npm dependencies and scripts
├── CLAUDE.md                     # Project guidelines for Claude (this file provides guidelines)
└── .env.example                  # Environment variable template (secrets excluded from repo)
```

## Directory Purposes

**`src/`:**
- Purpose: All application TypeScript source code
- Contains: Routes, handlers, services, jobs, types, utilities, database client
- Key files: `server.ts` (entry point), `types/index.ts` (centralized types)

**`src/db/`:**
- Purpose: Database client initialization and configuration
- Contains: Supabase client singleton with service role key
- Key files: `supabase.ts` (imported by all services)
- Notes: Service role key used backend-only; bypasses RLS for administrative operations

**`src/routes/`:**
- Purpose: HTTP webhook endpoint handlers that verify signatures and dispatch to handlers
- Contains: Express route handlers for WhatsApp and Stripe webhooks
- Key files: `whatsapp.ts` (message routing), `stripe.ts` (payment/account event handling)
- Pattern: Verify signature → respond immediately (200 OK) → process async

**`src/handlers/`:**
- Purpose: Orchestrate business logic for interactive multi-step workflows
- Contains: Command execution, onboarding state machine, trip wizard, button tap handling
- Key files:
  - `commandHandler.ts`: Route `/help`, `/trip`, `/trips`, `/status`, `/cancel`, `/connect` commands
  - `onboardingHandler.ts`: Manage captain registration (name → boat → license → IBAN)
  - `tripWizardHandler.ts`: Multi-step trip creation (10 fields, Redis state)
  - `buttonHandler.ts`: Handle guest booking button taps, create payment intents
- Pattern: Stateful orchestration; use Redis for ephemeral state (wizards, confirmations)

**`src/services/`:**
- Purpose: External API integrations and database CRUD operations grouped by domain
- Contains: WhatsApp API client, Stripe API client, database queries
- Key files:
  - `whatsapp.ts`: `sendTextMessage()`, `sendInteractiveMessage()`, `sendTemplateMessage()`
  - `stripe.ts`: `createPaymentIntent()`, `capturePaymentIntent()`, `cancelPaymentIntent()`
  - `stripeConnect.ts`: `createConnectAccount()`, `createOnboardingLink()`, `getAccountStatus()`
  - `trips.ts`: `createTrip()`, `getTripById()`, `getTripsByGroupId()`, `updateTripBookingCount()`
  - `bookings.ts`: `createBooking()`, `getBookingsByTrip()`, `updateBookingStatus()`, `hasGuestBooked()`
  - `notifications.ts`: `notifyPaymentLinkSent()`, `notifyBookingAuthorized()`, `notifyThresholdReached()`, `notifyTripCancelled()`
- Pattern: Pure functions; single responsibility per function

**`src/jobs/`:**
- Purpose: Background cron jobs for time-sensitive operations
- Contains: Job scheduling and individual job implementations
- Key files:
  - `scheduler.ts`: Define cron schedules (hourly, daily at specific UTC times)
  - `thresholdCheck.ts`: Hourly job that captures or cancels authorized bookings
  - `reauthorize.ts`: Daily 2am UTC job that recreates payment intents before 7-day hold expires
  - `dailySummary.ts`: Daily 4am UTC job that sends captain revenue summaries
- Pattern: Jobs called from scheduler; each handles its own error catching and logging

**`src/types/`:**
- Purpose: Centralized TypeScript interfaces, enums, and custom error class
- Contains: All database row types (Captain, Trip, Booking, etc.), input types, state types, WataSeatError
- Key files: `index.ts` (all types in one file for easy import)
- Pattern: Types grouped logically (database types, input types, state types)

**`src/utils/`:**
- Purpose: Cross-cutting utilities for logging and security
- Contains: Logger instance, signature verification functions
- Key files:
  - `logger.ts`: Pino logger singleton with environment-aware output
  - `crypto.ts`: HMAC-SHA256 verification for Meta and Stripe webhooks
- Pattern: Singletons; imported by handlers, services, routes

**`supabase/migrations/`:**
- Purpose: Database schema definitions and migrations
- Contains: Migration runner and SQL initialization logic
- Key files: `run_migrations.ts` (creates/updates all 7 tables: captains, whatsapp_groups, trips, bookings, stripe_intents, reauth_jobs, notification_log)
- Execution: `npx tsx supabase/migrations/run_migrations.ts` (run once on initial setup)

**`docs/`:**
- Purpose: External documentation for developers and operators
- Contains: Architecture, database schema, payment flow, setup guides, API spec, roadmap
- Key files: Multiple markdown files referenced in CLAUDE.md

**`.planning/codebase/`:**
- Purpose: GSD-generated codebase analysis documents
- Generated: By `/gsd:map-codebase` command
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md, STACK.md, INTEGRATIONS.md

## Key File Locations

**Entry Points:**
- `src/server.ts`: Server startup; initializes Express, mounts routes, starts cron jobs, exposes health check
- `src/routes/whatsapp.ts`: `POST /webhooks/whatsapp` — WhatsApp message receiver
- `src/routes/stripe.ts`: `POST /webhooks/stripe` — Stripe event receiver
- `src/jobs/scheduler.ts`: Initialized in `src/server.ts` at startup; defines all cron schedules

**Configuration:**
- `.env`: Environment variables (not committed; see `.env.example`)
- `tsconfig.json`: TypeScript compiler options
- `package.json`: Dependencies and build scripts

**Core Logic:**
- `src/db/supabase.ts`: Supabase client singleton (imported everywhere)
- `src/types/index.ts`: All TypeScript types (imported everywhere)
- `src/handlers/commandHandler.ts`: Command dispatch logic (entry point for `/` messages)
- `src/handlers/tripWizardHandler.ts`: Multi-step trip creation (most complex handler)
- `src/jobs/thresholdCheck.ts`: Threshold check and payment capture/cancel logic
- `src/services/stripe.ts`: Stripe PaymentIntent lifecycle
- `src/services/stripeConnect.ts`: Stripe Connect account setup

**Testing:**
- No test files in codebase (testing patterns not established yet)
- See TESTING.md for testing approach

## Naming Conventions

**Files:**
- Service files: `{domain}.ts` (e.g., `whatsapp.ts`, `stripe.ts`, `trips.ts`)
- Handler files: `{feature}Handler.ts` (e.g., `commandHandler.ts`, `tripWizardHandler.ts`)
- Job files: `{operation}.ts` (e.g., `thresholdCheck.ts`, `reauthorize.ts`, `dailySummary.ts`)
- Routes: `{webhook-source}.ts` (e.g., `whatsapp.ts`, `stripe.ts`)
- Types: `index.ts` (centralized in `types/` directory)

**Directories:**
- Plural for collections: `handlers/`, `services/`, `jobs/`, `routes/`, `utils/`, `migrations/`
- Flat structure: No nested subdirectories within functional areas
- Grouped by layer: `routes/`, `handlers/`, `services/`, `jobs/`, `db/`, `types/`, `utils/`

**Functions:**
- Command handlers: `handle{Command}()` (e.g., `handleHelp()`, `handleTripCommand()`, `handleConnectCommand()`)
- Flow handlers: `handle{Feature}()` or `handle{Feature}Step()` (e.g., `handleOnboarding()`, `handleTripWizardStep()`)
- Job runners: `run{JobName}()` (e.g., `runThresholdCheck()`, `runReauthorization()`)
- Service functions: Verb-noun, action-first (e.g., `createTrip()`, `getTripById()`, `updateTripBookingCount()`, `sendTextMessage()`, `capturePaymentIntent()`)
- State helpers: `{state}State()` or `save{State}()` (e.g., `saveState()` in trip wizard)

**Types:**
- Entity types: `{Entity}` (e.g., `Captain`, `Trip`, `Booking`)
- Status enums: `{Entity}Status` (e.g., `TripStatus`, `BookingStatus`)
- Input types: `Create{Entity}Input` (e.g., `CreateTripInput`, `CreateBookingInput`)
- State types: `{Feature}State` (e.g., `TripWizardState`, `CancelConfirmState`)
- Custom errors: `{Domain}Error` (e.g., `WataSeatError`)

## Where to Add New Code

**New Command:**
- Primary code: Add handler function in `src/handlers/commandHandler.ts` (switch statement in `handleCommand()`)
- Supporting logic: Extract to new service in `src/services/{domain}.ts`
- Tests: (Not yet established; see TESTING.md)
- Example: Adding `/earnings` command would add `case '/earnings':` handler, call `getEarnings()` from new `services/earnings.ts`

**New Multi-Step Flow (e.g., Dispute Resolution):**
- Primary code: Create new handler file `src/handlers/{featureName}Handler.ts`
- State management: Use Redis for ephemeral state with appropriate TTL
- Persistence: Upsert records to Supabase tables (create new table if needed)
- Tests: TBD
- Example: Adding guest dispute flow would create `src/handlers/disputeHandler.ts`, define `DisputeState` in `types/index.ts`, store state in Redis at `dispute:{guestWaId}`

**New Database Table:**
- Migration: Add schema definition to `supabase/migrations/run_migrations.ts`
- RLS: Enable row-level security with appropriate policies
- Types: Define row interface in `src/types/index.ts`
- Service: Create CRUD functions in new `src/services/{entity}.ts`
- Example: Adding `disputes` table would require Supabase migration, `Dispute` type in `types/index.ts`, CRUD functions in `services/disputes.ts`

**New Cron Job:**
- Schedule: Define in `src/jobs/scheduler.ts` (call `cron.schedule()` with UTC time)
- Job logic: Create new file `src/jobs/{jobName}.ts` with `run{JobName}()` function
- Error handling: Wrap in try/catch, log failures
- Example: Adding daily revenue reconciliation would add `cron.schedule()` call in `scheduler.ts`, create `src/jobs/revenueReconciliation.ts`

**New External API Integration:**
- Service layer: Create `src/services/{api}.ts` with exported functions (no class instantiation)
- Configuration: Store API credentials in `.env` as `{API_NAME}_SECRET_KEY` or similar
- Error handling: Catch API errors, log with context, return user-friendly errors to handlers
- Example: Adding Twilio SMS fallback would create `services/sms.ts` with `sendSmsMessage()`, called from handlers as needed

**New Webhook Handler (e.g., QStash scheduled messages):**
- Route: Create endpoint in new file `src/routes/{source}.ts`
- Verification: Implement signature verification (QStash uses HMAC header)
- Handler: Dispatch to handler layer or directly call services
- Mount: Register route in `src/server.ts`
- Example: Adding QStash message scheduling would create `routes/qstash.ts`, implement signature verification, dispatch to appropriate handler

**Utilities:**
- Shared helpers: `src/utils/{utility}.ts`
- Logging: Use `logger` from `src/utils/logger.ts`
- Examples: Date parsing utility, phone number validation, AED/fils conversion

## Special Directories

**`.env`:**
- Purpose: Local environment configuration (secrets)
- Generated: Not committed; copy from `.env.example` and populate
- Committed: No
- Contents: All 10+ critical env vars (WHATSAPP_ACCESS_TOKEN, STRIPE_SECRET_KEY, SUPABASE_URL, etc.)

**`.planning/codebase/`:**
- Purpose: GSD-generated codebase analysis
- Generated: Yes (by `/gsd:map-codebase` command)
- Committed: Yes (guides future development phases)
- Files: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md, STACK.md, INTEGRATIONS.md

**`node_modules/`:**
- Purpose: npm package dependencies
- Generated: Yes (by `npm install`)
- Committed: No (excluded by `.gitignore`)

**`dist/`:**
- Purpose: Compiled JavaScript output
- Generated: Yes (by `npm run build`)
- Committed: No (excluded by `.gitignore`)

**`.git/`:**
- Purpose: Git repository metadata
- Generated: Yes (by `git init`)
- Committed: N/A (repository control files)

---

*Structure analysis: 2026-03-29*
