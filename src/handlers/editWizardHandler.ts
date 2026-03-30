import { logger } from '../utils/logger';
import { sendTextMessage } from '../services/whatsapp';
import { supabase } from '../db/supabase';
import { Redis } from '@upstash/redis';
import { EditWizardState, Trip } from '../types';
import { parseDate, parseTime } from './tripWizardHandler';
import { captureAllForTrip } from '../jobs/thresholdCheck';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const EDIT_WIZARD_TTL = 600; // 10 minutes

const EDITABLE_FIELDS: Record<string, { label: string; dbField: string }> = {
  '1': { label: 'Date', dbField: 'departure_at' },
  '2': { label: 'Time', dbField: 'departure_at' },
  '3': { label: 'Duration', dbField: 'duration_hours' },
  '4': { label: 'Meeting Point', dbField: 'meeting_point' },
  '5': { label: 'Location URL', dbField: 'location_url' },
  '6': { label: 'Price', dbField: 'price_per_person_aed' },
  '7': { label: 'Max Seats', dbField: 'max_seats' },
  '8': { label: 'Threshold', dbField: 'threshold' },
};

export async function startEditWizard(from: string, shortId: string): Promise<void> {
  const { data: captain } = await supabase
    .from('captains')
    .select('*')
    .eq('whatsapp_id', from)
    .single();

  if (!captain || captain.onboarding_step !== 'complete') {
    await sendTextMessage(from, 'Please complete your onboarding first.');
    return;
  }

  // Find trip
  const { data: trips } = await supabase
    .from('trips')
    .select('*')
    .eq('captain_id', captain.id)
    .eq('status', 'open');

  const trip = trips?.find((t: any) => t.id.substring(0, 6) === shortId);

  if (!trip) {
    await sendTextMessage(from, `Trip "${shortId}" not found or is not open. Type /trips to see your trips.`);
    return;
  }

  // Clear other wizard states
  await redis.del(`trip_wizard:${from}`);
  await redis.del(`repeat_wizard:${from}`);

  const state: EditWizardState = {
    step: 'choose_field',
    trip_id: trip.id,
    captain_id: captain.id,
    field_to_edit: null,
    new_value: null,
    original_value: null,
  };

  await redis.set(`edit_wizard:${from}`, JSON.stringify(state), { ex: EDIT_WIZARD_TTL });

  const tripType = trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1);
  const depDate = new Date(trip.departure_at).toLocaleDateString('en-AE', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai',
  });
  const depTime = new Date(trip.departure_at).toLocaleTimeString('en-AE', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai',
  });

  await sendTextMessage(
    from,
    `✏️ Edit ${tripType} Trip [${shortId}]\n\n📅 ${depDate} at ${depTime}\n📍 ${trip.meeting_point || 'TBA'}\n💰 AED ${trip.price_per_person_aed}/person\n👥 ${trip.current_bookings}/${trip.max_seats} seats (min ${trip.threshold})\n\nWhat would you like to change?\n\n1. Date\n2. Time\n3. Duration\n4. Meeting Point\n5. Location URL\n6. Price\n7. Max Seats\n8. Threshold\n\nReply with the number, or type *cancel* to exit.`
  );
}

export async function handleEditWizardStep(from: string, text: string, state: EditWizardState): Promise<void> {
  if (text.toLowerCase() === 'cancel') {
    await redis.del(`edit_wizard:${from}`);
    await sendTextMessage(from, 'Edit cancelled.');
    return;
  }

  const { data: trip } = await supabase
    .from('trips')
    .select('*')
    .eq('id', state.trip_id)
    .single();

  if (!trip || trip.status !== 'open') {
    await redis.del(`edit_wizard:${from}`);
    await sendTextMessage(from, 'This trip is no longer available for editing.');
    return;
  }

  switch (state.step) {
    case 'choose_field':
      await handleFieldSelection(from, text, state, trip);
      break;
    case 'new_value':
      await handleNewValue(from, text, state, trip);
      break;
    case 'confirm':
      await handleConfirmation(from, text, state, trip);
      break;
  }
}

