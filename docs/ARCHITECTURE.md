# ARCHITECTURE.md — WataSeat

> Technical architecture, service map, and key design decisions.

---

## Stack Decision Record

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 + TypeScript | Matches SSS stack, best WhatsApp SDK support |
| Framework | Express.js | Lightweight, perfect for webhook server |
| WhatsApp API | Meta Cloud API (official) | Free, scalable, no policy risk |
| Payments | Stripe + Stripe Connect | Best-in-class authorization holds + Connect payouts |
| Database | Supabase (PostgreSQL) | Matches SSS stack, real-time, RLS built-in |
| Job Queue | Upstash QStash | Serverless cron, handles 6-day re-auth + 12h threshold check |
| Cache | Upstash Redis | Rate limiting, session state, dedup |
| Hosting | Railway | One-click GitHub deploy, auto HTTPS, cheap |
| Tunnel (dev) | ngrok | Expose localhost to Meta webhook |
| Monitoring | Railway logs + Supabase logs | Sufficient for MVP |

---

## Service Map

```
WhatsApp Group
     │
     │  (user messages / button taps)
     ▼
Meta Cloud API  ──────────────────────────────────────────────────────────
     │                                                                    │
     │  POST /webhooks/whatsapp                                           │
     ▼                                                                    │
WataSeat Backend (Express on Railway)                                     │
     │                                                                    │
     ├── Command Parser                                                   │
     │     └── /trip  /status  /cancel  /trips  /help                    │
     │                                                                    │
     ├── Trip Manager                                                     │
     │     └── Create, update, cancel trips in Supabase                  │
     │                                                                    │
     ├── Booking Manager                                                  │
     │     └── Seat allocation, waitlist logic                            │
     │                                                                    │
     ├── Stripe Service                                                   │
     │     └── Create PaymentIntent (auth hold)                          │
     │     └── Capture PaymentIntent (on threshold)                      │
     │     └── Cancel PaymentIntent (on trip cancel)                     │
     │     └── Create Connect onboarding links                           │
     │                                                                    │
     ├── Notification Service                                             │
     │     └── Send WhatsApp messages back to group + DMs                │
     │                                                                    │
     └── Webhook Handler (Stripe events)                                  │
           └── POST /webhooks/stripe                                      │
                                                                          │
Upstash QStash (cron jobs)  ──────────────────────────────────────────────
     │
     ├── Every 6 days: Re-authorize all pending Stripe holds
     └── Every hour: Check if any trip is 12h from departure
           └── If threshold not met → cancel trip, release all holds
           └── If threshold met → capture all holds, trigger payouts

Supabase (PostgreSQL)
     ├── captains
     ├── trips
     ├── bookings
     ├── stripe_intents
     └── whatsapp_groups

Stripe
     ├── PaymentIntents (hold → capture or cancel)
     ├── Connect accounts (captain payout accounts)
     └── Platform account (receives 10%, routes 90%)
```

---

## Key Design Decisions

### 1. Meta Cloud API, not Baileys

Meta Cloud API is the official WhatsApp Business API. It runs on Meta's servers, requires a registered phone number, and sends/receives messages via webhook HTTP calls. Baileys is an unofficial client that reverse-engineers the WhatsApp protocol — it violates WhatsApp ToS and risks permanent bans. We use the official API exclusively.

**Trade-off**: Meta Cloud API requires pre-approved message templates for outbound messages to users who haven't contacted the bot in 24 hours. All booking confirmations and notifications will be submitted as templates. This is a one-time setup, not an ongoing constraint.

### 2. Group Bot vs Individual Bot

The bot is added to existing WhatsApp groups as a participant (via phone number). It listens to all messages in the group and responds only when:
- A message starts with `/` (command)
- A button in an interactive message is tapped
- The bot is directly mentioned via `@WataSeat`

This means the bot doesn't need to create groups — it joins existing ones the captain invites it to.

### 3. Payment Link in DM, not in Group

When a guest taps "Book Now" in the group, the bot sends them a **private DM** with their unique Stripe Payment Link. This keeps payment details out of the group chat and prevents social pressure around who has/hasn't paid. The link is personalized (`?session=BOOKING_ID`) so we can match the payment back to the booking.

### 4. Stripe Authorization Hold (not immediate charge)

When the guest completes the Stripe checkout:
- We create a `PaymentIntent` with `capture_method: 'manual'`
- Stripe authorizes (holds) the full amount without charging
- The guest sees a pending hold on their card but no charge
- We store the `PaymentIntent` ID in Supabase against the booking
- If threshold is met: we call `paymentIntent.capture()` → guest is charged
- If trip cancelled: we call `paymentIntent.cancel()` → hold released, no charge

### 5. 6-Day Re-authorization via QStash

Stripe authorization holds expire after 7 days. We re-authorize every 6 days using a QStash scheduled job. The job:
1. Queries Supabase for all `pending` bookings where the `authorized_at` date is 6+ days ago
2. Creates a new `PaymentIntent` for each (which automatically cancels the old one)
3. Sends the guest a new payment link via WhatsApp DM to complete the re-authorization

This is transparent to the guest — they just tap a new link and Face ID again.

### 6. Captain Dashboard = WhatsApp Commands

At MVP, the captain's entire management experience is WhatsApp-native:

