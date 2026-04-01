/**
 * Live E2E Test — sends real WhatsApp messages!
 *
 * Usage: npx tsx scripts/live-test.ts
 *
 * This script:
 * 1. Cleans up existing test data
 * 2. Sends webhook payloads to the running server
 * 3. Server sends REAL WhatsApp messages (not test mode)
 * 4. Verifies results via Supabase DB
 */
import 'dotenv/config';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const WA_ID = '971526208920'; // Captain & guest phone
const GUEST_WA_ID = '971526208921'; // Simulated guest (different number)
const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const META_APP_SECRET = process.env.META_APP_SECRET!;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// ─── Payload Helpers ────────────────────────────────────────

function sign(body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', META_APP_SECRET).update(body).digest('hex');
}

function makeTextPayload(from: string, text: string) {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_ID',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '971500000000', phone_number_id: PHONE_NUMBER_ID },
          messages: [{
            from,
            id: `wamid.live_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Math.floor(Date.now() / 1000).toString(),
            type: 'text',
            text: { body: text },
          }],
        },
        field: 'messages',
      }],
    }],
  };
  const body = JSON.stringify(payload);
  return { body, signature: sign(body) };
}

function makeListPayload(from: string, rowId: string, rowTitle: string) {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_ID',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '971500000000', phone_number_id: PHONE_NUMBER_ID },
          messages: [{
            from,
            id: `wamid.live_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Math.floor(Date.now() / 1000).toString(),
            type: 'interactive',
            interactive: { type: 'list_reply', list_reply: { id: rowId, title: rowTitle } },
          }],
        },
        field: 'messages',
      }],
    }],
  };
  const body = JSON.stringify(payload);
  return { body, signature: sign(body) };
}

function makeButtonPayload(from: string, buttonId: string, buttonTitle: string) {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_ID',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '971500000000', phone_number_id: PHONE_NUMBER_ID },
          messages: [{
            from,
            id: `wamid.live_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Math.floor(Date.now() / 1000).toString(),
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: buttonId, title: buttonTitle } },
          }],
        },
        field: 'messages',
      }],
    }],
  };
  const body = JSON.stringify(payload);
  return { body, signature: sign(body) };
}

// ─── Send Helper ────────────────────────────────────────────

async function send(from: string, text: string): Promise<void> {
  const { body, signature } = makeTextPayload(from, text);
  const res = await fetch(`${BASE_URL}/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
    body,
  });
  if (!res.ok) throw new Error(`Webhook ${res.status}: ${await res.text()}`);
}

async function sendList(from: string, rowId: string, rowTitle: string): Promise<void> {
  const { body, signature } = makeListPayload(from, rowId, rowTitle);
  const res = await fetch(`${BASE_URL}/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
    body,
  });
  if (!res.ok) throw new Error(`Webhook ${res.status}: ${await res.text()}`);
}

async function sendButton(from: string, buttonId: string, buttonTitle: string): Promise<void> {
  const { body, signature } = makeButtonPayload(from, buttonId, buttonTitle);
  const res = await fetch(`${BASE_URL}/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
    body,
  });
  if (!res.ok) throw new Error(`Webhook ${res.status}: ${await res.text()}`);
}

async function wait(ms: number): Promise<void> {
  await new Promise(r => setTimeout(r, ms));
}

function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Cleanup ────────────────────────────────────────────────

async function cleanup(waId: string) {
  const { data: captain } = await supabase.from('captains').select('id').eq('whatsapp_id', waId).single();
  if (captain) {
    const { data: trips } = await supabase.from('trips').select('id').eq('captain_id', captain.id);
    if (trips) {
      for (const t of trips) {
        await supabase.from('bookings').delete().eq('trip_id', t.id);
        await supabase.from('stripe_intents').delete().eq('trip_id', t.id);
      }
    }
    await supabase.from('trips').delete().eq('captain_id', captain.id);
    await supabase.from('whatsapp_groups').delete().eq('captain_id', captain.id);
    await supabase.from('captains').delete().eq('id', captain.id);
  }
  await supabase.from('notification_log').delete().eq('recipient_wa_id', waId);
  await supabase.from('bookings').delete().eq('guest_whatsapp_id', waId);
}

