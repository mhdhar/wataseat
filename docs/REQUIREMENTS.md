# REQUIREMENTS.md — WataSeat

> Fill in every `YOUR_*` placeholder below before starting the build. Claude Code will copy values into the environment during setup.

---

## 1. Environment Variables

Paste your values into the `.env` file at the project root. Claude Code will read from here during development and Railway will read from its own env config in production.

```env
# ── WhatsApp / Meta Cloud API ──────────────────────────────────────────────
WHATSAPP_PHONE_NUMBER_ID=YOUR_WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_BUSINESS_ACCOUNT_ID=YOUR_WHATSAPP_BUSINESS_ACCOUNT_ID
WHATSAPP_ACCESS_TOKEN=YOUR_PERMANENT_WHATSAPP_ACCESS_TOKEN
WHATSAPP_WEBHOOK_VERIFY_TOKEN=YOUR_CUSTOM_WEBHOOK_VERIFY_TOKEN   # any random string you choose
META_APP_SECRET=YOUR_META_APP_SECRET

# ── Stripe ──────────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_test_YOUR_STRIPE_SECRET_KEY
STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET=whsec_YOUR_STRIPE_WEBHOOK_SECRET
STRIPE_PLATFORM_ACCOUNT_ID=acct_YOUR_STRIPE_PLATFORM_ACCOUNT_ID

# ── Supabase ────────────────────────────────────────────────────────────────
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
SUPABASE_PROJECT_REF=YOUR_PROJECT_REF
SUPABASE_DB_PASSWORD=YOUR_DATABASE_PASSWORD

# ── Upstash Redis (job queue + re-auth cron) ────────────────────────────────
UPSTASH_REDIS_REST_URL=https://YOUR_UPSTASH_REDIS_URL.upstash.io
UPSTASH_REDIS_REST_TOKEN=YOUR_UPSTASH_REDIS_TOKEN

# ── Railway (deployment) ────────────────────────────────────────────────────
RAILWAY_TOKEN=YOUR_RAILWAY_TOKEN

# ── ngrok (local webhook tunnel during development) ─────────────────────────
NGROK_AUTHTOKEN=YOUR_NGROK_AUTHTOKEN

# ── App config ──────────────────────────────────────────────────────────────
NODE_ENV=development
PORT=3000
APP_URL=https://YOUR_NGROK_OR_RAILWAY_URL
PLATFORM_COMMISSION_RATE=0.10
THRESHOLD_CHECK_HOURS_BEFORE=12
STRIPE_AUTH_REAUTH_DAYS=6
```

---

## 2. Where to Get Each Key

| Variable | Source | Notes |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Meta Developer Console → App → WhatsApp → API Setup | After phone number registration |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta Developer Console → App → WhatsApp → API Setup | Same page as above |
| `WHATSAPP_ACCESS_TOKEN` | Meta Developer Console → System User token (permanent) | Use System User, not temporary token |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | You create this | Any random string, used to verify webhook |
| `META_APP_SECRET` | Meta Developer Console → App Settings → Basic | Used to verify webhook signatures |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API Keys | Start with `sk_test_` |
| `STRIPE_PUBLISHABLE_KEY` | Same page as secret key | Starts with `pk_test_` |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Developers → Webhooks → Add endpoint | After creating webhook endpoint |
| `STRIPE_PLATFORM_ACCOUNT_ID` | Stripe Dashboard → Account settings | Your own Stripe account ID, starts with `acct_` |
| `SUPABASE_URL` | Supabase Dashboard → Project Settings → API | |
| `SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API | |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API | Never expose in frontend |
| `SUPABASE_PROJECT_REF` | Supabase Dashboard → Project Settings → General | The short ID in your project URL |
| `UPSTASH_REDIS_REST_URL` | Upstash Console → Redis database → REST API | |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Console → Redis database → REST API | |
| `RAILWAY_TOKEN` | Railway Dashboard → Account → Tokens | |
| `NGROK_AUTHTOKEN` | ngrok.com → Dashboard → Your Authtoken | Free tier works for dev |

---

## 3. External Accounts to Create Before Starting

- [ ] **Meta Developer Account** — developers.facebook.com
- [ ] **Meta App** — Create a new App, select "Business" type, add WhatsApp product
- [ ] **WhatsApp Business phone number** — Register a new number in Meta App (can use virtual number for testing)
- [ ] **Stripe account** — stripe.com (UAE supported, use business account)
- [ ] **Stripe Connect** — Enable in Stripe Dashboard → Connect settings (Standard Connect)
- [ ] **Supabase project** — supabase.com → New project → Select Frankfurt or closest EU region
- [ ] **Upstash account** — upstash.com → Create Redis database (Global, free tier works for dev)
- [ ] **Railway account** — railway.app → Link GitHub account
- [ ] **ngrok account** — ngrok.com → Free tier for local dev tunnel
- [ ] **GitHub repo** — Create `wataseat` repo under `mhdhar`

---

## 4. MCPs — Install All Before Starting

Run these commands in your terminal (not inside Claude Code) to install all MCPs globally.

### 4.1 Supabase MCP (Official)
```bash
claude mcp add --transport http supabase https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF
```
> Triggers browser OAuth on first use. Replace `YOUR_PROJECT_REF` with your actual project ref.

### 4.2 Stripe MCP (Official)
```bash
claude mcp add --transport http stripe https://mcp.stripe.com/mcp
```
> Triggers OAuth on first use via Stripe Dashboard.

### 4.3 GitHub MCP (Official)
```bash
claude mcp add --transport http github https://api.githubcopilot.com/mcp \
  -H "Authorization: Bearer YOUR_GITHUB_PAT"
