import { logger } from '../utils/logger';
import { sendTextMessage } from '../services/whatsapp';
import { supabase } from '../db/supabase';
import { Captain, TripType, TripWizardState } from '../types';
import { createTrip } from '../services/trips';
import { notifyTripPosted } from '../services/notifications';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const WIZARD_TTL = 600; // 10 minutes

export async function handleTripWizardStart(from: string, captain: Captain): Promise<void> {
  // Check if captain has any groups
  const { data: groups } = await supabase
    .from('whatsapp_groups')
    .select('*')
    .eq('captain_id', captain.id)
    .eq('is_active', true);

  if (!groups || groups.length === 0) {
    await sendTextMessage(from, "You haven't added me to any WhatsApp groups yet. Add me to a group first, then type /trip to create a trip.");
    return;
  }

  // Use first active group (multi-group selection can be added later)
  const group = groups[0];

  const state: TripWizardState = {
    step: 'trip_type',
    captain_id: captain.id,
    group_id: group.id,
  };

  await redis.set(`trip_wizard:${from}`, JSON.stringify(state), { ex: WIZARD_TTL });

  await sendTextMessage(
    from,
    "Let's create a new trip! 🚢\n\nWhat type of trip?\nReply: fishing / diving / cruising / other"
  );
}

export async function handleTripWizardStep(
  from: string,
  text: string,
  state: TripWizardState
): Promise<void> {
  const input = text.trim();

  switch (state.step) {
    case 'trip_type': {
      const validTypes: TripType[] = ['fishing', 'diving', 'cruising', 'other'];
      const tripType = input.toLowerCase() as TripType;

      if (!validTypes.includes(tripType)) {
        await sendTextMessage(from, 'Please reply with one of: fishing / diving / cruising / other');
        return;
      }

      state.trip_type = tripType;
      state.step = 'date';
      await saveState(from, state);

      await sendTextMessage(from, 'What date? (e.g. 28/03 or 28 March or Friday 28 March)');
      break;
    }

    case 'date': {
      const parsed = parseDate(input);
      if (!parsed) {
        await sendTextMessage(from, "I couldn't understand that date. Please use format like: 28/03, 28 March, or Friday 28 March");
        return;
      }

      if (parsed < new Date()) {
        await sendTextMessage(from, 'That date has already passed. Enter a future date.');
        return;
      }

      state.departure_date = parsed.toISOString().split('T')[0];
      state.step = 'time';
      await saveState(from, state);

      await sendTextMessage(from, 'What time? (e.g. 6am, 06:00, 14:30)');
      break;
    }

    case 'time': {
      const time = parseTime(input);
      if (!time) {
        await sendTextMessage(from, "I couldn't understand that time. Please use format like: 6am, 06:00, or 14:30");
        return;
      }

      state.departure_time = time;
      state.step = 'duration';
      await saveState(from, state);

      await sendTextMessage(from, 'Duration in hours? (e.g. 4 or 4.5)');
      break;
    }

    case 'duration': {
      const duration = parseFloat(input);
      if (isNaN(duration) || duration <= 0 || duration > 72) {
        await sendTextMessage(from, 'Please enter a valid duration in hours (e.g. 4 or 4.5)');
        return;
      }

      state.duration_hours = duration;
      state.step = 'meeting_point';
      await saveState(from, state);

      await sendTextMessage(from, 'Meeting point? (e.g. Dubai Marina, Pier 7)');
      break;
    }

    case 'meeting_point': {
      if (input.length < 2) {
        await sendTextMessage(from, 'Please enter a valid meeting point.');
        return;
      }

      state.meeting_point = input;
      state.step = 'location_url';
      await saveState(from, state);

      await sendTextMessage(from, '📍 Share the exact location as a Google Maps link.\n\nOpen Google Maps → find the spot → tap Share → Copy link → paste it here.\n\nThis link will be shared with guests only after the trip is confirmed.\n\nReply SKIP if you want to share it later.');
      break;
    }

    case 'location_url': {
      if (input.toUpperCase() === 'SKIP') {
        state.location_url = undefined;
      } else if (input.includes('google.com/maps') || input.includes('maps.app.goo.gl') || input.includes('goo.gl/maps')) {
        state.location_url = input;
      } else {
        await sendTextMessage(from, "That doesn't look like a Google Maps link. Please paste a link from Google Maps, or reply SKIP to add it later.");
        return;
      }

      state.step = 'max_seats';
      await saveState(from, state);

      await sendTextMessage(from, 'Maximum number of seats? (e.g. 12)');
      break;
    }

    case 'max_seats': {
      const maxSeats = parseInt(input);
      if (isNaN(maxSeats) || maxSeats < 1 || maxSeats > 100) {
        await sendTextMessage(from, 'Please enter a valid number of seats (1-100).');
        return;
      }

      state.max_seats = maxSeats;
      state.step = 'threshold';
      await saveState(from, state);

      await sendTextMessage(from, `Minimum needed for trip to run? (1-${maxSeats})`);
      break;
    }

    case 'threshold': {
      const threshold = parseInt(input);
      if (isNaN(threshold) || threshold < 1) {
        await sendTextMessage(from, 'Please enter a valid minimum number.');
        return;
      }

      if (threshold > (state.max_seats || 0)) {
        await sendTextMessage(from, `Minimum (${threshold}) can't be more than max seats (${state.max_seats}). Try again.`);
        return;
      }

      state.threshold = threshold;
      state.step = 'price';
      await saveState(from, state);

      await sendTextMessage(from, 'Price per person in AED? (e.g. 250)');
      break;
    }

    case 'price': {
      const price = parseFloat(input);
      if (isNaN(price) || price <= 0) {
        await sendTextMessage(from, 'Enter a number for the price (e.g. 250).');
        return;
      }

      state.price_per_person_aed = price;
      state.step = 'confirm';
      await saveState(from, state);

      // Build summary
      const departureAt = `${state.departure_date}T${state.departure_time}:00`;
      const date = new Date(departureAt);
      const formattedDate = date.toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' });
      const formattedTime = date.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });

      const locationLine = state.location_url
        ? `\n🗺 Location: ${state.location_url} (shared on confirmation)`
        : '\n🗺 Location: Will be shared later';

      await sendTextMessage(
        from,
        `📋 Trip Summary\n\n🚢 Type: ${state.trip_type}\n📅 Date: ${formattedDate}\n⏰ Time: ${formattedTime}\n⏱ Duration: ${state.duration_hours}h\n📍 Meeting: ${state.meeting_point}${locationLine}\n👥 Seats: ${state.max_seats} max, ${state.threshold} minimum\n💰 Price: AED ${state.price_per_person_aed}/person\n\nReply YES to confirm and post, or NO to cancel.`
      );
      break;
    }

    case 'confirm': {
      if (input.toUpperCase() === 'YES') {
        await redis.del(`trip_wizard:${from}`);

        const departureAt = `${state.departure_date}T${state.departure_time}:00`;
        const tripTypeLabel = (state.trip_type || 'fishing').charAt(0).toUpperCase() + (state.trip_type || 'fishing').slice(1);

        const trip = await createTrip({
          captain_id: state.captain_id,
          group_id: state.group_id!,
          trip_type: state.trip_type || 'fishing',
          title: `${tripTypeLabel} Trip`,
          departure_at: departureAt,
          duration_hours: state.duration_hours,
          meeting_point: state.meeting_point,
          location_url: state.location_url,
          max_seats: state.max_seats!,
          threshold: state.threshold!,
          price_per_person_aed: state.price_per_person_aed!,
        });

        // Post announcement to group
        const { data: group } = await supabase
          .from('whatsapp_groups')
          .select('group_id')
          .eq('id', state.group_id)
          .single();

        if (group) {
          await notifyTripPosted(trip, group.group_id);
        }

        await sendTextMessage(from, `✅ Trip created! [${trip.id.substring(0, 6)}]\n\nThe trip card has been posted to your group. Type /status ${trip.id.substring(0, 6)} to track bookings.`);

        logger.info({ tripId: trip.id, captainId: state.captain_id }, 'Trip created via wizard');
      } else {
        await redis.del(`trip_wizard:${from}`);
        await sendTextMessage(from, '❌ Trip creation cancelled. Type /trip to start over.');
      }
      break;
    }
  }
}

