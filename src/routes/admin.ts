import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { sendTemplateMessage, sendTextMessage } from '../services/whatsapp';
import { cancelAllForTrip } from '../jobs/thresholdCheck';
import { supabase } from '../db/supabase';
import { createPaymentLink } from '../services/stripe';

const router = Router();

// Verify admin secret on all requests
router.use((req: Request, res: Response, next) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

// Send WhatsApp template message
router.post('/send-whatsapp', async (req: Request, res: Response) => {
  const { to, templateName, templateParams } = req.body;

  if (!to || !templateName) {
    res.status(400).json({ error: 'Missing required fields: to, templateName' });
    return;
  }

  try {
    await sendTemplateMessage(to, templateName, templateParams || []);
    logger.info({ to, templateName }, 'Admin WhatsApp message sent');
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err.message, to, templateName }, 'Admin WhatsApp send failed');
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Cancel/delete a trip — releases Stripe holds, notifies guests + captain
router.post('/cancel-trip', async (req: Request, res: Response) => {
  const { tripId, reason } = req.body;

  if (!tripId) {
    res.status(400).json({ error: 'Missing required field: tripId' });
    return;
  }

  try {
    // Get trip + captain info before cancelling
    const { data: trip } = await supabase
      .from('trips')
      .select('*, captains(display_name, whatsapp_id)')
      .eq('id', tripId)
      .single();

    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    if (trip.status === 'cancelled') {
      res.status(400).json({ error: 'Trip is already cancelled' });
      return;
    }

    // Cancel trip — handles Stripe holds, booking updates, guest + group notifications
    await cancelAllForTrip(tripId, reason || 'Cancelled by admin');

    // Notify the captain
    const captain = trip.captains as { display_name: string; whatsapp_id: string } | null;
    if (captain?.whatsapp_id) {
      const tripDate = new Date(trip.departure_at).toLocaleDateString('en-AE', {
        weekday: 'short', day: 'numeric', month: 'short',
      });
      try {
        await sendTextMessage(
          captain.whatsapp_id,
          `Your trip "${trip.title}" on ${tripDate} has been cancelled by the admin. All guests have been notified and refunded.`
        );
      } catch (err) {
        logger.warn({ err, captainWaId: captain.whatsapp_id }, 'Failed to notify captain of trip deletion');
      }
    }

    logger.info({ tripId, reason }, 'Trip cancelled via admin dashboard');
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err.message, tripId }, 'Admin cancel trip failed');
    res.status(500).json({ error: 'Failed to cancel trip' });
  }
});

// Create a booking + payment link for a trip (admin test booking)
router.post('/create-booking', async (req: Request, res: Response) => {
  const { tripId, guestName, numSeats } = req.body;

  if (!tripId) {
    res.status(400).json({ error: 'Missing required field: tripId' });
    return;
  }

  try {
    const { data: trip } = await supabase
      .from('trips')
      .select('*, captains(display_name, stripe_account_id)')
      .eq('id', tripId)
      .single();

    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    const seats = numSeats || 1;
    const totalAmount = Number(trip.price_per_person_aed) * seats;
    const captain = trip.captains as { display_name: string; stripe_account_id: string | null } | null;

    // Create booking record
    const { data: booking, error: bookErr } = await supabase
      .from('bookings')
      .insert({
        trip_id: tripId,
        captain_id: trip.captain_id,
        guest_whatsapp_id: `admin_${Date.now()}`,
        guest_name: guestName || 'Admin Test',
        num_seats: seats,
        price_per_seat_aed: trip.price_per_person_aed,
        total_amount_aed: totalAmount,
        status: 'pending_payment',
      })
      .select()
      .single();

    if (bookErr || !booking) {
      res.status(500).json({ error: 'Failed to create booking' });
      return;
    }

    const depDate = new Date(trip.departure_at).toLocaleDateString('en-AE', {
      weekday: 'short', day: 'numeric', month: 'short',
    });

    // Create Stripe checkout link
    const paymentUrl = await createPaymentLink({
      amountAed: totalAmount,
      tripType: trip.trip_type,
      departureDate: depDate,
      captainName: captain?.display_name || 'Captain',
      numSeats: seats,
      captainStripeAccountId: captain?.stripe_account_id,
      bookingId: booking.id,
    });

    // Store payment link on booking
    await supabase
      .from('bookings')
      .update({ payment_link: paymentUrl, payment_link_sent_at: new Date().toISOString() })
      .eq('id', booking.id);

    logger.info({ tripId, bookingId: booking.id }, 'Admin booking created');
    res.json({ success: true, paymentUrl, bookingId: booking.id });
  } catch (err: any) {
    logger.error({ err: err.message, tripId }, 'Admin create booking failed');
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

export default router;
