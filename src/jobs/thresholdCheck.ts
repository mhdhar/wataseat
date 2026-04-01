import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';
import { capturePaymentIntent, cancelPaymentIntent, refundPaymentIntent } from '../services/stripe';
import { sendTextMessage } from '../services/whatsapp';
import { Booking, Trip } from '../types';
import { PLATFORM_COMMISSION_RATE, calculateCommission, SUPPORT_CONTACT } from '../config';
import { getTripSeatOccupancy } from '../services/bookings';

export async function runThresholdCheck(): Promise<void> {
  logger.info('Running threshold check job');

  // Cleanup: remove pending bookings older than 15 minutes (abandoned checkouts)
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: staleBookings } = await supabase
    .from('bookings')
    .select('*, trips!inner(id, trip_type, departure_at, status, max_seats)')
    .eq('status', 'pending_payment')
    .lt('created_at', fifteenMinutesAgo);

  if (staleBookings && staleBookings.length > 0) {
    // Notify guests with real WhatsApp IDs before deleting
    for (const booking of staleBookings) {
      if (booking.guest_whatsapp_id && !booking.guest_whatsapp_id.startsWith('pending')) {
        const trip = (booking as any).trips;
        const tripType = trip?.trip_type ? trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1) : 'Your';
        const tripOccupancy = trip?.id ? await getTripSeatOccupancy(trip.id) : null;
        const tripOpen = trip?.status === 'open' && tripOccupancy !== null && tripOccupancy.total_occupied_seats < trip.max_seats;
        const shortId = trip?.id?.substring(0, 6);
        const rebookMsg = tripOpen && shortId
          ? `\n\nIf you'd still like to join, you can book again at ${process.env.APP_URL || 'https://wataseat.com'}/book/${shortId}`
          : '';
        await sendTextMessage(
          booking.guest_whatsapp_id,
          `Your ${tripType} Trip booking has expired because payment was not completed in time.${rebookMsg}\n\nQuestions? Visit ${SUPPORT_CONTACT}`
        );
      }
    }

    // Cancel Stripe PaymentIntents for stale holds
    for (const booking of staleBookings) {
      if (booking.stripe_payment_intent_id) {
        try {
          await cancelPaymentIntent(booking.stripe_payment_intent_id);
          logger.info({ bookingId: booking.id, piId: booking.stripe_payment_intent_id }, 'Cancelled stale pending PI');
        } catch (err) {
          // PI may already be cancelled/expired — log but don't block cleanup
          logger.warn({ err, bookingId: booking.id, piId: booking.stripe_payment_intent_id }, 'Could not cancel stale PI');
        }
      }
    }

    await supabase
      .from('bookings')
      .delete()
      .eq('status', 'pending_payment')
      .lt('created_at', fifteenMinutesAgo);
    logger.info({ count: staleBookings.length }, 'Cleaned up stale pending bookings (>15min)');
  }

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
    const occupancy = await getTripSeatOccupancy(trip.id);
    if (occupancy.total_occupied_seats >= trip.threshold) {
      // Threshold met — capture all
      logger.info({ tripId: trip.id }, 'Threshold met at check time — capturing');
      await captureAllForTrip(trip.id);
      await supabase
        .from('trips')
        .update({ threshold_check_sent_at: new Date().toISOString() })
        .eq('id', trip.id);
    } else {
      // Threshold not met — send warning to captain first, auto-cancel on next cron run
      const tripType = trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1);
      const shortId = trip.id.substring(0, 6);
      const depDate = new Date(trip.departure_at).toLocaleDateString('en-AE', {
        weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai',
      });

      const { data: captain } = await supabase
        .from('captains')
        .select('whatsapp_id')
        .eq('id', trip.captain_id)
        .single();

      if (captain) {
        await sendTextMessage(
          captain.whatsapp_id,
          `⚠️ Your ${tripType} Trip [${shortId}] on ${depDate} has ${occupancy.total_occupied_seats}/${trip.threshold} bookings — threshold not met.\n\nThe trip will be auto-cancelled in ~1 hour if the threshold isn't reached. All card holds will be released.\n\nType /cancel ${shortId} to cancel now, or wait.`
        );
      }

      // Notify booked guests about potential cancellation
      const remaining = trip.threshold - occupancy.total_occupied_seats;
      const { data: guestBookings } = await supabase
        .from('bookings')
        .select('guest_whatsapp_id, guest_name')
        .eq('trip_id', trip.id)
        .eq('status', 'authorized');

      for (const booking of (guestBookings || [])) {
        if (booking.guest_whatsapp_id && !booking.guest_whatsapp_id.startsWith('pending')) {
          const name = booking.guest_name?.split(' ')[0] || 'there';
          await sendTextMessage(
            booking.guest_whatsapp_id,
            `Hi ${name}, the ${tripType} Trip on ${depDate} needs ${remaining} more booking${remaining !== 1 ? 's' : ''} to confirm (${occupancy.total_occupied_seats}/${trip.threshold} so far).\n\nIf the minimum isn't reached in ~1 hour, the trip will be cancelled and your card hold of AED will be released automatically.\n\nQuestions? Visit ${SUPPORT_CONTACT}`
          );
        }
      }

      // Mark as warned — next cron run will auto-cancel
      await supabase
        .from('trips')
        .update({ threshold_check_sent_at: new Date().toISOString() })
        .eq('id', trip.id);

      logger.info({ tripId: trip.id, current: occupancy.total_occupied_seats, threshold: trip.threshold }, 'Threshold warning sent to captain and guests');
    }
  }

  // Phase 2: Auto-cancel trips that were warned but still haven't met threshold
  const { data: warnedTrips } = await supabase
    .from('trips')
    .select('*')
    .eq('status', 'open')
    .not('threshold_check_sent_at', 'is', null)
    .lte('departure_at', checkTime.toISOString());

  for (const trip of (warnedTrips || [])) {
    const warnedOccupancy = await getTripSeatOccupancy(trip.id);
    // Skip if threshold was met since the warning
    if (warnedOccupancy.total_occupied_seats >= trip.threshold) {
      logger.info({ tripId: trip.id }, 'Threshold met after warning — capturing');
      await captureAllForTrip(trip.id);
      continue;
    }

    // Check if enough time passed since warning (~1 hour)
    const warnedAt = new Date(trip.threshold_check_sent_at).getTime();
    const hoursSinceWarning = (Date.now() - warnedAt) / (1000 * 60 * 60);
    if (hoursSinceWarning < 0.9) continue; // Wait at least ~1 hour

    logger.info({ tripId: trip.id, current: warnedOccupancy.total_occupied_seats, threshold: trip.threshold }, 'Auto-cancelling after warning');
    await cancelAllForTrip(trip.id, 'threshold_not_met');
  }

  // Phase 3: Create payouts for confirmed trips that have ended
  await createPayoutsForEndedTrips();
}

