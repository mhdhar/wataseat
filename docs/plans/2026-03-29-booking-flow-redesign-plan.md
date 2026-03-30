# Booking Flow Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable captain trip sharing via booking links, guest payment via Stripe Checkout (Apple Pay), authorization holds with threshold-based capture, and quick trip repeating.

**Architecture:** Captain creates trip via DM wizard → gets shareable message with booking URL → guests tap URL → Stripe Checkout with Apple Pay → authorization hold → webhook records booking → threshold check captures all holds. Platform-only Stripe (no Connect). `/repeat` copies last trip settings.

**Tech Stack:** Express.js, Stripe Checkout Sessions, Supabase, WhatsApp Cloud API

---

### Task 1: Remove Stripe Connect requirement from trip creation

**Files:**
- Modify: `src/handlers/commandHandler.ts:81-84`

**Step 1: Remove the stripe_charges_enabled check**

In `src/handlers/commandHandler.ts`, delete lines 81-84 (the `stripe_charges_enabled` check in `handleTripCommand`). The function should go straight from the onboarding check to `handleTripWizardStart`:

```typescript
async function handleTripCommand(from: string, message: any): Promise<void> {
  const captain = await getCaptain(from);

  if (!captain) {
    await sendTextMessage(from, "You're not registered yet. Send me any message to start onboarding!");
    return;
  }

  if (captain.onboarding_step !== 'complete') {
    await sendTextMessage(from, 'Please complete your onboarding first. Type /connect to continue.');
    return;
  }

  await handleTripWizardStart(from, captain);
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/handlers/commandHandler.ts
git commit -m "feat: remove Stripe Connect requirement for trip creation"
```

---

### Task 2: Auto-create DM group in trip wizard

**Files:**
- Modify: `src/handlers/tripWizardHandler.ts:16-30`

**Step 1: Replace group lookup with auto-create logic**

Replace the `handleTripWizardStart` function's group lookup (lines 16-30) so it finds or creates a DM-based group entry:

```typescript
export async function handleTripWizardStart(from: string, captain: Captain): Promise<void> {
  // Find or create a group entry for this captain
  // WhatsApp Business can't join groups, so captain's DM is the destination
  let group: any = null;

  const { data: groups } = await supabase
    .from('whatsapp_groups')
    .select('*')
    .eq('captain_id', captain.id)
    .eq('is_active', true);

  group = groups?.[0] || null;

  if (!group) {
    const { data: newGroup, error } = await supabase
      .from('whatsapp_groups')
      .insert({
        group_id: from,
        captain_id: captain.id,
        group_name: `${captain.display_name}'s trips`,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      logger.error({ err: error, captainId: captain.id }, 'Failed to create group entry');
      await sendTextMessage(from, 'Something went wrong. Please try again.');
      return;
    }
    group = newGroup;
    logger.info({ captainId: captain.id }, 'Auto-created DM group for captain');
  }

  // rest of function unchanged (state creation + first wizard question)
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/handlers/tripWizardHandler.ts
git commit -m "feat: auto-create DM group when captain has no groups"
```

---

### Task 3: Send shareable trip message after trip creation

**Files:**
- Modify: `src/handlers/tripWizardHandler.ts` (the `confirm` case, around line 215-253)

**Step 1: Add booking URL to trip confirmation**

In the `confirm` case of `handleTripWizardStep`, after the trip is created and the group notification is sent, add a shareable message. Replace the existing confirmation message with one that includes the booking link:

```typescript
case 'confirm': {
  if (input.toUpperCase() === 'YES') {
    await redis.del(`trip_wizard:${from}`);

    const departureAt = `${state.departure_date}T${state.departure_time}:00`;
    const tripTypeLabel = (state.trip_type || 'fishing').charAt(0).toUpperCase() + (state.trip_type || 'fishing').slice(1);

    const trip = await createTrip({
      captain_id: state.captain_id,
      group_id: state.group_id!,
      trip_type: state.trip_type || 'fishing',
      title: `${tripTypeLabel} Trip`,
      departure_at: departureAt,
      duration_hours: state.duration_hours,
      meeting_point: state.meeting_point,
      location_url: state.location_url,
      max_seats: state.max_seats!,
      threshold: state.threshold!,
      price_per_person_aed: state.price_per_person_aed!,
    });

    const shortId = trip.id.substring(0, 6);
    const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const bookingUrl = `${baseUrl}/book/${shortId}`;

    const date = new Date(departureAt);
    const formattedDate = date.toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' });
    const formattedTime = date.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });

    // Send confirmation to captain
    await sendTextMessage(from, `✅ Trip created! [${shortId}]\n\nType /status ${shortId} to track bookings.`);

    // Send shareable message for captain to copy-paste to their group
    const shareMsg = `🚢 ${tripTypeLabel} Trip — ${formattedDate}\n📍 ${state.meeting_point || 'TBA'}\n⏰ ${formattedTime}${state.duration_hours ? ` (${state.duration_hours}h)` : ''}\n💰 AED ${state.price_per_person_aed}/person\n👥 ${state.max_seats} seats (need ${state.threshold} min to confirm)\n\nBook & pay securely:\n${bookingUrl}\n\nYour card is only charged if the trip confirms!`;

    await sendTextMessage(from, `📋 Copy this message and share it in your group:\n\n${shareMsg}`);

    logger.info({ tripId: trip.id, captainId: state.captain_id }, 'Trip created via wizard');
  } else {
    await redis.del(`trip_wizard:${from}`);
    await sendTextMessage(from, '❌ Trip creation cancelled. Type /trip to start over.');
  }
  break;
}
```

Note: We removed the `notifyTripPosted` call since the bot can't post to groups. The captain shares the message manually.

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/handlers/tripWizardHandler.ts
git commit -m "feat: send shareable trip message with booking URL"
```

