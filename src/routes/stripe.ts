import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import { logger } from '../utils/logger';
import { supabase } from '../db/supabase';
import { captureAllForTrip } from '../jobs/thresholdCheck';
import { sendTextMessage } from '../services/whatsapp';
import { notifyBookingAuthorized, notifyThresholdReached, notifyTripCancelled } from '../services/notifications';
import { SUPPORT_CONTACT } from '../config';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});
const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Stripe webhook signature verification failed');
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  res.json({ received: true });

  try {
    await handleStripeEvent(event);
  } catch (err) {
    logger.error({ err, eventType: event.type }, 'Error handling Stripe event');
  }
});

const EVENT_DEDUP_TTL = 86400; // 24 hours — covers Stripe's retry window

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  // Idempotency: use Redis SETNX to deduplicate across restarts and instances
  try {
    const dedupKey = `stripe_event:${event.id}`;
    const isNew = await redis.set(dedupKey, '1', { ex: EVENT_DEDUP_TTL, nx: true });
    if (!isNew) {
      logger.debug({ eventId: event.id }, 'Skipping duplicate webhook event');
      return;
    }
  } catch (err) {
    // If Redis is down, process the event rather than drop it
    logger.warn({ err, eventId: event.id }, 'Redis dedup check failed — processing event anyway');
  }

  switch (event.type) {
    case 'account.updated': {
      const account = event.data.object as Stripe.Account;
      logger.info({ accountId: account.id }, 'Stripe account updated');

      await supabase
        .from('captains')
        .update({
          stripe_charges_enabled: account.charges_enabled,
          stripe_payouts_enabled: account.payouts_enabled,
        })
        .eq('stripe_account_id', account.id);

      // If charges just became enabled, update onboarding
      if (account.charges_enabled) {
        const { data: captain } = await supabase
          .from('captains')
          .select('*')
          .eq('stripe_account_id', account.id)
          .single();

        if (captain && captain.onboarding_step === 'stripe') {
          await supabase
            .from('captains')
            .update({ onboarding_step: 'complete', is_active: true })
            .eq('id', captain.id);

          await sendTextMessage(
            captain.whatsapp_id,
            "Your Stripe account is now active! You're all set to post trips. Add me to your WhatsApp group and type /trip to create your first trip."
          );
        }
      }
      break;
    }

    case 'payment_intent.amount_capturable_updated': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const bookingId = pi.metadata.booking_id;
      const tripId = pi.metadata.trip_id;

      if (!bookingId || !tripId) {
        logger.warn({ piId: pi.id }, 'PaymentIntent missing metadata');
        return;
      }

      logger.info({ bookingId, tripId, piId: pi.id }, 'Payment authorized');

      // Update booking
      await supabase
        .from('bookings')
        .update({
          status: 'authorized',
          authorized_at: new Date().toISOString(),
          stripe_payment_intent_id: pi.id,
        })
        .eq('id', bookingId);

      // Upsert stripe_intents (checkout flow doesn't use createPaymentIntent, so insert if missing)
      const { data: existingIntent } = await supabase
        .from('stripe_intents')
        .select('id')
        .eq('payment_intent_id', pi.id)
        .single();

      if (existingIntent) {
        await supabase
          .from('stripe_intents')
          .update({ stripe_status: 'requires_capture' })
          .eq('payment_intent_id', pi.id);
      } else {
        await supabase.from('stripe_intents').insert({
          booking_id: bookingId,
          trip_id: tripId,
          captain_id: pi.metadata.captain_id || '',
          payment_intent_id: pi.id,
          amount_aed: pi.amount / 100,
          stripe_status: 'requires_capture',
          is_current: true,
        });
      }

      // Atomically increment trip booking count
      const { data: booking } = await supabase
        .from('bookings')
        .select('num_seats')
        .eq('id', bookingId)
        .single();

      const seats = booking?.num_seats || 1;
      const { data: newCount } = await supabase.rpc('atomic_increment_bookings', {
        p_trip_id: tripId,
        p_delta: seats,
      });

      const { data: trip } = await supabase
        .from('trips')
        .select('*')
        .eq('id', tripId)
        .single();

      if (trip) {
        // WhatsApp notification is sent from checkout.session.completed handler
        // (guest number isn't available here yet — it's still 'pending_...')

        // Create reauth job scheduled 6 days from now
        const reauthDate = new Date();
        reauthDate.setDate(reauthDate.getDate() + (parseInt(process.env.STRIPE_AUTH_REAUTH_DAYS || '6')));
        await supabase.from('reauth_jobs').insert({
          booking_id: bookingId,
          scheduled_for: reauthDate.toISOString(),
        });

        // Check if threshold is met — capture immediately
        const currentCount = newCount ?? trip.current_bookings;
        if (currentCount >= trip.threshold && trip.status === 'open') {
          logger.info({ tripId, currentCount, threshold: trip.threshold }, 'Threshold reached — capturing all');
          await captureAllForTrip(tripId);
        }
      }
      break;
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const bookingId = pi.metadata.booking_id;
      const tripId = pi.metadata.trip_id;

      if (bookingId) {
        await supabase
          .from('bookings')
          .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            cancellation_reason: 'payment_failed',
          })
          .eq('id', bookingId);

        await supabase
          .from('stripe_intents')
          .update({ stripe_status: 'failed' })
          .eq('payment_intent_id', pi.id);

        // Notify guest
        const guestWaId = pi.metadata.guest_wa_id;
        if (guestWaId) {
          await sendTextMessage(
            guestWaId,
            `Your payment could not be processed. Please try booking again or contact your captain for help.\n\nQuestions? Visit ${SUPPORT_CONTACT}`
          );
        }
      }
      break;
    }

    case 'payment_intent.canceled': {
      const pi = event.data.object as Stripe.PaymentIntent;
      await supabase
        .from('stripe_intents')
        .update({
          stripe_status: 'canceled',
          cancelled_at: new Date().toISOString(),
        })
        .eq('payment_intent_id', pi.id);

      // Notify guest if their authorized hold expired
      const cancelBookingId = pi.metadata.booking_id;
      if (cancelBookingId) {
        const { data: cancelBooking } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', cancelBookingId)
          .eq('status', 'authorized')
          .single();

        if (cancelBooking) {
          await supabase
            .from('bookings')
            .update({
              status: 'cancelled',
              cancelled_at: new Date().toISOString(),
              cancellation_reason: 'auth_expired',
            })
            .eq('id', cancelBookingId);

          if (cancelBooking.guest_whatsapp_id && !cancelBooking.guest_whatsapp_id.startsWith('pending')) {
            await sendTextMessage(
              cancelBooking.guest_whatsapp_id,
              `The hold on your card for AED ${cancelBooking.total_amount_aed} has expired. If the trip is still open, you may need to re-book.\n\nBooking ID: ${cancelBooking.id.substring(0, 8)}\nQuestions? Visit ${SUPPORT_CONTACT}`
            );
          }

          // Decrement trip booking count
          await supabase.rpc('atomic_increment_bookings', {
            p_trip_id: cancelBooking.trip_id,
            p_delta: -(cancelBooking.num_seats || 1),
          });
        }
      }
      break;
    }

    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const piId = session.payment_intent as string;

      if (!piId) return;

      const pi = await stripe.paymentIntents.retrieve(piId);
      const bookingId = pi.metadata.booking_id;

      if (!bookingId) {
        logger.warn({ sessionId: session.id }, 'Checkout session missing booking metadata');
        return;
      }

      const whatsappField = session.custom_fields?.find((f: any) => f.key === 'whatsapp_number');
      let whatsappNumber = whatsappField?.numeric?.value || null;
      // Sanitize guest name: strip HTML tags and limit length
      const rawName = session.customer_details?.name || null;
      const guestName = rawName ? rawName.replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s\-'.]/gu, '').substring(0, 100) : null;

      // Normalize WhatsApp number: strip leading + or 00
      if (whatsappNumber) {
        whatsappNumber = whatsappNumber.replace(/^\+/, '').replace(/^00/, '');
      }

      const updateData: Record<string, any> = {};
      if (whatsappNumber) updateData.guest_whatsapp_id = whatsappNumber;
      if (guestName) updateData.guest_name = guestName;

      if (Object.keys(updateData).length > 0) {
        await supabase
          .from('bookings')
          .update(updateData)
          .eq('id', bookingId);
      }

      if (whatsappNumber) {
        await stripe.paymentIntents.update(piId, {
          metadata: { ...pi.metadata, guest_wa_id: whatsappNumber },
        });

        // Wait for PI handler to finish incrementing booking count
        // (both webhooks fire simultaneously; PI handler needs time to commit)
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Read fresh data after delay
        const { data: booking } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', bookingId)
          .single();

        if (booking) {
          const { data: freshTrip } = await supabase
            .from('trips')
            .select('*')
            .eq('id', booking.trip_id)
            .single();

          if (!freshTrip) break;

          const tripType = freshTrip.trip_type.charAt(0).toUpperCase() + freshTrip.trip_type.slice(1);
          const tripShortId = freshTrip.id.substring(0, 6);
          const bookingShortId = booking.id.substring(0, 8);
          const depDate = new Date(freshTrip.departure_at).toLocaleDateString('en-AE', {
            weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai',
          });
          const depTime = new Date(freshTrip.departure_at).toLocaleTimeString('en-AE', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai',
          });
          const locationLine = freshTrip.location_url ? `\n📍 Location: ${freshTrip.location_url}` : '';

          const isConfirmed = freshTrip.status === 'confirmed' || booking.status === 'confirmed';
          const thresholdMet = freshTrip.current_bookings >= freshTrip.threshold;

          // Guest confirmation
          let thresholdMsg: string;
          if (isConfirmed) {
            thresholdMsg = `🎉 Trip confirmed — you're ready to sail! Your card has been charged.${locationLine}`;
          } else if (thresholdMet) {
            thresholdMsg = `🎉 Trip confirmed — you're ready to sail! Your card will be charged shortly.${locationLine}`;
          } else {
            const remaining = freshTrip.threshold - freshTrip.current_bookings;
            thresholdMsg = `⏳ Your card has a hold but won't be charged yet — we need ${remaining} more booking${remaining !== 1 ? 's' : ''} to confirm the trip (${freshTrip.current_bookings}/${freshTrip.threshold} booked so far).\n\nWe'll notify you once the trip is confirmed!`;
          }

          await sendTextMessage(
            whatsappNumber,
            `✅ Booking confirmed!\n\nBooking ID: ${bookingShortId}\n${tripType} Trip — ${depDate} at ${depTime}\n📍 ${freshTrip.meeting_point || 'TBA'}\n💰 AED ${booking.total_amount_aed}\n\n${thresholdMsg}`
          );

          // Captain notification — new booking
          const { data: captain } = await supabase
            .from('captains')
            .select('whatsapp_id')
            .eq('id', freshTrip.captain_id)
            .single();

          if (captain) {
            const captainThresholdMsg = thresholdMet
              ? `\n\n✅ Threshold met! Trip is confirmed.`
              : `\n\nNeed ${freshTrip.threshold - freshTrip.current_bookings} more to confirm.`;
            await sendTextMessage(
              captain.whatsapp_id,
              `🎉 New booking! ${guestName || 'A guest'} booked your ${tripType} Trip [${tripShortId}].\n\n📅 ${depDate} at ${depTime}\nBooking ID: ${bookingShortId}\n${freshTrip.current_bookings}/${freshTrip.max_seats} seats filled.${captainThresholdMsg}`
            );
          }
        }
      }

      logger.info({ bookingId, whatsappNumber, guestName }, 'Checkout session completed — guest info saved');
      break;
    }

    default:
      logger.debug({ eventType: event.type }, 'Unhandled Stripe event');
  }
}

export default router;
