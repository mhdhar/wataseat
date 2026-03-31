---
phase: 02-checkout-safety
plan: 01
subsystem: database, jobs
tags: [postgres, supabase, migrations, stripe, seat-ttl, threshold-check]

# Dependency graph
requires:
  - "01-01: trip_seat_occupancy view (migration 012)"
provides:
  - "Migration 013 with TTL-aware trip_seat_occupancy view (15-minute pending_payment filter)"
  - "reserve_seat() function with matching 15-minute predicate"
  - "Stale hold cleanup in thresholdCheck.ts at 15-minute cutoff with Stripe PI cancellation"
affects:
  - "All call sites of getTripSeatOccupancy() — inherit TTL behavior automatically via view"
  - "src/jobs/thresholdCheck.ts — stale cleanup behavior changed"
  - "Stripe payment intents — now explicitly cancelled on stale booking cleanup"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TTL-aware view: pending_payment rows older than 15 minutes excluded from seat counts"
    - "View/function parity: both use identical 15-minute predicate for pending_payment"
    - "Defensive PI cancellation: try/catch with logger.warn — never blocks cleanup"

key-files:
  created: []
  modified:
    - "supabase/migrations/run_migrations.ts (migration 013 appended)"
    - "src/jobs/thresholdCheck.ts (15-min cutoff, Stripe PI cancel loop)"

key-decisions:
  - "15-minute interval hardcoded in SQL (not runtime-configurable) per D-01 and D-02"
  - "Both the view AND reserve_seat() must use identical predicate — prevents view/function disagreement on available seats"
  - "Stripe PI cancellation errors are non-fatal: log.warn and continue — PI may already be cancelled/expired"
  - "Notification text changed to 'payment was not completed in time' — avoids hardcoding 15min in user message"
  - "Migration 012 included in this worktree as baseline (phase 01 work not yet merged into worktree branch)"

patterns-established:
  - "Stale pending_payment rows: excluded from seat counts at DB layer, cleaned up by hourly job"
  - "Cleanup order: notify guests → cancel Stripe PIs → delete rows"

requirements-completed: [RSVP-01, RSVP-02]

# Metrics
duration: ~15min
completed: 2026-03-31
---

# Phase 02 Plan 01: Pending Payment TTL Enforcement Summary

**15-minute TTL for pending_payment bookings: DB view excludes stale holds from seat counts, reserve_seat() uses identical predicate, and the hourly threshold job cancels Stripe PIs and removes stale rows**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-31T10:21:00Z
- **Completed:** 2026-03-31T10:36:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added migration 013 rewriting `trip_seat_occupancy` view to exclude `pending_payment` rows older than 15 minutes from `reserved_seats` and `total_occupied_seats` aggregates
- Rewrote `reserve_seat()` PostgreSQL function with identical 15-minute predicate, ensuring the function and view agree on which pending rows count toward seat inventory
- Changed stale hold cleanup in `thresholdCheck.ts` from 4-hour to 15-minute cutoff
- Added Stripe PaymentIntent cancellation loop before row deletion, with defensive try/catch so PI errors never block cleanup
- Updated guest notification text from "4 hours" to "in time" for future-proofing
- Updated cleanup log message to include `(>15min)` for clarity
- Removed `current_bookings` from the trips join select in cleanup query (column dropped in migration 012)

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 013 — TTL-aware view and reserve_seat()** - `ed6546c` (feat)
2. **Task 2: Lower stale cleanup to 15 minutes + Stripe PI cancellation** - `a0d47cc` (feat)

## Files Created/Modified

- `supabase/migrations/run_migrations.ts` — Migration 012 baseline + migration 013 with TTL-aware view and reserve_seat() rewrite
- `src/jobs/thresholdCheck.ts` — 15-minute cutoff, Stripe PI cancellation loop, updated notification text and log message

## Decisions Made

- 15-minute interval is hardcoded in SQL (not configurable at runtime) — matches the research decision log (D-01, D-02)
- Both the view and `reserve_seat()` use identical predicates — prevents the critical Pitfall 1 where the function rejects valid bookings because it still counts stale holds that the view excludes
- Stripe PI cancellation is non-fatal: `logger.warn` on failure and continue — the PI may already be cancelled or expired by Stripe
- Guest message changed to generic "payment was not completed in time" — avoids coupling user-facing copy to the exact cutoff value

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing baseline] Added migration 012 to worktree**
- **Found during:** Task 1
- **Issue:** This worktree branched off `main` before Phase 01's migration 012 commit. The plan expected 012 to already be present in the file.
- **Fix:** Added migration 012 (exact SQL from main branch at `38af2d2`) before adding 013. When this worktree is merged into main, the 012 entry will conflict with phase 01's identical 012 entry — orchestrator should resolve by keeping one copy.
- **Files modified:** supabase/migrations/run_migrations.ts
- **Commit:** ed6546c

**2. [Rule 1 - Bug] Removed `current_bookings` from trips join select**
- **Found during:** Task 2
- **Issue:** The original stale cleanup query selected `current_bookings` from the trips join, but that column was dropped in migration 012. Keeping it would cause a runtime DB error.
- **Fix:** Removed `current_bookings` from the `trips!inner(...)` select and simplified the `tripOpen` check to `trip?.status === 'open'`.
- **Files modified:** src/jobs/thresholdCheck.ts
- **Commit:** a0d47cc

## Known Stubs

None — all changes are behavioral database/job logic with no UI stubs.

## Self-Check: PASSED

- FOUND: supabase/migrations/run_migrations.ts
- FOUND: src/jobs/thresholdCheck.ts
- FOUND commit: ed6546c (migration 013)
- FOUND commit: a0d47cc (stale cleanup update)
- VERIFIED: `grep -c "013_pending_payment_ttl_view" supabase/migrations/run_migrations.ts` = 1
- VERIFIED: `grep -c "INTERVAL '15 minutes'" supabase/migrations/run_migrations.ts` = 3
- VERIFIED: `grep -c "fifteenMinutesAgo" src/jobs/thresholdCheck.ts` = 3
- VERIFIED: `grep -c "fourHoursAgo" src/jobs/thresholdCheck.ts` = 0
- VERIFIED: `npx tsc --noEmit` = PASS
