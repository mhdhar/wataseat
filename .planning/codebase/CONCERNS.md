# Codebase Concerns

**Analysis Date:** 2026-03-29

## Tech Debt

**Redis client initialization pattern:**
- Issue: Multiple Redis clients are instantiated independently in each handler/job instead of using a singleton, wasting connections
- Files: `src/handlers/onboardingHandler.ts` (line 9-12), `src/handlers/commandHandler.ts` (line 12-15)
- Impact: Increased memory footprint, connection pool exhaustion under load, inefficient resource utilization
- Fix approach: Create a Redis singleton in `src/db/redis.ts` (similar to Supabase), export and reuse across all handlers and jobs

**IBAN validation too permissive:**
- Issue: Line 142 in `src/handlers/onboardingHandler.ts` only checks `iban.length < 15`, which is insufficient — valid UAE IBANs are exactly 23 characters
- Files: `src/handlers/onboardingHandler.ts` (line 142-145)
- Impact: Invalid IBANs could be accepted, causing payout failures; captains could provide malformed accounts
- Fix approach: Validate exact UAE IBAN format: `^AE\d{21}$` regex, reject anything that doesn't match

**Stripe fee calculation inconsistency:**
- Issue: Application fee is calculated as `Math.round(data.amountAed * 10)` fils in `src/services/stripe.ts` line 16, but should be `Math.round(data.amountAed * 100 * 0.10)` to match 10% correctly
- Files: `src/services/stripe.ts` (line 16), `src/jobs/thresholdCheck.ts` (line 90)
- Impact: Platform receives wrong commission (10x too much); captain payouts calculated incorrectly
- Fix approach: Standardize to `Math.round(amountAed * 100 * 0.10)` for 10% in fils across all payment creation

**Reauth jobs can accumulate indefinitely:**
- Issue: `src/jobs/reauthorize.ts` creates new reauth jobs every cycle but relies on `is_complete` flag; if a booking is never captured/cancelled, reauth jobs keep being created
- Files: `src/jobs/reauthorize.ts` (line 113-119), `src/jobs/thresholdCheck.ts` (line 125-135)
- Impact: Unbounded growth of `reauth_jobs` table; noise in recurring jobs causing unnecessary API calls
- Fix approach: Set TTL on reauth jobs or add a check to not create new job if previous cycle's exists and trip is not open

**Timezone handling fragile:**
- Issue: Cron jobs use UTC times (hardcoded "2am UTC" / "4am UTC") but no timezone conversion utilities exist; dates stored in ISO strings without timezone awareness
- Files: `src/jobs/scheduler.ts` (line 18, 26), `src/services/notifications.ts` (line 22-30 formatDate functions)
- Impact: Departure time comparisons across timezones could be off; threshold checks might trigger at wrong times in different regions
- Fix approach: Add timezone utility function, store captain/trip timezone preference, convert all dates to UTC internally but format for user's timezone on display

## Known Bugs

**Concurrent booking creation race condition:**
- Issue: Between checking seat availability (`trip.current_bookings >= trip.max_seats`) and creating booking, another guest could book last seat
- Files: `src/handlers/buttonHandler.ts` (line 42-44), `src/routes/stripe.ts` (line 99-110)
- Trigger: Two simultaneous "Book My Seat" button taps on nearly-full trip
- Symptom: More bookings created than `max_seats` allows
- Workaround: None — can only fix with database-level constraint or transactions

**Payment intent metadata missing trip_id in some flows:**
- Issue: Stripe event handlers expect `pi.metadata.trip_id` and `pi.metadata.guest_wa_id` (line 72-73 in `src/routes/stripe.ts`) but not all code paths set them
- Files: `src/routes/stripe.ts` (line 72-73), `src/services/stripe.ts` (line 27-32)
- Trigger: Payment intents created outside normal booking flow
- Impact: Payment failure events fail to log/notify because metadata lookup returns undefined