| Command | What it does |
|---|---|
| `/trip` | Start trip creation wizard (bot asks questions one by one) |
| `/trips` | List all upcoming trips with booking counts |
| `/status [trip_id]` | See full details + booking list for one trip |
| `/cancel [trip_id]` | Cancel trip (releases all holds, notifies guests) |
| `/connect` | Get Stripe Connect onboarding link (first-time setup) |
| `/help` | Show all commands |

No web dashboard at MVP. This is intentional — it reduces build time by ~3 weeks and is sufficient for captains who live in WhatsApp.

### 7. Captain Onboarding Flow

New captains onboard via a WhatsApp conversation with the bot (1:1, not in a group):
1. Captain sends any message to the bot number
2. Bot asks for: name, boat name, UAE maritime license number, trip types offered
3. Bot sends Stripe Connect onboarding link
4. Captain completes Stripe KYC and bank account connection
5. Bot confirms: "You're live! Add me to your WhatsApp group with `/start`"

### 8. Multi-group Support

One captain can add the bot to multiple groups (e.g., one for divers, one for fishers). The bot tracks which group ID a trip was posted to and routes notifications back to the correct group. Group IDs are stored in Supabase against each captain account.

---

## Data Flow — Booking a Seat

```
1. Captain posts trip in group
   └── Captain types: /trip
   └── Bot DMs captain a step-by-step wizard
   └── Captain answers: date, type, seats (max), threshold (min), price/person
   └── Bot creates Trip record in Supabase (status: OPEN)
   └── Bot posts Trip Card in group (interactive message with "Book Now" button)

2. Guest taps "Book Now"
   └── Bot reads guest's WhatsApp ID
   └── Bot creates Booking record in Supabase (status: PENDING_PAYMENT)
   └── Bot creates Stripe Payment Link (personalized with booking_id)
   └── Bot DMs guest the payment link (template message)

3. Guest completes payment (Apple Pay / Google Pay)
   └── Stripe creates PaymentIntent (capture_method: manual)
   └── Stripe webhook fires: payment_intent.created → status: authorized
   └── Backend updates Booking to status: AUTHORIZED
   └── Backend updates Trip: current_bookings += 1
   └── Bot DMs guest: "You're booked! Seat 3 of 6 on [Trip]"
   └── Bot posts in group: "3/6 seats booked — 3 more needed"

4a. Threshold reached
    └── current_bookings >= threshold
    └── QStash job or real-time check triggers
    └── Backend captures all pending PaymentIntents for this trip
    └── Stripe deducts 10% platform fee, routes 90% to captain's Connect account
    └── All bookings updated to status: CONFIRMED
    └── Bot posts in group: "✅ Trip confirmed! All 6 seats filled. See you [date]!"
    └── Bot DMs each guest: booking confirmation with trip details

4b. Threshold not reached (12h before departure)
    └── QStash checks: trip.departure - now <= 12h
    └── trip.current_bookings < trip.threshold
    └── Backend cancels all PaymentIntents for this trip
    └── All bookings updated to status: CANCELLED
    └── Trip updated to status: CANCELLED
    └── Bot posts in group: "❌ Trip cancelled — minimum not reached. No charges made."
    └── Bot DMs each guest who booked: "Your hold has been released. No charge."
```

---

## File Structure

```
wataseat/
├── src/
│   ├── server.ts                 # Express app entry point
│   ├── routes/
│   │   ├── whatsapp.ts           # POST /webhooks/whatsapp
│   │   └── stripe.ts             # POST /webhooks/stripe
│   ├── handlers/
│   │   ├── commandHandler.ts     # Parse /commands from WhatsApp messages
│   │   ├── buttonHandler.ts      # Handle interactive button taps
│   │   └── onboardingHandler.ts  # Captain onboarding conversation flow
│   ├── services/
│   │   ├── whatsapp.ts           # Meta Cloud API calls (send messages, templates)
│   │   ├── stripe.ts             # PaymentIntent create/capture/cancel
│   │   ├── stripeConnect.ts      # Connect account onboarding
│   │   ├── trips.ts              # Trip CRUD
│   │   ├── bookings.ts           # Booking CRUD + seat counting
│   │   └── notifications.ts      # Message assembly + dispatch
│   ├── jobs/
│   │   ├── thresholdCheck.ts     # 12h-before check
│   │   └── reauthorize.ts        # 6-day re-auth job
│   ├── db/
│   │   └── supabase.ts           # Supabase client
│   ├── types/
│   │   └── index.ts              # Shared TypeScript types
│   └── utils/
│       ├── logger.ts             # Pino logger
│       └── crypto.ts             # Webhook signature verification
├── supabase/
│   └── migrations/               # SQL migration files
├── .env                          # Local env (gitignored)
├── .env.example                  # Template (committed)
├── package.json
├── tsconfig.json
├── CLAUDE.md                     # Claude Code project instructions
└── README.md
```

---

## Security Considerations

- All webhook endpoints verify signatures (Meta `X-Hub-Signature-256`, Stripe `Stripe-Signature`)
- `SUPABASE_SERVICE_ROLE_KEY` never exposed to client
- Stripe `PaymentIntent` IDs stored server-side only — payment link uses a booking UUID, not the PI ID
- RLS enabled on all Supabase tables — captains can only read their own trips and bookings
- ngrok tunnel used only in development — Railway HTTPS in production
- All env vars in Railway environment, never committed to git