---

### Task 4: Create booking route with Stripe Checkout

**Files:**
- Create: `src/routes/booking.ts`
- Modify: `src/server.ts:10,46-48` (register new route)

**Step 1: Create `src/routes/booking.ts`**

```typescript
import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { logger } from '../utils/logger';
import { supabase } from '../db/supabase';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const router = Router();

// GET /book/:shortId — Show trip details and redirect to Stripe Checkout
router.get('/:shortId', async (req: Request, res: Response) => {
  const { shortId } = req.params;

  try {
    // Find trip by short ID
    const { data: trips } = await supabase
      .from('trips')
      .select('*, captains!inner(display_name)')
      .eq('status', 'open');

    const trip = trips?.find((t: any) => t.id.substring(0, 6) === shortId);

    if (!trip) {
      res.status(404).send(tripNotFoundPage());
      return;
    }

    if (trip.current_bookings >= trip.max_seats) {
      res.status(200).send(fullPage(trip));
      return;
    }

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const captainName = (trip as any).captains?.display_name || 'Captain';

    const date = new Date(trip.departure_at);
    const formattedDate = date.toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' });
    const formattedTime = date.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });
    const tripTypeLabel = trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1);

    res.send(bookingPage({
      shortId,
      tripTypeLabel,
      formattedDate,
      formattedTime,
      durationHours: trip.duration_hours,
      meetingPoint: trip.meeting_point || 'TBA',
      priceAed: trip.price_per_person_aed,
      seatsLeft: trip.max_seats - trip.current_bookings,
      maxSeats: trip.max_seats,
      threshold: trip.threshold,
      captainName,
      checkoutUrl: `${baseUrl}/book/${shortId}/checkout`,
    }));
  } catch (err) {
    logger.error({ err, shortId }, 'Error loading booking page');
    res.status(500).send('Something went wrong. Please try again.');
  }
});

// POST /book/:shortId/checkout — Create Stripe Checkout Session
router.post('/:shortId/checkout', async (req: Request, res: Response) => {
  const { shortId } = req.params;

  try {
    const { data: trips } = await supabase
      .from('trips')
      .select('*')
      .eq('status', 'open');

    const trip = trips?.find((t: any) => t.id.substring(0, 6) === shortId);

    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    if (trip.current_bookings >= trip.max_seats) {
      res.status(400).json({ error: 'Trip is fully booked' });
      return;
    }

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const tripTypeLabel = trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1);
    const formattedDate = new Date(trip.departure_at).toLocaleDateString('en-AE', {
      weekday: 'short', day: 'numeric', month: 'short',
    });

    // Create a pending booking
    const { data: booking, error: bookingErr } = await supabase
      .from('bookings')
      .insert({
        trip_id: trip.id,
        captain_id: trip.captain_id,
        guest_whatsapp_id: 'pending_checkout',
        num_seats: 1,
        price_per_seat_aed: trip.price_per_person_aed,
        total_amount_aed: trip.price_per_person_aed,
        status: 'pending_payment',
      })
      .select()
      .single();

    if (bookingErr || !booking) {
      logger.error({ err: bookingErr }, 'Failed to create booking');
      res.status(500).json({ error: 'Failed to create booking' });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'aed',
            product_data: {
              name: `${tripTypeLabel} Trip — ${formattedDate}`,
              description: `${trip.meeting_point || 'TBA'} | ${trip.duration_hours || '?'}h`,
            },
            unit_amount: Math.round(trip.price_per_person_aed * 100),
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        capture_method: 'manual',
        metadata: {
          booking_id: booking.id,
          trip_id: trip.id,
          captain_id: trip.captain_id,
        },
      },
      custom_fields: [
        {
          key: 'whatsapp_number',
          label: { type: 'custom', custom: 'WhatsApp Number (for booking updates)' },
          type: 'numeric',
        },
      ],
      success_url: `${baseUrl}/book/${shortId}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/book/${shortId}`,
    });

    // Store session ID on booking for later lookup
    await supabase
      .from('bookings')
      .update({ payment_link: session.url, stripe_payment_intent_id: session.payment_intent as string })
      .eq('id', booking.id);

    res.redirect(303, session.url!);
  } catch (err) {
    logger.error({ err, shortId }, 'Error creating checkout session');
    res.status(500).send('Something went wrong. Please try again.');
  }
});

// GET /book/:shortId/success — Post-payment success page
router.get('/:shortId/success', async (req: Request, res: Response) => {
  const sessionId = req.query.session_id as string;

  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const whatsappField = session.custom_fields?.find((f: any) => f.key === 'whatsapp_number');
      const whatsappNumber = whatsappField?.numeric?.value || null;
      const bookingId = (session.payment_intent as any)?.metadata?.booking_id
        || session.metadata?.booking_id;

      // Update booking with guest's WhatsApp number from custom field
      if (whatsappNumber) {
        // Retrieve payment intent to get booking_id from metadata
        const pi = await stripe.paymentIntents.retrieve(session.payment_intent as string);
        const bId = pi.metadata.booking_id;
        if (bId) {
          await supabase
            .from('bookings')
            .update({
              guest_whatsapp_id: whatsappNumber,
              guest_name: session.customer_details?.name || null,
            })
            .eq('id', bId);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error processing success page');
    }
  }

  res.send(successPage());
});

// ─── HTML Pages ──────────────────────────────────────────────────────────────

function bookingPage(data: {
  shortId: string;
  tripTypeLabel: string;
  formattedDate: string;
  formattedTime: string;
  durationHours: number | null;
  meetingPoint: string;
  priceAed: number;
  seatsLeft: number;
  maxSeats: number;
  threshold: number;
  captainName: string;
  checkoutUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Book: ${data.tripTypeLabel} Trip</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f0f4f8; color: #1a1a2e; padding: 20px; }
    .card { max-width: 420px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #0077b6, #00b4d8); color: white; padding: 24px; }
    .header h1 { font-size: 22px; margin-bottom: 4px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .details { padding: 20px 24px; }
    .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; font-size: 15px; }
    .row:last-child { border-bottom: none; }
    .label { color: #666; }
    .value { font-weight: 600; }
    .price { font-size: 28px; font-weight: 700; color: #0077b6; text-align: center; padding: 16px; }
    .price small { font-size: 14px; color: #666; font-weight: 400; }
    .note { background: #f0f9ff; padding: 12px 24px; font-size: 13px; color: #0077b6; text-align: center; }
    .btn-wrap { padding: 20px 24px; }
    .btn { display: block; width: 100%; padding: 16px; background: #0077b6; color: white; border: none; border-radius: 12px; font-size: 17px; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; }
    .btn:active { background: #005f8a; }
    .seats { text-align: center; padding: 8px; font-size: 13px; color: #666; }
  </style>
</head>
<body>
  <form action="${data.checkoutUrl}" method="POST">
    <div class="card">
      <div class="header">
        <h1>${data.tripTypeLabel} Trip</h1>
        <p>by ${data.captainName}</p>
      </div>
      <div class="details">
        <div class="row"><span class="label">Date</span><span class="value">${data.formattedDate}</span></div>
        <div class="row"><span class="label">Time</span><span class="value">${data.formattedTime}${data.durationHours ? ` (${data.durationHours}h)` : ''}</span></div>
        <div class="row"><span class="label">Meeting Point</span><span class="value">${data.meetingPoint}</span></div>
        <div class="row"><span class="label">Seats Left</span><span class="value">${data.seatsLeft} of ${data.maxSeats}</span></div>
      </div>
      <div class="price">AED ${data.priceAed} <small>/person</small></div>
      <div class="note">Your card is only charged if ${data.threshold}+ people book. Otherwise the hold is released automatically.</div>
      <div class="btn-wrap">
        <button type="submit" class="btn">Book & Pay Securely</button>
      </div>
      <div class="seats">${data.seatsLeft} seat${data.seatsLeft !== 1 ? 's' : ''} remaining</div>
    </div>
  </form>
</body>
</html>`;
}

function successPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booked!</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f0f4f8; padding: 20px; }
    .card { text-align: center; background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); max-width: 400px; }
    .check { font-size: 64px; margin-bottom: 16px; }
    h1 { color: #0077b6; margin-bottom: 8px; }
    p { color: #666; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✅</div>
    <h1>You're booked!</h1>
    <p>Your card has a hold but won't be charged unless the trip confirms.<br><br>You'll get a WhatsApp message with updates. You can close this page.</p>
  </div>
</body>
</html>`;
}

function tripNotFoundPage(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f0f4f8;padding:20px}.card{text-align:center;background:white;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.1);max-width:400px}h1{color:#e63946}</style></head>
<body><div class="card"><h1>Trip Not Found</h1><p>This trip may have been cancelled or the link is invalid.</p></div></body></html>`;
}

function fullPage(trip: any): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fully Booked</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f0f4f8;padding:20px}.card{text-align:center;background:white;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.1);max-width:400px}h1{color:#e63946}</style></head>
<body><div class="card"><h1>Fully Booked!</h1><p>All ${trip.max_seats} seats are taken. Contact the captain for the next trip.</p></div></body></html>`;
}

export default router;
```

**Step 2: Register route in `src/server.ts`**

Add import at line 10 area:
```typescript
import bookingRouter from './routes/booking';
```

Add route registration after the admin route (around line 48):
```typescript
app.use('/book', bookingRouter);
```

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/routes/booking.ts src/server.ts
git commit -m "feat: add booking page with Stripe Checkout for guest payments"
```

---

### Task 5: Handle checkout.session.completed webhook for guest WhatsApp DM

**Files:**
- Modify: `src/routes/stripe.ts:33-186` (add new case in handleStripeEvent)

**Step 1: Add checkout.session.completed handler**

Add this case in the `handleStripeEvent` switch statement, before the `default` case:

```typescript
case 'checkout.session.completed': {
  const session = event.data.object as Stripe.Checkout.Session;
  const piId = session.payment_intent as string;

  if (!piId) return;

  // Retrieve payment intent to get booking metadata
  const pi = await stripe.paymentIntents.retrieve(piId);
  const bookingId = pi.metadata.booking_id;

  if (!bookingId) {
    logger.warn({ sessionId: session.id }, 'Checkout session missing booking metadata');
    return;
  }

  // Extract WhatsApp number from custom field
  const whatsappField = session.custom_fields?.find((f: any) => f.key === 'whatsapp_number');
  const whatsappNumber = whatsappField?.numeric?.value || null;
  const guestName = session.customer_details?.name || null;

  // Update booking with guest info
  const updateData: any = {};
  if (whatsappNumber) updateData.guest_whatsapp_id = whatsappNumber;
  if (guestName) updateData.guest_name = guestName;

  if (Object.keys(updateData).length > 0) {
    await supabase
      .from('bookings')
      .update(updateData)
      .eq('id', bookingId);
  }

  // Also store the PI metadata with guest_wa_id so the existing
  // payment_intent.amount_capturable_updated handler can DM the guest
  if (whatsappNumber) {
    await stripe.paymentIntents.update(piId, {
      metadata: { ...pi.metadata, guest_wa_id: whatsappNumber },
    });
  }

  logger.info({ bookingId, whatsappNumber, guestName }, 'Checkout session completed — guest info saved');
  break;
}
```

Note: The existing `payment_intent.amount_capturable_updated` handler already handles creating the booking authorization, incrementing counts, and checking threshold. The `checkout.session.completed` handler just enriches the booking with guest contact info.

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/routes/stripe.ts
git commit -m "feat: handle checkout.session.completed to save guest WhatsApp number"
```

---

### Task 6: Modify Stripe service to work without Connect

**Files:**
- Modify: `src/services/stripe.ts:7-52` (createPaymentIntent function)

**Step 1: Make Connect params conditional**

Update `createPaymentIntent` to work with or without a captain Stripe account:

```typescript
export async function createPaymentIntent(data: {
  amountAed: number;
  captainStripeAccountId?: string | null;
  bookingId: string;
  tripId: string;
  captainId: string;
  guestWaId?: string;
}): Promise<Stripe.PaymentIntent> {
  const amountFils = Math.round(data.amountAed * 100);

  const piData: Stripe.PaymentIntentCreateParams = {
    amount: amountFils,
    currency: 'aed',
    capture_method: 'manual',
    payment_method_types: ['card'],
    metadata: {
      booking_id: data.bookingId,
      trip_id: data.tripId,
      captain_id: data.captainId,
      guest_wa_id: data.guestWaId || '',
    },
  };

  // Only add Connect params if captain has a Stripe account
  if (data.captainStripeAccountId) {
    const feeAmount = Math.round(data.amountAed * 10); // 10% in fils
    piData.application_fee_amount = feeAmount;
    piData.transfer_data = { destination: data.captainStripeAccountId };
  }

  const paymentIntent = await stripe.paymentIntents.create(piData);

  logger.info(
    { piId: paymentIntent.id, bookingId: data.bookingId, amountAed: data.amountAed },
    'PaymentIntent created'
  );

  // Record in stripe_intents table
  await supabase.from('stripe_intents').insert({
    booking_id: data.bookingId,
    trip_id: data.tripId,
    captain_id: data.captainId,
    payment_intent_id: paymentIntent.id,
    amount_aed: data.amountAed,
    stripe_status: paymentIntent.status,
    is_current: true,
  });

  return paymentIntent;
}
```

Also update `createPaymentLink` similarly — make `captainStripeAccountId` optional and conditionally add Connect params:

```typescript
export async function createPaymentLink(data: {
  amountAed: number;
  tripType: string;
  departureDate: string;
  captainName: string;
  numSeats: number;
  captainStripeAccountId?: string | null;
  bookingId: string;
}): Promise<string> {
  const piData: any = {
    capture_method: 'manual',
    metadata: { booking_id: data.bookingId },
  };

  if (data.captainStripeAccountId) {
    piData.application_fee_amount = Math.round(data.amountAed * 10);
    piData.transfer_data = { destination: data.captainStripeAccountId };
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'aed',
          product_data: {
            name: `${data.tripType} Trip — ${data.departureDate}`,
            description: `${data.numSeats} seat(s) | Captain: ${data.captainName}`,
          },
          unit_amount: Math.round(data.amountAed * 100 / data.numSeats),
        },
        quantity: data.numSeats,
      },
    ],
    payment_intent_data: piData,
    payment_method_types: ['card'],
    success_url: `${process.env.APP_URL || 'http://localhost:3000'}/booking/success?booking_id=${data.bookingId}`,
    cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/booking/cancel?booking_id=${data.bookingId}`,
  });

  const url = session.url || '';
  logger.info({ bookingId: data.bookingId, sessionId: session.id }, 'Checkout session created');
  return url;
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/services/stripe.ts
git commit -m "feat: make Stripe Connect params optional for platform-only payments"
```

---

### Task 7: Add /repeat command

**Files:**
- Modify: `src/handlers/commandHandler.ts` (add case in switch + new handler)

**Step 1: Add /repeat to the switch in handleCommand**

Add after the `/connect` case:

```typescript
case '/repeat':
  await handleRepeatCommand(from);
  break;
