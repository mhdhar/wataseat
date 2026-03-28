import { sendTextMessage, sendInteractiveMessage, sendTemplateMessage } from './whatsapp';
import { logger } from '../utils/logger';
import { Booking, Trip, Captain } from '../types';
import { supabase } from '../db/supabase';

// Template URL bases — the dynamic parameter replaces {{1}} after these
const STRIPE_URL_BASE = 'https://buy.stripe.com/';
const MAPS_URL_BASE = 'https://maps.app.goo.gl/';

// Extract the dynamic suffix from a full URL for template button parameters
function extractUrlSuffix(fullUrl: string, base: string): string {
  if (fullUrl.startsWith(base)) {
    return fullUrl.slice(base.length);
  }
  // If the URL doesn't match the expected base, return the full URL
  // Meta will append it to the base, so this may not produce a valid link
  // but it's better than failing silently
  logger.warn({ fullUrl, base }, 'URL does not match expected template base');
  return fullUrl;
}

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

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-AE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function shortId(id: string): string {
  return id.substring(0, 6);
}

function guestFirstName(booking: Booking): string {
  if (booking.guest_name) {
    return booking.guest_name.split(' ')[0];
  }
  return 'there';
}

// ─── Trip Posted (group interactive message — always within 24h context) ──────
export async function notifyTripPosted(trip: Trip, groupWaId: string): Promise<void> {
  const { data: captain } = await supabase
    .from('captains')
    .select('display_name')
    .eq('id', trip.captain_id)
    .single();

  const captainName = captain?.display_name || 'Captain';

  // Group messages are always within 24h (bot was just added or captain just typed /trip)
  // so we use an interactive message with a "Book My Seat" button
  await sendInteractiveMessage(groupWaId, {
    header: `${capitalize(trip.trip_type)} Trip — ${formatDate(trip.departure_at)}`,
    body: `📍 ${trip.meeting_point || 'TBA'}\n⏰ ${formatDate(trip.departure_at)}${trip.duration_hours ? ` (${trip.duration_hours}h)` : ''}\n💰 AED ${trip.price_per_person_aed}/person\n👥 0/${trip.max_seats} seats (need ${trip.threshold} min)\n\nPosted by ${captainName}\nNo charge unless trip confirms!`,
    footer: 'WataSeat — Tap to secure your spot',
    buttons: [{ id: `booking_intent:${trip.id}`, title: 'Book My Seat' }],
  });

  logger.info({ tripId: trip.id, groupWaId }, 'Trip posted notification sent');
}

// ─── Payment Link (template: payment_link) ───────────────────────────────────
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
  const departureDate = trip ? formatDateShort(trip.departure_at) : 'TBA';
  const threshold = trip?.threshold?.toString() || '0';

  await sendTemplateMessage(booking.guest_whatsapp_id, 'guest_payment', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: guestFirstName(booking) },
        { type: 'text', text: tripType },
        { type: 'text', text: departureDate },
        { type: 'text', text: booking.total_amount_aed.toString() },
        { type: 'text', text: threshold },
      ],
    },
    {
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: extractUrlSuffix(paymentLink, STRIPE_URL_BASE) }],
    },
  ]);

  logger.info({ bookingId: booking.id }, 'Payment link template sent to guest');
}

// ─── Booking Authorized (template: booking_confirmed) ────────────────────────
export async function notifyBookingAuthorized(
  booking: Booking,
  trip: Trip
): Promise<void> {
  // DM to guest using template (may be outside 24h window)
  await sendTemplateMessage(booking.guest_whatsapp_id, 'booking_confirmed', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: guestFirstName(booking) },
        { type: 'text', text: capitalize(trip.trip_type) },
        { type: 'text', text: formatDateShort(trip.departure_at) },
        { type: 'text', text: trip.current_bookings.toString() },
        { type: 'text', text: trip.current_bookings.toString() },
        { type: 'text', text: trip.threshold.toString() },
      ],
    },
  ]);

  // Group update — free-form text is fine here (guest just interacted, within 24h)
  const { data: whatsappGroup } = await supabase
    .from('whatsapp_groups')
    .select('group_id')
    .eq('id', trip.group_id)
    .single();

  if (whatsappGroup) {
    await sendTextMessage(
      whatsappGroup.group_id,
      `📊 ${capitalize(trip.trip_type)} Trip [${shortId(trip.id)}] — ${trip.current_bookings}/${trip.max_seats} seats booked (need ${trip.threshold} min)`
    );
  }

  logger.info({ bookingId: booking.id, tripId: trip.id }, 'Booking authorized notification sent');
}

