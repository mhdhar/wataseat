# Migration Plan: wataseat.com on Vercel

## Architecture
- Single Vercel project at `wataseat.com`
- Express backend as Vercel serverless function (API routes)
- Landing page at `/` (static HTML, bilingual AR+EN)
- Booking pages at `/book/:shortId` (served by Express)
- Admin dashboard at `/admin` (Next.js)
- Webhooks at `/webhooks/stripe` and `/webhooks/whatsapp`
- Cron jobs via Vercel Cron triggering API endpoints

---

## Part A: Code Changes (Claude does this)

### A1. Create `vercel.json` routing config
- Route `/admin/*` to Next.js admin app
- Route `/webhooks/*`, `/book/*`, `/api/*`, `/health` to Express serverless function
- Route `/` to static landing page
- Configure Vercel Cron for 3 jobs

### A2. Convert Express for Vercel serverless
- Export Express app as serverless handler in `api/index.ts`
- Add cron API endpoints:
  - `GET /api/cron/threshold` (hourly)
  - `GET /api/cron/reauth` (daily 2am UTC)
  - `GET /api/cron/summary` (daily 4am UTC)
- Protect cron endpoints with `CRON_SECRET` env var

### A3. Create bilingual landing page
- Static HTML at `public/index.html`
- English + Arabic (RTL) sections
- Captain instructions: how to use the bot
- Guest instructions: how booking works
- Mobile-first, matches booking page design

### A4. Merge admin dashboard
- Move admin Next.js into Vercel monorepo structure
- Update `EXPRESS_BOT_URL` to use relative paths or same domain

### A5. Production hardening
- Restrict CORS to `https://wataseat.com`
- Update CSP for production domain
- Set `NODE_ENV=production` handling
- Standardize all localhost fallbacks to `https://wataseat.com`

### A6. Update documentation
- Update CLAUDE.md with deployment info
- Update docs/GO_LIVE_CHECKLIST.md
- Update .env.example

---

## Part B: Platform Config (Mo does this)

### B1. Vercel Setup
1. Go to vercel.com -> New Project -> Import `mhdhar/wataseat` from GitHub
2. Framework: Other (we handle routing via vercel.json)
3. Add environment variables (copy from .env):
   - `APP_URL=https://wataseat.com`
   - `NODE_ENV=production`
   - `STRIPE_SECRET_KEY` (keep test key until ready for live)
   - `STRIPE_PUBLISHABLE_KEY`
   - `STRIPE_WEBHOOK_SECRET` (will update after B3)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
   - `META_APP_SECRET`
   - `SESSION_COOKIE_SECRET` (generate strong 64+ char random string)
   - `ADMIN_API_SECRET`
   - `ADMIN_JWT_SECRET` (generate strong random string)
   - `CRON_SECRET` (generate random string for cron auth)
   - `PLATFORM_COMMISSION_RATE=0.10`
   - `STRIPE_AUTH_REAUTH_DAYS=6`
   - `THRESHOLD_CHECK_HOURS_BEFORE=12`

### B2. Cloudflare DNS
1. Go to Cloudflare -> wataseat.com -> DNS
2. Add CNAME record: `@` -> `cname.vercel-dns.com` (proxy OFF / DNS only)
3. Add CNAME record: `www` -> `cname.vercel-dns.com` (proxy OFF / DNS only)
4. In Vercel: Settings -> Domains -> Add `wataseat.com` and `www.wataseat.com`
5. Vercel auto-provisions SSL

**Important:** Cloudflare proxy (orange cloud) must be OFF for Vercel SSL to work. Use "DNS only" (grey cloud).

### B3. Stripe Webhook
1. Stripe Dashboard -> Developers -> Webhooks -> Add endpoint
2. URL: `https://wataseat.com/webhooks/stripe`
3. Events: `checkout.session.completed`, `account.updated`, `payment_intent.amount_capturable_updated`, `payment_intent.payment_failed`, `payment_intent.canceled`
4. Copy signing secret -> update `STRIPE_WEBHOOK_SECRET` in Vercel env vars
5. Redeploy on Vercel after updating the secret

### B4. Meta WhatsApp Webhook
1. Meta Developer Console -> Your App -> WhatsApp -> Configuration
2. Edit webhook URL: `https://wataseat.com/webhooks/whatsapp`
3. Verify token: `wataseat_verify_2026` (same as before)
4. Subscribed events: `messages`, `message_deliveries`

### B5. Supabase Storage (if not done)
1. Supabase Dashboard -> Storage -> New Bucket
2. Name: `vessel-images`, Public: ON
3. Also run migration if not done:
   ```sql
   ALTER TABLE captains ADD COLUMN IF NOT EXISTS vessel_image_url TEXT;
   ```

### B6. Go Live with Stripe (when ready)
1. Stripe Dashboard -> toggle off Test Mode
2. Copy live keys -> update in Vercel:
   - `STRIPE_SECRET_KEY=sk_live_...`
   - `STRIPE_PUBLISHABLE_KEY=pk_live_...`
3. Create live webhook (same URL, same events)
4. Update `STRIPE_WEBHOOK_SECRET` with live webhook secret
5. Redeploy

---

## Execution Order
1. Claude: A1-A6 (code changes, commit, push)
2. Mo: B1 (Vercel project setup)
3. Mo: B2 (DNS setup)
4. Wait for DNS propagation (~5 min with Cloudflare)
5. Mo: B3 (Stripe webhook)
6. Mo: B4 (Meta webhook)
7. Mo: B5 (Supabase storage)
8. Test end-to-end on wataseat.com
9. Mo: B6 (Go live with Stripe when ready)
