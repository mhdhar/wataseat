import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger';
import { supabase } from '../db/supabase';
import { calculateCommission } from '../config';
import { getTripSeatOccupancy } from '../services/bookings';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const router = Router();

// Per-session + per-IP rate limiting on checkout (per D-05, D-06)
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.CHECKOUT_RATE_LIMIT_MAX || '3'),
  keyGenerator: (req: Request) => {
    // Primary: session cookie; fallback: IP (via ipKeyGenerator for IPv6 compat)
    const session = req.signedCookies?.['wata_session'];
    if (session) return session;
    // Use express-rate-limit's built-in IP key generator for proper IPv6 handling
    return req.ip ?? 'unknown';
  },
  validate: { ip: false } as any,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: { error: 'Too many booking attempts. Please try again in 15 minutes.' },
});

// GET /book/:shortId — Show trip details and redirect to Stripe Checkout
router.get('/:shortId', async (req: Request, res: Response) => {
  const { shortId } = req.params;

  try {
    // Find trip by short ID
    const { data: trips } = await supabase
      .from('trips')
      .select('*, captains!inner(display_name, is_active)')
      .in('status', ['open', 'confirmed']);

    const trip = trips?.find((t: any) => t.id.substring(0, 6) === shortId);

    if (!trip) {
      res.status(404).send(tripNotFoundPage());
      return;
    }

    // Check if captain's account is still active
    if (!(trip as any).captains?.is_active) {
      res.status(404).send(tripNotFoundPage());
      return;
    }

    // Check if trip departure hasn't passed
    if (new Date(trip.departure_at) <= new Date()) {
      res.status(404).send(tripNotFoundPage());
      return;
    }

    const occupancy = await getTripSeatOccupancy(trip.id);
    const seatsLeft = trip.max_seats - occupancy.total_occupied_seats;

    if (seatsLeft <= 0) {
      res.status(200).send(fullPage(trip));
      return;
    }

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const captainName = (trip as any).captains?.display_name || 'Captain';

    const date = new Date(trip.departure_at);
    const formattedDate = date.toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' });
    const formattedTime = date.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });
    const tripTypeLabel = trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1);

    res.send(bookingPage({
      shortId: shortId as string,
      tripTypeLabel,
      formattedDate,
      formattedTime,
      durationHours: trip.duration_hours,
      meetingPoint: trip.meeting_point || 'TBA',
      priceAed: trip.price_per_person_aed,
      seatsLeft,
      maxSeats: trip.max_seats,
      threshold: trip.threshold,
      captainName,
      checkoutUrl: `${baseUrl}/book/${shortId}/checkout`,
    }));
  } catch (err) {
    logger.error({ err, shortId }, 'Error loading booking page');
    res.status(500).send('Something went wrong. Please try again.');
  }
});

// POST /book/:shortId/checkout — Create Stripe Checkout Session
router.post('/:shortId/checkout', checkoutLimiter, async (req: Request, res: Response) => {
  const { shortId } = req.params;

  try {
    const { data: trips } = await supabase
      .from('trips')
      .select('*')
      .in('status', ['open', 'confirmed']);

    const trip = trips?.find((t: any) => t.id.substring(0, 6) === shortId);

    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    const occupancy = await getTripSeatOccupancy(trip.id);
    const seatsLeft = trip.max_seats - occupancy.total_occupied_seats;
    const numSeats = Math.min(Math.max(parseInt(req.body?.seats) || 1, 1), Math.min(seatsLeft, 4));
    const totalAmount = trip.price_per_person_aed * numSeats;

    // Fetch captain's Stripe account for Connect routing
    const { data: captain } = await supabase
      .from('captains')
      .select('stripe_account_id')
      .eq('id', trip.captain_id)
      .single();

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const tripTypeLabel = trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1);
    const formattedDate = new Date(trip.departure_at).toLocaleDateString('en-AE', {
      weekday: 'short', day: 'numeric', month: 'short',
    });

    // Atomic seat reservation — locks trip row, checks availability, inserts booking
    const { data: bookingId, error: reserveErr } = await supabase.rpc('reserve_seat', {
      p_trip_id: trip.id,
      p_captain_id: trip.captain_id,
      p_guest_whatsapp_id: (req as any).wataSessionId ?? `web_${Date.now()}`,
      p_guest_name: null,
      p_num_seats: numSeats,
      p_price_per_seat: trip.price_per_person_aed,
      p_total_amount: totalAmount,
    });

    if (reserveErr) {
      if (reserveErr.message?.includes('NO_SEATS_AVAILABLE')) {
        res.status(400).send(fullPage(trip));
        return;
      }
      if (reserveErr.message?.includes('TRIP_NOT_AVAILABLE')) {
        res.status(404).send(tripNotFoundPage());
        return;
      }
      logger.error({ err: reserveErr }, 'Failed to reserve seat');
      res.status(500).json({ error: 'Failed to create booking' });
      return;
    }

    const booking = { id: bookingId };

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'aed',
            product_data: {
              name: `${tripTypeLabel} Trip — ${formattedDate}`,
              description: `${trip.meeting_point || 'TBA'} | ${trip.duration_hours || '?'}h`,
            },
            unit_amount: Math.round(trip.price_per_person_aed * 100),
          },
          quantity: numSeats,
        },
      ],
      payment_intent_data: {
        capture_method: 'manual',
        metadata: {
          booking_id: booking.id,
          trip_id: trip.id,
          captain_id: trip.captain_id,
        },
        ...(captain?.stripe_account_id ? {
          application_fee_amount: calculateCommission(totalAmount).feeInFils,
          transfer_data: { destination: captain.stripe_account_id },
        } : {}),
      },
      custom_fields: [
        {
          key: 'whatsapp_number',
          label: { type: 'custom' as const, custom: 'WhatsApp Number (e.g. 971526208920)' },
          type: 'numeric' as const,
        },
      ],
      success_url: `${baseUrl}/book/${shortId}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/book/${shortId}`,
    }, {
      idempotencyKey: `checkout_web_${booking.id}`,
    });

    // Store session ID on booking for later lookup
    await supabase
      .from('bookings')
      .update({ payment_link: session.url, stripe_payment_intent_id: session.payment_intent as string })
      .eq('id', booking.id);

    res.redirect(303, session.url!);
  } catch (err) {
    logger.error({ err, shortId }, 'Error creating checkout session');
    res.status(500).send('Something went wrong. Please try again.');
  }
});

