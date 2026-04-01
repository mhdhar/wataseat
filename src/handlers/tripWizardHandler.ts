import { logger } from '../utils/logger';
import { sendTextMessage, sendListMessage, sendImageMessage } from '../services/whatsapp';
import { supabase } from '../db/supabase';
import { Captain, TripType, TripWizardState } from '../types';
import { createTrip } from '../services/trips';

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const WIZARD_TTL = 600; // 10 minutes

const STEP_ORDER: TripWizardState['step'][] = [
  'trip_type', 'date', 'time', 'duration', 'emirate', 'meeting_point', 'location_url', 'max_seats', 'threshold', 'price', 'confirm',
];

// Fields to clear when going back to a step (so captain re-enters it)
const STEP_FIELDS: Record<string, keyof TripWizardState> = {
  trip_type: 'trip_type',
  date: 'departure_date',
  time: 'departure_time',
  duration: 'duration_hours',
  emirate: 'emirate',
  meeting_point: 'meeting_point',
  location_url: 'location_url',
  max_seats: 'max_seats',
  threshold: 'threshold',
  price: 'price_per_person_aed',
};

export async function handleTripWizardStart(from: string, captain: Captain): Promise<void> {
  // Find or create a group entry for this captain
  // WhatsApp Business can't join groups, so captain's DM is the destination
  let group: any = null;

  const { data: groups } = await supabase
    .from('whatsapp_groups')
    .select('*')
    .eq('captain_id', captain.id)
    .eq('is_active', true);

  group = groups?.[0] || null;

  if (!group) {
    const { data: newGroup, error } = await supabase
      .from('whatsapp_groups')
      .insert({
        group_id: from,
        captain_id: captain.id,
        group_name: `${captain.display_name}'s trips`,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      logger.error({ err: error, captainId: captain.id }, 'Failed to create group entry');
      await sendTextMessage(from, 'Something went wrong. Please try again.');
      return;
    }
    group = newGroup;
    logger.info({ captainId: captain.id }, 'Auto-created DM group for captain');
  }

  const state: TripWizardState = {
    step: 'trip_type',
    captain_id: captain.id,
    group_id: group.id,
  };

  await redis.set(`trip_wizard:${from}`, JSON.stringify(state), { ex: WIZARD_TTL });

  await sendListMessage(from, {
    body: "Let's create a new trip! 🚢\n\nType *back* at any step to go to the previous step.\n\nWhat type of trip?",
    buttonText: 'Select Trip Type',
    sections: [{
      title: 'Trip Types',
      rows: [
        { id: 'type_fishing', title: 'Fishing' },
        { id: 'type_diving', title: 'Diving' },
        { id: 'type_cruising', title: 'Cruising' },
      ],
    }],
  });
}

export async function handleTripWizardStep(
  from: string,
  text: string,
  state: TripWizardState
): Promise<void> {
  const input = text.trim();

  // Handle "back" command
  if (input.toLowerCase() === 'back') {
    // vessel_image is a conditional step not in STEP_ORDER
    if (state.step === 'vessel_image') {
      state.price_per_person_aed = undefined;
      state.step = 'price';
      await saveState(from, state);
      await sendStepPrompt(from, state);
      return;
    }
    if (state.step === 'confirm') {
      // Check if captain has no vessel image — go back to vessel_image step
      const { data: captainCheck } = await supabase
        .from('captains')
        .select('vessel_image_url')
        .eq('id', state.captain_id)
        .single();
      if (!captainCheck?.vessel_image_url) {
        state.step = 'vessel_image';
        await saveState(from, state);
        await sendStepPrompt(from, state);
        return;
      }
    }
    const currentIdx = STEP_ORDER.indexOf(state.step);
    if (currentIdx <= 0) {
      await sendTextMessage(from, "You're at the first step. Type /trip to restart.");
      return;
    }
    const prevStep = STEP_ORDER[currentIdx - 1];
    // Clear the field for the previous step so captain re-enters it
    const fieldToClear = STEP_FIELDS[prevStep];
    if (fieldToClear) {
      (state as any)[fieldToClear] = undefined;
    }
    state.step = prevStep;
    await saveState(from, state);
    await sendStepPrompt(from, state);
    return;
  }

  switch (state.step) {
    case 'trip_type': {
      const validTypes: TripType[] = ['fishing', 'diving', 'cruising'];
      const tripType = input.toLowerCase() as TripType;

      if (!validTypes.includes(tripType)) {
        await sendTextMessage(from, 'Please select one of: Fishing, Diving, or Cruising.');
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
        await sendTextMessage(from, "I couldn't understand that date, or it's more than 90 days away. Please enter a date within the next 90 days.\n\nFormat: 28/03, 28 March, or 28 Mar");
        return;
      }

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      if (parsed < todayStart) {
        await sendTextMessage(from, 'That date has already passed. Enter a future date.');
        return;
      }

      state.departure_date = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
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

      // Validate departure is in the future if trip is today
      const departureCheck = new Date(`${state.departure_date}T${time}:00+04:00`);
      if (departureCheck <= new Date()) {
        await sendTextMessage(from, 'That time has already passed. Please enter a future departure time.');
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
      state.step = 'emirate';
      await saveState(from, state);

      await sendListMessage(from, {
        body: 'Which emirate is the trip departing from?',
        buttonText: 'Select Emirate',
        sections: [{
          title: 'Emirates',
          rows: [
            { id: 'emirate_abudhabi', title: 'Abu Dhabi' },
            { id: 'emirate_dubai', title: 'Dubai' },
            { id: 'emirate_sharjah', title: 'Sharjah' },
            { id: 'emirate_ajman', title: 'Ajman' },
            { id: 'emirate_uaq', title: 'Umm Al Quwain' },
            { id: 'emirate_rak', title: 'Ras Al Khaimah' },
            { id: 'emirate_fujairah', title: 'Fujairah' },
          ],
        }],
      });
      break;
    }

    case 'emirate': {
      const emirates: Record<string, string> = {
        '1': 'Abu Dhabi', 'abu dhabi': 'Abu Dhabi', 'abudhabi': 'Abu Dhabi',
        '2': 'Dubai', 'dubai': 'Dubai',
        '3': 'Sharjah', 'sharjah': 'Sharjah',
        '4': 'Ajman', 'ajman': 'Ajman',
        '5': 'Umm Al Quwain', 'umm al quwain': 'Umm Al Quwain', 'uaq': 'Umm Al Quwain',
        '6': 'Ras Al Khaimah', 'ras al khaimah': 'Ras Al Khaimah', 'rak': 'Ras Al Khaimah',
        '7': 'Fujairah', 'fujairah': 'Fujairah',
        // Also match exact list titles
        'Abu Dhabi': 'Abu Dhabi', 'Dubai': 'Dubai', 'Sharjah': 'Sharjah',
        'Ajman': 'Ajman', 'Umm Al Quwain': 'Umm Al Quwain',
        'Ras Al Khaimah': 'Ras Al Khaimah', 'Fujairah': 'Fujairah',
      };

      const emirate = emirates[input.toLowerCase()];
      if (!emirate) {
        await sendTextMessage(from, 'Please reply with a number (1-7) or emirate name.');
        return;
      }

      state.emirate = emirate;
      state.meeting_point = emirate;
      state.step = 'location_url';
      await saveState(from, state);

      await sendTextMessage(from, '📍 Share the exact meeting point as a Google Maps link.\n\nOpen Google Maps → find the spot → tap Share → Copy link → paste it here.\n\nThis link will be shared with guests after the trip is confirmed.\n\nReply SKIP if you want to share it later.');
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

      // Check if captain already has a vessel image
      const { data: captainData } = await supabase
        .from('captains')
        .select('vessel_image_url')
        .eq('id', state.captain_id)
        .single();

      if (!captainData?.vessel_image_url) {
        // No image yet — ask for one
        state.step = 'vessel_image';
        await saveState(from, state);
        await sendTextMessage(from, '📸 Send a photo of your vessel! This will be shown to guests on the booking page.\n\nType SKIP if you\'d like to add it later.');
        break;
      }

      // Already has image — go straight to confirm
      state.step = 'confirm';
      await saveState(from, state);

      // Build summary
      const departureAt = `${state.departure_date}T${state.departure_time}:00+04:00`;
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

    case 'vessel_image': {
      if (input.toUpperCase() === 'SKIP') {
        state.step = 'confirm';
        await saveState(from, state);

        const departureAt = `${state.departure_date}T${state.departure_time}:00+04:00`;
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
      } else {
        // Text that isn't SKIP — they need to send an image
        await sendTextMessage(from, 'Please send a photo of your vessel, or type SKIP to continue without one.');
      }
      break;
    }

    case 'confirm': {
      if (input.toUpperCase() === 'YES') {
        const departureAt = `${state.departure_date}T${state.departure_time}:00+04:00`;
        const tripTypeLabel = (state.trip_type || 'fishing').charAt(0).toUpperCase() + (state.trip_type || 'fishing').slice(1);

        // Check for overlapping trips by this captain
        const newStart = new Date(departureAt);
        const newEnd = new Date(newStart.getTime() + (state.duration_hours || 4) * 60 * 60 * 1000);
        const { data: existingTrips } = await supabase
          .from('trips')
          .select('departure_at, duration_hours, trip_type')
          .eq('captain_id', state.captain_id)
          .in('status', ['open', 'confirmed']);

        const overlap = (existingTrips || []).find((t: any) => {
          const tStart = new Date(t.departure_at);
          const tEnd = new Date(tStart.getTime() + (t.duration_hours || 4) * 60 * 60 * 1000);
          return newStart < tEnd && newEnd > tStart;
        });

        if (overlap) {
          const overlapType = (overlap as any).trip_type?.charAt(0).toUpperCase() + (overlap as any).trip_type?.slice(1);
          const overlapDate = new Date((overlap as any).departure_at).toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' });
          const overlapTime = new Date((overlap as any).departure_at).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });
          await sendTextMessage(from, `⚠️ You already have a ${overlapType} Trip on ${overlapDate} at ${overlapTime} that overlaps with this time slot.\n\nReply YES to create anyway, or NO to cancel.`);
          return; // Don't clear wizard state — let them try again
        }

        await redis.del(`trip_wizard:${from}`);

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

        const shortId = trip.id.substring(0, 6);
        const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
        const bookingUrl = `${baseUrl}/book/${shortId}`;

        const date = new Date(departureAt);
        const formattedDate = date.toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' });
        const formattedTime = date.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });

        await sendTextMessage(from, `✅ Trip created! [${shortId}]\n\nType /status ${shortId} to track bookings.`);

        const shareMsg = `🚢 ${tripTypeLabel} Trip — ${formattedDate}\n📍 ${state.meeting_point || 'TBA'}\n⏰ ${formattedTime}${state.duration_hours ? ` (${state.duration_hours}h)` : ''}\n💰 AED ${state.price_per_person_aed}/person\n👥 ${state.max_seats} seats (need ${state.threshold} min to confirm)\n\nBook & pay securely:\n${bookingUrl}\n\nYour card is only charged if the trip confirms!`;

        // Check if captain has a vessel image — send as image message with caption
        const { data: captainForImage } = await supabase
          .from('captains')
          .select('vessel_image_url')
          .eq('id', state.captain_id)
          .single();

        await sendTextMessage(from, '📋 Forward the next message to your group:');
        if (captainForImage?.vessel_image_url) {
          await sendImageMessage(from, captainForImage.vessel_image_url, shareMsg);
        } else {
          await sendTextMessage(from, shareMsg);
        }

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

async function sendStepPrompt(from: string, state: TripWizardState): Promise<void> {
  switch (state.step) {
    case 'trip_type':
      await sendListMessage(from, {
        body: "What type of trip?",
        buttonText: 'Select Trip Type',
        sections: [{
          title: 'Trip Types',
          rows: [
            { id: 'type_fishing', title: 'Fishing' },
            { id: 'type_diving', title: 'Diving' },
            { id: 'type_cruising', title: 'Cruising' },
          ],
        }],
      });
      break;
    case 'date':
      await sendTextMessage(from, 'What date? (e.g. 28/03 or 28 March)');
      break;
    case 'time':
      await sendTextMessage(from, 'What time? (e.g. 6am, 06:00, 14:30)');
      break;
    case 'duration':
      await sendTextMessage(from, 'Duration in hours? (e.g. 4 or 4.5)');
      break;
    case 'emirate':
      await sendListMessage(from, {
        body: 'Which emirate is the trip departing from?',
        buttonText: 'Select Emirate',
        sections: [{
          title: 'Emirates',
          rows: [
            { id: 'emirate_abudhabi', title: 'Abu Dhabi' },
            { id: 'emirate_dubai', title: 'Dubai' },
            { id: 'emirate_sharjah', title: 'Sharjah' },
            { id: 'emirate_ajman', title: 'Ajman' },
            { id: 'emirate_uaq', title: 'Umm Al Quwain' },
            { id: 'emirate_rak', title: 'Ras Al Khaimah' },
            { id: 'emirate_fujairah', title: 'Fujairah' },
          ],
        }],
      });
      break;
    case 'meeting_point':
      await sendTextMessage(from, `Enter the meeting point in ${state.emirate || 'your emirate'}:`);
      break;
    case 'location_url':
      await sendTextMessage(from, '📍 Share the exact meeting point as a Google Maps link.\n\nReply SKIP to add it later.');
      break;
    case 'max_seats':
      await sendTextMessage(from, 'Maximum number of seats? (e.g. 12)');
      break;
    case 'threshold':
      await sendTextMessage(from, `Minimum needed for trip to run? (1-${state.max_seats})`);
      break;
    case 'price':
      await sendTextMessage(from, 'Price per person in AED? (e.g. 250)');
      break;
    case 'vessel_image':
      await sendTextMessage(from, '📸 Send a photo of your vessel! This will be shown to guests on the booking page.\n\nType SKIP if you\'d like to add it later.');
      break;
    case 'confirm': {
      const departureAt = `${state.departure_date}T${state.departure_time}:00+04:00`;
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
  }
}

export function parseDate(input: string): Date | null {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentYear = now.getFullYear();
  const maxDate = new Date(todayStart.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days ahead

  // Try DD/MM format
  const slashMatch = input.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1]);
    const month = parseInt(slashMatch[2]) - 1;
    const year = slashMatch[3] ? (slashMatch[3].length === 2 ? 2000 + parseInt(slashMatch[3]) : parseInt(slashMatch[3])) : currentYear;
    let date = new Date(year, month, day);
    // Validate day-of-month (new Date(2026, 1, 31) silently becomes March 3)
    if (date.getDate() !== day || date.getMonth() !== month) return null;
    if (!slashMatch[3] && date < todayStart) {
      date = new Date(currentYear + 1, month, day);
      if (date.getDate() !== day || date.getMonth() !== month) return null;
    }
    if (!isNaN(date.getTime()) && date <= maxDate) return date;
    if (!isNaN(date.getTime())) return date;
    return null;
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
      // Validate day-of-month
      if (date.getDate() !== day || date.getMonth() !== month) return null;
      if (date < todayStart) {
        date = new Date(currentYear + 1, month, day);
        if (date.getDate() !== day || date.getMonth() !== month) return null;
      }
      if (date > maxDate) return null;
      return date;
    }
  }

  return null;
}

export function parseTime(input: string): string | null {
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
