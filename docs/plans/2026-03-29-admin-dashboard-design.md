# WataSeat Admin Dashboard — Design Document

> Date: 2026-03-29
> Status: Approved

---

## Overview

A full-management admin dashboard for the WataSeat platform owner to process manual bank transfer payouts, track financials, manage captains/trips/bookings, and communicate with captains via WhatsApp.

## Architecture

### Tech Stack
- **Framework:** Next.js 14+ (App Router, Server Components, Server Actions)
- **UI:** Tailwind CSS + shadcn/ui
- **Database:** Supabase (same instance as the bot — direct access via service role key, server-side only)
- **WhatsApp:** Calls existing Express bot API for sending messages
- **Deployment:** Vercel (free tier)

### Auth
- Single admin user — hardcoded email/password in env vars (`ADMIN_EMAIL`, `ADMIN_PASSWORD`)
- Session stored in HTTP-only signed JWT cookie
- Middleware protects all routes except `/login`

### Data Access
- Server Components read directly from Supabase
- Server Actions for mutations (mark payout, cancel trip, etc.)
- No separate API layer

### Project Structure
```
admin/                    <- New Next.js app in same repo
├── app/
│   ├── layout.tsx        <- Root layout with sidebar nav
│   ├── page.tsx          <- Dashboard home (KPIs + recent activity)
│   ├── login/page.tsx    <- Login page
│   ├── payouts/          <- Payout queue + history
│   ├── finances/         <- Financial reports + charts
│   ├── captains/         <- Captain management
│   ├── trips/            <- Trip management
│   ├── bookings/         <- Booking management
│   └── settings/         <- Admin settings
├── components/           <- Shared UI components
├── lib/
│   ├── supabase.ts       <- Supabase server client
│   ├── auth.ts           <- Auth middleware + helpers
│   └── whatsapp.ts       <- Call Express API for WhatsApp sends
├── package.json
└── tailwind.config.ts
```

---

## Database Changes

New table required for payout tracking:

```sql
CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) NOT NULL,
  captain_id UUID REFERENCES captains(id) NOT NULL,
  gross_amount NUMERIC(10,2) NOT NULL,       -- Total collected from guests
  commission_amount NUMERIC(10,2) NOT NULL,   -- Platform 10% fee
  payout_amount NUMERIC(10,2) NOT NULL,       -- Amount to transfer to captain (90%)
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | processing | completed
  bank_reference TEXT,                         -- Bank transfer reference number
  processed_at TIMESTAMPTZ,
  whatsapp_notified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_payouts_status ON payouts(status);
CREATE INDEX idx_payouts_captain ON payouts(captain_id);
```

New columns on `captains` table:
- `bank_name TEXT` — Captain's bank name
- `iban TEXT` — Captain's IBAN for manual transfers
- `is_suspended BOOLEAN DEFAULT false` — Admin can suspend captains

New table for admin settings:
```sql
CREATE TABLE admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Defaults
INSERT INTO admin_settings (key, value) VALUES
  ('commission_percentage', '10'),
  ('admin_whatsapp_number', ''),
  ('payout_reminder_hours', '48');
```

---

## Features (20)

### Dashboard Home

**1. KPI Cards**
- Total revenue (gross), platform commission earned, pending payouts count + amount, active trips count
- Period comparison: vs. previous week/month (percentage change with up/down indicator)
- Data source: aggregate queries on `bookings`, `payouts`, `trips` tables

**2. Recent Activity Feed**
- Chronological feed of: new bookings, trip completions, payout requests, captain signups
- Last 50 events, auto-refreshed
- Data source: `notification_log` table + `bookings`/`trips` recent records

**3. Alerts Panel**
- Trips within 24h of departure that haven't hit threshold
- Pending payouts older than 48h (configurable in settings)
- Captains with incomplete onboarding (stuck in wizard)
- Each alert links to the relevant detail page

### Payout Management

**4. Payout Queue**
- Table of completed trips awaiting payout (status = `pending`)
- Columns: trip name, captain name, date, gross amount, commission, payout amount, captain IBAN
- Sorted by oldest first (most urgent)
- Quick-action button: "Mark as Paid"

**5. Mark Payout Processed**
- Modal: enter bank transfer reference number, confirm amount
- On confirm: updates `payouts.status` to `completed`, sets `processed_at`, stores `bank_reference`
- Auto-sends WhatsApp template message to captain: "Your payout of AED {amount} for trip {trip_name} has been processed. Bank ref: {reference}"

**6. Payout History**
- Searchable/filterable table of all completed payouts
- Filters: date range, captain, amount range
- Columns: date processed, captain, trip, amount, bank reference, WhatsApp notified status

