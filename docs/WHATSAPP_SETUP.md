# WHATSAPP_SETUP.md — WataSeat

> Step-by-step guide to setting up Meta WhatsApp Cloud API. Do this before Phase 1.

---

## 1. Meta Developer Console Setup

### Step 1 — Create Meta App
1. Go to developers.facebook.com
2. Click "Create App"
3. Select type: **Business**
4. App name: `WataSeat`
5. Business account: your SeaSeatShare or personal business account

### Step 2 — Add WhatsApp Product
1. In your app dashboard → Add Product → **WhatsApp**
2. This creates a WhatsApp Business Account (WABA) under your app
3. Note the **WhatsApp Business Account ID** — paste into `.env`

### Step 3 — Register a Phone Number
1. WhatsApp → API Setup → Add phone number
2. Use a dedicated SIM or virtual number (e.g. from UAE carriers: Etisalat, du)
3. Complete the verification (SMS or voice call)
4. Note the **Phone Number ID** — paste into `.env`

> **Important**: This number cannot be your personal WhatsApp number. It becomes the bot's identity. Use a dedicated number.

### Step 4 — Generate Permanent Access Token
1. Go to Meta Business Settings → System Users
2. Create a system user with **Full Control** permission on your app
3. Generate token → select your app → select these permissions:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
4. Paste the token into `.env` as `WHATSAPP_ACCESS_TOKEN`

> System user tokens don't expire. Do NOT use the temporary test token — it expires in 24 hours.

