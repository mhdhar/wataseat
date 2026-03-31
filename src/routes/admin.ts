import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { logger } from '../utils/logger';
import { sendTemplateMessage, sendTextMessage } from '../services/whatsapp';
import { cancelAllForTrip } from '../jobs/thresholdCheck';
import { supabase } from '../db/supabase';
import { createPaymentLink, cancelPaymentIntent, refundPaymentIntent } from '../services/stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const router = Router();

// Verify admin secret on all requests
router.use((req: Request, res: Response, next) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

// Send WhatsApp template message
router.post('/send-whatsapp', async (req: Request, res: Response) => {
  const { to, templateName, templateParams } = req.body;

  if (!to || !templateName) {
    res.status(400).json({ error: 'Missing required fields: to, templateName' });
    return;
  }

  try {
    await sendTemplateMessage(to, templateName, templateParams || []);
    logger.info({ to, templateName }, 'Admin WhatsApp message sent');
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err.message, to, templateName }, 'Admin WhatsApp send failed');
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Cancel/delete a trip — releases Stripe holds, notifies guests + captain
router.post('/cancel-trip', async (req: Request, res: Response) => {
  const { tripId, reason } = req.body;

  if (!tripId) {
    res.status(400).json({ error: 'Missing required field: tripId' });
    return;
  }

  try {
    // Get trip + captain info before cancelling
    const { data: trip } = await supabase
      .from('trips')
      .select('*, captains(display_name, whatsapp_id)')
      .eq('id', tripId)
      .single();

    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    if (trip.status === 'cancelled') {
      res.status(400).json({ error: 'Trip is already cancelled' });
      return;
    }

    // Cancel trip — handles Stripe holds, booking updates, guest + group notifications
    await cancelAllForTrip(tripId, reason || 'Cancelled by admin');

    // Notify the captain
    const captain = trip.captains as { display_name: string; whatsapp_id: string } | null;
    if (captain?.whatsapp_id) {
      const tripDate = new Date(trip.departure_at).toLocaleDateString('en-AE', {
        weekday: 'short', day: 'numeric', month: 'short',
      });
      try {
        await sendTextMessage(
          captain.whatsapp_id,
          `Your trip "${trip.title}" on ${tripDate} has been cancelled by the admin. All guests have been notified and refunded.`
        );
      } catch (err) {
        logger.warn({ err, captainWaId: captain.whatsapp_id }, 'Failed to notify captain of trip deletion');
      }
    }

    logger.info({ tripId, reason }, 'Trip cancelled via admin dashboard');
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err.message, tripId }, 'Admin cancel trip failed');
    res.status(500).json({ error: 'Failed to cancel trip' });
  }
});