// GET /book/:shortId/success — Post-payment success page
router.get('/:shortId/success', async (req: Request, res: Response) => {
  const { shortId } = req.params;
  const sessionId = req.query.session_id as string;

  let bookingId: string | null = null;
  let whatsappSentTo: string | null = null;

  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const whatsappField = session.custom_fields?.find((f: any) => f.key === 'whatsapp_number');
      let whatsappNumber = whatsappField?.numeric?.value || null;
      const guestName = session.customer_details?.name || null;

      // Normalize WhatsApp number
      if (whatsappNumber) {
        whatsappNumber = whatsappNumber.replace(/^\+/, '').replace(/^00/, '');
      }

      if (whatsappNumber) {
        const pi = await stripe.paymentIntents.retrieve(session.payment_intent as string);
        bookingId = pi.metadata.booking_id;
        whatsappSentTo = whatsappNumber;
        if (bookingId) {
          await supabase
            .from('bookings')
            .update({
              guest_whatsapp_id: whatsappNumber,
              guest_name: guestName,
            })
            .eq('id', bookingId);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error processing success page');
    }
  }

  // Look up trip details for the success page
  try {
    const { data: trips } = await supabase
      .from('trips')
      .select('*, captains!inner(display_name)')
      .in('status', ['open', 'confirmed']);

    const trip = trips?.find((t: any) => t.id.substring(0, 6) === shortId);

    if (trip) {
      const date = new Date(trip.departure_at);
      const formattedDate = date.toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' });
      const formattedTime = date.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });
      const tripTypeLabel = trip.trip_type.charAt(0).toUpperCase() + trip.trip_type.slice(1);
      const captainName = (trip as any).captains?.display_name || 'Captain';
      const tripOccupancy = await getTripSeatOccupancy(trip.id);
      const thresholdMet = tripOccupancy.total_occupied_seats >= trip.threshold;

      // Build Google Calendar link
      const endDate = new Date(date.getTime() + (trip.duration_hours || 4) * 60 * 60 * 1000);
      const calStart = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const calEnd = endDate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const calTitle = encodeURIComponent(`${tripTypeLabel} Trip with ${captainName}`);
      const calLocation = encodeURIComponent(trip.meeting_point || 'TBA');
      const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${calTitle}&dates=${calStart}/${calEnd}&location=${calLocation}`;

      // Fetch booking details for seat count
      let numSeats = 1;
      let totalAmount: number | null = null;
      if (bookingId) {
        const { data: bookingData } = await supabase
          .from('bookings')
          .select('num_seats, total_amount_aed')
          .eq('id', bookingId)
          .single();
        if (bookingData) {
          numSeats = bookingData.num_seats || 1;
          totalAmount = bookingData.total_amount_aed;
        }
      }

      res.send(successPageWithDetails({
        tripTypeLabel,
        formattedDate,
        formattedTime,
        durationHours: trip.duration_hours,
        meetingPoint: trip.meeting_point || 'TBA',
        captainName,
        currentBookings: tripOccupancy.total_occupied_seats,
        threshold: trip.threshold,
        thresholdMet,
        calendarUrl,
        locationUrl: trip.location_url,
        bookingShortId: bookingId ? bookingId.substring(0, 8) : null,
        whatsappSentTo,
        numSeats,
        totalAmount,
      }));
      return;
    }
  } catch (err) {
    logger.error({ err }, 'Error loading trip for success page');
  }

  res.send(successPageBasic());
});

// ─── HTML Pages ──────────────────────────────────────────────────────────────

function bookingPage(data: {
  shortId: string;
  tripTypeLabel: string;
  formattedDate: string;
  formattedTime: string;
  durationHours: number | null;
  meetingPoint: string;
  priceAed: number;
  seatsLeft: number;
  maxSeats: number;
  threshold: number;
  captainName: string;
  checkoutUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Book: ${data.tripTypeLabel} Trip</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f0f4f8; color: #1a1a2e; padding: 20px; }
    .card { max-width: 420px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #0077b6, #00b4d8); color: white; padding: 24px; }
    .header h1 { font-size: 22px; margin-bottom: 4px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .details { padding: 20px 24px; }
    .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; font-size: 15px; }
    .row:last-child { border-bottom: none; }
    .label { color: #666; }
    .value { font-weight: 600; }
    .price { font-size: 28px; font-weight: 700; color: #0077b6; text-align: center; padding: 16px; }
    .price small { font-size: 14px; color: #666; font-weight: 400; }
    .note { background: #f0f9ff; padding: 12px 24px; font-size: 13px; color: #0077b6; text-align: center; }
    .btn-wrap { padding: 20px 24px; }
    .btn { display: block; width: 100%; padding: 16px; background: #0077b6; color: white; border: none; border-radius: 12px; font-size: 17px; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; }
    .btn:active { background: #005f8a; }
    .seats { text-align: center; padding: 8px; font-size: 13px; color: #666; }
    .seat-select { padding: 12px 24px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .seat-select select { padding: 8px 12px; border: 2px solid #0077b6; border-radius: 8px; font-size: 15px; font-weight: 600; background: white; }
  </style>

</head>
<body>
  <form action="${data.checkoutUrl}" method="POST">
    <div class="card">
      <div class="header">
        <h1>${data.tripTypeLabel} Trip</h1>
        <p>by ${data.captainName}</p>
      </div>
      <div class="details">
        <div class="row"><span class="label">Date</span><span class="value">${data.formattedDate}</span></div>
        <div class="row"><span class="label">Time</span><span class="value">${data.formattedTime}${data.durationHours ? ` (${data.durationHours}h)` : ''}</span></div>
        <div class="row"><span class="label">Meeting Point</span><span class="value">${data.meetingPoint}</span></div>
        <div class="row"><span class="label">Seats Left</span><span class="value">${data.seatsLeft} of ${data.maxSeats}</span></div>
      </div>
      <div class="price">AED ${data.priceAed} <small>/person</small></div>
      ${data.seatsLeft > 1 ? `<div class="seat-select">
        <label class="label">How many seats?</label>
        <select name="seats" id="seatPicker">
          ${Array.from({length: Math.min(data.seatsLeft, 4)}, (_, i) => `<option value="${i+1}">${i+1} seat${i > 0 ? 's' : ''}</option>`).join('')}
        </select>
        <span id="total" class="value" style="font-size:16px">Total: AED ${Number(data.priceAed).toFixed(2)}</span>
      </div>` : '<input type="hidden" name="seats" value="1">'}
      <div class="note">Your card is only charged if ${data.threshold}+ people book. Otherwise the hold is released automatically.</div>
      <div class="btn-wrap">
        <button type="submit" class="btn">Book & Pay Securely</button>
      </div>
      <div class="seats">${data.seatsLeft} seat${data.seatsLeft !== 1 ? 's' : ''} remaining</div>
    </div>
  </form>
  <script>
    (function(){var s=document.getElementById('seatPicker'),t=document.getElementById('total');if(s&&t){var p=${Number(data.priceAed)};function u(){t.textContent='Total: AED '+(p*Number(s.value)).toFixed(2)}s.addEventListener('change',u);s.addEventListener('input',u)}})();
  </script>
</body>
</html>`;
}

function successPageWithDetails(data: {
  tripTypeLabel: string;
  formattedDate: string;
  formattedTime: string;
  durationHours: number | null;
  meetingPoint: string;
  captainName: string;
  currentBookings: number;
  threshold: number;
  thresholdMet: boolean;
  calendarUrl: string;
  locationUrl: string | null;
  bookingShortId: string | null;
  whatsappSentTo: string | null;
  numSeats: number;
  totalAmount: number | null;
}): string {
  const seatsLine = data.numSeats > 1
    ? `<div class="row"><span class="label">Seats</span><span class="value">${data.numSeats}</span></div>`
    : '';
  const totalLine = data.totalAmount
    ? `<div class="row"><span class="label">Total</span><span class="value">AED ${Number(data.totalAmount).toFixed(2)}</span></div>`
    : '';

  const statusMsg = data.thresholdMet
    ? `<div class="status confirmed">🎉 Trip confirmed — you're ready to sail! ${data.currentBookings} people booked. Your card will be charged shortly.</div>`
    : `<div class="status pending">⏳ Waiting for ${data.threshold - data.currentBookings} more booking${data.threshold - data.currentBookings !== 1 ? 's' : ''} to confirm the trip (${data.currentBookings}/${data.threshold} so far). Your card won't be charged until then. We'll notify you once it's confirmed!</div>`;

  const bookingIdLine = data.bookingShortId
    ? `<div class="row"><span class="label">Booking ID</span><span class="value">${data.bookingShortId}</span></div>`
    : '';

  const whatsappLine = data.whatsappSentTo
    ? `<div class="wa-note">WhatsApp confirmation sent to +${data.whatsappSentTo}</div>`
    : '';

  const locationBtn = data.locationUrl
    ? `<a href="${data.locationUrl}" class="btn-secondary" target="_blank">Open Location</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booked!</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f0f4f8; color: #1a1a2e; padding: 20px; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { max-width: 420px; width: 100%; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #2d9f4e, #27ae60); color: white; padding: 24px; text-align: center; }
    .header .check { font-size: 48px; margin-bottom: 8px; }
    .header h1 { font-size: 22px; margin-bottom: 4px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .details { padding: 20px 24px; }
    .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; font-size: 15px; }
    .row:last-child { border-bottom: none; }
    .label { color: #666; }
    .value { font-weight: 600; }
    .status { padding: 14px 24px; font-size: 14px; text-align: center; line-height: 1.4; }
    .status.confirmed { background: #d4edda; color: #155724; }
    .status.pending { background: #fff3cd; color: #856404; }
    .actions { padding: 16px 24px 24px; display: flex; flex-direction: column; gap: 10px; }
    .btn-primary { display: block; width: 100%; padding: 14px; background: #0077b6; color: white; border: none; border-radius: 12px; font-size: 16px; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; }
    .btn-secondary { display: block; width: 100%; padding: 12px; background: white; color: #0077b6; border: 2px solid #0077b6; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; }
    .wa-note { padding: 10px 24px; font-size: 13px; color: #25D366; text-align: center; font-weight: 500; }
    .note { padding: 12px 24px 20px; font-size: 13px; color: #888; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="check">&#10003;</div>
      <h1>You're booked!</h1>
      <p>${data.tripTypeLabel} Trip with ${data.captainName}</p>
    </div>
    <div class="details">
      ${bookingIdLine}
      <div class="row"><span class="label">Date</span><span class="value">${data.formattedDate}</span></div>
      <div class="row"><span class="label">Time</span><span class="value">${data.formattedTime}${data.durationHours ? ` (${data.durationHours}h)` : ''}</span></div>
      <div class="row"><span class="label">Meeting Point</span><span class="value">${data.meetingPoint}</span></div>
      ${seatsLine}
      ${totalLine}
    </div>
    ${statusMsg}
    ${whatsappLine}
    <div class="actions">
      <a href="${data.calendarUrl}" class="btn-primary" target="_blank">Add to Calendar</a>
      ${locationBtn}
    </div>
    <div class="note">You can close this page.</div>
  </div>
</body>
</html>`;
}

function successPageBasic(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booked!</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f0f4f8; padding: 20px; }
    .card { text-align: center; background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); max-width: 400px; }
    .check { font-size: 64px; margin-bottom: 16px; }
    h1 { color: #0077b6; margin-bottom: 8px; }
    p { color: #666; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">&#10003;</div>
    <h1>You're booked!</h1>
    <p>Your card has a hold but won't be charged unless the trip confirms.<br><br>You'll get a WhatsApp message with updates. You can close this page.</p>
  </div>
</body>
</html>`;
}

function tripNotFoundPage(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f0f4f8;padding:20px}.card{text-align:center;background:white;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.1);max-width:400px}h1{color:#e63946}</style></head>
<body><div class="card"><h1>Trip Not Found</h1><p>This trip may have been cancelled or the link is invalid.</p></div></body></html>`;
}

function fullPage(trip: any): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fully Booked</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f0f4f8;padding:20px}.card{text-align:center;background:white;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.1);max-width:400px}h1{color:#e63946}</style></head>
<body><div class="card"><h1>Fully Booked!</h1><p>All ${trip.max_seats} seats are taken. Contact the captain for the next trip.</p></div></body></html>`;
}

export default router;
