import { logger } from '../utils/logger';
import { sendTextMessage } from '../services/whatsapp';
import { supabase } from '../db/supabase';
import { Captain, OnboardingStep } from '../types';
import { createConnectAccount, createOnboardingLink } from '../services/stripeConnect';
import { Redis } from '@upstash/redis';
import { CancelConfirmState, TripWizardState } from '../types';
import { handleTripWizardStep } from './tripWizardHandler';

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

  // Check for trip wizard state
  const wizardState = await redis.get<string>(`trip_wizard:${from}`);
  if (wizardState) {
    const parsed: TripWizardState = typeof wizardState === 'string' ? JSON.parse(wizardState) : wizardState;
    await handleTripWizardStep(from, text, parsed);
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
        .update({ license_number: license, onboarding_step: 'stripe' })
        .eq('id', captain.id);

      // Create Stripe Connect account
      const account = await createConnectAccount(captain.whatsapp_id);
      const onboardingLink = await createOnboardingLink(account.id);

      await supabase
        .from('captains')
        .update({
          stripe_account_id: account.id,
          stripe_onboarding_url: onboardingLink,
        })
        .eq('id', captain.id);

      await sendTextMessage(
        captain.whatsapp_id,
        `Almost there! 💳\n\nTo receive payments from guests, you need to connect your Stripe account. This is a one-time setup where Stripe handles all payment processing.\n\nTap the link below to set up your account:\n${onboardingLink}\n\nOnce done, I'll confirm you're all set!`
      );
      break;
    }

    case 'stripe': {
      // Captain might be waiting for Stripe — check status
      if (captain.stripe_account_id) {
        const { getAccountStatus } = require('../services/stripeConnect');
        const status = await getAccountStatus(captain.stripe_account_id);

        if (status.charges_enabled) {
          await supabase
            .from('captains')
            .update({ onboarding_step: 'complete', is_active: true, stripe_charges_enabled: true, stripe_payouts_enabled: status.payouts_enabled })
            .eq('id', captain.id);

          await sendTextMessage(
            captain.whatsapp_id,
            "You're all set! 🎉\n\nYour Stripe account is active. Now add me to your WhatsApp group and type /trip to create your first trip!\n\nType /help to see all available commands."
          );
        } else {
          // Re-send link
          const link = await createOnboardingLink(captain.stripe_account_id);
          await sendTextMessage(
            captain.whatsapp_id,
            `Your Stripe account setup isn't complete yet. Please finish the setup here:\n${link}`
          );
        }
      }
      break;
    }

    case 'complete': {
      // Captain is fully onboarded — treat as general message
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