async function createPayoutsForEndedTrips(): Promise<void> {
  const now = new Date();

  // Find confirmed trips that have already departed
  const { data: confirmedTrips } = await supabase
    .from('trips')
    .select('id, captain_id, departure_at, duration_hours')
    .eq('status', 'confirmed')
    .lte('departure_at', now.toISOString());

  if (!confirmedTrips?.length) return;

  for (const trip of confirmedTrips) {
    // Calculate trip end time: departure + duration
    const departureTime = new Date(trip.departure_at).getTime();
    const durationMs = (Number(trip.duration_hours) || 4) * 60 * 60 * 1000; // default 4h if not set
    const tripEndTime = departureTime + durationMs;

    if (now.getTime() < tripEndTime) continue; // Trip hasn't ended yet

    // Check if payout already exists for this trip
    const { data: existingPayout } = await supabase
      .from('payouts')
      .select('id')
      .eq('trip_id', trip.id)
      .maybeSingle();

    if (existingPayout) continue; // Payout already created

    // Get confirmed bookings to calculate totals
    const { data: bookings } = await supabase
      .from('bookings')
      .select('total_amount_aed')
      .eq('trip_id', trip.id)
      .eq('status', 'confirmed');

    if (!bookings?.length) continue;

    const totalGross = bookings.reduce((sum, b) => sum + Number(b.total_amount_aed), 0);
    const { fee: commission, payout: payoutAmount } = calculateCommission(totalGross);

    // Create payout
    await supabase.from('payouts').insert({
      trip_id: trip.id,
      captain_id: trip.captain_id,
      gross_amount: totalGross,
      commission_amount: commission,
      payout_amount: payoutAmount,
      status: 'pending',
    });

    // Mark trip as completed
    await supabase
      .from('trips')
      .update({ status: 'completed' })
      .eq('id', trip.id);

    // Send trip summary + payout notification to captain
    const { data: captain } = await supabase
      .from('captains')
      .select('whatsapp_id, display_name')
      .eq('id', trip.captain_id)
      .single();

    if (captain) {
      // Get full captain details for IBAN
      const { data: captainFull } = await supabase
        .from('captains')
        .select('iban, bank_name')
        .eq('id', trip.captain_id)
        .single();

      // Get full trip details for the summary
      const { data: fullTrip } = await supabase
        .from('trips')
        .select('*')
        .eq('id', trip.id)
        .single();

      const tripType = fullTrip?.trip_type ? fullTrip.trip_type.charAt(0).toUpperCase() + fullTrip.trip_type.slice(1) : 'Trip';
      const shortId = trip.id.substring(0, 6);
      const depDate = new Date(trip.departure_at).toLocaleDateString('en-AE', {
        weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai',
      });
      const depTime = new Date(trip.departure_at).toLocaleTimeString('en-AE', {
        hour: '2-digit', minute: '2-digit',
      });
      const commissionPct = Math.round(PLATFORM_COMMISSION_RATE * 100);

      const bankLine = captainFull?.bank_name && captainFull?.iban
        ? `\n🏦 ${captainFull.bank_name}\n💳 IBAN: ${captainFull.iban}`
        : captainFull?.iban
        ? `\n💳 IBAN: ${captainFull.iban}`
        : '';

      await sendTextMessage(
        captain.whatsapp_id,
        `🧾 Trip Summary — ${tripType} Trip [${shortId}]\n\n📅 ${depDate} at ${depTime}\n👥 ${bookings.length} passenger${bookings.length !== 1 ? 's' : ''}\n\n💰 Total collected: AED ${totalGross.toFixed(2)}\n📊 WataSeat commission (${commissionPct}%): AED ${commission.toFixed(2)}\n✅ Your payout: AED ${payoutAmount.toFixed(2)}\n\nYour payout will be processed within 48 hours to:${bankLine}\n\nThank you, Captain ${captain.display_name}! 🚢`
      );
    }

    logger.info({ tripId: trip.id, payoutAmount }, 'Payout created and captain notified for ended trip');
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

      const { fee: platformFee } = calculateCommission(Number(booking.total_amount_aed));
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
      // Notify guest about capture failure
      if (booking.guest_whatsapp_id && !booking.guest_whatsapp_id.startsWith('pending')) {
        await sendTextMessage(
          booking.guest_whatsapp_id,
          `There was an issue processing your payment for this trip. You will not be charged unless this is resolved. Our team is looking into it.\n\nBooking ID: ${booking.id.substring(0, 8)}\nQuestions? Visit ${SUPPORT_CONTACT}`
        );
      }
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

  // Notify all guests — trip confirmed
  const tripType = trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1);
  const depDate = new Date(trip.departure_at).toLocaleDateString('en-AE', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  const locationLine = trip.location_url ? `\n📍 Location: ${trip.location_url}` : '';

  const depTime = new Date(trip.departure_at).toLocaleTimeString('en-AE', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai',
  });

  for (const booking of capturedBookings) {
    if (booking.guest_whatsapp_id && !booking.guest_whatsapp_id.startsWith('pending')) {
      const name = booking.guest_name?.split(' ')[0] || 'there';
      const seatsLine = booking.num_seats > 1 ? `\n🎟 ${booking.num_seats} seats` : '';
      await sendTextMessage(
        booking.guest_whatsapp_id,
        `🎉 Trip confirmed, ${name}!\n\nBooking ID: ${booking.id.substring(0, 8)}\n${tripType} Trip — ${depDate} at ${depTime}${seatsLine}\n📍 Meeting: ${trip.meeting_point || 'TBA'}${locationLine}\n💰 AED ${booking.total_amount_aed} charged to your card.\n\nSee you there!`
      );
    }
  }

  // Notify captain — trip confirmed
  const { data: captain } = await supabase
    .from('captains')
    .select('whatsapp_id')
    .eq('id', trip.captain_id)
    .single();

  if (captain) {
    const totalSeats = capturedBookings.reduce((sum, b) => sum + (b.num_seats || 1), 0);
    const totalGrossMsg = capturedBookings.reduce((sum, b) => sum + Number(b.total_amount_aed), 0);
    await sendTextMessage(
      captain.whatsapp_id,
      `✅ Your ${tripType} Trip [${trip.id.substring(0, 6)}] is confirmed!\n\n${totalSeats} seat${totalSeats !== 1 ? 's' : ''} booked. All payments captured.\nTotal: AED ${totalGrossMsg}\n\nHave a great trip!`
    );
  }

  logger.info({ tripId, capturedCount: capturedBookings.length }, 'All bookings captured for trip');
}

