import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';
import { capturePaymentIntent, cancelPaymentIntent } from '../services/stripe';
import { notifyThresholdReached, notifyTripCancelled } from '../services/notifications';
import { Booking, Trip } from '../types';

export async function runThresholdCheck(): Promise<void> {
  logger.info('Running threshold check job');

  const hoursBeforeDeparture = parseInt(process.env.THRESHOLD_CHECK_HOURS_BEFORE || '12');
  const checkTime = new Date(Date.now() + hoursBeforeDeparture * 60 * 60 * 1000);

  // Find open trips departing within the threshold window
  const { data: trips, error } = await supabase
    .from('trips')
    .select('*')
    .eq('status', 'open')
    .lte('departure_at', checkTime.toISOString())
    .is('threshold_check_sent_at', null);

  if (error) {
    logger.error({ err: error }, 'Failed to query trips for threshold check');
    return;
  }

  if (!trips || trips.length === 0) {
    logger.debug('No trips need threshold check');
    return;
  }

  for (const trip of trips) {
    if (trip.current_bookings >= trip.threshold) {
      // Threshold met — capture all
      logger.info({ tripId: trip.id }, 'Threshold met at check time — capturing');
      await captureAllForTrip(trip.id);
    } else {
      // Threshold not met — cancel all
      logger.info({ tripId: trip.id, current: trip.current_bookings, threshold: trip.threshold }, 'Threshold not met — cancelling');
      await cancelAllForTrip(trip.id, 'threshold_not_met');
    }

    // Mark as checked
    await supabase
      .from('trips')
      .update({ threshold_check_sent_at: new Date().toISOString() })
      .eq('id', trip.id);
  }
}

export async function captureAllForTrip(tripId: string): Promise<void> {
  // Get all authorized bookings with their stripe intents
  const { data: bookings, error: bookErr } = await supabase
    .from('bookings')
    .select('*')
    .eq('trip_id', tripId)
    .eq('status', 'authorized');

  if (bookErr || !bookings || bookings.length === 0) {
    logger.warn({ tripId }, 'No authorized bookings to capture');
    return;
  }

  const { data: trip } = await supabase
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();

  if (!trip) return;

  const capturedBookings: Booking[] = [];

  for (const booking of bookings) {
    // Get current stripe intent
    const { data: intent } = await supabase
      .from('stripe_intents')
      .select('*')
      .eq('booking_id', booking.id)
      .eq('is_current', true)
      .single();

    if (!intent) {
      logger.warn({ bookingId: booking.id }, 'No current stripe intent found');
      continue;
    }

    try {
      await capturePaymentIntent(intent.payment_intent_id);

      const platformFee = Number(booking.total_amount_aed) * parseFloat(process.env.PLATFORM_COMMISSION_RATE || '0.10');
      const captainPayout = Number(booking.total_amount_aed) - platformFee;

      // Update booking
      await supabase
        .from('bookings')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
          platform_fee_aed: platformFee,
          captain_payout_aed: captainPayout,
        })
        .eq('id', booking.id);

      // Update stripe intent
      await supabase
        .from('stripe_intents')
        .update({
          stripe_status: 'succeeded',
          captured_at: new Date().toISOString(),
          application_fee_amount: platformFee,
          transfer_amount: captainPayout,
        })
        .eq('id', intent.id);

      capturedBookings.push(booking);
      logger.info({ bookingId: booking.id, piId: intent.payment_intent_id }, 'Payment captured');
    } catch (err) {
      logger.error({ err, bookingId: booking.id }, 'Failed to capture payment');
    }
  }

  // Update trip status
  await supabase
    .from('trips')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
    .eq('id', tripId);

  // Cancel reauth jobs for this trip's bookings
  for (const booking of capturedBookings) {
    await supabase
      .from('reauth_jobs')
      .update({ is_complete: true })
      .eq('booking_id', booking.id)
      .eq('is_complete', false);
  }

  // Notify
  await notifyThresholdReached(trip, capturedBookings);

  // Create payout record for admin dashboard
  const totalGross = capturedBookings.reduce((sum, b) => sum + Number(b.total_amount_aed), 0);
  const commissionRate = parseFloat(process.env.PLATFORM_COMMISSION_RATE || '0.10');
  const commission = Math.round(totalGross * commissionRate * 100) / 100;
  const payoutAmount = Math.round((totalGross - commission) * 100) / 100;

  await supabase.from('payouts').insert({
    trip_id: tripId,
    captain_id: trip.captain_id,
    gross_amount: totalGross,
    commission_amount: commission,
    payout_amount: payoutAmount,
    status: 'pending',
  });

  logger.info({ tripId, capturedCount: capturedBookings.length, payoutAmount }, 'All bookings captured for trip');
}

export async function cancelAllForTrip(tripId: string, reason: string): Promise<void> {
  const { data: bookings } = await supabase
    .from('bookings')
    .select('*')
    .eq('trip_id', tripId)
    .in('status', ['authorized', 'pending_payment']);

  if (!bookings || bookings.length === 0) {
    logger.debug({ tripId }, 'No bookings to cancel');
  }

  const { data: trip } = await supabase
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();

  const cancelledBookings: Booking[] = [];

  for (const booking of (bookings || [])) {
    if (booking.status === 'authorized') {
      const { data: intent } = await supabase
        .from('stripe_intents')
        .select('*')
        .eq('booking_id', booking.id)
        .eq('is_current', true)
        .single();

      if (intent) {
        try {
          await cancelPaymentIntent(intent.payment_intent_id);
        } catch (err) {
          logger.error({ err, piId: intent.payment_intent_id }, 'Failed to cancel PI');
        }
      }
    }

    await supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
      })
      .eq('id', booking.id);

    cancelledBookings.push(booking);
  }

  // Update trip
  await supabase
    .from('trips')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason,
    })
    .eq('id', tripId);

  // Cancel reauth jobs
  for (const booking of cancelledBookings) {
    await supabase
      .from('reauth_jobs')
      .update({ is_complete: true })
      .eq('booking_id', booking.id)
      .eq('is_complete', false);
  }

  // Notify
  if (trip) {
    await notifyTripCancelled(trip, cancelledBookings, reason);
  }

  logger.info({ tripId, reason, cancelledCount: cancelledBookings.length }, 'All bookings cancelled for trip');
}
