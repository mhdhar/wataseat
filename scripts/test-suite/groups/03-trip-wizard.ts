import { setGroup, test } from '../runner';
import {
  WA_ID, sendText, sendList, waitFor, assertContains, cleanup,
  getCaptain, getCaptainTrips, createTripViaWizard, futureDate,
  redis, IS_SILENT, delay, flushResponses, resetOutbound
} from '../harness';

/** Ensure captain is fully onboarded. Handles any intermediate state. */
async function ensureCaptain() {
  let c = await getCaptain(WA_ID);
  if (c && c.onboarding_step === 'complete') return;

  // Clean slate
  await cleanup(WA_ID);
  await resetOutbound(WA_ID);

  // Start onboarding
  await sendText(WA_ID, 'Hi');
  await waitFor(WA_ID);

  // Walk through steps based on current DB state
  const steps: Array<{ step: string; input: string }> = [
    { step: 'name', input: 'Captain Mo' },
    { step: 'boat_name', input: 'Sea Eagle' },
    { step: 'license', input: 'skip' },
    { step: 'iban', input: 'AE070331234567890123456' },
    { step: 'bank_name', input: 'Emirates NBD' },
  ];

  for (const s of steps) {
    c = await getCaptain(WA_ID);
    if (!c) throw new Error('ensureCaptain: captain not found');
    if (c.onboarding_step === 'complete') break;
    if (c.onboarding_step === s.step) {
      await sendText(WA_ID, s.input);
      await waitFor(WA_ID);
    }
  }

  c = await getCaptain(WA_ID);
  if (!c || c.onboarding_step !== 'complete') {
    throw new Error(`ensureCaptain: expected complete, got ${c?.onboarding_step}`);
  }
}

/** Start trip wizard and advance to the date step. Handles repeat hint + list message + Fishing selection. */
async function startWizardToDateStep() {
  await flushResponses(WA_ID);
  await redis.del(`trip_wizard:${WA_ID}`);
  await redis.del(`repeat_wizard:${WA_ID}`);

  await sendText(WA_ID, '/trip');
  // /trip may send 2 messages: repeat hint + list. Consume all.
  await waitFor(WA_ID, { min: 1 });
  await delay(300);
  await flushResponses(WA_ID);

  await sendList(WA_ID, 'type_fishing', 'Fishing');
  const msgs = await waitFor(WA_ID);
  assertContains(msgs, 'date');
}

/** Clean up any active wizard state */
async function clearWizard() {
  await redis.del(`trip_wizard:${WA_ID}`);
  await redis.del(`repeat_wizard:${WA_ID}`);
  await redis.del(`edit_wizard:${WA_ID}`);
  await redis.del(`cancel_confirm:${WA_ID}`);
  await delay(500);
  await flushResponses(WA_ID);
}

