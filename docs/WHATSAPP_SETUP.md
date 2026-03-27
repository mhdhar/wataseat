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
- Body: `"📍 New trip posted by {{1}}!\n\n🗓 {{2}}\n🚢 {{3}} | {{4}} seats available (min {{5}})\n💰 AED {{6}} per person\n📌 {{7}}\n\nTap below to book your seat!"`
- Variables: captain_name, departure_date, trip_type, max_seats, threshold, price, meeting_point
- Buttons: Quick Reply — "Book Now"

### Template: `payment_link`
- Category: UTILITY
- Language: English
- Body: `"Hi {{1}}! Here's your secure payment link for the {{2}} trip on {{3}}.\n\nAmount: AED {{4}}\n\nYour card will be held but NOT charged until {{5}} seats are confirmed. No payment if the trip doesn't run.\n\nLink expires in 24h:"`
- Footer: "WataSeat — Your seat, your terms."
- Variables: guest_first_name, trip_type, departure_date, amount, threshold
- Buttons: URL Button — "Pay Now (Apple/Google Pay)" → payment link URL

### Template: `booking_confirmed`
- Category: UTILITY
- Language: English
- Body: `"✅ Seat secured, {{1}}!\n\nTrip: {{2}} on {{3}}\nYour seat: #{{4}}\nBooked: {{5}}/{{6}} seats\n\nYour card is authorized (not charged yet). We charge everyone at once when all {{6}} seats fill up.\n\nWe'll update you as soon as the trip is confirmed! 🌊"`
- Variables: guest_first_name, trip_type, departure_date, seat_number, current_bookings, threshold

### Template: `threshold_reached`
- Category: UTILITY
- Language: English
- Body: `"🎉 Trip confirmed, {{1}}! All seats filled!\n\nTrip: {{2}} on {{3}}\nYour card has been charged AED {{4}}.\nMeeting point: {{5}}\n\nSee you there! Have questions? Reply here or contact your captain directly."`
- Variables: guest_first_name, trip_type, departure_date, amount, meeting_point

### Template: `trip_cancelled`
- Category: UTILITY
- Language: English
- Body: `"⚠️ Trip cancelled, {{1}}.\n\nUnfortunately the {{2}} trip on {{3}} didn't reach the minimum of {{4}} passengers.\n\nYour card hold has been released. No charge has been made.\n\nWe hope to see you on the next trip! 🚢"`
- Variables: guest_first_name, trip_type, departure_date, threshold

### Template: `reauth_required`
- Category: UTILITY
- Language: English
- Body: `"Hi {{1}}, your seat reservation for {{2}} on {{3}} is still active!\n\nTo keep your spot, please renew your card authorization (your card still won't be charged until the trip confirms).\n\nNew link:"`
- Variables: guest_first_name, trip_type, departure_date
- Buttons: URL Button → new payment link

### Template: `captain_daily_summary`
- Category: UTILITY
- Language: English
- Body: `"Good morning, Captain {{1}}! ☀️\n\nYour upcoming trips:\n{{2}}\n\nType /trips for details or /status [trip ID] to see bookings."`
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
