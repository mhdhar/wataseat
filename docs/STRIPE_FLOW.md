# STRIPE_FLOW.md — WataSeat

> Complete Stripe integration spec. Authorization holds, Connect payouts, re-authorization, and commission logic.

---

## 1. Stripe Account Structure

```
WataSeat Platform Account (you)
├── Stripe Connect — Standard
│   ├── Captain A's Connected Account  (acct_xxx)
│   ├── Captain B's Connected Account  (acct_yyy)
│   └── Captain C's Connected Account  (acct_zzz)
└── Platform revenue = 10% of every captured PaymentIntent
```

**Standard Connect** is the right model here. Captains connect their own existing Stripe accounts (or create new ones). They handle their own KYC, tax, and payouts. You never touch their funds — Stripe routes 90% directly to them.

---

## 2. Captain Onboarding (Connect)

### Create Connect account link:
```typescript
const accountLink = await stripe.accountLinks.create({
  account: 'acct_xxx',           // Create account first: stripe.accounts.create({ type: 'standard' })
  refresh_url: 'https://wataseat.com/connect/refresh',
  return_url: 'https://wataseat.com/connect/complete',
  type: 'account_onboarding',
});
// Send accountLink.url to captain via WhatsApp DM
```

### Check if captain can receive payouts:
```typescript
const account = await stripe.accounts.retrieve('acct_xxx');
const canReceivePayments = account.charges_enabled;
const canReceivePayouts = account.payouts_enabled;
// Update captains table: stripe_charges_enabled, stripe_payouts_enabled
```

### Webhook: account.updated
Listen for this to know when a captain completes onboarding:
```typescript
case 'account.updated': {
  const account = event.data.object as Stripe.Account;
  await supabase
    .from('captains')
    .update({
      stripe_charges_enabled: account.charges_enabled,
      stripe_payouts_enabled: account.payouts_enabled,
    })
    .eq('stripe_account_id', account.id);
}
```

---

## 3. Guest Checkout — Creating an Authorization Hold

When a guest taps "Book Now":

### Step 1 — Create PaymentIntent
```typescript
const paymentIntent = await stripe.paymentIntents.create({
  amount: Math.round(totalAmountAed * 100),  // Stripe uses fils (smallest unit for AED = fils, 1 AED = 100 fils)
  currency: 'aed',
  capture_method: 'manual',                  // KEY: hold without charging
  payment_method_types: ['card'],
  application_fee_amount: Math.round(totalAmountAed * 10),  // 10% platform fee (in fils)
  transfer_data: {
    destination: captainStripeAccountId,     // 90% goes here on capture
  },
  metadata: {
    booking_id: bookingId,
    trip_id: tripId,
    captain_id: captainId,
    guest_wa_id: guestWhatsAppId,
  },
});
```