**Reauth count not incremented on first SI creation:**
- Issue: New stripe_intents start with `reauth_count: 0` in DB but no default value enforced; first reauth increments to 1, causing off-by-one tracking
- Files: `src/services/stripe.ts` (line 41-49), `src/jobs/reauthorize.ts` (line 76)
- Impact: Reauth attempt count is inaccurate; cannot distinguish first-time from re-authorized intents

## Security Considerations

**No rate limiting on booking creation:**
- Risk: Guest can spam "Book My Seat" button taps to create multiple bookings per trip
- Files: `src/handlers/buttonHandler.ts` (line 23-78), `src/routes/whatsapp.ts` (line 27)
- Current mitigation: Deduplication in `hasGuestBooked()` prevents duplicate confirmed bookings, but temporary bookings still created
- Recommendations: Add Redis-based rate limit (e.g., 1 booking per guest per trip per 5 seconds), or use Stripe idempotency keys

**Webhook signature verification assumes base64 decoding:**
- Risk: `src/utils/crypto.ts` doesn't validate the signature format before comparing; malformed signatures could cause timing attacks
- Files: `src/utils/crypto.ts` (line 12-13)
- Current mitigation: Using `crypto.timingSafeEqual` to prevent timing attacks
- Recommendations: Validate signature format matches `sha256=[hex string]` before comparison; reject early if malformed

**Environment variables not validated at startup:**
- Risk: Missing critical env vars (STRIPE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, etc.) are not validated until first use, causing runtime errors
- Files: `src/server.ts` (line 6-12 imports)
- Current mitigation: None — assumes `.env` is always complete
- Recommendations: Add validation function in server startup that checks all required env vars and fails fast with clear error message

**Sensitive error logs could expose PII:**
- Risk: Logging full Stripe/Supabase errors may include email addresses, phone numbers, IBANs in stack traces
- Files: `src/routes/stripe.ts` (line 29), `src/services/whatsapp.ts` (line 17-20)
- Current mitigation: CLAUDE.md says "never expose stack traces in WhatsApp messages" but logs still captured
- Recommendations: Sanitize error logs before logging; redact PII patterns (email, phone, IBAN) from error messages

**No validation of Stripe Connect account ownership:**
- Risk: Captain could provide another person's Stripe account ID, receiving payouts to wrong account
- Files: `src/services/stripeConnect.ts` (line 6-25), `src/routes/stripe.ts` (line 47-66)
- Current mitigation: Stripe onboarding link requires KYC, but no verification that returned account matches captain's WhatsApp ID
- Recommendations: After account.updated event, verify `account.metadata.whatsapp_id` matches captain's WhatsApp ID before enabling charges

## Performance Bottlenecks

**N+1 query in notifyBookingAuthorized:**
- Problem: Line 120 in `src/services/notifications.ts` fetches trip data for each notification, could be 50+ queries for large bookings
- Files: `src/services/notifications.ts` (line 116-150)
- Cause: Called inside loop in `src/routes/stripe.ts` line 120 without pre-fetching trip
- Improvement path: Fetch trip once in stripe.ts event handler, pass it to notifyBookingAuthorized to avoid repeated queries

**Hourly threshold check queries all open trips:**
- Problem: `runThresholdCheck()` queries all open trips without index, could scan entire table on every hour
- Files: `src/jobs/thresholdCheck.ts` (line 14-19)
- Cause: No WHERE clause optimization for trips approaching departure time
- Improvement path: Add index on `(status, threshold_check_sent_at, departure_at)` in `trips` table; pre-filter trips within next 24 hours

**Reauth job query does expensive inner join:**
- Problem: Line 15 in `src/jobs/reauthorize.ts` joins bookings → trips → captains for every reauth cycle
- Files: `src/jobs/reauthorize.ts` (line 13-18)
- Cause: SQL query with nested joins without pagination
- Improvement path: Split into two queries — first get booking IDs, then fetch minimal captain data only if needed

