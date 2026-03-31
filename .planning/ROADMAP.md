# Roadmap: WataSeat — v1.0 Seat Integrity & Safety

## Overview

This milestone establishes a trustworthy foundation for WataSeat's seat economy. It starts with a canonical DB occupancy model that every other system depends on, secures the web checkout flow against anonymous inventory abuse, replaces the fake admin refund with a real Stripe saga, adds automated reconciliation monitoring, surfaces seat-accurate metrics in captain and admin views, and finishes with E2E test coverage that proves all of the above holds under adversarial conditions.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: DB Seat Foundation** - Canonical occupancy view + correct status predicate — everything else builds on this
- [ ] **Phase 2: Checkout Safety** - Web reservation TTL and session-bound anonymous holds with rate limiting
- [ ] **Phase 3: Admin Refund Saga** - Real Stripe cancel/refund pipeline with DB sync and guest notification
- [ ] **Phase 4: Reconciliation & Alerting** - Scheduled drift detection between DB seat counts and Stripe intent states
- [ ] **Phase 5: Seat-Based Metrics** - Admin dashboard and captain notifications show SUM(num_seats) not row counts
- [ ] **Phase 6: E2E Test Coverage** - Automated tests covering multi-seat checkout, abandoned holds, refunds, concurrency, and webhook reordering

## Phase Details

### Phase 1: DB Seat Foundation
**Goal**: A single canonical DB view for seat occupancy drives all routes, jobs, and dashboards — ad-hoc seat math and the broken status predicate are gone
**Depends on**: Nothing (first phase)
**Requirements**: SEAT-01, SEAT-02
**Success Criteria** (what must be TRUE):
  1. A DB view (or function) returns `reserved_seats`, `authorized_seats`, and `confirmed_seats` per trip and can be queried from any route or job
  2. Only bookings with status `pending_payment`, `authorized`, or `confirmed` count toward seat occupancy — refunded bookings do not appear in any seat count
  3. The `status != 'cancelled'` predicate is removed from all seat availability queries; the canonical predicate is used everywhere
  4. Booking a seat on a trip with zero remaining availability returns an error derived from the view, not ad-hoc math
**Plans:** 2 plans
Plans:
- [x] 01-01-PLAN.md — Create canonical view migration, update types, add occupancy helper
- [x] 01-02-PLAN.md — Migrate all call sites (backend + admin) to use canonical view

### Phase 2: Checkout Safety
**Goal**: Web checkout holds are time-bounded and identity-bound, so anonymous actors cannot exhaust trip inventory
**Depends on**: Phase 1
**Requirements**: RSVP-01, RSVP-02, SEC-01, SEC-02
**Success Criteria** (what must be TRUE):
  1. A `pending_payment` booking older than 15 minutes is excluded from seat availability calculations without any manual intervention
  2. Stale web reservations are cleaned up on a schedule shorter than the hourly threshold job (e.g., every 5 minutes or TTL-aware query)
  3. An anonymous checkout session receives a stable browser session token bound to its hold — not `pending_${Date.now()}`
  4. Repeated `POST /book/:shortId/checkout` calls from the same IP or session are rate-limited and blocked after a configurable threshold
**Plans**: TBD
**UI hint**: yes

### Phase 3: Admin Refund Saga
**Goal**: Admin-initiated refunds are a real atomic saga: Stripe action first, then DB updates, then guest notification — no DB-only status flips
**Depends on**: Phase 1
**Requirements**: RFND-01, RFND-02, RFND-03, RFND-04
**Success Criteria** (what must be TRUE):
  1. Clicking refund in the admin dashboard calls Stripe cancel or refund API and only proceeds if Stripe confirms success
  2. After a successful Stripe action, `trips.current_bookings` is decremented and any open reauth jobs for the booking are closed
  3. An audit record (triggered_by, timestamp, Stripe response summary) is written to the database for every refund attempt (success or failure)
  4. The guest WhatsApp refund notification is dispatched only after both the Stripe action and all DB updates complete without error
  5. A failed Stripe refund call surfaces a clear error to the admin and leaves booking status unchanged
**Plans**: TBD
**UI hint**: yes

### Phase 4: Reconciliation & Alerting
**Goal**: A scheduled job detects and reports drift between booking table seat sums, trips counters, and Stripe intent states before it causes financial harm
**Depends on**: Phase 1
**Requirements**: RECON-01, RECON-02
**Success Criteria** (what must be TRUE):
  1. A scheduled job runs and compares `SUM(bookings.num_seats)` per trip against `trips.current_bookings` and detects mismatches
  2. The job also cross-references Stripe intent states against booking statuses and flags disagreements (e.g., captured intent with non-confirmed booking)
  3. When drift exceeds a defined threshold, an alert is sent to the admin via WhatsApp message or written to the notification log and is visible in the admin dashboard
**Plans**: TBD

### Phase 5: Seat-Based Metrics
**Goal**: Every admin and captain-facing surface shows seat counts derived from SUM(num_seats) — multi-seat bookings are no longer undercounted
**Depends on**: Phase 1
**Requirements**: SEAT-03
**Success Criteria** (what must be TRUE):
  1. The admin dashboard trip stats show total seats reserved, authorized, and confirmed as seat counts — a booking for 3 seats contributes 3, not 1
  2. Captain WhatsApp notifications (booking confirmation, threshold met, summary) report seat counts not booking row counts
  3. Seat counts in the dashboard and notifications match the values returned by the Phase 1 canonical view
**Plans**: TBD
**UI hint**: yes

### Phase 6: E2E Test Coverage
**Goal**: Automated tests prove the seat integrity guarantees hold under realistic adversarial and edge-case conditions
**Depends on**: Phase 2, Phase 3, Phase 4, Phase 5
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05
**Success Criteria** (what must be TRUE):
  1. A multi-seat checkout test verifies seat count flows correctly through Stripe, DB, and availability query
  2. An abandoned-hold test verifies that a `pending_payment` booking older than 15 minutes does not block a new booking
  3. A refund test verifies admin refund triggers Stripe cancel, decrements seat count, and delivers guest WhatsApp notification
  4. A concurrency test verifies simultaneous booking requests do not exceed `max_seats` — race condition guard holds
  5. A webhook-reordering test verifies threshold transition logic is idempotent when Stripe events arrive out of order
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. DB Seat Foundation | 0/2 | Planning complete | - |
| 2. Checkout Safety | 0/TBD | Not started | - |
| 3. Admin Refund Saga | 0/TBD | Not started | - |
| 4. Reconciliation & Alerting | 0/TBD | Not started | - |
| 5. Seat-Based Metrics | 0/TBD | Not started | - |
| 6. E2E Test Coverage | 0/TBD | Not started | - |