### Step 5 — Configure Webhook
1. WhatsApp → Configuration → Webhook
2. Callback URL: `https://YOUR_NGROK_URL/webhooks/whatsapp` (dev) or `https://YOUR_RAILWAY_URL/webhooks/whatsapp` (prod)
3. Verify Token: the same value as `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in `.env`
4. Subscribe to these webhook fields:
   - `messages` ✅
   - `message_reactions` ✅
   - `messaging_referrals` ✅

### Step 6 — Get App Secret
1. App Settings → Basic
2. Copy **App Secret** → paste into `.env` as `META_APP_SECRET`

---

## 2. How Groups Work With the Bot

The WataSeat bot is a WhatsApp **phone number**. Captains invite it to their existing groups exactly like adding any contact.

**Adding the bot to a group:**
1. Captain saves the WataSeat bot number in their contacts as "WataSeat 🚢"
2. Captain opens their existing WhatsApp group
3. Group info → Add participants → search WataSeat → Add
4. Bot detects the `group_participant_add` event in the webhook
5. Bot sends a welcome message in the group: "Hi! I'm WataSeat 🚢 Type /help to see what I can do."
6. Bot DMs the group admin (the captain) to start onboarding if they haven't yet

**Key behavior notes:**
- Bot only responds to messages starting with `/` in groups (doesn't respond to every message)
- Bot responds to every message when in 1:1 DM with a captain (for onboarding wizard)
- When a guest taps "Book Now" in the group, all further communication happens in private DM

---

## 3. Message Template Specifications

All templates below must be submitted to Meta for approval before production use. Use template messages (not free-form text) for:
- Any message to a user who hasn't messaged the bot in the last 24 hours
- Booking confirmations, threshold alerts, cancellations

Submit at: Meta Developer Console → WhatsApp → Message Templates → Create Template

### Template: `trip_posted`
- Category: UTILITY
- Language: English
- Body: `"{{1}} is heading out on a {{2}} trip!\n\n{{3}}\n{{4}} seats available, minimum {{5}} to confirm\nAED {{6}} per person\nArea: {{7}}\n\nYour card is only charged if the trip confirms. Tap below to reserve your spot."`
- Variables: captain_name, trip_type, departure_date_time, max_seats, threshold, price, area
- Buttons: Quick Reply — "Book Now"

### Template: `guest_payment` (formerly payment_link)
- Category: UTILITY
- Language: English
- Body: `"Hi {{1}}, here is your payment link for the {{2}} trip on {{3}}.\n\nAmount: AED {{4}}\n\nThis is an authorization hold only. Your card will not be charged unless {{5}} or more passengers confirm. If the trip does not run, the hold is released automatically.\n\nThe link expires in 24 hours."`
- Footer: "WataSeat — Your seat, your terms."
- Variables: guest_first_name, trip_type, departure_date, amount, threshold
- Buttons: URL Button — "Pay Securely" → payment link URL (dynamic)

### Template: `booking_confirmed`
- Category: UTILITY
- Language: English
- Body: `"Your seat is reserved, {{1}}.\n\nTrip: {{2}} on {{3}}\nSeat number: {{4}}\nPassengers so far: {{5}} of {{6}} needed\n\nYour card has a hold but has not been charged. Once {{6}} passengers confirm, the trip is locked in and all cards are charged at once.\n\nWe will notify you as soon as the trip is confirmed."`
- Variables: guest_first_name, trip_type, departure_date, seat_number, current_bookings, threshold

### Template: `booking_charged` (formerly trip_confirmed)
- Category: UTILITY
- Language: English
- Body: `"Your trip is confirmed, {{1}}.\n\n{{2}} on {{3}}\nAmount charged: AED {{4}}\n\nMeeting point: {{5}}\n\nTap below for the exact location. See you there!"`
- Variables: guest_first_name, trip_type, departure_date, amount, meeting_point
- Buttons: URL Button — "Open Location" → Google Maps URL (dynamic)

### Template: `trip_cancelled`
- Category: UTILITY
- Language: English
- Body: `"Hi {{1}}, the {{2}} trip on {{3}} has been cancelled.\n\nThe minimum of {{4}} passengers was not reached. Your card hold has been released and no charge was made.\n\nWe hope to see you on the next one."`
- Variables: guest_first_name, trip_type, departure_date, threshold

### Template: `hold_renewal` (formerly reauth_required)
- Category: UTILITY
- Language: English
- Body: `"Hi {{1}}, your reservation for the {{2}} trip on {{3}} is still active.\n\nTo keep your seat, please renew your card authorization. Your card will not be charged until the trip confirms.\n\nTap below to renew."`
- Variables: guest_first_name, trip_type, departure_date
- Buttons: URL Button — "Renew Hold" → new payment link (dynamic)

### Template: `captain_daily_summary`
- Category: UTILITY
- Language: English
- Body: `"Good morning, Captain {{1}}.\n\nHere are your upcoming trips:\n{{2}}\n\nReply /trips for full details or /status followed by a trip ID to see bookings."`
- Variables: captain_first_name, formatted_trip_list

---

## 4. Interactive Message Format (Non-Template)

Used inside 24-hour windows (free-form messages). This is the trip card format:

```json
{
  "type": "interactive",
  "interactive": {
    "type": "button",
    "header": {
      "type": "text",
      "text": "🚢 Fishing Trip — Fri 28 Mar"
    },
    "body": {
      "text": "📍 Dubai Marina\n⏰ 6:00 AM departure (4 hours)\n💰 AED 250/person\n👥 3/6 seats filled (need 6 min)\n\n⚡ Book now — no charge unless trip confirms!"
    },
    "footer": {
      "text": "WataSeat 🌊 Tap to secure your spot"
    },
    "action": {
      "buttons": [
        {
          "type": "reply",
          "reply": {
            "id": "booking_intent:TRIP_UUID",
            "title": "Book My Seat"
          }
        }
      ]
    }
  }
}
```

---

## 5. Webhook Payload Examples

### Incoming text message in group:
```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": {
          "phone_number_id": "YOUR_PHONE_ID"
        },
        "messages": [{
          "from": "971501234567",
          "id": "wamid.xxx",
          "timestamp": "1234567890",
          "text": { "body": "/trip" },
          "type": "text",
          "context": {
            "id": "group_id_xxx"
          }
        }]
      }
    }]
  }]
}
```

### Interactive button reply (guest tapping "Book My Seat"):
```json
{
  "messages": [{
    "from": "971507654321",
    "type": "interactive",
    "interactive": {
      "type": "button_reply",
      "button_reply": {
        "id": "booking_intent:abc123-def456",
        "title": "Book My Seat"
      }
    }
  }]
}
```

---

## 6. Rate Limits (Meta Cloud API)

| Limit | Value |
|---|---|
| Messages per second | 80 msg/sec per phone number |
| Free conversations per month | 1,000 |
| Per-conversation pricing (beyond 1,000) | ~$0.005–$0.015 depending on country |
| Template message limit | No hard limit, but quality rating monitored |

For UAE (conversation pricing falls under the "Rest of World" tier):
- Service conversations: ~$0.005
- Utility conversations: ~$0.008
- Authentication conversations: ~$0.008

At 150 trips/month with avg 8 guests = 1,200 booking conversations + ~300 captain interactions = ~1,500 conversations/month = roughly $3–5/month in Meta fees.

---

## 7. Testing in Development

During development, you can test with a **test phone number** Meta provides (no real SIM needed):
1. Meta Developer Console → WhatsApp → API Setup → Test Numbers
2. Add your personal WhatsApp number as a test recipient
3. You can send up to 1,000 test messages per day for free

To test groups:
- Create a WhatsApp group on your personal phone
- Add the test bot number to the group
- Send `/help` — bot should respond

Use ngrok to expose your local server:
```bash
ngrok http 3000
# Copy the https:// URL → paste into Meta webhook config
```