**WhatsApp notification logging bypasses async:**
- Problem: Every message send logs to `notification_log` table synchronously (`src/services/whatsapp.ts` line 101-109)
- Files: `src/services/whatsapp.ts` (line 95-113)
- Cause: Database insert blocks on every message
- Improvement path: Queue notifications to Redis, batch insert to DB asynchronously via cron job

## Fragile Areas

**State machine transitions in handlers are not atomic:**
- Files: `src/handlers/onboardingHandler.ts` (line 14-176), `src/handlers/tripWizardHandler.ts`
- Why fragile: Between checking `captain.onboarding_step` and updating it, captain could get second message triggering duplicate transitions
- Safe modification: Wrap state updates in Supabase transactions, or use Redis locks per user (user_id:state_lock)
- Test coverage: No tests for concurrent state transitions

**Trip announcement message ID not verified before using:**
- Files: `src/services/notifications.ts` (line 69-76), referenced in trip updates
- Why fragile: If Meta API fails to return message ID or returns malformed data, trips stored with invalid `announcement_message_id` causing later updates to fail silently
- Safe modification: Validate message ID before storing; add retry with exponential backoff if send fails
- Test coverage: No tests for message ID validation

**Redis connection timeouts silently caught:**
- Files: `src/handlers/onboardingHandler.ts` (line 20), `src/handlers/commandHandler.ts` (line 40)
- Why fragile: `.get()` errors on Redis timeout are silently caught, falling through to wrong code path
- Safe modification: Explicitly handle Redis errors; log and return early with user-facing error message
- Test coverage: No tests for Redis failures

**Booking creation not idempotent:**
- Files: `src/handlers/buttonHandler.ts` (line 70-78)
- Why fragile: If network timeout occurs after booking created but before response sent, guest retaps button creating duplicate
- Safe modification: Use Stripe idempotency key on payment intent creation; check for existing booking before inserting
- Test coverage: No tests for idempotent booking creation

## Scaling Limits

**Redis connection pool:**
- Current capacity: 1 connection per handler initialization (not shared)
- Limit: Upstash free tier limits to ~10k requests/day; without connection pooling, will exhaust limits with 100s of concurrent users
- Scaling path: Implement connection pooling via singleton, evaluate Upstash paid tier if hitting limits, consider switching to AWS ElastiCache for production

**Supabase RLS policies not optimized:**
- Current capacity: No query indexing on frequently accessed columns (whatsapp_id, trip_id, status)
- Limit: Full table scans on `bookings` and `trips` tables with 10k+ records will become slow
- Scaling path: Add composite indexes on (status, created_at), (trip_id, status), (whatsapp_id, created_at); measure query performance with Supabase dashboard

**Cron job memory footprint:**
- Current capacity: All three jobs run independently; reauth and threshold check both load full bookings/trips into memory
- Limit: With 10k+ bookings, `runReauthorization()` and `runThresholdCheck()` will exhaust Node.js memory
- Scaling path: Add pagination to jobs (fetch 1000 records at a time), stream results instead of loading into memory, consider splitting jobs across multiple workers

**Stripe API rate limits:**
- Current capacity: No batching or rate limiting on Stripe calls
- Limit: Stripe rate limit is 100 requests/second; threshold check creating 100+ payment intents will hit limits
- Scaling path: Implement exponential backoff retry logic, batch API calls using Stripe batch processing, monitor rate limit headers

## Dependencies at Risk

**Pino logger major version outdated:**
- Risk: `pino@10.3.1` was released Jan 2024; newer versions may have security patches
- Impact: Potential logging bypasses or info leaks if vulnerability discovered in older version
- Migration plan: Run `npm audit` to check for known vulns; update to latest 10.x or 11.x with compatibility testing

**Node.js pg client doesn't auto-reconnect:**
- Risk: Migration script in `supabase/migrations/run_migrations.ts` uses raw pg Client without connection pooling
- Impact: Long-running migrations could lose connection; no retry logic if DB connection drops
- Migration plan: Wrap migration client in connection retry logic, or use supabase-js admin client instead of raw pg