async function handleFieldSelection(from: string, text: string, state: EditWizardState, trip: Trip): Promise<void> {
  const choice = text.trim();
  const field = EDITABLE_FIELDS[choice];

  if (!field) {
    await sendTextMessage(from, 'Please reply with a number 1-8, or type *cancel* to exit.');
    return;
  }

  // Business rule: price can't be changed if bookings exist
  if (choice === '6' && trip.current_bookings > 0) {
    await sendTextMessage(
      from,
      `Can't change the price — ${trip.current_bookings} guest(s) already booked at AED ${trip.price_per_person_aed}. You'd need to cancel the trip and create a new one.\n\nPick another field (1-8) or type *cancel*.`
    );
    return;
  }

  state.step = 'new_value';
  state.field_to_edit = choice;

  // Store original value for display
  switch (choice) {
    case '1': // Date
      state.original_value = new Date(trip.departure_at).toLocaleDateString('en-AE', {
        weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai',
      });
      await redis.set(`edit_wizard:${from}`, JSON.stringify(state), { ex: EDIT_WIZARD_TTL });
      await sendTextMessage(from, `Current date: ${state.original_value}\n\nEnter the new date (e.g. 28/03 or 28 March):`);
      break;
    case '2': // Time
      state.original_value = new Date(trip.departure_at).toLocaleTimeString('en-AE', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai',
      });
      await redis.set(`edit_wizard:${from}`, JSON.stringify(state), { ex: EDIT_WIZARD_TTL });
      await sendTextMessage(from, `Current time: ${state.original_value}\n\nEnter the new time (e.g. 6:00 AM or 14:30):`);
      break;
    case '3': // Duration
      state.original_value = trip.duration_hours;
      await redis.set(`edit_wizard:${from}`, JSON.stringify(state), { ex: EDIT_WIZARD_TTL });
      await sendTextMessage(from, `Current duration: ${trip.duration_hours || '?'}h\n\nEnter the new duration in hours (e.g. 4 or 4.5):`);
      break;
    case '4': // Meeting Point
      state.original_value = trip.meeting_point;
      await redis.set(`edit_wizard:${from}`, JSON.stringify(state), { ex: EDIT_WIZARD_TTL });
      await sendTextMessage(from, `Current meeting point: ${trip.meeting_point || 'TBA'}\n\nEnter the new meeting point:`);
      break;
    case '5': // Location URL
      state.original_value = trip.location_url;
      await redis.set(`edit_wizard:${from}`, JSON.stringify(state), { ex: EDIT_WIZARD_TTL });
      await sendTextMessage(from, `Current location URL: ${trip.location_url || 'none'}\n\nPaste the new Google Maps link (or type "clear" to remove):`);
      break;
    case '6': // Price
      state.original_value = trip.price_per_person_aed;
      await redis.set(`edit_wizard:${from}`, JSON.stringify(state), { ex: EDIT_WIZARD_TTL });
      await sendTextMessage(from, `Current price: AED ${trip.price_per_person_aed}\n\nEnter the new price per person (e.g. 250):`);
      break;
    case '7': // Max Seats
      state.original_value = trip.max_seats;
      await redis.set(`edit_wizard:${from}`, JSON.stringify(state), { ex: EDIT_WIZARD_TTL });
      await sendTextMessage(from, `Current max seats: ${trip.max_seats} (${trip.current_bookings} booked)\n\nEnter the new maximum (must be >= ${trip.current_bookings}):`);
      break;
    case '8': // Threshold
      state.original_value = trip.threshold;
      await redis.set(`edit_wizard:${from}`, JSON.stringify(state), { ex: EDIT_WIZARD_TTL });
      await sendTextMessage(from, `Current threshold: ${trip.threshold} (${trip.current_bookings} booked)\n\nEnter the new minimum passengers:`);
      break;
  }
}

