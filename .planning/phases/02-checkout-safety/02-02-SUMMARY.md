---
phase: 02-checkout-safety
plan: "02"
subsystem: booking-web
tags: [session-identity, rate-limiting, cookie, security]
dependency_graph:
  requires: []
  provides: [stable-session-identity, checkout-rate-limiting]
  affects: [src/routes/booking.ts, src/server.ts]
tech_stack:
  added: [cookie-parser, "@types/cookie-parser"]
  patterns: [signed-httponly-cookie, express-rate-limit-keygenerator, trust-proxy]
key_files:
  created: []
  modified:
    - src/server.ts
    - src/routes/booking.ts
    - package.json
    - .env.example
decisions:
  - "Use signed httpOnly cookie (wata_session) for stable browser session identity instead of pending_${Date.now()}"
  - "Rate limiter keyed on session cookie with req.ip fallback for cookieless clients"
  - "skipSuccessfulRequests: false so all 3 attempts count — prevents inventory exhaustion via rapid retries"
  - "trust proxy set to 1 at app level for correct req.ip behind Railway reverse proxy"
metrics:
  duration_minutes: 10
  completed_date: "2026-03-31"
  tasks_completed: 2
  files_changed: 4
---

# Phase 02 Plan 02: Session Identity and Checkout Rate Limiting Summary

**One-liner:** Signed httpOnly `wata_session` cookie replaces forgeable `pending_${Date.now()}` token, with per-session/IP rate limiting (3 attempts/15 min) on the POST checkout endpoint.

## What Was Built

### Task 1: cookie-parser install, trust proxy, and session middleware (commit: 4bab2e7)

- Installed `cookie-parser` and `@types/cookie-parser` via npm
- Added `app.set('trust proxy', 1)` immediately after `const app = express()` — required for correct `req.ip` behind Railway's reverse proxy
- Added `cookieParser(COOKIE_SECRET)` middleware after `express.urlencoded` 
- Added `/book` session middleware that issues a `wata_session` signed httpOnly cookie on first visit
  - Cookie: `httpOnly: true`, `signed: true`, `sameSite: 'lax'`, `secure` in production, 24h `maxAge`
  - Session ID format: `web_<uuid>` (UUID v4 via `crypto.randomUUID()`)
  - Sets `(req as any).wataSessionId` for downstream booking handler
- Added `SESSION_COOKIE_SECRET=` and `CHECKOUT_RATE_LIMIT_MAX=3` to `.env.example`

### Task 2: Checkout rate limiter and session token usage (commit: 28015de)

- Added `import rateLimit from 'express-rate-limit'` to `booking.ts`
- Created `checkoutLimiter` with:
  - `windowMs: 15 * 60 * 1000` (15 minutes)
  - `max: parseInt(process.env.CHECKOUT_RATE_LIMIT_MAX || '3')` (configurable)
  - `keyGenerator` reads `req.signedCookies?.['wata_session']` with `req.ip` fallback
  - `skipSuccessfulRequests: false` — all attempts count toward limit
  - 429 JSON response: `{ error: 'Too many booking attempts. Please try again in 15 minutes.' }`
- Applied `checkoutLimiter` as middleware to `router.post('/:shortId/checkout', checkoutLimiter, async ...)`
- Replaced `p_guest_whatsapp_id: \`pending_${Date.now()}\`` with `(req as any).wataSessionId ?? \`web_${Date.now()}\``

## Verification

All plan success criteria confirmed:

| Check | Result |
|-------|--------|
| `grep -c "checkoutLimiter" src/routes/booking.ts` | 2 (definition + usage) |
| `grep -c "wata_session" src/server.ts` | 2 (cookie set + read) |
| `grep -c "wataSessionId" src/routes/booking.ts` | 1 |
| `grep -c "pending_\${Date.now()}" src/routes/booking.ts` | 0 |
| `grep -c "cookie-parser" package.json` | 2 |
| `grep "trust proxy" src/server.ts` | app.set('trust proxy', 1) |
| `npx tsc --noEmit` | passes (no output) |

## Decisions Made

1. **Session ID format `web_<uuid>`** — The `web_` prefix is intentional: it distinguishes web checkout sessions from real WhatsApp IDs, and the notification path will not attempt to send WhatsApp messages to identifiers not matching a phone number format.
2. **`secure: process.env.NODE_ENV === 'production'`** — Cookie is NOT marked secure in development (allows testing without HTTPS locally), but IS secure in production (Railway, HTTPS).
3. **COOKIE_SECRET fallback** — Falls back to `'dev-secret-change-in-production'` so local dev doesn't crash if `SESSION_COOKIE_SECRET` is not set. Production must set this env var.
4. **`skipSuccessfulRequests: false`** — Every checkout attempt counts toward the limit, preventing an attacker from exhausting seats with 3 concurrent rapid requests per session.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all session identity and rate limiting is fully wired.

## Self-Check: PASSED

- `src/server.ts` — FOUND: wata_session cookie middleware, trust proxy, cookieParser
- `src/routes/booking.ts` — FOUND: checkoutLimiter (defined + applied), wataSessionId, no `pending_${Date.now()}`
- `package.json` — FOUND: cookie-parser in dependencies, @types/cookie-parser in devDependencies
- `.env.example` — FOUND: SESSION_COOKIE_SECRET, CHECKOUT_RATE_LIMIT_MAX
- Commits — FOUND: 4bab2e7, 28015de