**7. Captain Bank Details View**
- Inline display of captain's IBAN and bank name on payout queue rows
- Also visible on captain detail page
- Captains provide bank details during onboarding (new onboarding step) or admin enters manually

### Financial Reports

**8. Revenue Dashboard**
- Line/bar charts: gross revenue, platform commission, captain payouts over time
- Toggle: daily / weekly / monthly granularity
- Date range picker for custom periods
- Summary cards: total for selected period

**9. Per-Trip Financial Drill-Down**
- Click any trip to see: total collected, number of bookings, commission earned, captain payout, payout status
- Breakdown per guest: amount authorized, captured/cancelled, refunded
- Timeline of financial events for the trip

**10. Export to CSV**
- Export button on financial reports and payout history
- Exports filtered data to CSV with all columns
- Date range selection for export scope

### Captain Management

**11. Captain List**
- Table: name, boat name, status (active/onboarding/suspended), total trips, total revenue, Stripe Connect status
- Filters: status, onboarding step, has bank details
- Search by name or phone number

**12. Captain Detail Page**
- Profile info: name, boat name, license, WhatsApp number, onboarding step
- Stripe Connect status: charges enabled, payouts enabled, account ID
- Bank details: IBAN, bank name (editable by admin)
- Trip history with financials
- Payout history
- Lifetime stats: total trips, total revenue, total commission paid

**13. Send WhatsApp to Captain**
- Quick-send button on captain detail page
- Uses WhatsApp template message (for out-of-24h-window sends)
- Calls Express bot API: `POST /api/admin/send-whatsapp`

**14. Suspend/Reactivate Captain**
- Toggle button on captain detail page
- Sets `captains.is_suspended = true/false`
- Suspended captains cannot create new trips (bot checks this flag)
- Optional: send WhatsApp notification on suspend/reactivate

### Trip Management

**15. Trip List**
- Table: trip name/type, captain, date, status, fill rate (current/max), threshold, financial summary
- Filters: status (open/confirmed/cancelled/completed), captain, date range
- Search by trip short ID

**16. Trip Detail Page**
- Full trip info: type, date, duration, meeting point, price, threshold, max seats
- Guest list: name, WhatsApp number, booking status, payment status, amount
- Event timeline: created, announced, bookings, threshold met/missed, completed
- Financial summary: gross, commission, payout status

**17. Admin Cancel Trip**
- Button on trip detail page with confirmation modal
- Triggers `cancelAllForTrip()` — cancels all payment holds
- Sends WhatsApp cancellation notifications to all booked guests and captain
- Calls Express bot API for the cancellation flow

### Booking Management

**18. Booking List**
- Table: guest name/number, trip, status, amount, payment status, booked at
- Filters: status (pending/authorized/confirmed/cancelled/refunded), trip, date range
- Links to trip detail and guest WhatsApp number

**19. Refund Booking**
- Button on individual booking row
- Cancels the Stripe PaymentIntent (releases hold or refunds capture)
- Updates booking status
- Sends WhatsApp notification to guest confirming refund

### Settings

**20. Admin Settings**
- Platform commission percentage (default 10%)
- Admin WhatsApp number (for error notifications)
- Payout reminder threshold (hours before alert, default 48)
- Editable via simple form, stored in `admin_settings` table

---

## WhatsApp Integration

The admin dashboard communicates with captains/guests via the existing Express bot:

**New Express endpoint needed:**
```
POST /api/admin/send-whatsapp
Headers: X-Admin-Secret: {ADMIN_API_SECRET}
Body: { to: string, templateName: string, templateParams: object }
```

**Templates needed (submit to Meta):**
- `payout_processed` — "Your payout of AED {{amount}} for {{trip_name}} has been processed. Bank ref: {{reference}}"
- `captain_suspended` — "Your WataSeat captain account has been suspended. Contact support for details."
- `booking_refunded` — "Your booking for {{trip_name}} has been refunded. The hold on your card will be released."
- `admin_message` — Generic admin-to-captain template

---

## New Environment Variables

```
# Admin Dashboard
ADMIN_EMAIL=mo@wataseat.com
ADMIN_PASSWORD=<strong-password>
ADMIN_JWT_SECRET=<random-secret>
ADMIN_API_SECRET=<shared-secret-for-express-api>
NEXT_PUBLIC_APP_URL=https://admin.wataseat.com
EXPRESS_BOT_URL=https://bot.wataseat.com
```

---

## Payout Flow

1. Trip completes (all guests' payments captured after threshold met)
2. System auto-creates a `payouts` record with status `pending`
3. Admin sees payout in queue on dashboard
4. Admin views captain's IBAN, opens bank app, transfers money manually
5. Admin returns to dashboard, clicks "Mark as Paid", enters bank reference
6. System updates payout status to `completed`, sends WhatsApp to captain
7. Payout appears in history with full audit trail