async function saveState(from: string, state: TripWizardState): Promise<void> {
  await redis.set(`trip_wizard:${from}`, JSON.stringify(state), { ex: WIZARD_TTL });
}

function parseDate(input: string): Date | null {
  const now = new Date();
  const currentYear = now.getFullYear();

  // Try DD/MM format
  const slashMatch = input.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1]);
    const month = parseInt(slashMatch[2]) - 1;
    const year = slashMatch[3] ? (slashMatch[3].length === 2 ? 2000 + parseInt(slashMatch[3]) : parseInt(slashMatch[3])) : currentYear;
    const date = new Date(year, month, day);
    if (!isNaN(date.getTime())) return date;
  }

  // Try natural language: "28 March", "Friday 28 March", "28 Mar"
  const months: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  const naturalMatch = input.match(/(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)/i);
  if (naturalMatch) {
    const day = parseInt(naturalMatch[1]);
    const month = months[naturalMatch[2].toLowerCase()];
    if (month !== undefined) {
      let date = new Date(currentYear, month, day);
      if (date < now) date = new Date(currentYear + 1, month, day);
      return date;
    }
  }

  return null;
}

function parseTime(input: string): string | null {
  // Handle "6am", "6pm", "06:00", "14:30"
  const ampmMatch = input.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1]);
    const minutes = ampmMatch[2] ? parseInt(ampmMatch[2]) : 0;
    const period = ampmMatch[3].toLowerCase();

    if (period === 'pm' && hours !== 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  // Handle "06:00", "14:30"
  const militaryMatch = input.match(/^(\d{1,2}):(\d{2})$/);
  if (militaryMatch) {
    const hours = parseInt(militaryMatch[1]);
    const minutes = parseInt(militaryMatch[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
  }

  return null;
}
