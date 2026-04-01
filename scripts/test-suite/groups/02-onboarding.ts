import { setGroup, test } from '../runner';
import {
  WA_ID, sendText, waitFor, assertContains, cleanup,
  getCaptain, supabase, IS_SILENT, resetOutbound
} from '../harness';

export async function runOnboardingTests() {
  setGroup('Onboarding & Validation');

  // Clean slate
  await cleanup(WA_ID);

  await test('Full onboarding happy path', async () => {
    await sendText(WA_ID, 'Hello');
    let msgs = await waitFor(WA_ID);
    assertContains(msgs, 'Welcome to WataSeat');

    await sendText(WA_ID, 'Captain Mo');
    msgs = await waitFor(WA_ID);
    assertContains(msgs, "boat's name");

    await sendText(WA_ID, 'Sea Eagle');
    msgs = await waitFor(WA_ID);
    assertContains(msgs, 'license');

    await sendText(WA_ID, 'skip');
    msgs = await waitFor(WA_ID);
    assertContains(msgs, 'IBAN');

    await sendText(WA_ID, 'AE070331234567890123456');
    msgs = await waitFor(WA_ID);
    assertContains(msgs, 'bank');

    await sendText(WA_ID, 'Emirates NBD');
    msgs = await waitFor(WA_ID);
    assertContains(msgs, "You're all set");

    const c = await getCaptain(WA_ID);
    if (!c) throw new Error('Captain not created');
    if (c.onboarding_step !== 'complete') throw new Error(`Step=${c.onboarding_step}`);
    if (c.display_name !== 'Captain Mo') throw new Error(`Name=${c.display_name}`);
    if (c.boat_name !== 'Sea Eagle') throw new Error(`Boat=${c.boat_name}`);
    if (c.iban !== 'AE070331234567890123456') throw new Error(`IBAN=${c.iban}`);
  });

  await test('Invalid name (too short)', async () => {
    await cleanup(WA_ID);
    await resetOutbound(WA_ID);
    await sendText(WA_ID, 'Hello');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'A'); // 1 char
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'at least 2');

    // Verify still on name step
    const c = await getCaptain(WA_ID);
    if (c && c.onboarding_step !== 'name') throw new Error(`Step advanced to ${c.onboarding_step}`);

    // Now fix it and continue
    await sendText(WA_ID, 'Captain Mo');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'Sea Eagle');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'skip');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'AE070331234567890123456');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'Emirates NBD');
    await waitFor(WA_ID);
  });

  await test('Invalid IBAN format', async () => {
    await cleanup(WA_ID);
    await resetOutbound(WA_ID);
    await sendText(WA_ID, 'Hi');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'Test Captain');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'Test Boat');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'skip');
    await waitFor(WA_ID);

    // Bad IBAN
    await sendText(WA_ID, 'INVALID123');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'valid UAE IBAN');

    const c = await getCaptain(WA_ID);
    if (c && c.onboarding_step !== 'iban') throw new Error(`Step moved past iban to ${c.onboarding_step}`);

    // Fix and complete
    await sendText(WA_ID, 'AE070331234567890123456');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'Test Bank');
    await waitFor(WA_ID);
  });

  await test('IBAN with spaces accepted', async () => {
    await cleanup(WA_ID);
    await resetOutbound(WA_ID);
    await sendText(WA_ID, 'Hi');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'Captain Spaces');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'My Boat');
    await waitFor(WA_ID);
    await sendText(WA_ID, 'skip');
    await waitFor(WA_ID);

    // IBAN with spaces (should be stripped and accepted)
    await sendText(WA_ID, 'AE07 0331 2345 6789 0123 456');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'bank');

    const c = await getCaptain(WA_ID);
    if (c && c.onboarding_step !== 'bank_name') throw new Error(`Step=${c.onboarding_step}, expected bank_name`);
    if (c && c.iban !== 'AE070331234567890123456') throw new Error(`IBAN not stripped: ${c.iban}`);

    await sendText(WA_ID, 'Mashreq');
    await waitFor(WA_ID);
  });

  await test('Already onboarded captain gets help message', async () => {
    // Captain is complete from previous test
    await sendText(WA_ID, 'Hello again');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'already set up');
  });

  await test('Unknown command returns error', async () => {
    await sendText(WA_ID, '/xyz');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, 'Unknown command');
  });

  await test('/help shows all commands', async () => {
    await sendText(WA_ID, '/help');
    const msgs = await waitFor(WA_ID);
    assertContains(msgs, '/trip');
    assertContains(msgs, '/repeat');
    assertContains(msgs, '/cancel');
    assertContains(msgs, '/status');
    assertContains(msgs, '/edit');
    assertContains(msgs, '/earnings');
  });
}
