# Requirements: WataSeat

**Defined:** 2026-03-31
**Milestone:** v1.0 — Seat Integrity & Safety
**Core Value:** Guests book and pay for boat trips entirely through WhatsApp, and captains only run when enough seats are filled — zero-risk trip economics via authorization holds.

## v1.0 Requirements

Requirements for milestone v1.0. Each maps to roadmap phases.

### Seat Accounting

- [x] **SEAT-01**: System derives available seats from a canonical DB view (`reserved_seats`, `authorized_seats`, `confirmed_seats`) consumed by all routes, jobs, and dashboards — no ad-hoc seat math per file
- [x] **SEAT-02**: Refunded bookings are excluded from all seat counts; active statuses are explicit: `pending_payment`, `authorized`, `confirmed`
- [ ] **SEAT-03**: Admin trip stats and captain-facing metrics show `SUM(num_seats)` by status, not booking row counts

### Web Reservation TTL

- [ ] **RSVP-01**: Web `pending_payment` reservations older than 15 minutes are excluded from seat availability calculations at the DB/query layer
- [ ] **RSVP-02**: Stale web reservations are cleaned up proactively (more frequent than hourly, or TTL-aware query)

### Booking Security

- [ ] **SEC-01**: Anonymous web checkout holds are bound to a stable browser session token (not `pending_${Date.now()}`)
- [ ] **SEC-02**: Per-IP/session rate limiting is applied to `POST /book/:shortId/checkout` to prevent inventory exhaustion

### Admin Refund Saga

- [ ] **RFND-01**: Admin refund calls Stripe cancel/refund API and confirms success before updating booking status
- [ ] **RFND-02**: Admin refund decrements `trips.current_bookings` and closes open reauth jobs for the booking
- [ ] **RFND-03**: Admin refund records an audit trail (triggered by, timestamp, Stripe response) in the database
- [ ] **RFND-04**: Guest WhatsApp refund notification is only sent after Stripe action and DB updates succeed

### Reconciliation & Alerting

- [ ] **RECON-01**: A scheduled job detects drift between `SUM(bookings.num_seats)`, `trips.current_bookings`, and Stripe intent states
- [ ] **RECON-02**: Drift alerts are surfaced to admin (WhatsApp or notification log) when discrepancies exceed threshold

### Test Coverage

- [ ] **TEST-01**: E2E test verifies multi-seat web checkout flows seat count through to Stripe, DB, and availability correctly
- [ ] **TEST-02**: E2E test verifies abandoned pending holds (>15 min) do not block future seat availability
- [ ] **TEST-03**: E2E test verifies admin refund triggers Stripe cancel, decrements seat count, and sends guest notification
- [ ] **TEST-04**: E2E test verifies concurrent booking race condition guards hold under simultaneous requests
- [ ] **TEST-05**: E2E test verifies threshold transitions handle webhook reordering correctly

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Identity & Verification

- **IDENT-01**: Guest email collection and verification before first booking
- **IDENT-02**: Captain KYC/AML verification beyond Stripe Connect (license upload, UAE maritime authority integration)

### Security Hardening

- **SEC-03**: CAPTCHA on web checkout for repeated creation attempts
- **SEC-04**: Stripe Connect account ownership verification (metadata whatsapp_id match on account.updated)

### Infrastructure

- **INFRA-01**: Redis singleton client (eliminate multiple instantiations per handler)
- **INFRA-02**: Payment link expiry validation (prevent payment after trip cancelled)
- **INFRA-03**: Audit trail for payment captures (who triggered, when, errors)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Real-time chat | Not core to booking value |
| Mobile app | Web-first, mobile later |
| Video/image uploads | Storage/bandwidth costs |
| OAuth / social login | WhatsApp ID sufficient for identity |
| Timezone-aware cron | Complex, defer — UTC adequate for UAE ops |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEAT-01 | Phase 1 | Complete |
| SEAT-02 | Phase 1 | Complete |
| SEAT-03 | Phase 5 | Pending |
| RSVP-01 | Phase 2 | Pending |
| RSVP-02 | Phase 2 | Pending |
| SEC-01 | Phase 2 | Pending |
| SEC-02 | Phase 2 | Pending |
| RFND-01 | Phase 3 | Pending |
| RFND-02 | Phase 3 | Pending |
| RFND-03 | Phase 3 | Pending |
| RFND-04 | Phase 3 | Pending |
| RECON-01 | Phase 4 | Pending |
| RECON-02 | Phase 4 | Pending |
| TEST-01 | Phase 6 | Pending |
| TEST-02 | Phase 6 | Pending |
| TEST-03 | Phase 6 | Pending |
| TEST-04 | Phase 6 | Pending |
| TEST-05 | Phase 6 | Pending |

**Coverage:**
- v1.0 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-31*
*Last updated: 2026-03-31 — traceability updated after roadmap creation*
