import { TestHarness, TEST_WA_ID } from '../harness';

export async function testHelpCommand(h: TestHarness): Promise<void> {
  await h.sendText(TEST_WA_ID, '/help');
  const msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, '/trip');
  h.assertContains(msgs, '/repeat');
  h.assertContains(msgs, '/cancel');
  h.assertContains(msgs, '/status');
  h.assertContains(msgs, '/earnings');
}

export async function testTripsCommand(h: TestHarness, expectTripId: string): Promise<void> {
  await h.sendText(TEST_WA_ID, '/trips');
  const msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, expectTripId);
  h.assertContains(msgs, 'seats');
}

export async function testStatusCommand(h: TestHarness, shortId: string): Promise<void> {
  await h.sendText(TEST_WA_ID, `/status ${shortId}`);
  const msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, shortId);
  h.assertContains(msgs, 'Fishing');
  h.assertContains(msgs, 'AED 250');
}