```

**Step 2: Add handleRepeatCommand function**

```typescript
async function handleRepeatCommand(from: string): Promise<void> {
  const captain = await getCaptain(from);
  if (!captain) {
    await sendTextMessage(from, "You're not registered yet. Send me any message to start onboarding!");
    return;
  }

  if (captain.onboarding_step !== 'complete') {
    await sendTextMessage(from, 'Please complete your onboarding first.');
    return;
  }

  // Find captain's most recent trip
  const { data: trips } = await supabase
    .from('trips')
    .select('*')
    .eq('captain_id', captain.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!trips || trips.length === 0) {
    await sendTextMessage(from, "You haven't created any trips yet. Type /trip to create your first one!");
    return;
  }

  const lastTrip = trips[0];
  const tripTypeLabel = lastTrip.trip_type.charAt(0).toUpperCase() + lastTrip.trip_type.slice(1);

  // Store repeat state in Redis
  await redis.set(`repeat_wizard:${from}`, JSON.stringify({
    step: 'date',
    source_trip_id: lastTrip.id,
    captain_id: captain.id,
    trip_type: lastTrip.trip_type,
    meeting_point: lastTrip.meeting_point,
    location_url: lastTrip.location_url,
    max_seats: lastTrip.max_seats,
    threshold: lastTrip.threshold,
    price_per_person_aed: lastTrip.price_per_person_aed,
  }), { ex: 600 });

  await sendTextMessage(
    from,
    `🔄 Repeat your last trip:\n\n🚢 ${tripTypeLabel} Trip\n📍 ${lastTrip.meeting_point || 'TBA'}\n💰 AED ${lastTrip.price_per_person_aed}/person\n👥 ${lastTrip.max_seats} seats (min ${lastTrip.threshold})\n\nWhat date? (e.g. 28/03 or 28 March)`
  );
}
```

**Step 3: Add /repeat to the help text**

In `handleHelp`, update the message to include `/repeat`:

```typescript
async function handleHelp(from: string): Promise<void> {
  await sendTextMessage(
    from,
    `🚢 WataSeat Commands\n\n/trip — Create a new trip\n/repeat — Repeat your last trip (new date/time)\n/trips — View your upcoming trips\n/status [ID] — Check a trip's bookings\n/cancel [ID] — Cancel a trip\n/connect — Set up or update your Stripe account\n\nNeed help? Visit wataseat.com/support`
  );
}
```

**Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/handlers/commandHandler.ts
git commit -m "feat: add /repeat command to copy last trip settings"
```

