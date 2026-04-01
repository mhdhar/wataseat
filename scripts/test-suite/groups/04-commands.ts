import { setGroup, test } from '../runner';
import {
  WA_ID, sendText, waitFor, assertContains,
  getCaptain, getCaptainTrips, createTripViaWizard,
  redis, IS_SILENT, resetOutbound, flushResponses
} from '../harness';

export async function runCommandTests() {
  setGroup('Command & Edit Logic');

  // ── /status edge cases ──
  await test('/status with no args shows usage', async () => {
    await sendText(WA_ID, '/status');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'Usage');
  });

  await test('/status with invalid ID shows not found', async () => {
    await sendText(WA_ID, '/status xxxxxx');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'not found');
  });

  // ── /cancel edge cases ──
  await test('/cancel with no args shows usage', async () => {
    await sendText(WA_ID, '/cancel');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'Usage');
  });

  await test('/cancel with invalid ID shows not found', async () => {
    await sendText(WA_ID, '/cancel xxxxxx');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'not found');
  });

  await test('/cancel then NO keeps trip open', async () => {
    const c = await getCaptain(WA_ID);
    const trips = await getCaptainTrips(c!.id, 'open');
    if (trips.length === 0) throw new Error('No open trips to test cancel-NO');
    const shortId = trips[0].id.substring(0, 6);

    await sendText(WA_ID, `/cancel ${shortId}`);
    let msgs = await waitFor(WA_ID);
    assertContains(msgs, 'Are you sure');

    await sendText(WA_ID, 'NO');
    msgs = await waitFor(WA_ID);
    assertContains(msgs, 'kept active');

    // Verify trip still open
    const freshTrips = await getCaptainTrips(c!.id, 'open');
    const stillOpen = freshTrips.find((t: any) => t.id.substring(0, 6) === shortId);
    if (!stillOpen) throw new Error('Trip was cancelled despite NO');
  });

  // ── /edit edge cases ──
  await test('/edit with no args shows usage', async () => {
    await sendText(WA_ID, '/edit');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'Usage');
  });

  await test('/edit then cancel exits wizard', async () => {
    const c = await getCaptain(WA_ID);
    const trips = await getCaptainTrips(c!.id, 'open');
    if (trips.length === 0) throw new Error('No open trips to test edit-cancel');
    const shortId = trips[0].id.substring(0, 6);

    await sendText(WA_ID, `/edit ${shortId}`);
    let msgs = await waitFor(WA_ID);
    assertContains(msgs, 'What would you like to change');

    await sendText(WA_ID, 'cancel');
    msgs = await waitFor(WA_ID);
    assertContains(msgs, 'cancelled');

    // Verify wizard state cleared
    if (IS_SILENT) {
      const state = await redis.get(`edit_wizard:${WA_ID}`);
      if (state) throw new Error('Edit wizard state not cleared');
    }
  });

  await test('/edit meeting point full flow', async () => {
    const c = await getCaptain(WA_ID);
    const trips = await getCaptainTrips(c!.id, 'open');
    if (trips.length === 0) throw new Error('No open trips');
    const shortId = trips[0].id.substring(0, 6);

    await sendText(WA_ID, `/edit ${shortId}`);
    await waitFor(WA_ID);
    await sendText(WA_ID, '4'); // Meeting Point
    await waitFor(WA_ID);
    await sendText(WA_ID, 'Updated Marina Pier');
    let msgs = await waitFor(WA_ID);
    assertContains(msgs, 'Updated Marina Pier');

    await sendText(WA_ID, 'YES');
    msgs = await waitFor(WA_ID);
    assertContains(msgs, 'updated');
  });

  // ── /repeat edge cases ──
  await test('/repeat shows last trip details', async () => {
    await sendText(WA_ID, '/repeat');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'Repeat');
    assertContains(msgs, 'date');

    // Cancel repeat wizard
    await redis.del(`repeat_wizard:${WA_ID}`);
  });

  // ── /earnings with no earnings ──
  await test('/earnings with no payouts', async () => {
    await sendText(WA_ID, '/earnings');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'No earnings');
  });

  // ── /trips list ──
  await test('/trips shows open trips', async () => {
    await sendText(WA_ID, '/trips');
    const msgs = await waitFor(WA_ID);
    // Should list at least the trips created in wizard tests
    const c = await getCaptain(WA_ID);
    const trips = await getCaptainTrips(c!.id, 'open');
    if (trips.length === 0) throw new Error('No trips in DB');
  });

  // ── /status with valid trip ──
  await test('/status shows trip details', async () => {
    const c = await getCaptain(WA_ID);
    const trips = await getCaptainTrips(c!.id, 'open');
    if (trips.length === 0) throw new Error('No trips');
    const shortId = trips[0].id.substring(0, 6);

    await sendText(WA_ID, `/status ${shortId}`);
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, shortId);
    assertContains(msgs, 'Seats');
  });

  // ── Full cancel flow ──
  await test('/cancel confirms and cancels trip', async () => {
    await resetOutbound(WA_ID);
    const shortId = await createTripViaWizard(WA_ID, { dayOffset: 50, time: '10am', price: 100 });

    // Flush any leftover messages from trip creation
    await flushResponses(WA_ID);

    await sendText(WA_ID, `/cancel ${shortId}`);
    let msgs = await waitFor(WA_ID);
    assertContains(msgs, 'Are you sure');

    await sendText(WA_ID, 'YES');
    msgs = await waitFor(WA_ID);
    assertContains(msgs, 'cancelled');

    // Verify in DB
    const c = await getCaptain(WA_ID);
    const trips = await getCaptainTrips(c!.id);
    const cancelled = trips.find((t: any) => t.id.substring(0, 6) === shortId);
    if (!cancelled) throw new Error('Trip not found');
    if (cancelled.status !== 'cancelled') throw new Error(`Status=${cancelled.status}`);
  });
}
