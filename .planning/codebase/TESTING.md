# Testing Patterns

**Analysis Date:** 2026-03-29

## Test Framework

**Status:** NOT CONFIGURED
- No test runner installed (`jest`, `vitest`, `mocha` not in `package.json`)
- No test configuration files found (`jest.config.js`, `vitest.config.ts`, `mocha.opts`)
- **No test files in codebase** — no `.test.ts`, `.spec.ts`, or test directories

**Build Commands:**
```bash
npm run dev          # Development with tsx watch
npm run build        # TypeScript compilation only (no test step)
npm start            # Production
npx tsc --noEmit     # Type checking without compilation
```

**Current Status:**
- TypeScript strict mode (`tsconfig.json`) provides some safety
- No test runner or assertion library in dependencies
- Testing is not integrated into build/CI pipeline

## Testing Approach (Current)

**Manual Testing:**
- Local development: `npm run dev` with `tsx watch`
- Webhook testing: `ngrok http 3000` for local tunnel to Meta/Stripe webhook endpoints
- No automated test suite

**Type Safety:**
- Reliance on TypeScript strict mode for compile-time safety
- Explicit type annotations throughout codebase
- No runtime type checking beyond try/catch on external API calls

## Recommended Test Structure (if implementing tests)

**Test Framework Recommendation:** Vitest or Jest (Vitest for faster iteration with TypeScript projects)

**Test File Location Pattern:**
```
src/
├── services/
│   ├── stripe.ts
│   └── stripe.test.ts        # Co-located with source
├── handlers/
│   ├── buttonHandler.ts
│   └── buttonHandler.test.ts
└── utils/
    ├── crypto.ts
    └── crypto.test.ts
```

**Test Organization Example:**
```typescript
// src/services/stripe.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Stripe from 'stripe';
import { createPaymentIntent } from './stripe';
import { supabase } from '../db/supabase';

vi.mock('../db/supabase');
vi.mock('stripe');

describe('stripe service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createPaymentIntent', () => {
    it('should create a payment intent with manual capture', async () => {
      // Arrange
      const mockPaymentIntent = {
        id: 'pi_test123',
        status: 'requires_payment_method',
      };
      vi.mocked(Stripe.prototype.paymentIntents.create).mockResolvedValue(mockPaymentIntent);

      // Act
      const result = await createPaymentIntent({
        amountAed: 100,
        captainStripeAccountId: 'acct_captain123',
        bookingId: 'booking_123',
        tripId: 'trip_123',
        captainId: 'captain_123',
        guestWaId: '971501234567',
      });

      // Assert
      expect(result.id).toBe('pi_test123');
      expect(result.capture_method).toBe('manual');
      expect(supabase.from).toHaveBeenCalledWith('stripe_intents');
    });
  });
});
```

## Mocking Patterns

**External API Mocking:**
- Stripe API: Mock `Stripe` client constructor
- Supabase: Mock `supabase` client and query methods
- WhatsApp Graph API: Mock `axios` POST requests
- Redis: Mock `@upstash/redis` Redis constructor

**Example Mock Structure:**
```typescript
// src/services/__mocks__/stripe.ts
export const mockStripe = {
  paymentIntents: {
    create: vi.fn(),
    capture: vi.fn(),
    cancel: vi.fn(),
  },
  webhooks: {
    constructEvent: vi.fn(),
  },
};

// src/services/__mocks__/supabase.ts
export const mockSupabase = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({ data: [], error: null, single: vi.fn() })),
    insert: vi.fn(() => ({ data: [], error: null, select: vi.fn() })),
    update: vi.fn(() => ({ data: [], error: null })),
    eq: vi.fn(() => ({ data: [], error: null })),
  })),
};
```

**What to Mock:**
- External APIs (Stripe, Meta WhatsApp, Supabase)
- Time-dependent operations (current date/time for scheduling tests)
- Cron jobs and async tasks
- `logger` to verify logging calls

**What NOT to Mock:**
- Utility functions like `verifyMetaSignature()` — test cryptographic behavior
- Type definitions and custom error classes
- Pure helper functions (`shortId()`, `capitalize()`, date formatting)

## Test Patterns (if implemented)

**Async Testing:**
```typescript
it('should handle async operations', async () => {
  const result = await createBooking({
    trip_id: 'trip_123',
    captain_id: 'captain_123',
    guest_whatsapp_id: '971501234567',
    num_seats: 1,
    price_per_seat_aed: 300,
    total_amount_aed: 300,
  });

  expect(result.id).toBeDefined();
  expect(result.status).toBe('pending_payment');
});
```

