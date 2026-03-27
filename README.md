# WataSeat

WhatsApp-native group booking platform for boat captains. Guests book seats, pay via Apple Pay (Stripe), and are only charged when a minimum passenger threshold is met. 10% platform commission captured automatically.

## Tech Stack

- **Runtime:** Node.js 20 + TypeScript
- **Framework:** Express.js
- **WhatsApp:** Meta Cloud API (official)
- **Payments:** Stripe Connect (Standard) with authorization holds
- **Database:** Supabase (PostgreSQL)
- **Cache/Queue:** Upstash Redis
- **Hosting:** Railway

## Local Setup

```bash
# 1. Clone
git clone https://github.com/mhdhar/wataseat.git
cd wataseat

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Fill in all values in .env (see docs/REQUIREMENTS.md for where to get each key)

# 4. Run database migrations
npx tsx supabase/migrations/run_migrations.ts

# 5. Start dev server
npm run dev
```

## Webhook Testing with ngrok

```bash
# Start ngrok tunnel
ngrok http 3000

# Copy the https:// URL, then:
# 1. Meta Developer Console → WhatsApp → Configuration → Webhook → paste URL + /webhooks/whatsapp
# 2. Stripe Dashboard → Developers → Webhooks → Add endpoint → paste URL + /webhooks/stripe
```

## Adding the Bot to a WhatsApp Group

1. Save the bot's phone number as a contact
2. Open your WhatsApp group → Group Info → Add Participant → select the bot
3. Type `/help` in the group to see available commands

## Bot Commands

| Command | Who | What it does |
|---------|-----|-------------|
| `/help` | Anyone | Show available commands |
| `/trip` | Captain | Start trip creation wizard |
| `/trips` | Captain | View upcoming trips |
| `/status [ID]` | Captain | Check trip bookings |
| `/cancel [ID]` | Captain | Cancel a trip |
| `/connect` | Captain | Set up Stripe account |

## How It Works

1. **Captain** adds bot to group, completes onboarding, connects Stripe
2. **Captain** types `/trip` → bot DMs a wizard to collect trip details
3. Bot posts **trip card** with "Book My Seat" button to the group
4. **Guest** taps button → receives payment link via **private DM**
5. Guest pays (Apple Pay / Google Pay) → card is **held, not charged**
6. When minimum threshold is met → all cards **captured**, 10% fee deducted, 90% to captain
7. If threshold not met by 12h before departure → all holds **released**, no charges

## Deploy to Railway

```bash
# Connect GitHub repo in Railway dashboard
# Set all env vars from .env in Railway environment settings
# Railway auto-deploys on push to main
```

## Project Documentation

See `docs/` for detailed specifications:
- `ARCHITECTURE.md` — System design and service map
- `DATABASE_SCHEMA.md` — All 7 tables with migrations
- `STRIPE_FLOW.md` — Payment authorization and capture flow
- `WHATSAPP_SETUP.md` — Meta console setup and message templates
- `API_SPEC.md` — Webhook contracts and command specs
- `ROADMAP.md` — 8-phase build plan