---

### Task 8: Handle repeat wizard responses in onboarding handler

**Files:**
- Modify: `src/handlers/onboardingHandler.ts` (add repeat wizard check after trip wizard check)

**Step 1: Add repeat wizard handling**

After the trip wizard check (around line 39-44), add a check for `repeat_wizard:${from}`:

```typescript
// Check for repeat wizard state
const repeatState = await redis.get<string>(`repeat_wizard:${from}`);
if (repeatState) {
  const parsed = typeof repeatState === 'string' ? JSON.parse(repeatState) : repeatState;
  await handleRepeatWizardStep(from, text, parsed);
  return;
}
```

**Step 2: Add handleRepeatWizardStep function**

Add this function (can be in the same file or imported). Since it's small, add to onboardingHandler.ts:

```typescript
async function handleRepeatWizardStep(from: string, text: string, state: any): Promise<void> {
  const input = text.trim();

  switch (state.step) {
    case 'date': {
      // Reuse parseDate from tripWizardHandler — import it or inline
      const { parseDate } = require('./tripWizardHandler');
      const parsed = parseDate(input);
      if (!parsed) {
        await sendTextMessage(from, "I couldn't understand that date. Please use format like: 28/03 or 28 March");
        return;
      }
      if (parsed < new Date()) {
        await sendTextMessage(from, 'That date has already passed. Enter a future date.');
        return;
      }
      state.departure_date = parsed.toISOString().split('T')[0];
      state.step = 'time';
      await redis.set(`repeat_wizard:${from}`, JSON.stringify(state), { ex: 600 });
      await sendTextMessage(from, 'What time? (e.g. 6am, 06:00, 14:30)');
      break;
    }

    case 'time': {
      const { parseTime } = require('./tripWizardHandler');
      const time = parseTime(input);
      if (!time) {
        await sendTextMessage(from, "I couldn't understand that time. Please use format like: 6am, 06:00, or 14:30");
        return;
      }
      state.departure_time = time;
      state.step = 'duration';
      await redis.set(`repeat_wizard:${from}`, JSON.stringify(state), { ex: 600 });
      await sendTextMessage(from, 'Duration in hours? (e.g. 4 or 4.5)');
      break;
    }

    case 'duration': {
      const duration = parseFloat(input);
      if (isNaN(duration) || duration <= 0 || duration > 72) {
        await sendTextMessage(from, 'Please enter a valid duration in hours (e.g. 4 or 4.5)');
        return;
      }
      state.duration_hours = duration;
      state.step = 'confirm';
      await redis.set(`repeat_wizard:${from}`, JSON.stringify(state), { ex: 600 });

      const tripTypeLabel = state.trip_type.charAt(0).toUpperCase() + state.trip_type.slice(1);
      const departureAt = `${state.departure_date}T${state.departure_time}:00`;
      const date = new Date(departureAt);
      const formattedDate = date.toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' });
      const formattedTime = date.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });

      await sendTextMessage(
        from,
        `📋 Repeat Trip Summary\n\n🚢 ${tripTypeLabel}\n📅 ${formattedDate} at ${formattedTime}\n⏱ ${duration}h\n📍 ${state.meeting_point || 'TBA'}\n👥 ${state.max_seats} seats (min ${state.threshold})\n💰 AED ${state.price_per_person_aed}/person\n\nReply YES to confirm, NO to cancel.`
      );
      break;
    }

    case 'confirm': {
      if (input.toUpperCase() === 'YES') {
        await redis.del(`repeat_wizard:${from}`);

        const { createTrip } = require('../services/trips');
        const tripTypeLabel = state.trip_type.charAt(0).toUpperCase() + state.trip_type.slice(1);
        const departureAt = `${state.departure_date}T${state.departure_time}:00`;

        // Find captain's group
        const { data: groups } = await supabase
          .from('whatsapp_groups')
          .select('id')
          .eq('captain_id', state.captain_id)
          .eq('is_active', true)
          .limit(1);

        const groupId = groups?.[0]?.id;
        if (!groupId) {
          await sendTextMessage(from, 'No group found. Type /trip to create a trip from scratch.');
          return;
        }

        const trip = await createTrip({
          captain_id: state.captain_id,
          group_id: groupId,
          trip_type: state.trip_type,
          title: `${tripTypeLabel} Trip`,
          departure_at: departureAt,
          duration_hours: state.duration_hours,
          meeting_point: state.meeting_point,
          location_url: state.location_url,
          max_seats: state.max_seats,
          threshold: state.threshold,
          price_per_person_aed: state.price_per_person_aed,
        });

        const shortId = trip.id.substring(0, 6);
        const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
        const bookingUrl = `${baseUrl}/book/${shortId}`;
        const date = new Date(departureAt);
        const formattedDate = date.toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' });
        const formattedTime = date.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });

        await sendTextMessage(from, `✅ Trip created! [${shortId}]\n\nType /status ${shortId} to track bookings.`);

        const shareMsg = `🚢 ${tripTypeLabel} Trip — ${formattedDate}\n📍 ${state.meeting_point || 'TBA'}\n⏰ ${formattedTime}${state.duration_hours ? ` (${state.duration_hours}h)` : ''}\n💰 AED ${state.price_per_person_aed}/person\n👥 ${state.max_seats} seats (need ${state.threshold} min to confirm)\n\nBook & pay securely:\n${bookingUrl}\n\nYour card is only charged if the trip confirms!`;

        await sendTextMessage(from, `📋 Copy this message and share it in your group:\n\n${shareMsg}`);

        const { logger } = require('../utils/logger');
        logger.info({ tripId: trip.id, captainId: state.captain_id }, 'Trip created via repeat wizard');
      } else {
        await redis.del(`repeat_wizard:${from}`);
        await sendTextMessage(from, '❌ Repeat cancelled. Type /repeat to try again or /trip for a new trip.');
      }
      break;
    }
  }
}
```

