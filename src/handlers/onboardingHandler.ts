import { logger } from '../utils/logger';
import { sendTextMessage, sendImageMessage } from '../services/whatsapp';
import { supabase } from '../db/supabase';
import { Captain, OnboardingStep } from '../types';
import { Redis } from '@upstash/redis';
import { CancelConfirmState, TripWizardState, EditWizardState } from '../types';
import { handleTripWizardStep, parseDate, parseTime } from './tripWizardHandler';
import { handleEditWizardStep } from './editWizardHandler';
import { createTrip } from '../services/trips';
import { trackEvent } from '../services/analytics';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function handleOnboarding(
  from: string,
  text: string,
  message: any
): Promise<void> {
  // Check for cancel confirmation first
  const cancelState = await redis.get<string>(`cancel_confirm:${from}`);
  if (cancelState) {
    const parsed: CancelConfirmState = typeof cancelState === 'string' ? JSON.parse(cancelState) : cancelState;
    if (text.toUpperCase() === 'YES') {
      await redis.del(`cancel_confirm:${from}`);
      const { cancelAllForTrip } = require('../jobs/thresholdCheck');
      await cancelAllForTrip(parsed.trip_id, 'captain_cancelled');
      await sendTextMessage(
        from,
        `✅ Trip cancelled. ${parsed.booking_count} guest${parsed.booking_count !== 1 ? 's' : ''} notified. No charges made.`
      );
      return;
    } else if (text.toUpperCase() === 'NO') {
      await redis.del(`cancel_confirm:${from}`);
      await sendTextMessage(from, '👍 Trip kept active.');
      return;
    }
  }

  // Check for edit wizard state
  const editState = await redis.get<string>(`edit_wizard:${from}`);
  if (editState) {
    const parsed: EditWizardState = typeof editState === 'string' ? JSON.parse(editState) : editState;
    await handleEditWizardStep(from, text, parsed);
    return;
  }

  // Check for trip wizard state
  const wizardState = await redis.get<string>(`trip_wizard:${from}`);
  if (wizardState) {
    const parsed: TripWizardState = typeof wizardState === 'string' ? JSON.parse(wizardState) : wizardState;
    await handleTripWizardStep(from, text, parsed);
    return;
  }

  // Check for repeat wizard state
  const repeatState = await redis.get<string>(`repeat_wizard:${from}`);
  if (repeatState) {
    const parsed = typeof repeatState === 'string' ? JSON.parse(repeatState) : repeatState;
    await handleRepeatWizardStep(from, text, parsed);
    return;
  }

  // Check if user is an existing captain
  const { data: captain } = await supabase
    .from('captains')
    .select('*')
    .eq('whatsapp_id', from)
    .single();

  if (captain) {
    // Continue onboarding based on current step
    await processOnboardingStep(captain, text);
  } else {
    // New user — start onboarding
    await startOnboarding(from);
  }
}

async function startOnboarding(waId: string): Promise<void> {
  // Create captain record
  const { error } = await supabase.from('captains').insert({
    whatsapp_id: waId,
    display_name: '',
    onboarding_step: 'name',
  });

  if (error) {
    // Might already exist due to race condition
    logger.warn({ err: error, waId }, 'Failed to create captain — may already exist');
    return;
  }

  await sendTextMessage(
    waId,
    "Welcome to WataSeat! 🚢\n\nI'll help you set up your captain account in just a few steps.\n\nWhat's your name?"
  );

  trackEvent('wa_onboarding_started', { step: 'name' }, waId);
  logger.info({ waId }, 'Captain onboarding started');
}

