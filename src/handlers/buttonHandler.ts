import { logger } from '../utils/logger';
import { sendTextMessage } from '../services/whatsapp';
import { supabase } from '../db/supabase';
import { getTripById } from '../services/trips';
import { createPaymentIntent, createPaymentLink } from '../services/stripe';
import { notifyPaymentLinkSent } from '../services/notifications';
import { trackEvent } from '../services/analytics';

export async function handleButton(
  from: string,
  buttonId: string,
  buttonTitle: string,
  message: any
): Promise<void> {
  logger.info({ from, buttonId, buttonTitle }, 'Button tap received');

  if (buttonId.startsWith('booking_intent:')) {
    const tripId = buttonId.replace('booking_intent:', '');
    trackEvent('wa_booking_button_tap', { trip_id: tripId }, from);
    await handleBookingIntent(from, tripId, message);
  }
}

async function handleBookingIntent(
  from: string,
  tripId: string,
  message: any
): Promise<void> {
  // Get trip
  const trip = await getTripById(tripId);
  if (!trip) {
    await sendTextMessage(from, 'This trip is no longer available.');
    return;
  }

  // Check trip is open
  if (trip.status !== 'open') {
    await sendTextMessage(from, `This trip is ${trip.status}. Booking is no longer available.`);
    return;
  }

  // Get captain info
  const { data: captain } = await supabase
    .from('captains')
    .select('*')
    .eq('id', trip.captain_id)
    .single();

  if (!captain || !captain.stripe_account_id) {
    await sendTextMessage(from, 'The captain has not completed their payment setup yet. Please try again later.');
    return;
  }

  // Get guest name from WhatsApp profile if available
  const guestName = message?.contacts?.[0]?.profile?.name || null;

  // Atomic seat reservation — locks trip row, checks availability, prevents duplicates
  const { data: bookingId, error: reserveErr } = await supabase.rpc('reserve_seat', {
    p_trip_id: tripId,
    p_captain_id: trip.captain_id,
    p_guest_whatsapp_id: from,
    p_guest_name: guestName,
    p_num_seats: 1,
    p_price_per_seat: trip.price_per_person_aed,
    p_total_amount: trip.price_per_person_aed,
  });

  if (reserveErr) {
    if (reserveErr.message?.includes('NO_SEATS_AVAILABLE')) {
      await sendTextMessage(from, 'Sorry, this trip is fully booked!');
      return;
    }
    if (reserveErr.message?.includes('TRIP_NOT_AVAILABLE')) {
      await sendTextMessage(from, 'This trip is no longer available.');
      return;
    }
    // Unique constraint violation = already booked
    if (reserveErr.message?.includes('unique') || reserveErr.message?.includes('duplicate')) {
      await sendTextMessage(from, "You've already booked this trip! Check your DMs for the payment link.");
      return;
    }
    logger.error({ err: reserveErr, tripId, from }, 'Failed to reserve seat');
    await sendTextMessage(from, 'Something went wrong. Please try again.');
    return;
  }

  // Fetch the full booking record
  const { data: booking } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (!booking) {
    logger.error({ bookingId }, 'Booking created but not found');
    await sendTextMessage(from, 'Something went wrong. Please try again.');
    return;
  }

  // Create Stripe PaymentIntent
  const paymentIntent = await createPaymentIntent({
    amountAed: booking.total_amount_aed,
    captainStripeAccountId: captain.stripe_account_id,
    bookingId: booking.id,
    tripId: trip.id,
    captainId: captain.id,
    guestWaId: from,
  });

  // Create payment link
  const departureDate = new Date(trip.departure_at).toLocaleDateString('en-AE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const paymentLinkUrl = await createPaymentLink({
    amountAed: booking.total_amount_aed,
    tripType: trip.trip_type,
    departureDate,
    captainName: captain.display_name,
    numSeats: 1,
    captainStripeAccountId: captain.stripe_account_id,
    bookingId: booking.id,
  });

  // Update booking with payment link
  await supabase
    .from('bookings')
    .update({
      payment_link: paymentLinkUrl,
      payment_link_sent_at: new Date().toISOString(),
      stripe_payment_intent_id: paymentIntent.id,
    })
    .eq('id', booking.id);

  // Send payment link via PRIVATE DM (never in group)
  await notifyPaymentLinkSent(booking, paymentLinkUrl);

  logger.info(
    { bookingId: booking.id, tripId, guestWaId: from },
    'Booking created and payment link sent'
  );
}
