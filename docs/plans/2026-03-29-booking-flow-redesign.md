# Booking Flow Redesign — Shareable Links + Platform Payments + Repeat Trips

**Date:** 2026-03-29
**Status:** Approved

## Problem

WhatsApp Business accounts cannot join groups. The bot communicates via 1:1 DMs only. The original design (bot posts trip cards in groups, guests tap "Book My Seat") doesn't work. Additionally, Stripe Connect isn't set up yet — payments need to work on the platform account with manual captain payouts.

## Design

### Feature 1: Shareable Trip Message with Booking Link

**Flow:**
1. Captain DMs bot `/trip` → wizard → trip created
2. Bot sends captain a copy-paste message with trip details + booking URL
3. Captain pastes into their WhatsApp group
4. Guest taps link → WhatsApp in-app browser → Stripe Checkout (Apple Pay / card)
5. Payment authorized (hold, not charged) → webhook records booking
6. Bot DMs guest confirmation using WhatsApp number from Stripe custom field

**Booking URL:** `GET /book/:shortId` on our Express server. Creates a Stripe Checkout Session with `capture_method: 'manual'` and redirects to Stripe.

**Shareable message format:**
```
🚢 Fishing Trip — Tue 1 Apr
📍 Sharjah
⏰ 5:00 AM (6h)
💰 AED 250/person
👥 10 seats (need 1 min to confirm)

Book & pay securely: https://server.com/book/0848ec
Your card is only charged if the trip confirms!
```

### Feature 2: Platform-Only Stripe (No Connect)

- All PaymentIntents on platform account (no `transfer_data`, no `application_fee_amount`)
- `capture_method: 'manual'` — authorization hold only
- Existing threshold check cron captures holds when threshold met
- Captain payouts handled manually
- When Connect is added later, just add `transfer_data` back

### Feature 3: `/repeat` — Repeat Last Trip

- Captain types `/repeat` in DM
- Bot finds most recent trip by `created_at`
- Shows summary, asks for date + time + duration only
- Creates new trip with same settings
- Sends shareable message with new booking link

## Stripe Checkout Session Config

```typescript
{
  mode: 'payment',
  payment_method_types: ['card'],  // Apple Pay auto-enabled on card
  line_items: [{ price_data: { currency: 'aed', ... }, quantity: 1 }],
  payment_intent_data: { capture_method: 'manual', metadata: { trip_id, booking_id } },
  custom_fields: [{ key: 'whatsapp_number', label: 'WhatsApp Number', type: 'numeric' }],
  success_url: '/book/:shortId/success',
  cancel_url: '/book/:shortId',
}
```

## Webhook: checkout.session.completed

1. Extract `trip_id` and `booking_id` from payment_intent metadata
2. Extract WhatsApp number from `custom_fields`
3. Create/update booking record
4. Increment `trip.current_bookings`
5. DM guest confirmation via WhatsApp
6. Check if threshold met → if so, capture all holds immediately

## Files

| File | Change |
|---|---|
| `src/routes/booking.ts` | **NEW** — GET /book/:shortId, GET /book/:shortId/success |
| `src/routes/stripe.ts` | Handle checkout.session.completed event |
| `src/handlers/commandHandler.ts` | Remove Stripe check, add /repeat |
| `src/handlers/tripWizardHandler.ts` | Auto-create DM group, send shareable message |
| `src/services/stripe.ts` | Remove Connect params, add createCheckoutForBooking() |
| `src/server.ts` | Register /book route |
