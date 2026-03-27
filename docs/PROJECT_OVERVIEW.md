# WataSeat — Project Overview

> WhatsApp-native group booking with threshold-based payments. Built for UAE maritime. Designed to scale globally.

---

## What Is This

WataSeat is a SaaS product that turns any WhatsApp group into a fully functional booking platform. A captain (or any group organizer) adds the WataSeat bot to their existing WhatsApp group. From inside that group, they can post trip announcements, collect seat reservations, authorize guest payment cards, and automatically charge everyone the moment a minimum passenger threshold is met — all without anyone downloading an app or creating an account.

The entire guest experience lives inside WhatsApp and a 10-second Stripe payment link. The entire captain experience lives inside WhatsApp commands. No dashboard required at MVP.

---

## Core Value Proposition

- **For captains**: Post a trip in one command. Know instantly if it's viable. Get paid automatically.
- **For guests**: Book a seat in 30 seconds. Apple Pay or Google Pay. Zero registration.
- **For SeaSeatShare / platform**: 10% commission captured automatically on every booking that converts.

---

## Target Market

**Phase 1 — UAE Maritime (Months 1–3)**
- Licensed boat captains running fishing, diving, and cruising trips across all 7 emirates
- WhatsApp groups are already how they communicate with their regulars
- Trip sizes: 6–25 passengers, AED 150–500 per person

**Phase 2 — UAE Adjacent (Months 4–6)**
- Desert safari operators
- Yacht charter companies
- Diving clubs
- Group fitness / bootcamp instructors with recurring participant groups

**Phase 3 — Global SaaS (Month 6+)**
- Any operator running group-minimum experiences worldwide
- Event organizers, tour companies, cooking classes, escape rooms

---

## Business Model

**Revenue Stream 1: Transaction Commission**
- 10% of every booking that converts (threshold met + card captured)
- Deducted automatically at capture time via Stripe Connect
- No invoicing, no reconciliation, no chasing

**Revenue Stream 2: Captain Subscription (optional, Phase 2)**
- AED 99/month per captain for unlimited trips + analytics
- Freemium: 3 free trips/month before paywall

**Revenue Stream 3: White-label (Phase 3)**
- Branded version of the bot sold to enterprise operators or marketplaces
- Custom pricing

---

## Key Differentiators

1. **Zero app install** — guests and captains stay in WhatsApp
2. **Threshold-first model** — captains never run a trip at a loss; guests never pay for a cancelled trip
3. **Apple Pay / Google Pay** — fastest possible guest checkout, no friction
4. **WhatsApp-native management** — captain sees everything via bot commands, no external dashboard at MVP
5. **Stripe Connect** — automatic commission split, no manual payouts

---

## What WataSeat Is Not

- Not a full marketplace (that's SeaSeatShare's job)
- Not a chat app replacement
- Not a passenger management system (no manifests, no check-in, no ID verification at this stage)
- Not a solo booking tool (built specifically for group-minimum use cases)

---

## Relationship to SeaSeatShare

WataSeat starts as a SeaSeatShare feature for captains on the SSS platform. It ships as a standalone SaaS once validated. The core booking, payment, and commission logic is shared infrastructure — WataSeat is the WhatsApp-native front end sitting on top of it.

---

## Product Name Rationale

- **Wata** — informal Arabic for "book" / "reserve" (colloquial Gulf dialect)
- **Seat** — the unit being sold
- WhatsApp + Seat = WataSeat
- Short, memorable, bilingual resonance in UAE market
- Domain: wataseat.com (to be registered)

---

## Success Metrics — Month 3 Targets

| Metric | Target |
|---|---|
| Active captains | 25 |
| Trips posted | 150 |
| Trips that hit threshold | 90+ (60%+ conversion) |
| Gross booking value | AED 180,000 |
| Platform revenue (10%) | AED 18,000 |
| Average guests per trip | 8 |
| Guest re-booking rate | 35%+ |