async function handleNewValue(from: string, text: string, state: EditWizardState, trip: Trip): Promise<void> {
  const input = text.trim();
  let displayValue: string;

  switch (state.field_to_edit) {
    case '1': { // Date
      const parsed = parseDate(input);
      if (!parsed) {
        await sendTextMessage(from, 'Invalid date. Use format like 28/03 or 28 March.');
        return;
      }
      // Keep the existing time, change the date
      const existingDep = new Date(trip.departure_at);
      parsed.setHours(existingDep.getHours(), existingDep.getMinutes(), 0, 0);
      if (parsed <= new Date()) {
        await sendTextMessage(from, 'Date must be in the future.');
        return;
      }
      state.new_value = parsed.toISOString();
      displayValue = parsed.toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' });
      break;
    }
    case '2': { // Time
      const timeStr = parseTime(input);
      if (!timeStr) {
        await sendTextMessage(from, 'Invalid time. Use format like 6:00 AM or 14:30.');
        return;
      }
      const dep = new Date(trip.departure_at);
      const [hours, minutes] = timeStr.split(':').map(Number);
      dep.setHours(hours, minutes, 0, 0);
      state.new_value = dep.toISOString();
      displayValue = dep.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
      break;
    }
    case '3': { // Duration
      const duration = parseFloat(input);
      if (isNaN(duration) || duration <= 0 || duration > 72) {
        await sendTextMessage(from, 'Enter a valid duration (0.5-72 hours).');
        return;
      }
      state.new_value = duration;
      displayValue = `${duration}h`;
      break;
    }
    case '4': { // Meeting Point
      if (input.length < 2 || input.length > 200) {
        await sendTextMessage(from, 'Meeting point must be 2-200 characters.');
        return;
      }
      state.new_value = input;
      displayValue = input;
      break;
    }
    case '5': { // Location URL
      if (input.toLowerCase() === 'clear') {
        state.new_value = null;
        displayValue = 'removed';
      } else {
        state.new_value = input;
        displayValue = input.length > 50 ? input.substring(0, 50) + '...' : input;
      }
      break;
    }
    case '6': { // Price
      const price = parseFloat(input);
      if (isNaN(price) || price <= 0) {
        await sendTextMessage(from, 'Enter a valid price (e.g. 250).');
        return;
      }
      state.new_value = price;
      displayValue = `AED ${price}`;
      break;
    }
    case '7': { // Max Seats
      const maxSeats = parseInt(input);
      if (isNaN(maxSeats) || maxSeats < 1) {
        await sendTextMessage(from, 'Enter a valid number of seats.');
        return;
      }
      if (maxSeats < trip.current_bookings) {
        await sendTextMessage(from, `Can't set max seats below ${trip.current_bookings} — that's how many are already booked.`);
        return;
      }
      state.new_value = maxSeats;
      displayValue = `${maxSeats} seats`;
      break;
    }
    case '8': { // Threshold
      const threshold = parseInt(input);
      if (isNaN(threshold) || threshold < 1) {
        await sendTextMessage(from, 'Enter a valid minimum (at least 1).');
        return;
      }
      if (threshold > (trip.max_seats)) {
        await sendTextMessage(from, `Threshold can't exceed max seats (${trip.max_seats}).`);
        return;
      }
      state.new_value = threshold;
      displayValue = `${threshold} minimum`;
      break;
    }
    default:
      await redis.del(`edit_wizard:${from}`);
      return;
  }

  const fieldLabel = EDITABLE_FIELDS[state.field_to_edit!]?.label || 'field';
  state.step = 'confirm';
  await redis.set(`edit_wizard:${from}`, JSON.stringify(state), { ex: EDIT_WIZARD_TTL });

  await sendTextMessage(
    from,
    `Change ${fieldLabel}:\n• Old: ${state.original_value ?? 'none'}\n• New: ${displayValue}\n\nReply *YES* to confirm or *NO* to cancel.`
  );
}