**Step 3: Export parseDate and parseTime from tripWizardHandler**

In `src/handlers/tripWizardHandler.ts`, add `export` to the `parseDate` and `parseTime` functions (currently they're private):

Change `function parseDate(` to `export function parseDate(`
Change `function parseTime(` to `export function parseTime(`

**Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/handlers/onboardingHandler.ts src/handlers/tripWizardHandler.ts
git commit -m "feat: handle repeat wizard responses (date, time, duration, confirm)"
```

---

### Task 9: Set APP_URL environment variable

**Files:**
- Modify: `.env`

**Step 1: Add APP_URL**

Add to `.env`:
```
APP_URL=https://buzzardlike-calista-nonterminally.ngrok-free.dev
```

This is the ngrok URL that booking links will use. Must match the current ngrok tunnel.

**Step 2: Commit** (do NOT commit .env — it's gitignored)

No commit needed for .env.

---

### Task 10: End-to-end verification

**Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Restart dev server**

The `tsx watch` should auto-reload, but verify server is running on port 3002.

**Step 3: Test trip creation**

DM the bot `/trip` → complete wizard → verify you get the shareable message with booking URL.

**Step 4: Test booking page**

Open the booking URL in a browser → verify trip details show → click "Book & Pay Securely" → verify Stripe Checkout opens with Apple Pay option and WhatsApp number field.

**Step 5: Test /repeat**

DM the bot `/repeat` → verify it shows last trip settings → enter date, time, duration → verify new trip created with booking link.

**Step 6: Test payment webhook**

Use Stripe CLI to forward webhooks locally:
```bash
stripe listen --forward-to localhost:3002/webhooks/stripe
```
Complete a test payment → verify booking status updates in Supabase.
