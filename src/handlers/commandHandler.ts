import { logger } from '../utils/logger';
import { sendTextMessage, sendInteractiveMessage } from '../services/whatsapp';
import { supabase } from '../db/supabase';
import { handleTripWizardStart } from './tripWizardHandler';
import { Captain } from '../types';
import { getTripsByCaptain, getTripByShortId } from '../services/trips';
import { getBookingsByTrip } from '../services/bookings';
import { cancelAllForTrip } from '../jobs/thresholdCheck';
import { Redis } from '@upstash/redis';
import { createOnboardingLink } from '../services/stripeConnect';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function handleCommand(
  from: string,
  text: string,
  message: any
): Promise<void> {
  const parts = text.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  logger.info({ from, command, args }, 'Command received');

  switch (command) {
    case '/help':
      await handleHelp(from);
      break;
    case '/trip':
      await handleTripCommand(from, message);
      break;
    case '/trips':
      await handleTripsCommand(from);
      break;
    case '/status':
      await handleStatusCommand(from, args[0]);
      break;
    case '/cancel':
      await handleCancelCommand(from, args[0]);
      break;
    case '/connect':
      await handleConnectCommand(from);
      break;
    default:
      await sendTextMessage(from, `Unknown command: ${command}\nType /help to see available commands.`);
  }
}

async function handleHelp(from: string): Promise<void> {
  await sendTextMessage(
    from,
    `🚢 WataSeat Commands\n\n/trip — Create a new trip\n/trips — View your upcoming trips\n/status [ID] — Check a trip's bookings\n/cancel [ID] — Cancel a trip\n/connect — Set up or update your Stripe account\n\nNeed help? Visit wataseat.com/support`
  );
}

async function getCaptain(waId: string): Promise<Captain | null> {
  const { data } = await supabase
    .from('captains')
    .select('*')
    .eq('whatsapp_id', waId)
    .single();
  return data;
}

async function handleTripCommand(from: string, message: any): Promise<void> {
  const captain = await getCaptain(from);

  if (!captain) {
    await sendTextMessage(from, "You're not registered yet. Send me any message to start onboarding!");
    return;
  }

  if (captain.onboarding_step !== 'complete') {
    await sendTextMessage(from, 'Please complete your onboarding first. Type /connect to continue.');
    return;
  }

  if (!captain.stripe_charges_enabled) {
    await sendTextMessage(from, 'Please complete your Stripe setup before posting trips. Type /connect to get your link.');
    return;
  }

  await handleTripWizardStart(from, captain);
}

