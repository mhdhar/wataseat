import Stripe from 'stripe';
import { logger } from '../utils/logger';
import { supabase } from '../db/supabase';
import { calculateCommission } from '../config';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function createPaymentIntent(data: {
  amountAed: number;
  captainStripeAccountId?: string | null;
  bookingId: string;
  tripId: string;
  captainId: string;
  guestWaId?: string;
}): Promise<Stripe.PaymentIntent> {
  const amountFils = Math.round(data.amountAed * 100);

  const piData: Stripe.PaymentIntentCreateParams = {
    amount: amountFils,
    currency: 'aed',
    capture_method: 'manual',
    payment_method_types: ['card'],
    metadata: {
      booking_id: data.bookingId,
      trip_id: data.tripId,
      captain_id: data.captainId,
      guest_wa_id: data.guestWaId || '',
    },
  };

  // Only add Connect params if captain has a Stripe account
  if (data.captainStripeAccountId) {
    const { feeInFils } = calculateCommission(data.amountAed);
    piData.application_fee_amount = feeInFils;
    piData.transfer_data = { destination: data.captainStripeAccountId };
  }

  const paymentIntent = await stripe.paymentIntents.create(piData, {
    idempotencyKey: `pi_create_${data.bookingId}`,
  });

  logger.info(
    { piId: paymentIntent.id, bookingId: data.bookingId, amountAed: data.amountAed },
    'PaymentIntent created'
  );

  // Record in stripe_intents table
  await supabase.from('stripe_intents').insert({
    booking_id: data.bookingId,
    trip_id: data.tripId,
    captain_id: data.captainId,
    payment_intent_id: paymentIntent.id,
    amount_aed: data.amountAed,
    stripe_status: paymentIntent.status,
    is_current: true,
  });

  return paymentIntent;
}

export async function createPaymentLink(data: {
  amountAed: number;
  tripType: string;
  departureDate: string;
  captainName: string;
  numSeats: number;
  captainStripeAccountId?: string | null;
  bookingId: string;
}): Promise<string> {
  const piData: any = {
    capture_method: 'manual',
    metadata: { booking_id: data.bookingId },
  };

  if (data.captainStripeAccountId) {
    piData.application_fee_amount = calculateCommission(data.amountAed).feeInFils;
    piData.transfer_data = { destination: data.captainStripeAccountId };
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'aed',
          product_data: {
            name: `${data.tripType} Trip — ${data.departureDate}`,
            description: `${data.numSeats} seat(s) | Captain: ${data.captainName}`,
          },
          unit_amount: Math.round(data.amountAed * 100 / data.numSeats),
        },
        quantity: data.numSeats,
      },
    ],
    payment_intent_data: piData,
    payment_method_types: ['card'],
    success_url: `${process.env.APP_URL || 'http://localhost:3000'}/booking/success?booking_id=${data.bookingId}`,
    cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/booking/cancel?booking_id=${data.bookingId}`,
  }, {
    idempotencyKey: `checkout_${data.bookingId}`,
  });

  const url = session.url || '';
  logger.info({ bookingId: data.bookingId, sessionId: session.id }, 'Checkout session created');
  return url;
}

export async function capturePaymentIntent(
  paymentIntentId: string
): Promise<Stripe.PaymentIntent> {
  const captured = await stripe.paymentIntents.capture(paymentIntentId, {}, {
    idempotencyKey: `pi_capture_${paymentIntentId}`,
  });
  logger.info({ piId: paymentIntentId }, 'PaymentIntent captured');
  return captured;
}

export async function cancelPaymentIntent(
  paymentIntentId: string
): Promise<Stripe.PaymentIntent> {
  const cancelled = await stripe.paymentIntents.cancel(paymentIntentId, {}, {
    idempotencyKey: `pi_cancel_${paymentIntentId}`,
  });
  logger.info({ piId: paymentIntentId }, 'PaymentIntent cancelled');
  return cancelled;
}

export async function refundPaymentIntent(
  paymentIntentId: string
): Promise<Stripe.Refund> {
  const refund = await stripe.refunds.create({ payment_intent: paymentIntentId }, {
    idempotencyKey: `pi_refund_${paymentIntentId}`,
  });
  logger.info({ piId: paymentIntentId, refundId: refund.id }, 'PaymentIntent refunded');
  return refund;
}