// ─── Test Results ───────────────────────────────────────────

interface Result { name: string; ok: boolean; ms: number; error?: string }
const results: Result[] = [];

async function test(name: string, fn: () => Promise<void>) {
  const t = Date.now();
  try {
    await fn();
    const ms = Date.now() - t;
    results.push({ name, ok: true, ms });
    console.log(`  \x1b[32m[PASS]\x1b[0m ${name} (${(ms / 1000).toFixed(1)}s)`);
  } catch (err: any) {
    const ms = Date.now() - t;
    results.push({ name, ok: false, ms, error: err.message });
    console.log(`  \x1b[31m[FAIL]\x1b[0m ${name} (${(ms / 1000).toFixed(1)}s)`);
    console.log(`         ${err.message}`);
  }
}

// ─── Tests ──────────────────────────────────────────────────

const WAIT = 3000; // Wait between steps for WhatsApp delivery

async function main() {
  console.log(`\n🚢 WataSeat Live E2E Test`);
  console.log(`Captain WhatsApp: +${WA_ID}`);
  console.log(`Server: ${BASE_URL}`);
  console.log('─'.repeat(50));

  // Check server
  try {
    const health = await fetch(`${BASE_URL}/health`);
    if (!health.ok) throw new Error(`Health check failed: ${health.status}`);
    console.log('Server: online\n');
  } catch {
    console.error(`\n\x1b[31mServer not reachable at ${BASE_URL}\x1b[0m`);
    console.error('Start the server: npm run dev\n');
    process.exit(1);
  }

  // Clean up
  console.log('Cleaning up existing data...');
  await cleanup(WA_ID);
  await cleanup(GUEST_WA_ID);
  console.log('Clean.\n');

  // ── 1. Captain Onboarding ──
  await test('Captain onboarding', async () => {
    await send(WA_ID, 'Hello');
    await wait(WAIT);

    // Check captain created with step=name
    let { data: c } = await supabase.from('captains').select('onboarding_step').eq('whatsapp_id', WA_ID).single();
    if (!c || c.onboarding_step !== 'name') throw new Error(`Expected step=name, got ${c?.onboarding_step}`);

    await send(WA_ID, 'Captain Mo');
    await wait(WAIT);

    await send(WA_ID, 'Sea Eagle');
    await wait(WAIT);

    await send(WA_ID, 'skip'); // license
    await wait(WAIT);

    await send(WA_ID, 'AE070331234567890123456'); // IBAN
    await wait(WAIT);

    await send(WA_ID, 'Emirates NBD'); // bank
    await wait(WAIT);

    // Verify complete
    ({ data: c } = await supabase.from('captains').select('*').eq('whatsapp_id', WA_ID).single());
    if (!c) throw new Error('Captain not in DB');
    if (c.onboarding_step !== 'complete') throw new Error(`Step=${c.onboarding_step}, expected complete`);
    if (c.display_name !== 'Captain Mo') throw new Error(`Name=${c.display_name}`);
    if (c.boat_name !== 'Sea Eagle') throw new Error(`Boat=${c.boat_name}`);
  });

  // ── 2. Help Command ──
  await test('/help command', async () => {
    await send(WA_ID, '/help');
    await wait(WAIT);
    // Verify via notification_log
    const { count } = await supabase.from('notification_log')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_wa_id', WA_ID)
      .eq('direction', 'outbound');
    if (!count || count < 1) throw new Error('No outbound messages logged');
  });

  // ── 3. Create Trip 1 (full wizard) ──
  const tripIds: string[] = [];

  await test('Trip 1: full wizard (Fishing, Apr)', async () => {
    await send(WA_ID, '/trip');
    await wait(WAIT);

    await sendList(WA_ID, 'type_fishing', 'Fishing');
    await wait(WAIT);

    await send(WA_ID, futureDate(5)); // 5 days from now
    await wait(WAIT);

    await send(WA_ID, '6am');
    await wait(WAIT);

    await send(WA_ID, '4'); // duration
    await wait(WAIT);

    await sendList(WA_ID, 'emirate_dubai', 'Dubai');
    await wait(WAIT);

    await send(WA_ID, 'SKIP'); // location url
    await wait(WAIT);

    await send(WA_ID, '10'); // max seats
    await wait(WAIT);

    await send(WA_ID, '4'); // threshold
    await wait(WAIT);

    await send(WA_ID, '250'); // price
    await wait(WAIT);

    // May ask for vessel image since captain has none
    await send(WA_ID, 'SKIP'); // skip vessel image (or this is the summary)
    await wait(WAIT);

    await send(WA_ID, 'YES'); // confirm
    await wait(WAIT + 2000); // extra time for trip creation

    const { data: captain } = await supabase.from('captains').select('id').eq('whatsapp_id', WA_ID).single();
    const { data: trips } = await supabase.from('trips').select('id, status, trip_type')
      .eq('captain_id', captain!.id).eq('status', 'open');
    if (!trips || trips.length === 0) throw new Error('No open trip found');
    tripIds.push(trips[0].id.substring(0, 6));
  });

  // ── 4. Create Trip 2 (Diving) ──
  await test('Trip 2: Diving trip', async () => {
    await send(WA_ID, '/trip');
    await wait(WAIT);
    await sendList(WA_ID, 'type_diving', 'Diving');
    await wait(WAIT);
    await send(WA_ID, futureDate(8));
    await wait(WAIT);
    await send(WA_ID, '7am');
    await wait(WAIT);
    await send(WA_ID, '3');
    await wait(WAIT);
    await sendList(WA_ID, 'emirate_fujairah', 'Fujairah');
    await wait(WAIT);
    await send(WA_ID, 'SKIP');
    await wait(WAIT);
    await send(WA_ID, '8');
    await wait(WAIT);
    await send(WA_ID, '3');
    await wait(WAIT);
    await send(WA_ID, '300');
    await wait(WAIT);
    // vessel image prompt (captain still has no image)
    await send(WA_ID, 'SKIP');
    await wait(WAIT);
    await send(WA_ID, 'YES');
    await wait(WAIT + 2000);

    const { data: captain } = await supabase.from('captains').select('id').eq('whatsapp_id', WA_ID).single();
    const { data: trips } = await supabase.from('trips').select('id, trip_type')
      .eq('captain_id', captain!.id).eq('status', 'open').eq('trip_type', 'diving');
    if (!trips || trips.length === 0) throw new Error('Diving trip not found');
    tripIds.push(trips[0].id.substring(0, 6));
  });

  // ── 5. Create Trip 3 (Cruising) ──
  await test('Trip 3: Cruising trip', async () => {
    await send(WA_ID, '/trip');
    await wait(WAIT);
    await sendList(WA_ID, 'type_cruising', 'Cruising');
    await wait(WAIT);
    await send(WA_ID, futureDate(12));
    await wait(WAIT);
    await send(WA_ID, '5pm');
    await wait(WAIT);
    await send(WA_ID, '3');
    await wait(WAIT);
    await sendList(WA_ID, 'emirate_abudhabi', 'Abu Dhabi');
    await wait(WAIT);
    await send(WA_ID, 'SKIP');
    await wait(WAIT);
    await send(WA_ID, '12');
    await wait(WAIT);
    await send(WA_ID, '5');
    await wait(WAIT);
    await send(WA_ID, '180');
    await wait(WAIT);
    await send(WA_ID, 'SKIP');
    await wait(WAIT);
    await send(WA_ID, 'YES');
    await wait(WAIT + 2000);

    const { data: captain } = await supabase.from('captains').select('id').eq('whatsapp_id', WA_ID).single();
    const { data: trips } = await supabase.from('trips').select('id')
      .eq('captain_id', captain!.id).eq('status', 'open').eq('trip_type', 'cruising');
    if (!trips || trips.length === 0) throw new Error('Cruising trip not found');
    tripIds.push(trips[0].id.substring(0, 6));
  });

  // ── 6. Rapid trips 4 & 5 (stress) ──
  await test('Trips 4 & 5: rapid stress creation', async () => {
    for (let i = 0; i < 2; i++) {
      await send(WA_ID, '/trip');
      await wait(WAIT);
      await sendList(WA_ID, 'type_fishing', 'Fishing');
      await wait(WAIT);
      await send(WA_ID, futureDate(20 + i * 5)); // well-spaced dates
      await wait(WAIT);
      await send(WA_ID, `${8 + i}am`);
      await wait(WAIT);
      await send(WA_ID, '4');
      await wait(WAIT);
      await sendList(WA_ID, 'emirate_sharjah', 'Sharjah');
      await wait(WAIT);
      await send(WA_ID, 'SKIP');
      await wait(WAIT);
      await send(WA_ID, '6');
      await wait(WAIT);
      await send(WA_ID, '2');
      await wait(WAIT);
      await send(WA_ID, '150');
      await wait(WAIT);
      await send(WA_ID, 'SKIP');
      await wait(WAIT);
      await send(WA_ID, 'YES');
      await wait(WAIT + 2000);
    }

    const { data: captain } = await supabase.from('captains').select('id').eq('whatsapp_id', WA_ID).single();
    const { data: all } = await supabase.from('trips').select('id').eq('captain_id', captain!.id).eq('status', 'open');
    if (!all || all.length < 5) throw new Error(`Expected 5+ open trips, got ${all?.length}`);
    tripIds.push(all[all.length - 2].id.substring(0, 6));
    tripIds.push(all[all.length - 1].id.substring(0, 6));
  });

  // ── 7. /trips list ──
  await test('/trips command', async () => {
    await send(WA_ID, '/trips');
    await wait(WAIT);
    const { data: logs } = await supabase.from('notification_log')
      .select('*')
      .eq('recipient_wa_id', WA_ID)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(1);
    if (!logs || logs.length === 0) throw new Error('No response logged');
  });

  // ── 8. /status ──
  await test(`/status ${tripIds[0] || '???'}`, async () => {
    if (!tripIds[0]) throw new Error('No trip ID from earlier test');
    await send(WA_ID, `/status ${tripIds[0]}`);
    await wait(WAIT);
  });

  // ── 9. Edit trip ──
  await test(`/edit ${tripIds[0] || '???'} (meeting point)`, async () => {
    if (!tripIds[0]) throw new Error('No trip ID');
    await send(WA_ID, `/edit ${tripIds[0]}`);
    await wait(WAIT);
    await send(WA_ID, '4'); // Meeting Point
    await wait(WAIT);
    await send(WA_ID, 'Dubai Marina Dock B');
    await wait(WAIT);
    await send(WA_ID, 'YES');
    await wait(WAIT);

    // Verify
    const { data: captain } = await supabase.from('captains').select('id').eq('whatsapp_id', WA_ID).single();
    const { data: trips } = await supabase.from('trips').select('meeting_point, id')
      .eq('captain_id', captain!.id).eq('status', 'open');
    const edited = trips?.find((t: any) => t.id.substring(0, 6) === tripIds[0]);
    if (!edited) throw new Error('Trip not found');
    if (edited.meeting_point !== 'Dubai Marina Dock B') throw new Error(`Meeting point = ${edited.meeting_point}`);
  });

  // ── 10. Repeat trip ──
  await test('/repeat command', async () => {
    await send(WA_ID, '/repeat');
    await wait(WAIT);
    await send(WA_ID, futureDate(30)); // 30 days out
    await wait(WAIT);
    await send(WA_ID, '6am');
    await wait(WAIT);
    await send(WA_ID, 'YES');
    await wait(WAIT + 2000);

    const { data: captain } = await supabase.from('captains').select('id').eq('whatsapp_id', WA_ID).single();
    const { data: all } = await supabase.from('trips').select('id').eq('captain_id', captain!.id).eq('status', 'open');
    if (!all || all.length < 6) throw new Error(`Expected 6+ trips after repeat, got ${all?.length}`);
  });

  // ── 11. Cancel a trip ──
  const cancelId = tripIds[4] || tripIds[tripIds.length - 1];
  await test(`/cancel ${cancelId || '???'}`, async () => {
    if (!cancelId) throw new Error('No trip to cancel');
    await send(WA_ID, `/cancel ${cancelId}`);
    await wait(WAIT);
    await send(WA_ID, 'YES');
    await wait(WAIT);

    const { data: captain } = await supabase.from('captains').select('id').eq('whatsapp_id', WA_ID).single();
    const { data: trips } = await supabase.from('trips').select('id, status')
      .eq('captain_id', captain!.id);
    const cancelled = trips?.find((t: any) => t.id.substring(0, 6) === cancelId);
    if (!cancelled) throw new Error('Trip not found');
    if (cancelled.status !== 'cancelled') throw new Error(`Status=${cancelled.status}, expected cancelled`);
  });

  // ── 12. Guest booking attempt ──
  await test('Guest booking attempt (Stripe not set up)', async () => {
    // Get a trip ID (full UUID) for the booking button
    const { data: captain } = await supabase.from('captains').select('id').eq('whatsapp_id', WA_ID).single();
    const { data: trips } = await supabase.from('trips').select('id')
      .eq('captain_id', captain!.id).eq('status', 'open').limit(1);
    if (!trips || trips.length === 0) throw new Error('No open trip');

    await sendButton(GUEST_WA_ID, `booking_intent:${trips[0].id}`, 'Book My Seat');
    await wait(WAIT);

    // Should get "payment setup not complete" message (logged for guest number)
    const { count } = await supabase.from('notification_log')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_wa_id', GUEST_WA_ID)
      .eq('direction', 'outbound');
    if (!count || count < 1) throw new Error('No response sent to guest');
  });

  // ── 13. /earnings ──
  await test('/earnings command', async () => {
    await send(WA_ID, '/earnings');
    await wait(WAIT);
  });

  // ── Summary ──
  console.log('\n' + '─'.repeat(50));
  const passed = results.filter(r => r.ok).length;
  if (passed === results.length) {
    console.log(`\x1b[32m${passed}/${results.length} passed\x1b[0m (${(results.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(0)}s total)`);
  } else {
    console.log(`\x1b[31m${passed}/${results.length} passed, ${results.length - passed} failed\x1b[0m`);
    for (const r of results.filter(r => !r.ok)) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
  }

  // Final DB summary
  const { data: captain } = await supabase.from('captains').select('id, display_name').eq('whatsapp_id', WA_ID).single();
  if (captain) {
    const { data: allTrips } = await supabase.from('trips').select('id, trip_type, status, departure_at, meeting_point, price_per_person_aed, max_seats, threshold')
      .eq('captain_id', captain.id)
      .order('departure_at', { ascending: true });
    console.log(`\nCaptain: ${captain.display_name}`);
    console.log(`Trips: ${allTrips?.length || 0}`);
    if (allTrips) {
      for (const t of allTrips) {
        const d = new Date(t.departure_at).toLocaleDateString('en-AE', { day: 'numeric', month: 'short' });
        const icon = t.status === 'open' ? '🟢' : t.status === 'cancelled' ? '🔴' : '⚪';
        console.log(`  ${icon} [${t.id.substring(0, 6)}] ${t.trip_type} — ${d} — ${t.meeting_point} — AED ${t.price_per_person_aed} — ${t.status}`);
      }
    }
  }
  console.log('');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
