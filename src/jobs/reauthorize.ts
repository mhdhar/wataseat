import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';
import { cancelPaymentIntent, createPaymentIntent, createPaymentLink } from '../services/stripe';
import { notifyReauthRequired } from '../services/notifications';

export async function runReauthorization(): Promise<void> {
  logger.info('Running re-authorization job');

  const reauthDays = parseInt(process.env.STRIPE_AUTH_REAUTH_DAYS || '6');
  const cutoff = new Date(Date.now() - reauthDays * 24 * 60 * 60 * 1000).toISOString();

  // Find authorized bookings older than reauthDays where trip is still open
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('*, trips!inner(*), captains:captain_id(*)')
    .eq('status', 'authorized')
    .lt('authorized_at', cutoff)
    .eq('trips.status', 'open');

  if (error) {
    logger.error({ err: error }, 'Failed to query bookings for reauth');
    return;
  }

  if (!bookings || bookings.length === 0) {
    logger.debug('No bookings need re-authorization');
    return;
  }

  for (const booking of bookings) {
    const trip = (booking as any).trips;
    const captain = (booking as any).captains;

    if (!captain?.stripe_account_id) {
      logger.warn({ bookingId: booking.id }, 'Captain has no Stripe account — skipping reauth');
      continue;
    }

    try {
      // Get current stripe intent
      const { data: currentIntent } = await supabase
        .from('stripe_intents')
        .select('*')
        .eq('booking_id', booking.id)
        .eq('is_current', true)
        .single();

      if (!currentIntent) continue;

      // Cancel old PaymentIntent
      try {
        await cancelPaymentIntent(currentIntent.payment_intent_id);
      } catch (err) {
        logger.warn({ err, piId: currentIntent.payment_intent_id }, 'Failed to cancel old PI during reauth');
      }

      // Mark old intent as not current
      await supabase
        .from('stripe_intents')
        .update({ is_current: false })
        .eq('id', currentIntent.id);

      // Create new PaymentIntent
      const newPi = await createPaymentIntent({
        amountAed: booking.total_amount_aed,
        captainStripeAccountId: captain.stripe_account_id,
        bookingId: booking.id,
        tripId: booking.trip_id,
        captainId: captain.id,
        guestWaId: booking.guest_whatsapp_id,
      });

      // Update reauth count on the new intent
      await supabase
        .from('stripe_intents')
        .update({ reauth_count: currentIntent.reauth_count + 1 })
        .eq('payment_intent_id', newPi.id);

      // Create new payment link
      const departureDate = new Date(trip.departure_at).toLocaleDateString('en-AE', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });

      const newPaymentLinkUrl = await createPaymentLink({
        amountAed: booking.total_amount_aed,
        tripType: trip.trip_type,
        departureDate,
        captainName: captain.display_name,
        numSeats: booking.num_seats,
        captainStripeAccountId: captain.stripe_account_id,
        bookingId: booking.id,
      });

      // Update booking to pending_payment
      await supabase
        .from('bookings')
        .update({
          status: 'pending_payment',
          payment_link: newPaymentLinkUrl,
          stripe_payment_intent_id: newPi.id,
        })
        .eq('id', booking.id);

      // Update reauth_jobs
      await supabase
        .from('reauth_jobs')
        .update({ is_complete: true, executed_at: new Date().toISOString() })
        .eq('booking_id', booking.id)
        .eq('is_complete', false);

      // Create new reauth job for next cycle
      const nextReauth = new Date();
      nextReauth.setDate(nextReauth.getDate() + reauthDays);
      await supabase.from('reauth_jobs').insert({
        booking_id: booking.id,
        scheduled_for: nextReauth.toISOString(),
      });

      // Notify guest
      await notifyReauthRequired(booking, newPaymentLinkUrl);

      logger.info({ bookingId: booking.id }, 'Booking re-authorized');
    } catch (err) {
      logger.error({ err, bookingId: booking.id }, 'Failed to re-authorize booking');
    }
  }
}