// Create a booking + payment link for a trip (admin test booking)
router.post('/create-booking', async (req: Request, res: Response) => {
  const { tripId, guestName, numSeats } = req.body;

  if (!tripId) {
    res.status(400).json({ error: 'Missing required field: tripId' });
    return;
  }

  try {
    const { data: trip } = await supabase
      .from('trips')
      .select('*, captains(display_name, stripe_account_id)')
      .eq('id', tripId)
      .single();

    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    const seats = numSeats || 1;
    const totalAmount = Number(trip.price_per_person_aed) * seats;
    const captain = trip.captains as { display_name: string; stripe_account_id: string | null } | null;

    // Create booking record
    const { data: booking, error: bookErr } = await supabase
      .from('bookings')
      .insert({
        trip_id: tripId,
        captain_id: trip.captain_id,
        guest_whatsapp_id: `admin_${Date.now()}`,
        guest_name: guestName || 'Admin Test',
        num_seats: seats,
        price_per_seat_aed: trip.price_per_person_aed,
        total_amount_aed: totalAmount,
        status: 'pending_payment',
      })
      .select()
      .single();

    if (bookErr || !booking) {
      res.status(500).json({ error: 'Failed to create booking' });
      return;
    }

    const depDate = new Date(trip.departure_at).toLocaleDateString('en-AE', {
      weekday: 'short', day: 'numeric', month: 'short',
    });

    // Create Stripe checkout link
    const paymentUrl = await createPaymentLink({
      amountAed: totalAmount,
      tripType: trip.trip_type,
      departureDate: depDate,
      captainName: captain?.display_name || 'Captain',
      numSeats: seats,
      captainStripeAccountId: captain?.stripe_account_id,
      bookingId: booking.id,
    });

    // Store payment link on booking
    await supabase
      .from('bookings')
      .update({ payment_link: paymentUrl, payment_link_sent_at: new Date().toISOString() })
      .eq('id', booking.id);

    logger.info({ tripId, bookingId: booking.id }, 'Admin booking created');
    res.json({ success: true, paymentUrl, bookingId: booking.id });
  } catch (err: any) {
    logger.error({ err: err.message, tripId }, 'Admin create booking failed');
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// Refund a booking — full saga: Stripe action → DB updates → guest notification
router.post('/refund-booking', async (req: Request, res: Response) => {
  const { bookingId } = req.body;

  if (!bookingId) {
    res.status(400).json({ error: 'Missing bookingId' });
    return;
  }

  // Step 0: Load booking with trip join + current stripe intent
  const { data: booking } = await supabase
    .from('bookings')
    .select('*, trips(title)')
    .eq('id', bookingId)
    .single();

  if (!booking) {
    res.status(404).json({ error: 'Booking not found' });
    return;
  }

  const { data: intentRow } = await supabase
    .from('stripe_intents')
    .select('payment_intent_id')
    .eq('booking_id', bookingId)
    .eq('is_current', true)
    .maybeSingle();

  // Pitfall 5: fall back to bookings.stripe_payment_intent_id if no stripe_intents row
  const piId = intentRow?.payment_intent_id ?? booking.stripe_payment_intent_id;
  if (!piId) {
    res.status(422).json({ error: 'No Stripe PaymentIntent found for this booking' });
    return;
  }

  let action: 'cancel' | 'refund' | 'error' = 'error';
  let stripeResponse: object = {};
  let success = false;
  let errorMessage: string | undefined;

  try {
    // Step 1: Live-retrieve PI status (D-01 — do NOT trust cached stripe_intents status)
    const pi = await stripe.paymentIntents.retrieve(piId);

    if (pi.status === 'requires_capture') {
      const result = await cancelPaymentIntent(pi.id);
      action = 'cancel';
      stripeResponse = { id: result.id, status: result.status };
    } else if (pi.status === 'succeeded') {
      const result = await refundPaymentIntent(pi.id);
      action = 'refund';
      stripeResponse = { id: result.id, status: result.status };
    } else {
      throw new Error(`PaymentIntent ${pi.id} is in state '${pi.status}' — cannot refund`);
    }

    // Step 2: DB updates — only after Stripe success (D-02)
    await supabase
      .from('bookings')
      .update({
        status: 'refunded',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: 'Refunded by admin',
      })
      .eq('id', bookingId);

    // Close open reauth jobs — mark complete, do NOT delete (D-06)
    await supabase
      .from('reauth_jobs')
      .update({ is_complete: true, executed_at: new Date().toISOString() })
      .eq('booking_id', bookingId)
      .eq('is_complete', false);

    // Note: trips.current_bookings was removed in Phase 1 migration 012 (D-07)
    // The trip_seat_occupancy view excludes 'refunded' status automatically

    success = true;
    logger.info({ bookingId, action }, 'Admin refund saga succeeded');
  } catch (err: any) {
    errorMessage = err.message;
    logger.error({ err: err.message, bookingId }, 'Admin refund saga failed');
  }

  // Step 3: Audit record — always written regardless of success or failure (D-03)
  await supabase.from('refund_audit').insert({
    booking_id: bookingId,
    triggered_by: 'admin',
    action,
    stripe_response: stripeResponse,
    success,
    error_message: errorMessage ?? null,
  });

  if (!success) {
    res.status(500).json({ error: errorMessage ?? 'Refund failed' });
    return;
  }

  // Step 4: Guest WhatsApp notification — only after Stripe + DB success (D-05, RFND-04)
  // Failure is logged but does NOT fail the response — refund is already complete
  if (booking.guest_whatsapp_id) {
    const trip = booking.trips as { title: string } | null;
    try {
      await sendTemplateMessage(booking.guest_whatsapp_id, 'booking_refunded', [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: booking.guest_name || 'there' },
            { type: 'text', text: trip?.title ?? 'Trip' },
          ],
        },
      ]);
    } catch (notifyErr: any) {
      logger.error({ err: notifyErr.message, bookingId }, 'Guest refund notification failed — refund already complete');
    }
  }

  res.json({ success: true, action });
});

export default router;
