---
phase: 03-admin-refund-saga
plan: 01
subsystem: payments
tags: [stripe, postgres, express, supabase, migrations]

# Dependency graph
requires:
  - phase: 01-db-seat-foundation
    provides: trip_seat_occupancy view, refunded status excluded from seat math, current_bookings column removed
provides:
  - migration 014_refund_audit table with full audit trail schema
  - POST /api/admin/refund-booking Express endpoint with Stripe-first saga
affects:
  - 03-02 (admin Next.js app calls this endpoint from server action)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Stripe-first saga ordering: Stripe action → DB updates → guest notification
    - Live PI status retrieval via stripe.paymentIntents.retrieve() before acting
    - Audit row written on both success and failure paths
    - Reauth jobs marked complete (not deleted) after successful refund

key-files:
  created: []
  modified:
    - supabase/migrations/run_migrations.ts
    - src/routes/admin.ts

key-decisions:
  - "Use stripe.paymentIntents.retrieve() for live PI status — not cached stripe_intents.stripe_status — to prevent acting on stale data"
  - "Auto-detect cancel vs refund from PI status: requires_capture → cancel, succeeded → refund"
  - "Audit row always written regardless of saga outcome (success or failure)"
  - "Guest WhatsApp notification failure only logs error, never fails the refund response"
  - "triggered_by hardcoded as 'admin' — single-operator system, no multi-user identity in this phase"

patterns-established:
  - "Pattern: Admin refund saga in src/routes/admin.ts protected by X-Admin-Secret middleware"
  - "Pattern: refund_audit table as append-only audit log for all Stripe refund attempts"

requirements-completed: [RFND-01, RFND-02, RFND-03]

# Metrics
duration: 5min
completed: 2026-03-31
---

# Phase 03 Plan 01: Admin Refund Saga Backend Summary

**Stripe-first admin refund saga: migration 014 creates refund_audit table, POST /api/admin/refund-booking auto-detects cancel vs refund from live PI status and writes audit row on every attempt**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-31T11:20:00Z
- **Completed:** 2026-03-31T11:24:35Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added migration 014_refund_audit with UUID PK, booking_id FK, triggered_by, action CHECK constraint (cancel/refund/error), stripe_response JSONB, success boolean, error_message nullable
- Implemented POST /api/admin/refund-booking with full 4-step saga: (1) live PI status retrieval, (2) Stripe cancel or refund, (3) DB updates + reauth job closure, (4) guest WhatsApp notification
- Audit row written on BOTH success and failure paths — never lost regardless of outcome
- TypeScript compiles cleanly with no errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add migration 014_refund_audit and create refund-booking endpoint** - `503197b` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `supabase/migrations/run_migrations.ts` - Added migration 014_refund_audit after 013_pending_payment_ttl_view
- `src/routes/admin.ts` - Added Stripe import, local stripe instance, and POST /refund-booking endpoint with full saga

## Decisions Made
- Used `stripe.paymentIntents.retrieve()` for live PI status before deciding action — prevents acting on stale `stripe_intents` cache (per RESEARCH.md Pitfall 1)
- Saga ordering: Stripe action FIRST, DB updates second, notification third — if Stripe fails, DB and notification are skipped (D-02)
- Both `cancelPaymentIntent()` and `refundPaymentIntent()` reuse the established service layer functions which already have idempotency keys
- Fallback PI ID from `bookings.stripe_payment_intent_id` when no `stripe_intents` row exists (per RESEARCH.md Pitfall 5)
- `triggered_by` recorded as literal `"admin"` — single operator, no per-user identity in current JWT payload

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
- None

## User Setup Required
None — no external service configuration required. Migration 014 will run on next `npx tsx supabase/migrations/run_migrations.ts` execution.

## Next Phase Readiness
- Backend endpoint is fully implemented and TypeScript-clean
- Plan 02 (admin Next.js app) can now call `POST /api/admin/refund-booking` with `{ bookingId }` and `X-Admin-Secret` header
- The `booking_refunded` WhatsApp template must be approved in Meta before guest notifications will send

## Self-Check: PASSED

- supabase/migrations/run_migrations.ts: FOUND
- src/routes/admin.ts: FOUND
- .planning/phases/03-admin-refund-saga/03-01-SUMMARY.md: FOUND
- Commit 503197b: FOUND

---
*Phase: 03-admin-refund-saga*
*Completed: 2026-03-31*
