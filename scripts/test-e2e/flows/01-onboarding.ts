import { TestHarness, TEST_WA_ID } from '../harness';

export async function testOnboarding(h: TestHarness): Promise<void> {
  // Step 1: First message triggers onboarding
  await h.sendText(TEST_WA_ID, 'Hello');
  let msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, "Welcome to WataSeat");
  h.assertContains(msgs, "What's your name");

  // Step 2: Name
  await h.sendText(TEST_WA_ID, 'Captain Ahmed');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'Captain Ahmed');
  h.assertContains(msgs, "boat's name");

  // Step 3: Boat name
  await h.sendText(TEST_WA_ID, 'Sea Eagle');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'license');

  // Step 4: Skip license
  await h.sendText(TEST_WA_ID, 'skip');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'IBAN');

  // Step 5: IBAN
  await h.sendText(TEST_WA_ID, 'AE070331234567890123456');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'bank');

  // Step 6: Bank name
  await h.sendText(TEST_WA_ID, 'Emirates NBD');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, "You're all set");

  // Verify in DB
  const { data: captain } = await h.supabase
    .from('captains')
    .select('*')
    .eq('whatsapp_id', TEST_WA_ID)
    .single();

  if (!captain) throw new Error('Captain not created in DB');
  if (captain.onboarding_step !== 'complete') throw new Error(`Onboarding step is ${captain.onboarding_step}, expected complete`);
  if (captain.display_name !== 'Captain Ahmed') throw new Error(`Name is ${captain.display_name}, expected Captain Ahmed`);
  if (captain.boat_name !== 'Sea Eagle') throw new Error(`Boat is ${captain.boat_name}, expected Sea Eagle`);
}
