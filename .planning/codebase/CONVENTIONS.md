# Coding Conventions

**Analysis Date:** 2026-03-29

## Naming Patterns

**Files:**
- Services: camelCase (`stripe.ts`, `bookings.ts`, `notifications.ts`)
- Handlers: camelCase ending with Handler (`commandHandler.ts`, `buttonHandler.ts`, `onboardingHandler.ts`)
- Routes: camelCase (`whatsapp.ts`, `stripe.ts`)
- Jobs: camelCase ending with job name (`scheduler.ts`, `thresholdCheck.ts`, `reauthorize.ts`, `dailySummary.ts`)
- Utilities: camelCase (`logger.ts`, `crypto.ts`)
- Types: grouped in single file (`types/index.ts`)
- Directories: camelCase (`src/services/`, `src/handlers/`, `src/jobs/`, `src/routes/`)

**Functions:**
- camelCase throughout: `handleCommand()`, `createPaymentIntent()`, `sendTextMessage()`
- Prefix functions by action: `handle*` for event handlers, `create*` for factory functions, `send*` for notifications, `notify*` for outbound notifications, `process*` for transformation
- Async functions use `async` keyword consistently

**Variables:**
- camelCase: `captainId`, `tripId`, `bookingId`, `guestWaId`, `paymentLink`
- Abbreviated names for common entities: `from` (sender's WhatsApp ID), `to` (recipient's WhatsApp ID), `err` (error)
- Boolean prefixes: `is_active`, `has*`, `alreadyBooked`, `stripe_charges_enabled`
- Database column naming: snake_case (`whatsapp_id`, `trip_type`, `created_at`, `updated_at`, `current_bookings`, `price_per_person_aed`)

**Types:**
- PascalCase for interfaces: `Captain`, `Trip`, `Booking`, `StripeIntent`, `WhatsAppGroup`
- PascalCase for type unions: `TripType`, `TripStatus`, `BookingStatus`, `OnboardingStep`
- Export from `src/types/index.ts`: central type definition file, no scattered `.d.ts` files
- Custom error class: `WataSeatError` extends `Error` with `code`, `httpStatus`, and `context` properties

## Code Style

**Formatting:**
- No explicit formatter configured (no `.prettierrc` or `.eslintrc`)
- TypeScript strict mode enabled in `tsconfig.json`
- 2-space indentation (observed in codebase)
- Maximum line length: ~80 characters (observed in comments and code structure)

**Linting:**
- TypeScript strict mode enforced: `"strict": true`
- ESModule conversion enabled: `"esModuleInterop": true`
- Force consistent casing: `"forceConsistentCasingInFileNames": true`
- Type declaration files generated: `"declaration": true, "declarationMap": true`

## Import Organization

**Order:**
1. Third-party packages (`express`, `stripe`, `axios`, `dotenv`, `pino`)
2. Internal utilities and database (`./utils/logger`, `./db/supabase`)
3. Other internal modules (`./services/`, `./handlers/`, `./types`)

**Example from `src/routes/whatsapp.ts`:**
```typescript
import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { verifyMetaSignature } from '../utils/crypto';
import { handleCommand } from '../handlers/commandHandler';
import { handleButton } from '../handlers/buttonHandler';
import { handleOnboarding } from '../handlers/onboardingHandler';
import { supabase } from '../db/supabase';
```

**Path Aliases:**
- No path aliases configured (uses relative paths with `../`)
- All imports use relative paths from file location

## Error Handling

**Patterns:**
- Errors thrown as instances of `Error` or custom `WataSeatError`
- Errors logged with `logger.error()` before throwing
- Service layer: throw descriptive errors when database operations fail: `throw new Error('Failed to create booking: ${error.message}')`
- Route layer: catch errors globally in Express middleware, log, and return generic response to client
- Handler layer: catch internal errors, log, and send user-friendly WhatsApp message (never expose stack traces)
- Global error handler in `src/server.ts` (lines 98-110): wraps all unhandled errors, logs them, and returns `{ error: 'Internal server error' }`

**WataSeatError Class:**
```typescript
export class WataSeatError extends Error {
  constructor(
    message: string,
    public code: string,
    public httpStatus: number = 500,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WataSeatError';
  }
}
```

## Logging

