import Stripe from 'stripe';
import { logger } from '../utils/logger';
import { supabase } from '../db/supabase';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function createPaymentIntent(data: {
  amountAed: number;
  captainStripeAccountId: string;
  bookingId: string;
  tripId: string;
  captainId: string;
  guestWaId: string;
}): Promise<Stripe.PaymentIntent> {
  const amountFils = Math.round(data.amountAed * 100);
  const feeAmount = Math.round(data.amountAed * 10); // 10% in fils

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountFils,
    currency: 'aed',
    capture_method: 'manual',
    payment_method_types: ['card'],
    application_fee_amount: feeAmount,
    transfer_data: {
      destination: data.captainStripeAccountId,
    },
    metadata: {
      booking_id: data.bookingId,
      trip_id: data.tripId,
      captain_id: data.captainId,
      guest_wa_id: data.guestWaId,
    },
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
  captainStripeAccountId: string;
  bookingId: string;
}): Promise<string> {
  // Use Checkout Sessions for Connect — supports application_fee_amount + transfer_data
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
    payment_intent_data: {
      capture_method: 'manual',
      application_fee_amount: Math.round(data.amountAed * 10),
      transfer_data: {
        destination: data.captainStripeAccountId,
      },
      metadata: {
        booking_id: data.bookingId,
      },
    },
    payment_method_types: ['card'],
    success_url: `${process.env.APP_URL || 'http://localhost:3000'}/booking/success?booking_id=${data.bookingId}`,
    cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/booking/cancel?booking_id=${data.bookingId}`,
  });

  const url = session.url || '';
  logger.info({ bookingId: data.bookingId, sessionId: session.id }, 'Checkout session created');
  return url;
}

export async function capturePaymentIntent(
  paymentIntentId: string
): Promise<Stripe.PaymentIntent> {
  const captured = await stripe.paymentIntents.capture(paymentIntentId);
  logger.info({ piId: paymentIntentId }, 'PaymentIntent captured');
  return captured;
}

export async function cancelPaymentIntent(
  paymentIntentId: string
): Promise<Stripe.PaymentIntent> {
  const cancelled = await stripe.paymentIntents.cancel(paymentIntentId);
  logger.info({ piId: paymentIntentId }, 'PaymentIntent cancelled');
  return cancelled;
}
