import { setGroup, test } from '../runner';
import {
  WA_ID, sendText, sendList, waitFor, assertContains,
  getCaptain, getCaptainTrips, createTripViaWizard, futureDate,
  redis, delay, BASE_URL, IS_SILENT, getNotificationCount,
  flushResponses, resetOutbound
} from '../harness';

export async function runStressTests() {
  setGroup('Stress & Load Tests');

  // ── Rapid trip creation ──
  await test('3 rapid trip creations', async () => {
    await resetOutbound(WA_ID);
    const beforeC = await getCaptain(WA_ID);
    const beforeTrips = await getCaptainTrips(beforeC!.id, 'open');
    const beforeCount = beforeTrips.length;

    for (let i = 0; i < 3; i++) {
      await resetOutbound(WA_ID);
      await createTripViaWizard(WA_ID, {
        dayOffset: 55 + i * 3,
        time: `${5 + i}am`,
        type: ['fishing', 'diving', 'cruising'][i],
        emirate: ['Dubai', 'Sharjah', 'Abu Dhabi'][i],
        seats: 6 + i,
        threshold: 2 + i,
        price: 100 + i * 50,
      });
    }

    const afterTrips = await getCaptainTrips(beforeC!.id, 'open');
    const created = afterTrips.length - beforeCount;
    if (created < 3) throw new Error(`Expected 3 new trips, got ${created}`);
  });

  // ── Rapid /help spam ──
  await test('10 rapid /help commands', async () => {
    const beforeCount = await getNotificationCount(WA_ID);

    for (let i = 0; i < 10; i++) {
      await sendText(WA_ID, '/help');
      // Don't wait between sends — true stress test
    }
    // Wait for all to process
    if (IS_SILENT) {
      await waitFor(WA_ID, { min: 10, timeout: 30000 });
    } else {
      await delay(10000);
    }

    const afterCount = await getNotificationCount(WA_ID);
    const sent = afterCount - beforeCount;
    if (sent < 10) throw new Error(`Expected 10 responses, got ${sent}`);
  });

  // ── Rapid /trips + /status interleaved ──
  await test('Rapid /trips + /status interleaved', async () => {
    const c = await getCaptain(WA_ID);
    const trips = await getCaptainTrips(c!.id, 'open');
    if (trips.length === 0) throw new Error('No trips for interleave test');

    const shortId = trips[0].id.substring(0, 6);

    for (let i = 0; i < 5; i++) {
      await sendText(WA_ID, '/trips');
      await sendText(WA_ID, `/status ${shortId}`);
    }

    if (IS_SILENT) {
      await waitFor(WA_ID, { min: 10, timeout: 30000 });
    } else {
      await delay(15000);
    }
  });

  // ── Wizard start/cancel/restart ──
  await test('Start wizard, cancel (NO), restart, complete', async () => {
    await resetOutbound(WA_ID);
    await redis.del(`trip_wizard:${WA_ID}`);
    await redis.del(`repeat_wizard:${WA_ID}`);

    // Create a trip then cancel to test NO flow
    const shortId = await createTripViaWizard(WA_ID, { dayOffset: 80, time: '6am' });

    // Now start another wizard and cancel with NO
    await resetOutbound(WA_ID);
    await sendText(WA_ID, '/trip');
    await waitFor(WA_ID, { min: 1 });
    await delay(1000);
    await flushResponses(WA_ID);

    await sendList(WA_ID, 'type_fishing', 'Fishing');
    await waitFor(WA_ID);
    await sendText(WA_ID, futureDate(81));
    await waitFor(WA_ID);
    await sendText(WA_ID, '7am');
    await waitFor(WA_ID);
    await sendText(WA_ID, '3');
    await waitFor(WA_ID);
    await sendList(WA_ID, 'emirate_dubai', 'Dubai');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'SKIP');
    await waitFor(WA_ID);
    await sendText(WA_ID, '6');
    await waitFor(WA_ID);
    await sendText(WA_ID, '2');
    await waitFor(WA_ID);
    await sendText(WA_ID, '150');
    let msgs = await waitFor(WA_ID);

    const body = msgs.map(m => (m as any).text?.body || '').join(' ').toLowerCase();
    if (body.includes('vessel') || body.includes('photo')) {
      await sendText(WA_ID, 'SKIP');
      msgs = await waitFor(WA_ID);
    }

    // Cancel with NO
    await sendText(WA_ID, 'NO');
    msgs = await waitFor(WA_ID);
    assertContains(msgs, 'cancelled');

    // Restart and complete
    await resetOutbound(WA_ID);
    const shortId2 = await createTripViaWizard(WA_ID, { dayOffset: 82, time: '8am' });
    const c = await getCaptain(WA_ID);
    const trips = await getCaptainTrips(c!.id, 'open');
    const found = trips.find((t: any) => t.id.substring(0, 6) === shortId2);
    if (!found && IS_SILENT) throw new Error('Restarted trip not created');
  });

  // ── Full lifecycle: create → edit → status → cancel ──
  await test('Full lifecycle: create → edit → status → cancel', async () => {
    await resetOutbound(WA_ID);
    // Create
    const shortId = await createTripViaWizard(WA_ID, {
      dayOffset: 85, time: '5am', type: 'cruising', emirate: 'Abu Dhabi', price: 500,
    });

    // Status
    await sendText(WA_ID, `/status ${shortId}`);
    let msgs = await waitFor(WA_ID);
    assertContains(msgs, shortId);

    // Edit meeting point — flush leftover trip creation messages first
    await delay(1000);
    await resetOutbound(WA_ID);
    await sendText(WA_ID, `/edit ${shortId}`);
    await waitFor(WA_ID);
    await sendText(WA_ID, '4');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'Yas Marina');
    await waitFor(WA_ID); // "Change X → New: Yas Marina. Reply YES"
    await sendText(WA_ID, 'YES');
    msgs = await waitFor(WA_ID);
    assertContains(msgs, 'updated');

    // Status again — should show updated meeting point
    await sendText(WA_ID, `/status ${shortId}`);
    msgs = await waitFor(WA_ID);
    assertContains(msgs, 'Yas Marina');

    // Cancel
    await sendText(WA_ID, `/cancel ${shortId}`);
    await waitFor(WA_ID);
    await sendText(WA_ID, 'YES');
    msgs = await waitFor(WA_ID);
    assertContains(msgs, 'cancelled');
  });

  // ── Repeat trip stress ──
  await test('Repeat trip creation', async () => {
    await redis.del(`repeat_wizard:${WA_ID}`);
    await redis.del(`trip_wizard:${WA_ID}`);
    await redis.del(`edit_wizard:${WA_ID}`);
    await redis.del(`cancel_confirm:${WA_ID}`);
    await delay(500);
    await resetOutbound(WA_ID);
    await sendText(WA_ID, '/repeat');
    let msgs = await waitFor(WA_ID);
    assertContains(msgs, 'Repeat');

    await sendText(WA_ID, futureDate(88));
    msgs = await waitFor(WA_ID);
    assertContains(msgs, 'time');

    await sendText(WA_ID, '8am');
    msgs = await waitFor(WA_ID);
    assertContains(msgs, 'Summary');

    await sendText(WA_ID, 'YES');
    msgs = await waitFor(WA_ID, { min: 2, timeout: 15000 });
    assertContains(msgs, 'Trip created');
  });

  // ── Server health after stress ──
  await test('Server healthy after stress', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`Health returned ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error(`Status: ${data.status}`);
  });

  // ── Final DB summary ──
  await test('DB consistency check', async () => {
    const c = await getCaptain(WA_ID);
    if (!c) throw new Error('Captain missing');
    const allTrips = await getCaptainTrips(c.id);
    const openTrips = allTrips.filter((t: any) => t.status === 'open');
    const cancelledTrips = allTrips.filter((t: any) => t.status === 'cancelled');

    console.log(`    \x1b[90mTotal trips: ${allTrips.length} (${openTrips.length} open, ${cancelledTrips.length} cancelled)\x1b[0m`);

    if (allTrips.length < 5) throw new Error(`Expected 5+ trips total, got ${allTrips.length}`);
    if (openTrips.length < 3) throw new Error(`Expected 3+ open trips, got ${openTrips.length}`);
  });
}
