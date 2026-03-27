import Stripe from 'stripe';
import { logger } from '../utils/logger';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function createConnectAccount(captainWaId: string): Promise<Stripe.Account> {
  const account = await stripe.accounts.create({
    type: 'standard',
    metadata: { whatsapp_id: captainWaId },
  });
  logger.info({ accountId: account.id, captainWaId }, 'Stripe Connect account created');
  return account;
}

export async function createOnboardingLink(
  accountId: string
): Promise<string> {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${appUrl}/connect/refresh`,
    return_url: `${appUrl}/connect/complete`,
    type: 'account_onboarding',
  });
  return accountLink.url;
}

export async function getAccountStatus(
  accountId: string
): Promise<{ charges_enabled: boolean; payouts_enabled: boolean }> {
  const account = await stripe.accounts.retrieve(accountId);
  return {
    charges_enabled: account.charges_enabled ?? false,
    payouts_enabled: account.payouts_enabled ?? false,
  };
}