**Stripe SDK version pinned broadly:**
- Risk: `stripe@^21.0.1` allows any 21.x version; minor updates could include breaking changes
- Impact: Transitive dependency updates could break payment logic without explicit package.json change
- Migration plan: Pin to exact version `stripe@21.0.1` in production, or regularly audit changelogs before accepting minor updates

## Missing Critical Features

**No payment link expiry validation:**
- Problem: Payment links sent to guests never expire; they can pay days/weeks after trip is cancelled
- Blocks: Cannot enforce payment deadline; guests booking after threshold check still pay even if trip cancelled
- Fix: Add `payment_link_expires_at` to bookings table, check expiry on Stripe webhook before capturing, send new link if expired

**No audit trail for payment captures:**
- Problem: When threshold is met and payments captured, no record of who triggered capture (cron vs manual), when exactly, or if there were errors
- Blocks: Cannot debug failed captures or prove platform took correct action in disputes
- Fix: Add `capture_triggered_by`, `capture_triggered_at`, `capture_attempts` to stripe_intents table; log all capture operations

**No guest identity verification:**
- Problem: Anyone with guest WhatsApp number can book under their name; no email or ID verification
- Blocks: Cannot prevent duplicate accounts, resolve chargebacks, or contact guests via email
- Fix: Add optional guest email field, require verification before first booking, store hashed guest identity

**No captain KYC/AML verification:**
- Problem: Captains onboard via WhatsApp text; no verification of license, boat registration, insurance
- Blocks: Platform liable if unlicensed captains operate boats; Stripe Connect requires KYC but we don't verify it locally
- Fix: Add license upload/verification step, integrate with UAE maritime authority API if available, store verification status

## Test Coverage Gaps

**No tests for payment intent capture flow:**
- What's not tested: End-to-end booking → authorization → threshold check → capture → notification
- Files: `src/routes/stripe.ts`, `src/jobs/thresholdCheck.ts`, `src/services/notifications.ts`
- Risk: Threshold check logic could silently fail; captures might not send notifications
- Priority: **High** — this is core revenue flow

**No tests for Stripe Connect re-authorization:**
- What's not tested: Old PI cancellation, new PI creation, guest notification for reauth, new reauth job scheduling
- Files: `src/jobs/reauthorize.ts`, `src/services/notifications.ts`
- Risk: Reauth loop could break silently; guests not notified to re-authenticate; orphaned reauth jobs
- Priority: **High** — affects payment holds in 6+ day trips

**No tests for concurrent state transitions:**
- What's not tested: Two simultaneous messages during onboarding, trip wizard, or booking creation
- Files: `src/handlers/onboardingHandler.ts`, `src/handlers/tripWizardHandler.ts`, `src/handlers/buttonHandler.ts`
- Risk: State machine could accept invalid transitions or duplicate data
- Priority: **High** — race conditions in production are hard to debug

**No tests for Redis failures:**
- What's not tested: Redis timeout, connection refused, or key expiry during state machine operations
- Files: `src/handlers/onboardingHandler.ts`, `src/handlers/commandHandler.ts`
- Risk: Graceful degradation not tested; unknown behavior if Redis unavailable
- Priority: **Medium** — not common but critical when it happens

**No tests for webhook signature verification:**
- What's not tested: Invalid signatures, replayed webhooks, malformed payloads
- Files: `src/routes/whatsapp.ts` (line 28-40), `src/routes/stripe.ts` (line 12-23)
- Risk: Webhook processing could be exploited if verification broken
- Priority: **Medium** — security-critical but only tested manually

**No integration tests with test Stripe account:**
- What's not tested: Actual PaymentIntent creation, capture, and event webhook delivery
- Files: `src/services/stripe.ts`, `src/routes/stripe.ts`
- Risk: Stripe API changes or incorrect metadata could break in production
- Priority: **Medium** — pre-production testing would catch most issues

---

*Concerns audit: 2026-03-29*