export async function cancelAllForTrip(tripId: string, reason: string): Promise<void> {
  const { data: bookings } = await supabase
    .from('bookings')
    .select('*')
    .eq('trip_id', tripId)
    .in('status', ['authorized', 'pending_payment', 'confirmed']);

  if (!bookings || bookings.length === 0) {
    logger.debug({ tripId }, 'No bookings to cancel');
  }

  const { data: trip } = await supabase
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();

  const cancelledBookings: Booking[] = [];
  const paymentFailedBookings: Booking[] = [];

  for (const booking of (bookings || [])) {
    const { data: intent } = await supabase
      .from('stripe_intents')
      .select('*')
      .eq('booking_id', booking.id)
      .eq('is_current', true)
      .single();

    let paymentCancelFailed = false;
    if (intent) {
      try {
        if (booking.status === 'confirmed') {
          await refundPaymentIntent(intent.payment_intent_id);
          logger.info({ bookingId: booking.id, piId: intent.payment_intent_id }, 'Payment refunded');
        } else if (booking.status === 'authorized') {
          await cancelPaymentIntent(intent.payment_intent_id);
        }
      } catch (err) {
        paymentCancelFailed = true;
        logger.error({ err, piId: intent.payment_intent_id, status: booking.status }, 'Failed to cancel/refund PI');
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

    if (paymentCancelFailed) {
      paymentFailedBookings.push(booking);
    }
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

  // Notify all guests — trip cancelled
  if (trip) {
    const tripType = trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1);
    const depDate = new Date(trip.departure_at).toLocaleDateString('en-AE', {
      weekday: 'short', day: 'numeric', month: 'short',
    });

    const depTime = new Date(trip.departure_at).toLocaleTimeString('en-AE', {
      hour: '2-digit', minute: '2-digit',
    });

    for (const booking of cancelledBookings) {
      if (booking.guest_whatsapp_id && !booking.guest_whatsapp_id.startsWith('pending')) {
        const name = booking.guest_name?.split(' ')[0] || 'there';
        const isPaymentFailed = paymentFailedBookings.some(b => b.id === booking.id);
        const releaseMsg = isPaymentFailed
          ? `We're processing the release of your card hold of AED ${booking.total_amount_aed} — this may take a few business days. If you see a charge, please contact us.`
          : `Your card hold of AED ${booking.total_amount_aed} has been released immediately — no charge was made.`;
        await sendTextMessage(
          booking.guest_whatsapp_id,
          `Hi ${name}, the ${tripType} Trip on ${depDate} at ${depTime} has been cancelled.\n\nBooking ID: ${booking.id.substring(0, 8)}\nThe minimum of ${trip.threshold} passengers was not reached. ${releaseMsg}\n\nQuestions? Visit ${SUPPORT_CONTACT}\n\nWe hope to see you on the next one!`
        );
      }
    }

    // Notify captain
    const { data: captain } = await supabase
      .from('captains')
      .select('whatsapp_id')
      .eq('id', trip.captain_id)
      .single();

    if (captain) {
      const cancelSummaryOccupancy = await getTripSeatOccupancy(tripId);
      await sendTextMessage(
        captain.whatsapp_id,
        `❌ Your ${tripType} Trip [${trip.id.substring(0, 6)}] has been cancelled — ${reason === 'threshold_not_met' ? `threshold not met (${cancelSummaryOccupancy.total_occupied_seats}/${trip.threshold} booked)` : reason}.\n\nAll card holds released. No charges made.`
      );
    }
  }

  logger.info({ tripId, reason, cancelledCount: cancelledBookings.length }, 'All bookings cancelled for trip');
}