### Step 2 — Create Payment Link with Apple/Google Pay
```typescript
const paymentLink = await stripe.paymentLinks.create({
  line_items: [{
    price_data: {
      currency: 'aed',
      product_data: {
        name: `${tripType} Trip — ${departureDate}`,
        description: `${numSeats} seat(s) | Captain: ${captainName}`,
      },
      unit_amount: Math.round(pricePerSeat * 100),
    },
    quantity: numSeats,
  }],
  payment_intent_data: {
    capture_method: 'manual',
    application_fee_amount: Math.round(totalAmount * 10),
    transfer_data: {
      destination: captainStripeAccountId,
    },
    metadata: {
      booking_id: bookingId,
    },
  },
  payment_method_types: ['card'],  // Apple Pay and Google Pay are automatically included
  after_completion: {
    type: 'redirect',
    redirect: {
      url: `https://wataseat.com/booking/success?booking_id=${bookingId}`,
    },
  },
});
```

> **Note**: Apple Pay and Google Pay surface automatically on payment links when the customer is on a compatible device/browser. No additional configuration needed.

### Step 3 — Listen for authorization
```typescript
// Webhook event when manual-capture PI is authorized:
case 'payment_intent.amount_capturable_updated': {
  const pi = event.data.object as Stripe.PaymentIntent;
  const bookingId = pi.metadata.booking_id;
  // Update booking status to 'authorized'
  // Trigger threshold check
}
```

---

## 4. Threshold Reached — Capturing All Holds

When `current_bookings >= threshold`:

```typescript
async function captureAllBookingsForTrip(tripId: string) {
  // Get all authorized bookings
  const { data: bookings } = await supabase
    .from('bookings')
    .select('*, stripe_intents!inner(payment_intent_id)')
    .eq('trip_id', tripId)
    .eq('status', 'authorized');

  for (const booking of bookings) {
    const piId = booking.stripe_intents[0].payment_intent_id;

    const capturedPi = await stripe.paymentIntents.capture(piId, {
      amount_to_capture: Math.round(booking.total_amount_aed * 100),
      // application_fee_amount was set at creation — Stripe auto-applies it
    });

    // Update records
    await supabase.from('bookings').update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      platform_fee_aed: booking.total_amount_aed * 0.1,
      captain_payout_aed: booking.total_amount_aed * 0.9,
    }).eq('id', booking.id);

    await supabase.from('stripe_intents').update({
      stripe_status: 'succeeded',
      captured_at: new Date().toISOString(),
      application_fee_amount: booking.total_amount_aed * 0.1,
      transfer_amount: booking.total_amount_aed * 0.9,
    }).eq('payment_intent_id', piId);
  }

  // Update trip
  await supabase.from('trips')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
    .eq('id', tripId);
}
```

**Money flow on capture:**
- Guest's card charged: AED 250
- Platform fee (10%): AED 25 → stays in WataSeat Stripe account
- Captain payout (90%): AED 225 → transferred to captain's Connect account automatically

---

## 5. Trip Cancelled — Releasing All Holds

When threshold not met at T-12h:

```typescript
async function cancelAllBookingsForTrip(tripId: string, reason: string) {
  const { data: bookings } = await supabase
    .from('bookings')
    .select('*, stripe_intents!inner(payment_intent_id)')
    .eq('trip_id', tripId)
    .in('status', ['authorized', 'pending_payment']);

  for (const booking of bookings) {
    if (booking.status === 'authorized') {
      const piId = booking.stripe_intents[0].payment_intent_id;
      await stripe.paymentIntents.cancel(piId);
    }

    await supabase.from('bookings').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason,
    }).eq('id', booking.id);
  }

  await supabase.from('trips').update({
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancellation_reason: reason,
  }).eq('id', tripId);
}
```

**Guest experience**: The pending hold disappears from their bank statement within 1–7 business days (depends on their bank). No money is moved. Guest sees the hold disappear.

---

## 6. 6-Day Re-authorization Flow

Stripe authorization holds expire after **7 days**. We re-authorize after 6 days to maintain a 1-day buffer.

```typescript
// Runs daily at 2am UTC (6am UAE) via QStash
async function reauthorizeExpiring() {
  const { data: expiring } = await supabase
    .from('bookings')
    .select('*, stripe_intents!inner(*), trips!inner(*), captains!inner(*)')
    .eq('status', 'authorized')
    .lt('authorized_at', new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString())
    .eq('trips.status', 'open');  // Only re-auth if trip is still open

  for (const booking of expiring) {
    // Cancel old PaymentIntent
    const oldPiId = booking.stripe_intents[0].payment_intent_id;
    await stripe.paymentIntents.cancel(oldPiId);

    // Create new PaymentIntent (fresh 7-day window)
    const newPi = await stripe.paymentIntents.create({
      amount: Math.round(booking.total_amount_aed * 100),
      currency: 'aed',
      capture_method: 'manual',
      application_fee_amount: Math.round(booking.total_amount_aed * 10),
      transfer_data: {
        destination: booking.captains.stripe_account_id,
      },
      metadata: {
        booking_id: booking.id,
        trip_id: booking.trip_id,
        reauth: 'true',
      },
    });

    // Create new payment link
    // ... (same as initial booking)

    // Update records
    await supabase.from('stripe_intents').update({ is_current: false }).eq('booking_id', booking.id);
    await supabase.from('stripe_intents').insert({
      booking_id: booking.id,
      trip_id: booking.trip_id,
      captain_id: booking.captain_id,
      payment_intent_id: newPi.id,
      amount_aed: booking.total_amount_aed,
      stripe_status: 'requires_payment_method',
      is_current: true,
      reauth_count: booking.stripe_intents[0].reauth_count + 1,
    });

    // Update booking to pending_payment (guest needs to re-tap)
    await supabase.from('bookings').update({
      status: 'pending_payment',
      payment_link: newPaymentLinkUrl,
      stripe_payment_intent_id: newPi.id,
    }).eq('id', booking.id);

    // Notify guest via WhatsApp DM
    await notifications.notifyReauthRequired(booking, newPaymentLinkUrl);
  }
}
```

---

## 7. Stripe Webhook Events to Handle

Register webhook at: Stripe Dashboard → Developers → Webhooks → Add endpoint

Endpoint URL: `https://YOUR_URL/webhooks/stripe`

| Event | Action |
|---|---|
| `payment_intent.amount_capturable_updated` | Booking → authorized, update trip count, notify |
| `payment_intent.succeeded` | Booking → confirmed (fires after capture) |
| `payment_intent.payment_failed` | Booking → failed, notify guest, free up seat |
| `payment_intent.canceled` | Booking → cancelled, confirm no charge to guest |
| `account.updated` | Update captain's stripe_charges_enabled / stripe_payouts_enabled |
| `transfer.created` | Log payout to captain (for audit) |

### Webhook signature verification:
```typescript
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle events...
  res.json({ received: true });
});
```

---

## 8. Currency Note — AED

Stripe supports AED (United Arab Emirates Dirham) natively. The smallest unit is fils (1 AED = 100 fils), so:
- AED 250 → 25000 in Stripe `amount` field
- Always multiply by 100, always round to integer: `Math.round(aed * 100)`

Stripe Connect in the UAE:
- Standard Connect is available for UAE businesses
- Captains need UAE bank account for payouts
- KYC handled by Stripe during Connect onboarding
- Payout schedule: typically T+2 business days to captain's bank

---

## 9. Going Live (Test → Production)

1. Test mode: use `sk_test_*` keys → card numbers like `4242 4242 4242 4242` work
2. Before going live, Stripe requires:
   - Platform business verification (your WataSeat entity)
   - Connect platform agreement acceptance
   - Review by Stripe for Connect marketplaces (usually 1–3 business days)
3. Switch to `sk_live_*` keys in Railway environment
4. Create new production webhook endpoints (test webhooks don't fire in live mode)
5. Advise captains to complete Stripe onboarding with real business details
