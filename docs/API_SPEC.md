# API_SPEC.md — WataSeat

> Webhook endpoint contracts, bot command reference, and internal service interfaces.

---

## 1. HTTP Endpoints

### GET /health
Health check for Railway and monitoring.

**Response 200:**
```json
{
  "status": "ok",
  "uptime": 3600,
  "version": "1.0.0",
  "services": {
    "database": "connected",
    "redis": "connected",
    "whatsapp": "connected"
  }
}
```

---

### GET /webhooks/whatsapp
Meta verification challenge. Called once by Meta when you register the webhook.

**Query params:**
- `hub.mode` = `"subscribe"`
- `hub.verify_token` = your `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `hub.challenge` = random string from Meta

**Response 200:** Return the `hub.challenge` value as plain text.
**Response 403:** If verify token doesn't match.

---

### POST /webhooks/whatsapp
Receives all incoming WhatsApp events. Must respond within 5 seconds or Meta retries.

**Headers required:**
- `X-Hub-Signature-256: sha256=HMAC_SIGNATURE`

**Verification:**
```typescript
const signature = req.headers['x-hub-signature-256'];
const expectedSignature = 'sha256=' + crypto
  .createHmac('sha256', process.env.META_APP_SECRET!)
  .update(req.body)
  .digest('hex');

if (signature !== expectedSignature) {
  return res.status(401).send('Unauthorized');
}
```

**Always respond 200 immediately**, then process async:
```typescript
res.status(200).json({ status: 'ok' });  // Respond first
processWebhookAsync(body);               // Then process
```

**Payload types to handle:**

| `messages[].type` | Action |
|---|---|
| `text` | Route to command handler or onboarding |
| `interactive` with `button_reply` | Route to button handler |
| `unsupported` | Ignore |
| (no messages field) | Delivery receipt — ignore |

---

### POST /webhooks/stripe
Receives all Stripe events.

**Headers required:**
- `Stripe-Signature: t=xxx,v1=yyy`

**Events handled:**

| Event | Handler |
|---|---|
| `payment_intent.amount_capturable_updated` | Mark booking as authorized |
| `payment_intent.succeeded` | Mark booking as confirmed (post-capture) |
| `payment_intent.payment_failed` | Mark booking as failed, free seat |
| `payment_intent.canceled` | Mark booking as cancelled |
| `account.updated` | Update captain stripe_charges_enabled |
| `transfer.created` | Log payout to captain |

---

## 2. WhatsApp Command Specifications

### /help
**Input:** `/help` (anywhere)
**Response (text):**
```
🚢 WataSeat Commands

/trip — Create a new trip
/trips — View your upcoming trips
/status [ID] — Check a trip's bookings
/cancel [ID] — Cancel a trip
/connect — Set up or update your Stripe account

Need help? Visit wataseat.com/support
```

---

### /trip
**Input:** `/trip` (captain only, group or DM)
**Flow:** Multi-step DM wizard. Bot asks questions sequentially. Captain replies to each.

**Step sequence:**
1. Bot: "What type of trip? Reply: fishing / diving / cruising / other"
2. Bot: "What date? (e.g. Friday 28 March or 28/03)"
3. Bot: "What time? (e.g. 6am or 06:00)"
4. Bot: "Duration? (e.g. 4 hours)"
5. Bot: "Meeting point?"
6. Bot: "Max seats? (e.g. 12)"
7. Bot: "Minimum needed for trip to run? (e.g. 6)"
8. Bot: "Price per person in AED?"
9. Bot: "Confirm? Reply YES or NO\n\n[Summary of all details]"
10. On YES: create trip, post announcement to group

**Validation errors (example):**
- Threshold > max seats: "Minimum (8) can't be more than max seats (6). Try again."
- Date in past: "That date has already passed. Enter a future date."
- Non-numeric price: "Enter a number for the price (e.g. 250)."

---

### /trips
**Input:** `/trips` (captain only)
**Response (text):**
```
📅 Your upcoming trips:

[abc123] Fishing — Fri 28 Mar 6am
  3/6 seats ░░░███░ 50% filled

[def456] Diving — Sat 29 Mar 7am
  6/6 seats ██████ ✅ CONFIRMED

[ghi789] Cruising — Sun 30 Mar 5pm
  0/8 seats ░░░░░░░░ (need 4 min)

Type /status [ID] for details.
```

---

### /status [trip_id]
**Input:** `/status abc123` (captain only)
**Response:**
```
🚢 Fishing Trip — Fri 28 Mar
ID: abc123

