---
phase: 01-db-seat-foundation
plan: 02
subsystem: backend-services, admin-dashboard
tags: [seat-counting, migration, canonical-predicate, typescript]
dependency_graph:
  requires: [01-01]
  provides: [clean-seat-math-everywhere]
  affects: [all-booking-flows, admin-dashboard, threshold-job]
tech_stack:
  added: []
  patterns:
    - getTripSeatOccupancy() as canonical seat source at every call site
    - .in('status', ['pending_payment','authorized','confirmed']) replacing .not('status','eq','cancelled')
    - computed current_bookings in admin queries from joined bookings relation
key_files:
  created: []
  modified:
    - src/services/bookings.ts
    - src/services/notifications.ts
    - src/routes/booking.ts
    - src/routes/stripe.ts
    - src/handlers/editWizardHandler.ts
    - src/handlers/commandHandler.ts
    - src/jobs/thresholdCheck.ts
    - admin/lib/queries.ts
    - admin/app/(dashboard)/trips/page.tsx
    - admin/app/(dashboard)/trips/[id]/page.tsx
decisions:
  - id: D-ADMIN-01
    summary: "Admin queries compute current_bookings via bookings relation join rather than calling getTripSeatOccupancy (server-side Node function) — keeps admin Next.js app independent of backend service layer"
  - id: D-REMOVE-ATOMIC
    summary: "atomic_increment_bookings RPC calls removed from stripe.ts — denormalized counter is gone, view is authoritative; threshold check now calls getTripSeatOccupancy directly"
metrics:
  duration_minutes: 10
  completed_date: "2026-03-31T07:16:20Z"
  tasks_completed: 2
  files_modified: 9
---

# Phase 01 Plan 02: Call-Site Migration to getTripSeatOccupancy Summary

All backend routes, services, handlers, jobs, and admin dashboard queries migrated from `trip.current_bookings` and broken `.not('status','eq','cancelled')` predicate to canonical `getTripSeatOccupancy()` view and `.in('status', ['pending_payment','authorized','confirmed'])` predicate. Zero compile errors. TypeScript and build pass clean.

## What Was Built

Per D-06 (atomic switchover), every call site was updated in a single deployment:

**Backend (Task 1):**
- `src/services/bookings.ts`: Fixed `getBookingsByTrip` and `hasGuestBooked` to use canonical `.in()` predicate
- `src/services/notifications.ts`: Replaced ad-hoc seat queries and `trip.current_bookings` reads with `getTripSeatOccupancy()` in `notifyBookingAuthorized`, `notifyThresholdReached`, `notifyCaptainSummary`
- `src/routes/booking.ts`: Replaced ad-hoc Supabase queries in GET and POST handlers with `getTripSeatOccupancy()`; success page uses computed occupancy
- `src/routes/stripe.ts`: Removed `atomic_increment_bookings` RPC calls (denormalized counter gone); replaced `current_bookings` fallback and ad-hoc query with `getTripSeatOccupancy()`
- `src/handlers/editWizardHandler.ts`: All 7 `current_bookings` references replaced with `getTripSeatOccupancy()`; `.not()` in `notifyGuestsOfChange` replaced with `.in()`
- `src/handlers/commandHandler.ts`: `/trips`, `/status`, `/cancel` commands all use `getTripSeatOccupancy()` per trip
- `src/jobs/thresholdCheck.ts`: Threshold check loop, auto-cancel loop, stale booking cleanup, and captain cancellation message all use `getTripSeatOccupancy()`; `current_bookings` removed from select string

**Admin (Task 2):**
- `admin/lib/queries.ts`: `getAlerts` joins bookings, computes `current_bookings` client-side; `getCaptainDetail` joins bookings per trip; `getTripsForCalendar` drops DB column from select, computes from joined bookings; `CalendarTrip` interface keeps `current_bookings` field name (computed)
- `admin/app/(dashboard)/trips/page.tsx`: Removed dead `?? trip.current_bookings ?? 0` fallback
- `admin/app/(dashboard)/trips/[id]/page.tsx`: Computes `currentBookings` from fetched bookings array (canonical predicate)

## Verification Results

```
current_bookings in src/ (DB reads): 0
broken .not predicate across codebase: 0
updateTripBookingCount callers: 0
atomic_increment_bookings callers: 0
getTripSeatOccupancy usages: 28
.select() strings with current_bookings in admin/lib/queries.ts: 0
npx tsc --noEmit: PASS (0 errors)
npm run build: PASS
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed atomic_increment_bookings RPC calls entirely**
- **Found during:** Task 1 (stripe.ts)
- **Issue:** Plan said to remove the `currentCount = newCount ?? trip.current_bookings` fallback, but the `atomic_increment_bookings` RPC calls themselves would fail at runtime since the `current_bookings` column was dropped in Plan 01. Leaving them would be a silent runtime error.
- **Fix:** Removed both `atomic_increment_bookings` calls in stripe.ts (increment on authorized, decrement on expired). The view (`trip_seat_occupancy`) derives counts live from booking statuses — no counter to maintain.
- **Files modified:** `src/routes/stripe.ts`
- **Commit:** db49405

**2. [Rule 1 - Bug] trips/[id]/page.tsx computes currentBookings from bookings array**
- **Found during:** Task 2
- **Issue:** `getTripDetail` returns trip from `select('*')` — `current_bookings` column gone, so `trip.current_bookings ?? 0` would silently return 0 for all trips.
- **Fix:** Page now computes from already-fetched `bookings` array using canonical predicate `['pending_payment','authorized','confirmed']`.
- **Files modified:** `admin/app/(dashboard)/trips/[id]/page.tsx`
- **Commit:** 76b4181

## Known Stubs

None — all seat count displays are now wired to live computed data.

## Self-Check: PASSED

- SUMMARY.md: FOUND
- Commit db49405 (backend migration): FOUND
- Commit 76b4181 (admin migration): FOUND
