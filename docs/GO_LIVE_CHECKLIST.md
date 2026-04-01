# WataSeat Go-Live Checklist

## Context
Moving from dev/testing to production on `wataseat.com`. The code is production-ready — changes are configuration, credentials, and platform setup.

---

## Step-by-Step (in order)

### 1. Get a server (Railway or Render)
- Create account on [railway.app](https://railway.app) → connect your GitHub repo `mhdhar/wataseat`
- Railway auto-detects Node.js, runs `npm run build` then `npm start`
- Every push to `main` auto-deploys

### 2. Buy & connect domain `wataseat.com`
- Buy from Namecheap, Cloudflare, or any registrar
- In Railway: Settings → Domains → Add `wataseat.com`
- Railway gives you a CNAME record → add it in your domain's DNS settings
- SSL is automatic (Railway handles HTTPS)

### 3. Set all environment variables in Railway
- Copy your `.env` values into Railway's Variables tab
- **Change these specifically:**
  - `APP_URL=https://wataseat.com`
  - `NODE_ENV=production`
  - `SESSION_COOKIE_SECRET=` → generate a strong random string (64+ chars)
  - Remove `NGROK_AUTHTOKEN` (not needed)

### 4. Switch Stripe to live mode
- Go to [Stripe Dashboard](https://dashboard.stripe.com) → toggle off "Test mode" (top-right)
- Copy your **live** keys from Developers → API Keys:
  - `STRIPE_SECRET_KEY=sk_live_...`
  - `STRIPE_PUBLISHABLE_KEY=pk_live_...`
- Update these in Railway env vars

### 5. Create Stripe live webhook
- Stripe Dashboard → Developers → Webhooks → Add endpoint
- URL: `https://wataseat.com/webhooks/stripe`
- Events to listen for: `checkout.session.completed`, `account.updated`, `payment_intent.amount_capturable_updated`, `payment_intent.payment_failed`, `payment_intent.canceled`
- Copy the new webhook signing secret → set `STRIPE_WEBHOOK_SECRET=whsec_...` in Railway

### 6. Update Meta WhatsApp webhook URL
- Go to [Meta Developers Console](https://developers.facebook.com) → your app → WhatsApp → Configuration
- Change webhook callback URL from ngrok to: `https://wataseat.com/webhooks/whatsapp`
- Verify token stays the same (`wataseat_verify_2026`)
- Make sure these events are subscribed: `messages`, `message_deliveries`

### 7. Submit WhatsApp message templates to Meta
- Meta Developers Console → WhatsApp → Message Templates
- You need approved templates to message users outside the 24h window (e.g., threshold confirmations, trip reminders)
- Key templates to create: trip confirmation, payment captured, trip cancelled, booking reminder
- Approval takes 1-24 hours typically

### 8. Verify WhatsApp Business profile
- In Meta Business Suite → WhatsApp Manager → Phone Numbers
- Make sure your business is verified (green checkmark)
- Add display name, profile picture, business description
- Without verification you're limited to 250 messages/day

### 9. Verify Stripe Connect onboarding works in live mode
- Your first captain will go through real KYC (ID, bank account)
- Test the onboarding link flow: captain messages bot → gets Stripe Connect link → completes real verification
- Check `STRIPE_PLATFORM_ACCOUNT_ID` is your live platform account

### 10. Run database migrations on production Supabase
- Your Supabase instance is already production (`zzczwqbnvfeyqmozwdsg`)
- Verify all migrations are applied: `npx tsx supabase/migrations/run_migrations.ts`
- Enable Supabase backups: Dashboard → Settings → Database → enable daily backups

### 11. Set `ADMIN_API_SECRET` to a strong value
- Generate a 32+ char random string for admin API authentication
- Set in Railway env vars

### 12. Test end-to-end on production
- Onboard a captain (real Stripe Connect)
- Captain creates a trip
- Book seats (real payment — use a small amount like AED 1)
- Verify threshold check captures payment
- Verify guest + captain get correct WhatsApp messages
- Cancel and verify refund works

### 13. Set up monitoring (optional but recommended)
- Railway has built-in logs (good enough to start)
- `/health` endpoint exists — set up an uptime monitor (e.g., UptimeRobot, free tier)
- Set `TEST_WHATSAPP_NUMBER` to your personal number for error alerts

---

## What you do NOT need to change
- WhatsApp phone number ID & business account ID — already production
- WhatsApp access token — already a permanent system user token
- Supabase & Redis — already production instances
- Any application code — it's production-ready