async function handleTripsCommand(from: string): Promise<void> {
  const captain = await getCaptain(from);
  if (!captain) {
    await sendTextMessage(from, "You're not registered as a captain. Send me any message to start onboarding!");
    return;
  }

  const trips = await getTripsByCaptain(captain.id);

  if (trips.length === 0) {
    await sendTextMessage(from, "📅 No upcoming trips. Type /trip to create one!");
    return;
  }

  let response = '📅 Your upcoming trips:\n';
  for (const trip of trips) {
    const shortId = trip.id.substring(0, 6);
    const fillBar = buildFillBar(trip.current_bookings, trip.max_seats);
    const pct = Math.round((trip.current_bookings / trip.max_seats) * 100);
    const statusIcon = trip.status === 'confirmed' ? ' ✅ CONFIRMED' : ` (need ${trip.threshold} min)`;

    const date = new Date(trip.departure_at).toLocaleDateString('en-AE', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    const time = new Date(trip.departure_at).toLocaleTimeString('en-AE', {
      hour: '2-digit',
      minute: '2-digit',
    });

    response += `\n[${shortId}] ${trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1)} — ${date} ${time}`;
    response += `\n  ${trip.current_bookings}/${trip.max_seats} seats ${fillBar} ${pct}% filled${statusIcon}\n`;
  }

  response += '\nType /status [ID] for details.';
  await sendTextMessage(from, response);
}

async function handleStatusCommand(from: string, shortIdArg?: string): Promise<void> {
  const captain = await getCaptain(from);
  if (!captain) {
    await sendTextMessage(from, "You're not registered as a captain.");
    return;
  }

  if (!shortIdArg) {
    await sendTextMessage(from, 'Usage: /status [trip ID]\nExample: /status abc123\n\nType /trips to see your trip IDs.');
    return;
  }

  const trip = await getTripByShortId(shortIdArg, captain.id);
  if (!trip) {
    await sendTextMessage(from, `Trip "${shortIdArg}" not found. Type /trips to see your trips.`);
    return;
  }

  const bookings = await getBookingsByTrip(trip.id);
  const fillBar = buildFillBar(trip.current_bookings, trip.max_seats);
  const remaining = trip.threshold - trip.current_bookings;

  const date = new Date(trip.departure_at);
  const formattedDate = date.toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' });
  const formattedTime = date.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });

  // Calculate deadline
  const deadlineMs = date.getTime() - (parseInt(process.env.THRESHOLD_CHECK_HOURS_BEFORE || '12') * 60 * 60 * 1000);
  const deadline = new Date(deadlineMs);
  const now = new Date();
  const hoursUntilDeadline = Math.max(0, (deadline.getTime() - now.getTime()) / (1000 * 60 * 60));

  let statusText: string;
  if (trip.status === 'confirmed') {
    statusText = '✅ CONFIRMED';
  } else if (trip.status === 'cancelled') {
    statusText = '❌ CANCELLED';
  } else if (remaining <= 0) {
    statusText = '✅ THRESHOLD MET — awaiting capture';
  } else {
    statusText = `OPEN — ${remaining} more needed`;
  }

  let response = `🚢 ${trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1)} Trip — ${formattedDate}\nID: ${trip.id.substring(0, 6)}\n\n📍 ${trip.meeting_point || 'TBA'}\n⏰ ${formattedTime}${trip.duration_hours ? ` (${trip.duration_hours}h)` : ''}\n💰 AED ${trip.price_per_person_aed}/person\n\nSeats: ${trip.current_bookings}/${trip.max_seats} ${fillBar}\nThreshold: ${trip.threshold} minimum\nStatus: ${statusText}`;

  if (bookings.length > 0) {
    response += '\n\nGuests booked:';
    for (const b of bookings) {
      const name = b.guest_name || b.guest_whatsapp_id.substring(0, 6) + '...';
      response += `\n• ${name} — ${b.num_seats} seat${b.num_seats > 1 ? 's' : ''} (${b.status})`;
    }
  }

  if (trip.status === 'open') {
    response += `\n\n⏱ Deadline: ${deadline.toLocaleDateString('en-AE', { day: 'numeric', month: 'short' })} ${deadline.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })} (${hoursUntilDeadline.toFixed(1)}h left)`;
    response += `\n\n/cancel ${trip.id.substring(0, 6)} to cancel`;
  }

  await sendTextMessage(from, response);
}

async function handleCancelCommand(from: string, shortIdArg?: string): Promise<void> {
  const captain = await getCaptain(from);
  if (!captain) {
    await sendTextMessage(from, "You're not registered as a captain.");
    return;
  }

  if (!shortIdArg) {
    await sendTextMessage(from, 'Usage: /cancel [trip ID]\nExample: /cancel abc123');
    return;
  }

  const trip = await getTripByShortId(shortIdArg, captain.id);
  if (!trip) {
    await sendTextMessage(from, `Trip "${shortIdArg}" not found. Type /trips to see your trips.`);
    return;
  }

  if (trip.status !== 'open') {
    await sendTextMessage(from, `Trip "${shortIdArg}" is already ${trip.status}. Only open trips can be cancelled.`);
    return;
  }

  // Store cancel confirmation state in Redis
  await redis.set(`cancel_confirm:${from}`, JSON.stringify({
    trip_id: trip.id,
    trip_title: `${trip.trip_type} Trip on ${new Date(trip.departure_at).toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' })}`,
    booking_count: trip.current_bookings,
  }), { ex: 300 }); // Expires in 5 minutes

  await sendTextMessage(
    from,
    `⚠️ Are you sure you want to cancel the ${trip.trip_type} Trip on ${new Date(trip.departure_at).toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' })}?\n\n• ${trip.current_bookings} guest${trip.current_bookings !== 1 ? 's' : ''} will be notified\n• All card holds will be released\n• No one will be charged\n\nReply YES to confirm, or NO to keep the trip.`
  );
}

async function handleConnectCommand(from: string): Promise<void> {
  const captain = await getCaptain(from);

  if (!captain) {
    await sendTextMessage(from, "You're not registered yet. Send me any message to start onboarding!");
    return;
  }

  if (captain.stripe_charges_enabled) {
    await sendTextMessage(from, '✅ Your Stripe account is active. You can post trips!');
    return;
  }

  if (captain.stripe_account_id) {
    // Re-send onboarding link
    const link = await createOnboardingLink(captain.stripe_account_id);
    await supabase
      .from('captains')
      .update({ stripe_onboarding_url: link })
      .eq('id', captain.id);

    await sendTextMessage(from, `Complete your Stripe setup here:\n${link}`);
    return;
  }

  await sendTextMessage(from, 'Please complete your onboarding first. Send me any message to continue.');
}

function buildFillBar(current: number, max: number): string {
  const filled = Math.round((current / max) * 8);
  const empty = 8 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}