async function processOnboardingStep(
  captain: Captain,
  text: string
): Promise<void> {
  const step = captain.onboarding_step;

  switch (step) {
    case 'name': {
      const name = text.trim();
      if (name.length < 2) {
        await sendTextMessage(captain.whatsapp_id, 'Please enter a valid name (at least 2 characters).');
        return;
      }

      await supabase
        .from('captains')
        .update({ display_name: name, onboarding_step: 'boat_name' })
        .eq('id', captain.id);

      await sendTextMessage(captain.whatsapp_id, `Nice to meet you, ${name}! 🎣\n\nWhat's your boat's name?`);
      break;
    }

    case 'boat_name': {
      const boatName = text.trim();
      if (boatName.length < 2) {
        await sendTextMessage(captain.whatsapp_id, 'Please enter a valid boat name.');
        return;
      }

      await supabase
        .from('captains')
        .update({ boat_name: boatName, onboarding_step: 'license' })
        .eq('id', captain.id);

      await sendTextMessage(
        captain.whatsapp_id,
        `Great boat name! 🚢\n\nWhat's your UAE maritime license number? (or type "skip" if you don't have one yet)`
      );
      break;
    }

    case 'license': {
      const license = text.trim().toLowerCase() === 'skip' ? null : text.trim();

      await supabase
        .from('captains')
        .update({ license_number: license, onboarding_step: 'iban' })
        .eq('id', captain.id);

      await sendTextMessage(
        captain.whatsapp_id,
        `Almost there! 💳\n\nTo receive your payouts, I need your bank details.\n\nWhat's your IBAN number?`
      );
      break;
    }

    case 'iban': {
      const iban = text.trim().replace(/\s/g, '').toUpperCase();
      // UAE IBANs: AE + 2 check digits + 3 bank code + 16 account = 23 chars
      const uaeIbanRegex = /^AE\d{21}$/;
      if (!uaeIbanRegex.test(iban)) {
        await sendTextMessage(captain.whatsapp_id, 'That doesn\'t look like a valid UAE IBAN.\n\nUAE IBANs start with AE and are exactly 23 characters.\nExample: AE070331234567890123456\n\nPlease try again.');
        return;
      }

      await supabase
        .from('captains')
        .update({ iban, onboarding_step: 'bank_name' })
        .eq('id', captain.id);

      await sendTextMessage(
        captain.whatsapp_id,
        `Got it! 🏦\n\nWhat's the name of your bank? (e.g. Emirates NBD, ADCB, Mashreq)`
      );
      break;
    }

    case 'bank_name': {
      const bankName = text.trim();
      if (bankName.length < 2) {
        await sendTextMessage(captain.whatsapp_id, 'Please enter a valid bank name.');
        return;
      }

      await supabase
        .from('captains')
        .update({ bank_name: bankName, onboarding_step: 'complete', is_active: true })
        .eq('id', captain.id);

      trackEvent('wa_onboarding_completed', { captain_id: captain.id }, captain.whatsapp_id);

      await sendTextMessage(
        captain.whatsapp_id,
        `You're all set, Captain! 🎉\n\nYour account is ready. Payouts will be sent to your ${bankName} account.\n\nType /trip to create your first trip — you'll get a booking link to share with your group.\n\nType /help to see all available commands.`
      );
      break;
    }

    case 'complete': {
      await sendTextMessage(
        captain.whatsapp_id,
        "You're already set up! Type /help to see available commands, or /trip to create a new trip."
      );
      break;
    }

    default:
      await sendTextMessage(captain.whatsapp_id, 'Type /help to see available commands.');
  }
}

async function handleRepeatWizardStep(from: string, text: string, state: any): Promise<void> {
  const input = text.trim();

  switch (state.step) {
    case 'date': {
      const parsed = parseDate(input);
      if (!parsed) {
        await sendTextMessage(from, "I couldn't understand that date. Please use format like: 28/03 or 28 March");
        return;
      }
      if (parsed < new Date()) {
        await sendTextMessage(from, 'That date has already passed. Enter a future date.');
        return;
      }
      state.departure_date = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
      state.step = 'time';
      await redis.set(`repeat_wizard:${from}`, JSON.stringify(state), { ex: 600 });
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
      // Skip duration — keep the original trip's duration
      state.step = 'confirm';
      await redis.set(`repeat_wizard:${from}`, JSON.stringify(state), { ex: 600 });

      const tripTypeLabel = state.trip_type.charAt(0).toUpperCase() + state.trip_type.slice(1);
      const departureAt = `${state.departure_date}T${state.departure_time}:00+04:00`;
      const date = new Date(departureAt);
      const formattedDate = date.toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' });
      const formattedTime = date.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });

      await sendTextMessage(
        from,
        `📋 Repeat Trip Summary\n\n🚢 ${tripTypeLabel}\n📅 ${formattedDate} at ${formattedTime}\n⏱ ${state.duration_hours}h\n📍 ${state.meeting_point || 'TBA'}\n👥 ${state.max_seats} seats (min ${state.threshold})\n💰 AED ${state.price_per_person_aed}/person\n\nReply YES to confirm, NO to cancel.`
      );
      break;
    }

    case 'confirm': {
      if (input.toUpperCase() === 'YES') {
        await redis.del(`repeat_wizard:${from}`);

        const tripTypeLabel = state.trip_type.charAt(0).toUpperCase() + state.trip_type.slice(1);
        const departureAt = `${state.departure_date}T${state.departure_time}:00+04:00`;

        const { data: groups } = await supabase
          .from('whatsapp_groups')
          .select('id')
          .eq('captain_id', state.captain_id)
          .eq('is_active', true)
          .limit(1);

        const groupId = groups?.[0]?.id;
        if (!groupId) {
          await sendTextMessage(from, 'Something went wrong. Type /trip to create a trip from scratch.');
          return;
        }

        const trip = await createTrip({
          captain_id: state.captain_id,
          group_id: groupId,
          trip_type: state.trip_type,
          title: `${tripTypeLabel} Trip`,
          departure_at: departureAt,
          duration_hours: state.duration_hours,
          meeting_point: state.meeting_point,
          location_url: state.location_url,
          max_seats: state.max_seats,
          threshold: state.threshold,
          price_per_person_aed: state.price_per_person_aed,
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

        logger.info({ tripId: trip.id, captainId: state.captain_id }, 'Trip created via repeat wizard');
      } else {
        await redis.del(`repeat_wizard:${from}`);
        await sendTextMessage(from, '❌ Repeat cancelled. Type /repeat to try again or /trip for a new trip.');
      }
      break;
    }
  }
}
