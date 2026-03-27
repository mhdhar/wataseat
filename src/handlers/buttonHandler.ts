import { logger } from '../utils/logger';
import { sendTextMessage } from '../services/whatsapp';
import { supabase } from '../db/supabase';
import { createBooking, hasGuestBooked } from '../services/bookings';
import { getTripById } from '../services/trips';
import { createPaymentIntent, createPaymentLink } from '../services/stripe';
import { notifyPaymentLinkSent } from '../services/notifications';

export async function handleButton(
  from: string,
  buttonId: string,
  buttonTitle: string,
  message: any
): Promise<void> {
  logger.info({ from, buttonId, buttonTitle }, 'Button tap received');

  if (buttonId.startsWith('booking_intent:')) {
    const tripId = buttonId.replace('booking_intent:', '');
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

  // Check seats available
  if (trip.current_bookings >= trip.max_seats) {
    await sendTextMessage(from, 'Sorry, this trip is fully booked!');
    return;
  }

  // Check guest hasn't already booked
  const alreadyBooked = await hasGuestBooked(tripId, from);
  if (alreadyBooked) {
    await sendTextMessage(from, "You've already booked this trip! Check your DMs for the payment link.");
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

  // Create booking
  const booking = await createBooking({
    trip_id: tripId,
    captain_id: trip.captain_id,
    guest_whatsapp_id: from,
    guest_name: guestName,
    num_seats: 1,
    price_per_seat_aed: trip.price_per_person_aed,
    total_amount_aed: trip.price_per_person_aed,
  });

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