// ─── Threshold Reached (template: trip_confirmed) ────────────────────────────
export async function notifyThresholdReached(
  trip: Trip,
  bookings: Booking[]
): Promise<void> {
  // DM each guest using template
  for (const booking of bookings) {
    const locationUrl = trip.location_url || `https://maps.app.goo.gl/search/${encodeURIComponent(trip.meeting_point || 'UAE')}`;

    await sendTemplateMessage(booking.guest_whatsapp_id, 'booking_charged', [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: guestFirstName(booking) },
          { type: 'text', text: capitalize(trip.trip_type) },
          { type: 'text', text: formatDateShort(trip.departure_at) },
          { type: 'text', text: booking.total_amount_aed.toString() },
          { type: 'text', text: trip.meeting_point || 'TBA' },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: extractUrlSuffix(locationUrl, MAPS_URL_BASE) }],
      },
    ]);
  }

  // Group notification — free-form (within 24h context from trip interactions)
  const { data: whatsappGroup } = await supabase
    .from('whatsapp_groups')
    .select('group_id')
    .eq('id', trip.group_id)
    .single();

  if (whatsappGroup) {
    await sendTextMessage(
      whatsappGroup.group_id,
      `✅ Trip confirmed! ${trip.current_bookings}/${trip.max_seats} seats filled for ${capitalize(trip.trip_type)} on ${formatDate(trip.departure_at)}. See you there!`
    );
  }

  logger.info({ tripId: trip.id, guestCount: bookings.length }, 'Threshold reached notifications sent');
}

// ─── Trip Cancelled (template: trip_cancelled) ───────────────────────────────
export async function notifyTripCancelled(
  trip: Trip,
  bookings: Booking[],
  reason: string
): Promise<void> {
  // DM each guest using template
  for (const booking of bookings) {
    await sendTemplateMessage(booking.guest_whatsapp_id, 'trip_cancelled', [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: guestFirstName(booking) },
          { type: 'text', text: trip.trip_type },
          { type: 'text', text: formatDateShort(trip.departure_at) },
          { type: 'text', text: trip.threshold.toString() },
        ],
      },
    ]);
  }

  // Group notification — free-form
  const { data: whatsappGroup } = await supabase
    .from('whatsapp_groups')
    .select('group_id')
    .eq('id', trip.group_id)
    .single();

  if (whatsappGroup) {
    await sendTextMessage(
      whatsappGroup.group_id,
      `❌ ${capitalize(trip.trip_type)} Trip [${shortId(trip.id)}] cancelled — ${reason}. No charges made.`
    );
  }

  logger.info({ tripId: trip.id, reason }, 'Trip cancelled notifications sent');
}

// ─── Re-auth Required (template: renew_hold) ─────────────────────────────────
export async function notifyReauthRequired(
  booking: Booking,
  newPaymentLink: string
): Promise<void> {
  const { data: trip } = await supabase
    .from('trips')
    .select('*')
    .eq('id', booking.trip_id)
    .single();

  await sendTemplateMessage(booking.guest_whatsapp_id, 'hold_renewal', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: guestFirstName(booking) },
        { type: 'text', text: trip?.trip_type || 'boat' },
        { type: 'text', text: trip ? formatDateShort(trip.departure_at) : 'upcoming' },
      ],
    },
    {
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: extractUrlSuffix(newPaymentLink, STRIPE_URL_BASE) }],
    },
  ]);

  logger.info({ bookingId: booking.id }, 'Reauth template sent to guest');
}

// ─── Captain Daily Summary (template: captain_daily_summary) ─────────────────
export async function notifyCaptainSummary(
  captain: Captain,
  upcomingTrips: Trip[]
): Promise<void> {
  if (upcomingTrips.length === 0) return;

  let tripList = '';
  for (const trip of upcomingTrips) {
    const status = trip.current_bookings < trip.threshold ? 'Need more' : 'Confirmed';
    tripList += `${capitalize(trip.trip_type)} - ${formatDateShort(trip.departure_at)} - ${trip.current_bookings}/${trip.max_seats} seats (${status})\n`;
  }

  await sendTemplateMessage(captain.whatsapp_id, 'captain_daily_summary', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: captain.display_name.split(' ')[0] },
        { type: 'text', text: tripList.trim() },
      ],
    },
  ]);

  logger.info({ captainId: captain.id, tripCount: upcomingTrips.length }, 'Captain summary template sent');
}