**Error Testing:**
```typescript
it('should throw on database error', async () => {
  const mockError = new Error('Database connection failed');
  vi.mocked(supabase.from).mockReturnValue({
    insert: vi.fn(() => ({
      select: vi.fn(() => ({ error: mockError })),
    })),
  });

  await expect(
    createBooking({
      trip_id: 'trip_123',
      captain_id: 'captain_123',
      guest_whatsapp_id: '971501234567',
      num_seats: 1,
      price_per_seat_aed: 300,
      total_amount_aed: 300,
    })
  ).rejects.toThrow('Failed to create booking');
});
```

**State Machine Testing (Trip Wizard):**
```typescript
it('should advance trip wizard state', async () => {
  const from = '971501234567';
  const state: TripWizardState = {
    step: 'trip_type',
    captain_id: 'captain_123',
  };

  await handleTripWizardStep(from, 'fishing', state);

  expect(state.step).toBe('date');
  expect(state.trip_type).toBe('fishing');
});
```

## Test Categories (if implementing)

**Unit Tests:**
- Individual service functions (`createPaymentIntent()`, `createBooking()`, `getTripsByCaptain()`)
- Utility functions (`verifyMetaSignature()`, date parsing/formatting)
- State machine transitions (wizard steps, onboarding flow)
- Error handling and recovery

**Integration Tests:**
- Webhook processing: Full request → parsing → handler → response
- Payment flow: Booking creation → PaymentIntent → Stripe event handling
- Onboarding flow: Multiple wizard steps with state persistence
- Cron jobs: Mock scheduler and verify job execution

**E2E Tests:**
- NOT currently used
- Would require: live Stripe test account, Meta test WhatsApp phone number, Supabase test database
- Could be implemented for critical paths (booking → payment → confirmation)

## Coverage Recommendations (if implementing)

**Target:** 80%+ coverage for critical paths
- Services (100%): `stripe.ts`, `bookings.ts`, `trips.ts`, `notifications.ts`
- Handlers (70%+): Command/button/onboarding handlers (high complexity, many branches)
- Routes (60%+): Webhook endpoints (signature verification, event dispatching)
- Utilities (100%): `crypto.ts`, logger configuration

**Skip from Coverage:**
- Server.ts health check (simple health checks)
- Generated types
- External API integrations (mocked in tests)

## Dependencies to Add (if implementing tests)

```json
{
  "devDependencies": {
    "vitest": "^1.0.0",
    "@vitest/ui": "^1.0.0",
    "@vitest/coverage-c8": "^1.0.0",
    "vi": "^0.3.0"
  }
}
```

**Configuration (vitest.config.ts):**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'c8',
      reporter: ['text', 'json', 'html'],
      lines: 80,
      functions: 80,
      branches: 70,
      statements: 80,
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
      ],
    },
  },
});
```

**Run Commands:**
```bash
npm test                  # Run all tests
npm test -- --watch      # Watch mode
npm test -- --coverage   # Generate coverage report
npm test -- --ui         # Vitest UI
```

## Known Testing Gaps

**Untested Areas:**
1. **Webhook processing (`src/routes/whatsapp.ts`, `src/routes/stripe.ts`)** — Signature verification and event routing not tested
2. **State machine flows** — Trip wizard and onboarding multi-step flows not validated
3. **Error handling paths** — Exception recovery and user-friendly messaging not tested
4. **Stripe payment lifecycle** — Authorization → capture → cancellation flow not tested end-to-end
5. **Cron jobs (`src/jobs/`)** — Threshold checking, re-authorization, and summary jobs not tested
6. **Redis operations** — Wizard state and cancel confirmation storage/retrieval not tested
7. **WhatsApp message formatting** — Template parameter substitution not validated

**Risk Assessment:**
- **High:** Payment flow (threshold checks, captures, refunds) — any bug causes incorrect charges or missing payouts
- **High:** Onboarding state machine — broken flow blocks captain registration
- **Medium:** Webhook signature verification — security issue if wrong
- **Medium:** Cron jobs — missed payments or incomplete re-authorizations
- **Low:** Message formatting — typos or incorrect data in user messages

---

*Testing analysis: 2026-03-29*
