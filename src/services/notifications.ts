import { sendTextMessage, sendInteractiveMessage, sendTemplateMessage } from './whatsapp';
import { logger } from '../utils/logger';
import { Booking, Trip, Captain } from '../types';
import { supabase } from '../db/supabase';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-AE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortId(id: string): string {
  return id.substring(0, 6);
}

export async function notifyTripPosted(trip: Trip, groupWaId: string): Promise<void> {
  const { data: captain } = await supabase
    .from('captains')
    .select('display_name')
    .eq('id', trip.captain_id)
    .single();

  const captainName = captain?.display_name || 'Captain';

  await sendInteractiveMessage(groupWaId, {
    header: `${trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1)} Trip — ${formatDate(trip.departure_at)}`,
    body: `📍 ${trip.meeting_point || 'TBA'}\n⏰ ${formatDate(trip.departure_at)}${trip.duration_hours ? ` (${trip.duration_hours}h)` : ''}\n💰 AED ${trip.price_per_person_aed}/person\n👥 0/${trip.max_seats} seats (need ${trip.threshold} min)\n\nPosted by ${captainName}\nNo charge unless trip confirms!`,
    footer: 'WataSeat — Tap to secure your spot',
    buttons: [{ id: `booking_intent:${trip.id}`, title: 'Book My Seat' }],
  });

  logger.info({ tripId: trip.id, groupWaId }, 'Trip posted notification sent');
}

export async function notifyPaymentLinkSent(
  booking: Booking,
  paymentLink: string
): Promise<void> {
  const { data: trip } = await supabase
    .from('trips')
    .select('*')
    .eq('id', booking.trip_id)
    .single();

  const tripType = trip?.trip_type || 'boat';
  const departureDate = trip ? formatDate(trip.departure_at) : 'TBA';

  await sendTextMessage(
    booking.guest_whatsapp_id,
    `Hi! Here's your secure payment link for the ${tripType} trip on ${departureDate}.\n\nAmount: AED ${booking.total_amount_aed}\n\nYour card will be held but NOT charged until ${trip?.threshold || 'minimum'} seats are confirmed. No payment if the trip doesn't run.\n\n${paymentLink}`
  );

  logger.info({ bookingId: booking.id }, 'Payment link sent to guest');
}

export async function notifyBookingAuthorized(
  booking: Booking,
  trip: Trip
): Promise<void> {
  // DM to guest
  await sendTextMessage(
    booking.guest_whatsapp_id,
    `Seat secured! 🎉\n\nTrip: ${trip.trip_type} on ${formatDate(trip.departure_at)}\nYour seat: #${trip.current_bookings}\nBooked: ${trip.current_bookings}/${trip.threshold} seats needed\n\nYour card is authorized (not charged yet). We'll charge everyone at once when ${trip.threshold} seats fill up.`
  );

  // Group update
  const { data: whatsappGroup } = await supabase
    .from('whatsapp_groups')
    .select('group_id')
    .eq('id', trip.group_id)
    .single();

  if (whatsappGroup) {
    await sendTextMessage(
      whatsappGroup.group_id,
      `📊 ${trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1)} Trip [${shortId(trip.id)}] — ${trip.current_bookings}/${trip.max_seats} seats booked (need ${trip.threshold} min)`
    );
  }

  logger.info({ bookingId: booking.id, tripId: trip.id }, 'Booking authorized notification sent');
}

export async function notifyThresholdReached(
  trip: Trip,
  bookings: Booking[]
): Promise<void> {
  // Notify each guest via DM
  for (const booking of bookings) {
    await sendTextMessage(
      booking.guest_whatsapp_id,
      `🎉 Trip confirmed! All seats filled!\n\nTrip: ${trip.trip_type} on ${formatDate(trip.departure_at)}\nYour card has been charged AED ${booking.total_amount_aed}.\nMeeting point: ${trip.meeting_point || 'TBA'}\n\nSee you there!`
    );
  }

  // Group notification
  const { data: whatsappGroup } = await supabase
    .from('whatsapp_groups')
    .select('group_id')
    .eq('id', trip.group_id)
    .single();

  if (whatsappGroup) {
    await sendTextMessage(
      whatsappGroup.group_id,
      `✅ Trip confirmed! ${trip.current_bookings}/${trip.max_seats} seats filled for ${trip.trip_type} on ${formatDate(trip.departure_at)}. See you there! 🌊`
    );
  }

  logger.info({ tripId: trip.id, guestCount: bookings.length }, 'Threshold reached notifications sent');
}

export async function notifyTripCancelled(
  trip: Trip,
  bookings: Booking[],
  reason: string
): Promise<void> {
  // DM each guest
  for (const booking of bookings) {
    await sendTextMessage(
      booking.guest_whatsapp_id,
      `⚠️ Trip cancelled.\n\nThe ${trip.trip_type} trip on ${formatDate(trip.departure_at)} didn't reach the minimum of ${trip.threshold} passengers.\n\nYour card hold has been released. No charge has been made.\n\nWe hope to see you on the next trip! 🚢`
    );
  }

  // Group notification
  const { data: whatsappGroup } = await supabase
    .from('whatsapp_groups')
    .select('group_id')
    .eq('id', trip.group_id)
    .single();

  if (whatsappGroup) {
    await sendTextMessage(
      whatsappGroup.group_id,
      `❌ ${trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1)} Trip [${shortId(trip.id)}] cancelled — ${reason}. No charges made.`
    );
  }

  logger.info({ tripId: trip.id, reason }, 'Trip cancelled notifications sent');
}

export async function notifyReauthRequired(
  booking: Booking,
  newPaymentLink: string
): Promise<void> {
  const { data: trip } = await supabase
    .from('trips')
    .select('*')
    .eq('id', booking.trip_id)
    .single();

  await sendTextMessage(
    booking.guest_whatsapp_id,
    `Hi! Your seat reservation for ${trip?.trip_type || 'the'} trip on ${trip ? formatDate(trip.departure_at) : 'upcoming date'} is still active!\n\nTo keep your spot, please renew your card authorization (your card still won't be charged until the trip confirms).\n\nNew link: ${newPaymentLink}`
  );

  logger.info({ bookingId: booking.id }, 'Reauth notification sent');
}

export async function notifyCaptainSummary(
  captain: Captain,
  upcomingTrips: Trip[]
): Promise<void> {
  if (upcomingTrips.length === 0) return;

  let tripList = '';
  for (const trip of upcomingTrips) {
    const fillRate = trip.current_bookings / trip.threshold;
    const warning = trip.current_bookings < trip.threshold ? ' ⚠️' : ' ✅';
    tripList += `\n[${shortId(trip.id)}] ${trip.trip_type} — ${formatDate(trip.departure_at)} — ${trip.current_bookings}/${trip.max_seats} seats${warning}`;
  }

  await sendTextMessage(
    captain.whatsapp_id,
    `Good morning, Captain ${captain.display_name}! ☀️\n\nYour upcoming trips:${tripList}\n\nType /trips for details or /status [trip ID] to see bookings.`
  );

  logger.info({ captainId: captain.id, tripCount: upcomingTrips.length }, 'Captain summary sent');
}