async function handleConfirmation(from: string, text: string, state: EditWizardState, trip: Trip): Promise<void> {
  if (text.toUpperCase() === 'NO') {
    await redis.del(`edit_wizard:${from}`);
    await sendTextMessage(from, 'Edit cancelled. Trip unchanged.');
    return;
  }

  if (text.toUpperCase() !== 'YES') {
    await sendTextMessage(from, 'Reply *YES* to confirm or *NO* to cancel.');
    return;
  }

  await redis.del(`edit_wizard:${from}`);

  // Build the update object
  const update: Record<string, any> = {};
  const fieldChoice = state.field_to_edit;

  switch (fieldChoice) {
    case '1': // Date
    case '2': // Time
      update.departure_at = state.new_value;
      break;
    case '3':
      update.duration_hours = state.new_value;
      break;
    case '4':
      update.meeting_point = state.new_value;
      break;
    case '5':
      update.location_url = state.new_value;
      break;
    case '6':
      update.price_per_person_aed = state.new_value;
      break;
    case '7':
      update.max_seats = state.new_value;
      break;
    case '8':
      update.threshold = state.new_value;
      break;
  }

  const { error } = await supabase
    .from('trips')
    .update(update)
    .eq('id', state.trip_id);

  if (error) {
    logger.error({ err: error, tripId: state.trip_id }, 'Failed to update trip');
    await sendTextMessage(from, 'Something went wrong updating the trip. Please try again.');
    return;
  }

  const fieldLabel = EDITABLE_FIELDS[fieldChoice!]?.label || 'field';
  const shortId = state.trip_id.substring(0, 6);
  await sendTextMessage(from, `✅ ${fieldLabel} updated for trip [${shortId}].`);

  // Notify booked guests for changes that affect them
  const guestNotifyFields = ['1', '2', '4', '5']; // date, time, meeting point, location
  if (guestNotifyFields.includes(fieldChoice!)) {
    await notifyGuestsOfChange(state.trip_id, fieldLabel);
  }

  // If threshold was lowered and now met, trigger capture
  if (fieldChoice === '8') {
    const freshTrip = await supabase.from('trips').select('*').eq('id', state.trip_id).single();
    if (freshTrip.data && freshTrip.data.current_bookings >= freshTrip.data.threshold && freshTrip.data.status === 'open') {
      logger.info({ tripId: state.trip_id }, 'Threshold now met after edit — capturing');
      await captureAllForTrip(state.trip_id);
      await sendTextMessage(from, `🎉 The new threshold is already met! All bookings are being captured.`);
    }
  }
}

async function notifyGuestsOfChange(tripId: string, fieldChanged: string): Promise<void> {
  const { data: bookings } = await supabase
    .from('bookings')
    .select('guest_whatsapp_id, guest_name')
    .eq('trip_id', tripId)
    .not('status', 'eq', 'cancelled');

  if (!bookings || bookings.length === 0) return;

  const { data: trip } = await supabase
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();

  if (!trip) return;

  const tripType = trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1);
  const depDate = new Date(trip.departure_at).toLocaleDateString('en-AE', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai',
  });
  const depTime = new Date(trip.departure_at).toLocaleTimeString('en-AE', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai',
  });

  for (const booking of bookings) {
    if (booking.guest_whatsapp_id && !booking.guest_whatsapp_id.startsWith('pending')) {
      const name = booking.guest_name?.split(' ')[0] || 'there';
      await sendTextMessage(
        booking.guest_whatsapp_id,
        `Hi ${name}, the ${tripType} Trip has been updated.\n\n${fieldChanged} has changed. Here are the latest details:\n\n📅 ${depDate} at ${depTime}\n📍 ${trip.meeting_point || 'TBA'}${trip.location_url ? `\n🗺 ${trip.location_url}` : ''}\n\nBooking ID: ${booking.guest_whatsapp_id.substring(0, 8)}`
      );
    }
  }
}