📍 Dubai Marina
⏰ 6:00 AM (4 hours)
💰 AED 250/person

Seats: 3/6 ░░░███░
Threshold: 6 minimum
Status: OPEN — 2 more needed

Guests booked:
• Ahmed (+97150xxx) — 1 seat
• Sara (+97155xxx) — 1 seat
• Mohammed (+97154xxx) — 1 seat

⏱ Deadline: 27 Mar 6pm (if not full, cancelled)

/cancel abc123 to cancel
```

---

### /cancel [trip_id]
**Input:** `/cancel abc123` (captain only)
**Response (bot asks for confirmation):**
```
⚠️ Are you sure you want to cancel the Fishing Trip on Fri 28 Mar?

• 3 guests will be notified
• All card holds will be released
• No one will be charged

Reply YES to confirm, or NO to keep the trip.
```

**On YES reply:**
1. Call `cancelAllBookingsForTrip()`
2. Send cancellation notifications to all guests
3. Send group message
4. Respond to captain: "✅ Trip cancelled. 3 guests notified. No charges made."

---

### /connect
**Input:** `/connect` (captain only, DM)
**Flow:**
- If captain not registered: start onboarding wizard
- If captain registered but Stripe incomplete: "Complete your Stripe setup here: [link]"
- If captain fully onboarded: "✅ Your Stripe account is active. You can post trips."

---

## 3. Internal Service Interfaces (TypeScript)

### whatsapp.ts
```typescript
sendTextMessage(recipientWaId: string, text: string): Promise<void>

sendInteractiveMessage(recipientWaId: string, options: {
  header?: string;
  body: string;
  footer?: string;
  buttons: Array<{ id: string; title: string }>;
}): Promise<string>  // returns Meta message ID

sendTemplateMessage(recipientWaId: string, templateName: string, components: any[]): Promise<void>
```

### trips.ts
```typescript
createTrip(data: CreateTripInput): Promise<Trip>
getTripById(tripId: string): Promise<Trip | null>
getTripByShortId(shortId: string, captainId: string): Promise<Trip | null>
getTripsByCapture(captainId: string): Promise<Trip[]>
getOpenTrips(): Promise<Trip[]>  // for threshold check job
updateTripBookingCount(tripId: string, delta: number): Promise<Trip>
```

### bookings.ts
```typescript
createBooking(data: CreateBookingInput): Promise<Booking>
getBookingByTrip(tripId: string): Promise<Booking[]>
getAuthorizedBookings(tripId: string): Promise<Booking[]>
updateBookingStatus(bookingId: string, status: BookingStatus): Promise<void>
hasGuestBooked(tripId: string, guestWaId: string): Promise<boolean>
```

### stripe.ts
```typescript
createPaymentIntent(data: {
  amountAed: number;
  captainStripeAccountId: string;
  bookingId: string;
  tripId: string;
  captainId: string;
  guestWaId: string;
}): Promise<Stripe.PaymentIntent>

createPaymentLink(paymentIntentId: string, bookingId: string, lineItem: LineItem): Promise<string>

capturePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent>

cancelPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent>
```

### notifications.ts
```typescript
notifyTripPosted(trip: Trip, groupWaId: string): Promise<void>
notifyPaymentLinkSent(booking: Booking, paymentLink: string): Promise<void>
notifyBookingAuthorized(booking: Booking, trip: Trip): Promise<void>
notifyThresholdReached(trip: Trip, bookings: Booking[]): Promise<void>
notifyTripCancelled(trip: Trip, bookings: Booking[], reason: string): Promise<void>
notifyReauthRequired(booking: Booking, newPaymentLink: string): Promise<void>
notifyCaptainSummary(captain: Captain, upcomingTrips: Trip[]): Promise<void>
```

---

## 4. Error Handling Conventions

All services throw typed errors:

```typescript
export class WataSeatError extends Error {
  constructor(
    message: string,
    public code: string,
    public httpStatus: number = 500,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WataSeatError';
  }
}

// Usage
throw new WataSeatError(
  'Trip not found',
  'TRIP_NOT_FOUND',
  404,
  { tripId, captainId }
);
```

Global error handler in Express logs the error and sends a DM to `ADMIN_WA_ID` for critical failures (Stripe capture failures, database connection failures).

User-facing error messages in WhatsApp are always friendly and actionable — never expose stack traces or internal error codes.
