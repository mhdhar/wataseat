---
phase: 01-db-seat-foundation
plan: 01
subsystem: database
tags: [postgres, supabase, migrations, typescript, seat-occupancy]

# Dependency graph
requires: []
provides:
  - "PostgreSQL view trip_seat_occupancy aggregating reserved/authorized/confirmed seats per trip"
  - "Migration 012 with view DDL, column drop (current_bookings), function drop (atomic_increment_bookings), and reserve_seat fix"
  - "TripSeatOccupancy TypeScript interface exported from src/types/index.ts"
  - "getTripSeatOccupancy() helper function in src/services/bookings.ts"
affects:
  - 01-02-call-site-migration
  - jobs/thresholdCheck
  - routes/booking
  - admin dashboard

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Canonical view pattern: trip_seat_occupancy as single source of truth for seat counts"
    - "Status predicate: status IN ('pending_payment','authorized','confirmed') — never status != 'cancelled'"
    - "ZERO_OCCUPANCY constant with maybeSingle() for trips with no active bookings"

key-files:
  created:
    - "supabase/migrations/run_migrations.ts (migration 012 appended)"
  modified:
    - "supabase/migrations/run_migrations.ts"
    - "src/types/index.ts"
    - "src/services/bookings.ts"
    - "src/services/trips.ts"

key-decisions:
  - "Use CREATE OR REPLACE VIEW so migration is idempotent and re-runnable"
  - "Use maybeSingle() not single() in getTripSeatOccupancy — trips with zero active bookings have no row in the view"
  - "ZERO_OCCUPANCY constant handles null return from maybeSingle gracefully"
  - "reserve_seat() predicate changed from status != 'cancelled' to explicit IN list to exclude refunded bookings from seat count"

patterns-established:
  - "Seat occupancy: always query trip_seat_occupancy view, never trips.current_bookings"
  - "Status predicate: always use status IN ('pending_payment','authorized','confirmed') for active seat counts"

requirements-completed: [SEAT-01, SEAT-02]

# Metrics
duration: 15min
completed: 2026-03-31
---

# Phase 01 Plan 01: DB Seat Foundation Summary

**PostgreSQL view trip_seat_occupancy as canonical seat source, dropping denormalized current_bookings column and fixing reserve_seat() status predicate to exclude refunded bookings**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-31T07:05:00Z
- **Completed:** 2026-03-31T07:20:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created migration 012 establishing `trip_seat_occupancy` view with per-status seat counts (reserved/authorized/confirmed/total)
- Dropped `trips.current_bookings` column and `atomic_increment_bookings()` function to remove the stale denormalized counter
- Fixed `reserve_seat()` SQL predicate from `status != 'cancelled'` to `status IN ('pending_payment','authorized','confirmed')` — this correctly excludes `refunded` bookings from inventory
- Added `TripSeatOccupancy` interface and `getTripSeatOccupancy()` helper to TypeScript codebase
- Removed `updateTripBookingCount()` from trips service (dead code after column drop)
- Removed `current_bookings` from Trip interface — tsc now reports all remaining usage sites for Plan 02 migration

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 012 — view, column drop, function updates** - `38af2d2` (feat)
2. **Task 2: Update types, add occupancy helper, delete stale function** - `9b37ab7` (feat)

**Plan metadata:** (committed with docs metadata below)

## Files Created/Modified
- `supabase/migrations/run_migrations.ts` - Migration 012 appended with view DDL, DROP COLUMN, DROP FUNCTION, and reserve_seat fix
- `src/types/index.ts` - Removed `current_bookings` from Trip interface; added `TripSeatOccupancy` interface
- `src/services/bookings.ts` - Added `getTripSeatOccupancy()` and `ZERO_OCCUPANCY` constant; imported `TripSeatOccupancy`
- `src/services/trips.ts` - Deleted `updateTripBookingCount()` function entirely

## Decisions Made
- Used `maybeSingle()` not `single()` in `getTripSeatOccupancy` because trips with zero active bookings have no row in the view (GROUP BY produces no row, not a zero-row)
- Used `ZERO_OCCUPANCY` constant instead of inline object literal for clarity and reuse
- Kept migration 011 unchanged (preserve history); migration 012 uses `CREATE OR REPLACE FUNCTION reserve_seat` to redeclare with corrected predicate

## Deviations from Plan

None - plan executed exactly as written. TypeScript errors from remaining `current_bookings` usages are expected and desired; Plan 02 migrates all call sites.

## Issues Encountered
None. TypeScript type errors (`Property 'current_bookings' does not exist on type 'Trip'`) in 20 locations across commandHandler.ts, editWizardHandler.ts, and notifications.ts are intentional — they serve as the compiler-enforced migration checklist for Plan 02.

## User Setup Required
None - no external service configuration required. Run `npx tsx supabase/migrations/run_migrations.ts` to apply migration 012 to the database when ready.

## Next Phase Readiness
- Plan 02 can now migrate all `trip.current_bookings` call sites to use `getTripSeatOccupancy()` — tsc error list is the exact migration checklist
- The view is idempotent and safe to run against production
- All seat count logic in jobs (threshold check), routes (booking), and admin must be updated in Plan 02

---
*Phase: 01-db-seat-foundation*
*Completed: 2026-03-31*
