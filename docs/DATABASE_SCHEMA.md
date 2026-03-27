# DATABASE_SCHEMA.md — WataSeat

> Complete Supabase (PostgreSQL) schema. Claude Code will run these migrations in order during Phase 1 setup.

---

## Tables Overview

| Table | Purpose |
|---|---|
| `captains` | Registered boat captains with Stripe Connect accounts |
| `whatsapp_groups` | WhatsApp groups the bot has been added to |
| `trips` | Individual trip listings created by captains |
| `bookings` | Individual seat reservations by guests |
| `stripe_intents` | Stripe PaymentIntent records (1:1 with bookings) |
| `reauth_jobs` | Tracks upcoming 6-day re-authorization jobs |
| `notification_log` | Audit log of all WhatsApp messages sent |

---

## Migration 001 — captains

```sql
CREATE TABLE captains (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Identity
  whatsapp_id           TEXT UNIQUE NOT NULL,        -- WhatsApp phone number (e.g. 971501234567)
  display_name          TEXT NOT NULL,
  boat_name             TEXT,
  license_number        TEXT,                         -- UAE maritime license

  -- Onboarding state
  onboarding_step       TEXT NOT NULL DEFAULT 'start',  -- start | name | boat | license | stripe | complete
  is_active             BOOLEAN NOT NULL DEFAULT false,

  -- Stripe Connect
  stripe_account_id     TEXT UNIQUE,                 -- acct_xxx (Connect account)
  stripe_onboarding_url TEXT,                        -- Temporary onboarding link
  stripe_charges_enabled BOOLEAN NOT NULL DEFAULT false,
  stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT false,

  -- Stats
  total_trips           INT NOT NULL DEFAULT 0,
  total_revenue_aed     NUMERIC(10, 2) NOT NULL DEFAULT 0
);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER captains_updated_at
  BEFORE UPDATE ON captains
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE captains ENABLE ROW LEVEL SECURITY;
```

---

## Migration 002 — whatsapp_groups

```sql
CREATE TABLE whatsapp_groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  group_id      TEXT UNIQUE NOT NULL,   -- WhatsApp group JID (e.g. 120363xxxxxxxx@g.us)
  group_name    TEXT,
  captain_id    UUID NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE whatsapp_groups ENABLE ROW LEVEL SECURITY;
```

---

## Migration 003 — trips

```sql
CREATE TYPE trip_type AS ENUM ('fishing', 'diving', 'cruising', 'other');
CREATE TYPE trip_status AS ENUM ('draft', 'open', 'confirmed', 'cancelled', 'completed');

CREATE TABLE trips (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Relationships
  captain_id        UUID NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
  group_id          UUID NOT NULL REFERENCES whatsapp_groups(id) ON DELETE CASCADE,

  -- Trip details
  trip_type         trip_type NOT NULL DEFAULT 'fishing',
  title             TEXT NOT NULL,                      -- Auto-generated or captain-set
  description       TEXT,
  departure_at      TIMESTAMPTZ NOT NULL,               -- Date + time of departure
  duration_hours    NUMERIC(4, 1),                      -- e.g. 4.5 hours
  meeting_point     TEXT,

  -- Capacity and pricing
  max_seats         INT NOT NULL CHECK (max_seats >= 1),
  threshold         INT NOT NULL CHECK (threshold >= 1), -- Min passengers for trip to run
  price_per_person_aed  NUMERIC(10, 2) NOT NULL,

  -- Booking state
  current_bookings  INT NOT NULL DEFAULT 0 CHECK (current_bookings >= 0),
  status            trip_status NOT NULL DEFAULT 'open',

  -- WhatsApp message IDs (for editing the trip card in group)
  announcement_message_id  TEXT,                        -- ID of the bot's trip card in group

  -- Threshold check tracking
  threshold_check_sent_at  TIMESTAMPTZ,                -- When we sent the 12h warning
  confirmed_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  cancellation_reason TEXT
);

CREATE TRIGGER trips_updated_at
  BEFORE UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Index for the 12h threshold check job
CREATE INDEX idx_trips_departure_status ON trips(departure_at, status)
  WHERE status = 'open';

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
```