export async function runTripWizardTests() {
  setGroup('Trip Wizard Logic');

  await cleanup(WA_ID);
  await ensureCaptain();

  // ── Happy path ──
  await test('Full trip creation wizard', async () => {
    await resetOutbound(WA_ID);
    const shortId = await createTripViaWizard(WA_ID, { dayOffset: 5, time: '6am' });
    const c = await getCaptain(WA_ID);
    const trips = await getCaptainTrips(c!.id, 'open');
    if (trips.length === 0) throw new Error('No trip created');
  });

  // ── Validation: past date ──
  await test('Rejects past date', async () => {
    await clearWizard();
    await startWizardToDateStep();

    // Use yesterday's date — guaranteed past
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const pastDate = `${String(yesterday.getDate()).padStart(2, '0')}/${String(yesterday.getMonth() + 1).padStart(2, '0')}/${yesterday.getFullYear()}`;
    await sendText(WA_ID, pastDate);
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'passed');

    await clearWizard();
  });

  // ── Validation: bad date format ──
  await test('Rejects invalid date format', async () => {
    await clearWizard();
    await startWizardToDateStep();

    await sendText(WA_ID, 'not-a-date');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, "couldn't understand");

    await clearWizard();
  });

  // ── Validation: bad time format ──
  await test('Rejects invalid time format', async () => {
    await clearWizard();
    await startWizardToDateStep();

    await sendText(WA_ID, futureDate(10));
    await waitFor(WA_ID); // consumes "What time?" prompt

    await sendText(WA_ID, '25:00');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, "couldn't understand");

    await clearWizard();
  });

  // ── Validation: duration too high ──
  await test('Rejects excessive duration', async () => {
    await clearWizard();
    await startWizardToDateStep();

    await sendText(WA_ID, futureDate(11));
    await waitFor(WA_ID);

    await sendText(WA_ID, '6am');
    await waitFor(WA_ID);

    await sendText(WA_ID, '100'); // > 72 hours
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'valid duration');

    await clearWizard();
  });

  // ── Validation: max seats out of range ──
  await test('Rejects max seats = 0', async () => {
    await clearWizard();
    await startWizardToDateStep();

    await sendText(WA_ID, futureDate(15));
    await waitFor(WA_ID);
    await sendText(WA_ID, '7am');
    await waitFor(WA_ID);
    await sendText(WA_ID, '3');
    await waitFor(WA_ID); // emirate list
    await sendList(WA_ID, 'emirate_dubai', 'Dubai');
    await waitFor(WA_ID); // location prompt
    await sendText(WA_ID, 'SKIP');
    await waitFor(WA_ID); // max seats prompt

    await sendText(WA_ID, '0');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'valid number of seats');

    await clearWizard();
  });

  // ── Validation: threshold > max seats ──
  await test('Rejects threshold > max seats', async () => {
    await clearWizard();
    await startWizardToDateStep();

    await sendText(WA_ID, futureDate(16));
    await waitFor(WA_ID);
    await sendText(WA_ID, '8am');
    await waitFor(WA_ID);
    await sendText(WA_ID, '3');
    await waitFor(WA_ID);
    await sendList(WA_ID, 'emirate_sharjah', 'Sharjah');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'SKIP');
    await waitFor(WA_ID);
    await sendText(WA_ID, '5'); // max seats = 5
    await waitFor(WA_ID); // threshold prompt

    await sendText(WA_ID, '10'); // > max 5
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, "can't be more");

    await clearWizard();
  });

  // ── Validation: price zero ──
  await test('Rejects price = 0', async () => {
    await clearWizard();
    await startWizardToDateStep();

    await sendText(WA_ID, futureDate(17));
    await waitFor(WA_ID);
    await sendText(WA_ID, '9am');
    await waitFor(WA_ID);
    await sendText(WA_ID, '4');
    await waitFor(WA_ID);
    await sendList(WA_ID, 'emirate_dubai', 'Dubai');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'SKIP');
    await waitFor(WA_ID);
    await sendText(WA_ID, '6');
    await waitFor(WA_ID);
    await sendText(WA_ID, '2');
    await waitFor(WA_ID); // price prompt

    await sendText(WA_ID, '0');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'number for the price');

    await clearWizard();
  });

  // ── Back command ──
  await test('"back" command navigates to previous step', async () => {
    await clearWizard();
    await startWizardToDateStep();

    await sendText(WA_ID, futureDate(20));
    await waitFor(WA_ID); // time prompt

    // Go back from time to date
    await sendText(WA_ID, 'back');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'date'); // Should prompt for date again

    if (IS_SILENT) {
      const raw = await redis.get(`trip_wizard:${WA_ID}`);
      const state = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if ((state as any)?.step !== 'date') throw new Error(`State step=${(state as any)?.step}, expected date`);
    }

    await clearWizard();
  });

  // ── Confirm NO ──
  await test('Declining trip at summary (NO)', async () => {
    await clearWizard();
    await resetOutbound(WA_ID);

    const shortId = await createTripViaWizardUntilConfirm(WA_ID);

    await sendText(WA_ID, 'NO');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'cancelled');

    await clearWizard();
  });

  // ── Overlap detection ──
  await test('Overlap detection warns on same date/time', async () => {
    await clearWizard();
    await resetOutbound(WA_ID);

    // Create a trip first
    await createTripViaWizard(WA_ID, { dayOffset: 25, time: '6am', seats: 8, threshold: 3, price: 200 });

    // Try creating another at the same date/time
    await clearWizard();
    await resetOutbound(WA_ID);

    // Walk through wizard to confirm step with same date/time
    await startWizardToDateStep();
    await sendText(WA_ID, futureDate(25));
    await waitFor(WA_ID);
    await sendText(WA_ID, '6am');
    await waitFor(WA_ID);
    await sendText(WA_ID, '4');
    await waitFor(WA_ID);
    await sendList(WA_ID, 'emirate_dubai', 'Dubai');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'SKIP');
    await waitFor(WA_ID);
    await sendText(WA_ID, '6');
    await waitFor(WA_ID);
    await sendText(WA_ID, '2');
    await waitFor(WA_ID);
    await sendText(WA_ID, '100');
    let msgs = await waitFor(WA_ID);

    // Handle vessel image
    const body = msgs.map(m => (m as any).text?.body || (m as any).interactive?.body?.text || '').join(' ').toLowerCase();
    if (body.includes('vessel') || body.includes('photo')) {
      await sendText(WA_ID, 'SKIP');
      msgs = await waitFor(WA_ID);
    }

    await sendText(WA_ID, 'YES');
    msgs = await waitFor(WA_ID);
    assertContains(msgs, 'overlap');

    await sendText(WA_ID, 'NO');
    await waitFor(WA_ID);
    await clearWizard();
  });
}

/** Walk through wizard until the confirm step (don't confirm — used for NO test) */
async function createTripViaWizardUntilConfirm(from: string): Promise<void> {
  await startWizardToDateStep();

  await sendText(from, futureDate(22));
  await waitFor(from);
  await sendText(from, '6am');
  await waitFor(from);
  await sendText(from, '4');
  await waitFor(from);
  await sendList(from, 'emirate_dubai', 'Dubai');
  await waitFor(from);
  await sendText(from, 'SKIP');
  await waitFor(from);
  await sendText(from, '8');
  await waitFor(from);
  await sendText(from, '3');
  await waitFor(from);
  await sendText(from, '200');
  let msgs = await waitFor(from);

  const body = msgs.map(m => (m as any).text?.body || (m as any).interactive?.body?.text || '').join(' ').toLowerCase();
  if (body.includes('vessel') || body.includes('photo')) {
    await sendText(from, 'SKIP');
    await waitFor(from);
  }

  // Now at confirm step — caller can send YES or NO
}
