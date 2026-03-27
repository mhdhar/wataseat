import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { logger } from '../utils/logger';
import { supabase } from '../db/supabase';
import { captureAllForTrip } from '../jobs/thresholdCheck';
import { sendTextMessage } from '../services/whatsapp';
import { notifyBookingAuthorized, notifyThresholdReached, notifyTripCancelled } from '../services/notifications';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
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

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
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

      // Update stripe_intents
      await supabase
        .from('stripe_intents')
        .update({ stripe_status: 'requires_capture' })
        .eq('payment_intent_id', pi.id);

      // Increment trip booking count
      const { data: trip } = await supabase
        .from('trips')
        .select('*')
        .eq('id', tripId)
        .single();

      if (trip) {
        const newCount = trip.current_bookings + 1;
        await supabase
          .from('trips')
          .update({ current_bookings: newCount })
          .eq('id', tripId);

        // Get booking for notifications
        const { data: booking } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', bookingId)
          .single();

        if (booking) {
          await notifyBookingAuthorized(booking, { ...trip, current_bookings: newCount });

          // Create reauth job scheduled 6 days from now
          const reauthDate = new Date();
          reauthDate.setDate(reauthDate.getDate() + (parseInt(process.env.STRIPE_AUTH_REAUTH_DAYS || '6')));
          await supabase.from('reauth_jobs').insert({
            booking_id: bookingId,
            scheduled_for: reauthDate.toISOString(),
          });
        }

        // Check if threshold is met — capture immediately
        if (newCount >= trip.threshold && trip.status === 'open') {
          logger.info({ tripId, newCount, threshold: trip.threshold }, 'Threshold reached — capturing all');
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
            'Your payment could not be processed. Please try booking again or contact your captain for help.'
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
      break;
    }

    default:
      logger.debug({ eventType: event.type }, 'Unhandled Stripe event');
  }
}

export default router;