```
> Replace `YOUR_GITHUB_PAT` with a GitHub Personal Access Token (classic, repo + workflow scopes).

### 4.4 Upstash MCP (Redis management)
```bash
claude mcp add upstash --scope project -- npx -y @upstash/mcp-server@latest \
  --email YOUR_UPSTASH_EMAIL \
  --api-key YOUR_UPSTASH_API_KEY
```

### 4.5 Context7 MCP (Up-to-date library docs — prevents hallucinated APIs)
```bash
claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp --api-key YOUR_CONTEXT7_API_KEY
```
> Get free API key at context7.com/dashboard

### 4.6 Verify all MCPs are loaded
```bash
claude mcp list
```
You should see: `supabase`, `stripe`, `github`, `upstash`, `context7` all listed as active.

---

## 5. Claude Code Plugins — Install Before Starting

Run inside Claude Code terminal:

```bash
# Stripe integration best practices and API upgrade guidance
claude /plugin install stripe@claude-plugins-official
```

---

## 6. Claude Code Skills — Pre-installed in This Project

The following skills are used by Claude Code during this build. They live in `.claude/skills/` and are auto-loaded.

| Skill | Purpose |
|---|---|
| `frontend-design` | Any UI components (captain onboarding web page, payment link page) |
| `docx` | Generating captain onboarding guides as Word docs |
| `pdf` | Generating receipts and booking confirmations as PDFs |
| `mcp-builder` | If we need to extend any MCP server for WhatsApp-specific tools |
| `doc-coauthoring` | Iterative document drafting during planning phases |

---

## 7. npm Dependencies (Pre-install Checklist)

Claude Code will install these during Phase 1 setup. Listed here for awareness.

```bash
# Core framework
npm install express dotenv cors helmet

# WhatsApp Cloud API SDK
npm install @whiskeysockets/baileys   # for group bot behavior (unofficial, more control)
# OR use direct Meta API calls with:
npm install axios                      # HTTP client for Meta API calls

# Stripe
npm install stripe @stripe/stripe-js

# Supabase
npm install @supabase/supabase-js

# Upstash (Redis + QStash for cron jobs)
npm install @upstash/redis @upstash/qstash

# Validation
npm install zod

# Scheduled jobs
npm install node-cron

# Logging
npm install pino pino-pretty

# TypeScript
npm install -D typescript ts-node @types/node @types/express tsx

# Dev tools
npm install -D nodemon
```

---

## 8. Meta WhatsApp — Message Templates Required

These templates must be pre-approved by Meta before going live. Submit them in Meta Developer Console → WhatsApp → Message Templates. Approval typically takes 24–48 hours.

| Template Name | Category | Purpose |
|---|---|---|
| `trip_posted` | UTILITY | Notify group a new trip is available |
| `booking_confirmed` | UTILITY | Guest confirms seat + card authorized |
| `threshold_reached` | UTILITY | Notify all guests trip is confirmed + charged |
| `threshold_failed` | UTILITY | Notify guests trip cancelled, hold released |
| `reauth_notice` | UTILITY | Warn guest card will be re-authorized |
| `captain_summary` | UTILITY | Daily captain summary of upcoming trips |
| `payment_link` | UTILITY | Send Stripe link to guest DM |

---

## 9. Stripe Configuration Checklist

- [ ] Enable **Stripe Connect** in Dashboard → Connect settings
- [ ] Set Connect type to **Standard** (captains connect their own accounts)
- [ ] Enable **Apple Pay** and **Google Pay** in Dashboard → Payment methods
- [ ] Create webhook endpoint pointing to `YOUR_URL/webhooks/stripe`
- [ ] Subscribe webhook to events:
  - `payment_intent.created`
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `payment_intent.canceled`
  - `account.updated` (for Connect onboarding status)

---

## 10. One-Command Pre-flight Script

Save as `setup.sh` in project root and run once after cloning the repo:

```bash
#!/bin/bash
echo "🚢 WataSeat — Pre-flight setup"

# Install dependencies
npm install

# Add all MCPs (requires manual token input)
echo "Adding Supabase MCP..."
claude mcp add --transport http supabase "https://mcp.supabase.com/mcp?project_ref=$(grep SUPABASE_PROJECT_REF .env | cut -d= -f2)"

echo "Adding Context7 MCP..."
claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp --api-key $(grep CONTEXT7_API_KEY .env | cut -d= -f2)

echo "Adding GitHub MCP..."
claude mcp add --transport http github https://api.githubcopilot.com/mcp \
  -H "Authorization: Bearer $(grep GITHUB_PAT .env | cut -d= -f2)"

echo "Adding Upstash MCP..."
claude mcp add upstash --scope project -- npx -y @upstash/mcp-server@latest \
  --email $(grep UPSTASH_EMAIL .env | cut -d= -f2) \
  --api-key $(grep UPSTASH_API_KEY .env | cut -d= -f2)

# Install Stripe Claude plugin
echo "Installing Stripe Claude plugin..."
claude /plugin install stripe@claude-plugins-official

echo "✅ Pre-flight complete. Run: npm run dev"
```