---

## Migration 004 — bookings

```sql
CREATE TYPE booking_status AS ENUM (
  'pending_payment',    -- Guest tapped Book Now, link sent, not yet paid
  'authorized',         -- Stripe hold successful, waiting for threshold
  'confirmed',          -- Threshold met, card captured
  'cancelled',          -- Trip cancelled or guest cancelled
  'refunded'            -- Edge case: post-capture refund
);

CREATE TABLE bookings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Relationships
  trip_id           UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  captain_id        UUID NOT NULL REFERENCES captains(id),

  -- Guest identity (no account required — WhatsApp only)
  guest_whatsapp_id TEXT NOT NULL,                     -- Guest's WhatsApp phone number
  guest_name        TEXT,                              -- Optional, from WhatsApp profile

  -- Seat
  seat_number       INT,                               -- Assigned when authorized
  num_seats         INT NOT NULL DEFAULT 1 CHECK (num_seats >= 1),

  -- Pricing snapshot (locked at booking time)
  price_per_seat_aed    NUMERIC(10, 2) NOT NULL,
  total_amount_aed      NUMERIC(10, 2) NOT NULL,       -- price_per_seat * num_seats
  platform_fee_aed      NUMERIC(10, 2),                -- 10% of total (set at capture)
  captain_payout_aed    NUMERIC(10, 2),                -- 90% of total (set at capture)

  -- Payment state
  status            booking_status NOT NULL DEFAULT 'pending_payment',
  payment_link      TEXT,                              -- Stripe Payment Link URL (short-lived)

  -- Stripe
  stripe_customer_id    TEXT,                          -- cus_xxx (created on first booking)
  stripe_payment_intent_id TEXT,                       -- pi_xxx (the authorization hold)

  -- Timestamps
  payment_link_sent_at  TIMESTAMPTZ,
  authorized_at         TIMESTAMPTZ,
  confirmed_at          TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  cancellation_reason   TEXT,

  -- Constraints
  UNIQUE(trip_id, guest_whatsapp_id)                  -- One booking per guest per trip
);

CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes
CREATE INDEX idx_bookings_trip_status ON bookings(trip_id, status);
CREATE INDEX idx_bookings_guest ON bookings(guest_whatsapp_id);
CREATE INDEX idx_bookings_authorized_at ON bookings(authorized_at)
  WHERE status = 'authorized';

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
```

---

## Migration 005 — stripe_intents

```sql
-- Full history of all Stripe PaymentIntents (including re-authorizations)
CREATE TABLE stripe_intents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  booking_id        UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  trip_id           UUID NOT NULL REFERENCES trips(id),
  captain_id        UUID NOT NULL REFERENCES captains(id),

  -- Stripe data
  payment_intent_id     TEXT NOT NULL UNIQUE,          -- pi_xxx
  stripe_customer_id    TEXT,
  amount_aed            NUMERIC(10, 2) NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'aed',

  -- Lifecycle
  is_current            BOOLEAN NOT NULL DEFAULT true,  -- Only latest per booking is true
  stripe_status         TEXT NOT NULL,                  -- requires_capture, succeeded, canceled
  captured_at           TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  reauth_count          INT NOT NULL DEFAULT 0,

  -- Platform split (populated at capture)
  application_fee_amount NUMERIC(10, 2),               -- 10%
  transfer_amount        NUMERIC(10, 2)                 -- 90% to captain
);

CREATE INDEX idx_stripe_intents_booking ON stripe_intents(booking_id, is_current);

ALTER TABLE stripe_intents ENABLE ROW LEVEL SECURITY;
```

---

## Migration 006 — reauth_jobs

