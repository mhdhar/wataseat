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
import { startEditWizard } from './editWizardHandler';

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
      await handleTripsCommand(from, args);
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
    case '/repeat':
      await handleRepeatCommand(from);
      break;
    case '/edit':
      if (!args[0]) {
        await sendTextMessage(from, 'Usage: /edit [trip ID]\nExample: /edit abc123\n\nType /trips to see your trip IDs.');
      } else {
        await startEditWizard(from, args[0]);
      }
      break;
    case '/earnings':
      await handleEarningsCommand(from);
      break;
    default:
      await sendTextMessage(from, `Unknown command: ${command}\nType /help to see available commands.`);
  }
}

async function handleHelp(from: string): Promise<void> {
  await sendTextMessage(
    from,
    `🚢 WataSeat Commands\n\n/trip — Create a new trip\n/repeat — Repeat your last trip (new date/time)\n/edit [ID] — Edit a trip's details\n/trips — View your upcoming trips\n/status [ID] — Check a trip's bookings\n/cancel [ID] — Cancel a trip\n/earnings — View your earnings & payouts\n/connect — Set up or update your Stripe account\n\nNeed help? Visit wataseat.com/support`
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

  // Clear any existing wizard states
  await redis.del(`repeat_wizard:${from}`);
  await redis.del(`trip_wizard:${from}`);

  // Check if captain has previous trips — offer repeat option
  const { data: prevTrips } = await supabase
    .from('trips')
    .select('*')
    .eq('captain_id', captain.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (prevTrips && prevTrips.length > 0) {
    const lastTrip = prevTrips[0];
    const tripTypeLabel = lastTrip.trip_type.charAt(0).toUpperCase() + lastTrip.trip_type.slice(1);
    await sendTextMessage(
      from,
      `💡 Want to repeat your last ${tripTypeLabel} Trip (${lastTrip.meeting_point || 'TBA'}, AED ${lastTrip.price_per_person_aed})?\n\nType /repeat — just pick a new date and time.\n\nOr continue below to create a brand new trip...`
    );
  }

  await handleTripWizardStart(from, captain);
}

async function handleTripsCommand(from: string, args: string[] = []): Promise<void> {
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

  const PAGE_SIZE = 5;
  const page = Math.max(1, parseInt(args[0]) || 1);
  const totalPages = Math.ceil(trips.length / PAGE_SIZE);
  const pageTrips = trips.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  let response = `📅 Your trips (${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, trips.length)} of ${trips.length}):\n`;
  for (const trip of pageTrips) {
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

  if (totalPages > 1 && page < totalPages) {
    response += `\nType /trips ${page + 1} for more.`;
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

async function handleRepeatCommand(from: string): Promise<void> {
  // Clear any existing wizard states
  await redis.del(`trip_wizard:${from}`);
  await redis.del(`repeat_wizard:${from}`);

  const captain = await getCaptain(from);
  if (!captain) {
    await sendTextMessage(from, "You're not registered yet. Send me any message to start onboarding!");
    return;
  }

  if (captain.onboarding_step !== 'complete') {
    await sendTextMessage(from, 'Please complete your onboarding first.');
    return;
  }

  // Find captain's most recent trip
  const { data: trips } = await supabase
    .from('trips')
    .select('*')
    .eq('captain_id', captain.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!trips || trips.length === 0) {
    await sendTextMessage(from, "You haven't created any trips yet. Type /trip to create your first one!");
    return;
  }

  const lastTrip = trips[0];
  const tripTypeLabel = lastTrip.trip_type.charAt(0).toUpperCase() + lastTrip.trip_type.slice(1);

  await redis.set(`repeat_wizard:${from}`, JSON.stringify({
    step: 'date',
    source_trip_id: lastTrip.id,
    captain_id: captain.id,
    trip_type: lastTrip.trip_type,
    meeting_point: lastTrip.meeting_point,
    location_url: lastTrip.location_url,
    max_seats: lastTrip.max_seats,
    threshold: lastTrip.threshold,
    price_per_person_aed: lastTrip.price_per_person_aed,
    duration_hours: lastTrip.duration_hours,
  }), { ex: 600 });

  const lastDate = new Date(lastTrip.departure_at);
  const lastTime = lastDate.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });

  await sendTextMessage(
    from,
    `🔄 Repeat your last trip:\n\n🚢 ${tripTypeLabel} Trip\n📍 ${lastTrip.meeting_point || 'TBA'}\n⏰ ${lastTime} (${lastTrip.duration_hours || '?'}h)\n💰 AED ${lastTrip.price_per_person_aed}/person\n👥 ${lastTrip.max_seats} seats (min ${lastTrip.threshold})\n\nJust need a new date and departure time.\n\nWhat date? (e.g. 28/03 or 28 March)`
  );
}

async function handleEarningsCommand(from: string): Promise<void> {
  const captain = await getCaptain(from);
  if (!captain) {
    await sendTextMessage(from, "You're not registered as a captain.");
    return;
  }

  // Get payouts grouped by status
  const { data: payouts } = await supabase
    .from('payouts')
    .select('*')
    .eq('captain_id', captain.id)
    .order('created_at', { ascending: false });

  if (!payouts || payouts.length === 0) {
    await sendTextMessage(from, "No earnings yet. Create a trip with /trip to get started!");
    return;
  }

  let totalEarned = 0;
  let completedAmount = 0;
  let completedCount = 0;
  let pendingAmount = 0;
  let pendingCount = 0;

  for (const p of payouts) {
    totalEarned += Number(p.payout_amount);
    if (p.status === 'completed') {
      completedAmount += Number(p.payout_amount);
      completedCount++;
    } else {
      pendingAmount += Number(p.payout_amount);
      pendingCount++;
    }
  }

  let response = `💰 Earnings Summary\n\nTotal earned: AED ${totalEarned.toFixed(2)}`;
  response += `\n├ Completed: AED ${completedAmount.toFixed(2)} (${completedCount} trip${completedCount !== 1 ? 's' : ''})`;
  response += `\n└ Pending: AED ${pendingAmount.toFixed(2)} (${pendingCount} trip${pendingCount !== 1 ? 's' : ''})`;

  // Recent 5 payouts
  const recent = payouts.slice(0, 5);
  if (recent.length > 0) {
    response += '\n\nRecent:';
    for (const p of recent) {
      const shortId = p.trip_id.substring(0, 6);
      const statusIcon = p.status === 'completed' ? '✅' : '⏳';
      response += `\n${statusIcon} [${shortId}] AED ${Number(p.payout_amount).toFixed(2)} (${p.status})`;
    }
  }

  await sendTextMessage(from, response);
}

function buildFillBar(current: number, max: number): string {
  const filled = Math.round((current / max) * 8);
  const empty = 8 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}
