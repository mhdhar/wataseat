import { TestHarness, TEST_WA_ID } from '../harness';

function getFutureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function testRepeatTrip(h: TestHarness): Promise<string> {
  // /repeat command
  await h.sendText(TEST_WA_ID, '/repeat');
  let msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'Repeat');
  h.assertContains(msgs, 'date');

  // New date (5 days from now to avoid overlap)
  await h.sendText(TEST_WA_ID, getFutureDate(5));
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'time');

  // New time
  await h.sendText(TEST_WA_ID, '7am');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'Repeat Trip Summary');
  h.assertContains(msgs, 'YES');

  // Confirm
  await h.sendText(TEST_WA_ID, 'YES');
  msgs = await h.waitForResponse(TEST_WA_ID, { minMessages: 2, timeout: 15000 });
  h.assertContains(msgs, 'Trip created');

  // Extract short ID
  const shortId = h.extractFromMessages(msgs, /\[([a-f0-9]{6})\]/i);
  if (!shortId) throw new Error('Could not extract repeated trip short ID');

  return shortId;
}