```sql
-- Track which bookings need re-authorization (scheduled by QStash)
CREATE TABLE reauth_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  booking_id        UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  scheduled_for     TIMESTAMPTZ NOT NULL,               -- When to trigger re-auth
  executed_at       TIMESTAMPTZ,
  is_complete       BOOLEAN NOT NULL DEFAULT false,
  attempt_count     INT NOT NULL DEFAULT 0,

  -- QStash job ID for cancellation if trip confirms before re-auth needed
  qstash_message_id TEXT
);

CREATE INDEX idx_reauth_jobs_scheduled ON reauth_jobs(scheduled_for, is_complete)
  WHERE is_complete = false;
```

---

## Migration 007 — notification_log

```sql
-- Audit trail of all WhatsApp messages sent
CREATE TABLE notification_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Target
  recipient_wa_id   TEXT NOT NULL,                     -- Phone number or group ID
  message_type      TEXT NOT NULL,                     -- template | text | interactive
  template_name     TEXT,
  direction         TEXT NOT NULL DEFAULT 'outbound',  -- outbound | inbound

  -- Context
  trip_id           UUID REFERENCES trips(id),
  booking_id        UUID REFERENCES bookings(id),
  captain_id        UUID REFERENCES captains(id),

  -- Result
  meta_message_id   TEXT,                              -- Message ID from Meta API response
  status            TEXT NOT NULL DEFAULT 'sent',      -- sent | delivered | read | failed
  error_message     TEXT
);

CREATE INDEX idx_notification_log_booking ON notification_log(booking_id);
CREATE INDEX idx_notification_log_trip ON notification_log(trip_id);
```

---

## RLS Policies (Summary)

All tables have RLS enabled. The backend uses the `service_role` key which bypasses RLS — RLS policies here are for any future client-side or dashboard access.

```sql
-- Captains can only see their own data
CREATE POLICY "captains_own_data" ON captains
  FOR ALL USING (whatsapp_id = current_setting('app.whatsapp_id', true));

CREATE POLICY "captains_own_trips" ON trips
  FOR ALL USING (
    captain_id IN (
      SELECT id FROM captains
      WHERE whatsapp_id = current_setting('app.whatsapp_id', true)
    )
  );

CREATE POLICY "captains_own_bookings" ON bookings
  FOR SELECT USING (
    captain_id IN (
      SELECT id FROM captains
      WHERE whatsapp_id = current_setting('app.whatsapp_id', true)
    )
  );
```

---

## Useful Queries

```sql
-- Trips within 12h of departure that haven't hit threshold
SELECT t.id, t.title, t.departure_at, t.threshold, t.current_bookings,
       t.current_bookings::float / t.threshold::float AS fill_rate
FROM trips t
WHERE t.status = 'open'
  AND t.departure_at BETWEEN now() AND now() + interval '12 hours'
  AND t.current_bookings < t.threshold;

-- All authorized bookings for a trip (ready to capture)
SELECT b.id, b.guest_whatsapp_id, b.total_amount_aed, si.payment_intent_id
FROM bookings b
JOIN stripe_intents si ON si.booking_id = b.id AND si.is_current = true
WHERE b.trip_id = $1
  AND b.status = 'authorized';

-- Captain revenue summary
SELECT
  c.display_name,
  COUNT(DISTINCT t.id) AS total_trips,
  COUNT(b.id) AS total_bookings,
  SUM(b.captain_payout_aed) AS total_payout_aed
FROM captains c
LEFT JOIN trips t ON t.captain_id = c.id
LEFT JOIN bookings b ON b.captain_id = c.id AND b.status = 'confirmed'
GROUP BY c.id, c.display_name;

-- Bookings needing re-authorization (6+ days since auth)
SELECT b.id, b.guest_whatsapp_id, b.total_amount_aed, b.authorized_at,
       si.payment_intent_id, c.stripe_account_id
FROM bookings b
JOIN stripe_intents si ON si.booking_id = b.id AND si.is_current = true
JOIN trips t ON t.id = b.trip_id
JOIN captains c ON c.id = b.captain_id
WHERE b.status = 'authorized'
  AND b.authorized_at < now() - interval '6 days'
  AND t.status = 'open';
```