**Framework:** Pino with environment-dependent configuration (`src/utils/logger.ts`)

**Configuration:**
- Production: `level: 'info'`, no pretty-printing
- Development: `level: 'debug'`, pretty-printed console output via `pino-pretty`
- Logger singleton instantiated once and imported throughout

**Patterns:**
- Log structured data as objects: `logger.info({ bookingId, tripId }, 'Booking created')`
- Always include correlation IDs when available: `from`, `to`, `piId`, `bookingId`, `tripId`, `captainId`
- Log at appropriate levels:
  - `info`: successful operations (`PaymentIntent created`, `Booking created`, `WhatsApp message sent`)
  - `warn`: unexpected conditions (`Invalid Meta webhook signature`, `Stripe webhook missing metadata`)
  - `error`: exceptions and failures (`Failed to send WhatsApp message`, `Unhandled error`)
- No `console.log()` in production code — use Pino throughout

**Example from `src/services/stripe.ts`:**
```typescript
logger.info(
  { piId: paymentIntent.id, bookingId: data.bookingId, amountAed: data.amountAed },
  'PaymentIntent created'
);
```

## Comments

**When to Comment:**
- Comment non-obvious logic, especially around state machine transitions and wizard steps
- Explain WHY, not WHAT: `// Respond immediately — Meta requires response within 5 seconds`
- Use section headers for logical groupings (see `src/services/notifications.ts` with `─────` dividers)
- No JSDoc/TSDoc (@param, @returns, @throws) observed — types are self-documenting

**Examples:**
```typescript
// Stripe webhook needs raw body — must be before express.json()
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));

// Respond immediately — Meta requires response within 5 seconds
res.status(200).json({ status: 'ok' });

// Process async
try {
  await processWebhook(req.body);
}
```

## Function Design

**Size:** Functions are generally 10-40 lines of logic. Longer functions (50+ lines) are split into private helper functions.

**Parameters:**
- Prefer object parameters for functions with 3+ parameters: `data: { amountAed, captainStripeAccountId, bookingId, tripId, captainId, guestWaId }`
- Simple parameters for 1-2 arguments: `async function sendTextMessage(to: string, text: string)`
- Type parameters explicitly: all parameters have TypeScript types, even if inferred from context

**Return Values:**
- Async functions return `Promise<T>` where T is explicitly typed
- Void functions for side effects that don't need return values: handlers that send messages
- Single return value preferred; if multiple values needed, return object or typed tuple
- Explicit `null` returns when lookup fails: `if (error) return null;`

## Module Design

**Exports:**
- Named exports only (no default exports): `export async function handleCommand(...)`
- Functions exported when used in multiple modules
- Private functions remain `async function` without `export`
- Types re-exported from `src/types/index.ts`

**Barrel Files:**
- No barrel files (`index.ts` re-exports) observed
- Each service/handler imported directly by path

**Example structure from `src/handlers/buttonHandler.ts`:**
```typescript
// Private helper
async function handleBookingIntent(from: string, tripId: string, message: any): Promise<void> {
  // ...
}

// Exported entry point
export async function handleButton(
  from: string,
  buttonId: string,
  buttonTitle: string,
  message: any
): Promise<void> {
  // Routes to private handler
  if (buttonId.startsWith('booking_intent:')) {
    const tripId = buttonId.replace('booking_intent:', '');
    await handleBookingIntent(from, tripId, message);
  }
}
```

## Data Conversion

**AED to Fils (Stripe):**
- Always multiply by 100: `Math.round(aed * 100)`
- Store in Supabase as `NUMERIC(10,2)`
- Observed in `src/services/stripe.ts` lines 15-16 and throughout stripe operations

**Short IDs:**
- Trip/Booking references use first 6 characters of UUID: `trip.id.substring(0, 6)`
- Used in WhatsApp messages for user-friendly trip identification
- Pattern: `[${shortId}] fishing — Mon 28 Mar 06:00`

**Date Formatting:**
- Use Intl API: `toLocaleDateString('en-AE', {...})` and `toLocaleTimeString('en-AE', {...})`
- Locale: always 'en-AE' for UAE context
- Formats: short date `Mon 28 Mar`, with time `Mon 28 Mar 06:00`, no year

---

*Convention analysis: 2026-03-29*
