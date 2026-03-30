import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';
import { cancelPaymentIntent } from '../services/stripe';
import { sendTextMessage } from '../services/whatsapp';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function runReauthorization(): Promise<void> {
  logger.info('Running re-authorization job');

  const reauthDays = parseInt(process.env.STRIPE_AUTH_REAUTH_DAYS || '6');
  const cutoff = new Date(Date.now() - reauthDays * 24 * 60 * 60 * 1000).toISOString();

  // Find authorized bookings older than reauthDays where trip is still open
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('*, trips!inner(*)')
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

      // Create new Checkout Session for re-authorization
      const tripType = trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1);
      const shortId = trip.id.substring(0, 6);
      const depDate = new Date(trip.departure_at).toLocaleDateString('en-AE', {
        weekday: 'short', day: 'numeric', month: 'short',
      });
      const depTime = new Date(trip.departure_at).toLocaleTimeString('en-AE', {
        hour: '2-digit', minute: '2-digit',
      });
      const baseUrl = process.env.APP_URL || 'http://localhost:3002';

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'aed',
            product_data: {
              name: `${tripType} Trip — ${depDate} (Re-authorization)`,
              description: `Renew your hold for booking ${booking.id.substring(0, 8)}`,
            },
            unit_amount: Math.round(booking.total_amount_aed * 100),
          },
          quantity: 1,
        }],
        payment_intent_data: {
          capture_method: 'manual',
          metadata: {
            booking_id: booking.id,
            trip_id: booking.trip_id,
            captain_id: booking.captain_id,
            guest_wa_id: booking.guest_whatsapp_id,
            is_reauth: 'true',
          },
        },
        success_url: `${baseUrl}/book/${shortId}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/book/${shortId}`,
      });

      // Update booking with new payment link
      await supabase
        .from('bookings')
        .update({
          status: 'pending_payment',
          payment_link: session.url,
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

      // Notify guest via plain text WhatsApp
      const guestWaId = booking.guest_whatsapp_id;
      if (guestWaId && !guestWaId.startsWith('pending')) {
        const guestName = booking.guest_name?.split(' ')[0] || 'there';
        await sendTextMessage(
          guestWaId,
          `Hi ${guestName}, your reservation for the ${tripType} Trip on ${depDate} at ${depTime} is still active.\n\nTo keep your seat, please renew your card authorization:\n${session.url}\n\nYour card will not be charged until the trip confirms.`
        );
      }

      logger.info({ bookingId: booking.id, reauthCount: currentIntent.reauth_count + 1 }, 'Booking re-authorization sent');
    } catch (err) {
      logger.error({ err, bookingId: booking.id }, 'Failed to re-authorize booking');
    }
  }
}
