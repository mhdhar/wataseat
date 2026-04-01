import { TestHarness, TEST_WA_ID } from '../harness';

function getFutureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function createQuickTrip(h: TestHarness, dayOffset: number, time: string): Promise<string> {
  await h.sendText(TEST_WA_ID, '/trip');
  await h.waitForResponse(TEST_WA_ID, { minMessages: 1, timeout: 10000 });

  // Select Fishing
  await h.sendListSelection(TEST_WA_ID, 'type_fishing', 'Fishing');
  await h.waitForResponse(TEST_WA_ID);

  // Date
  await h.sendText(TEST_WA_ID, getFutureDate(dayOffset));
  await h.waitForResponse(TEST_WA_ID);

  // Time
  await h.sendText(TEST_WA_ID, time);
  await h.waitForResponse(TEST_WA_ID);

  // Duration
  await h.sendText(TEST_WA_ID, '3');
  await h.waitForResponse(TEST_WA_ID);

  // Emirate
  await h.sendListSelection(TEST_WA_ID, 'emirate_dubai', 'Dubai');
  await h.waitForResponse(TEST_WA_ID);

  // Skip location
  await h.sendText(TEST_WA_ID, 'SKIP');
  await h.waitForResponse(TEST_WA_ID);

  // Max seats
  await h.sendText(TEST_WA_ID, '8');
  await h.waitForResponse(TEST_WA_ID);

  // Threshold
  await h.sendText(TEST_WA_ID, '3');
  await h.waitForResponse(TEST_WA_ID);

  // Price
  await h.sendText(TEST_WA_ID, '200');
  let msgs = await h.waitForResponse(TEST_WA_ID);

  // Handle vessel image step if it appears
  const body = msgs.map(m => h.getMessageBody(m)).join(' ');
  if (body.toLowerCase().includes('vessel') || body.toLowerCase().includes('photo of your')) {
    await h.sendText(TEST_WA_ID, 'SKIP');
    msgs = await h.waitForResponse(TEST_WA_ID);
  }

  // Confirm
  await h.sendText(TEST_WA_ID, 'YES');
  msgs = await h.waitForResponse(TEST_WA_ID, { minMessages: 2, timeout: 15000 });

  const shortId = h.extractFromMessages(msgs, /\[([a-f0-9]{6})\]/i);
  if (!shortId) throw new Error('Stress test: could not extract trip short ID');
  return shortId;
}

export async function testStress(h: TestHarness): Promise<void> {
  const tripIds: string[] = [];

  // Create 5 trips with different dates/times to avoid overlaps
  for (let i = 0; i < 5; i++) {
    const dayOffset = 10 + i * 2; // Days 10, 12, 14, 16, 18 from now
    const hour = 5 + i; // 5am, 6am, 7am, 8am, 9am
    const shortId = await createQuickTrip(h, dayOffset, `${hour}am`);
    tripIds.push(shortId);
  }

  // Verify all 5 trips exist in DB
  const { data: captain } = await h.supabase
    .from('captains')
    .select('id')
    .eq('whatsapp_id', TEST_WA_ID)
    .single();

  const { data: allTrips } = await h.supabase
    .from('trips')
    .select('id, status')
    .eq('captain_id', captain!.id)
    .eq('status', 'open');

  for (const shortId of tripIds) {
    const found = allTrips?.find((t: any) => t.id.substring(0, 6) === shortId);
    if (!found) throw new Error(`Stress test trip ${shortId} not found in DB`);
  }

  if ((allTrips?.length || 0) < 5) {
    throw new Error(`Expected at least 5 open trips, found ${allTrips?.length}`);
  }
}
