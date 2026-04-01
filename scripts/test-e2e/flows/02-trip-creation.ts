import { TestHarness, TEST_WA_ID } from '../harness';

// Compute a future date (3 days from now) in DD/MM format
function getFutureDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function testTripCreation(h: TestHarness): Promise<string> {
  // /trip command — may show repeat hint first, then list message
  await h.sendText(TEST_WA_ID, '/trip');
  let msgs = await h.waitForResponse(TEST_WA_ID, { minMessages: 1, timeout: 10000 });

  // The first response should contain trip type selection (list message)
  // If captain has previous trips, there may be a repeat hint message first
  const allBodies = msgs.map(m => h.getMessageBody(m)).join(' ');
  if (!allBodies.toLowerCase().includes('type of trip') && !allBodies.toLowerCase().includes('trip type')) {
    // Wait for the list message
    const more = await h.waitForResponse(TEST_WA_ID, { timeout: 5000 });
    msgs = [...msgs, ...more];
  }

  // Select Fishing via list selection (title is passed as text to handler)
  await h.sendListSelection(TEST_WA_ID, 'type_fishing', 'Fishing');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'date');

  // Date
  await h.sendText(TEST_WA_ID, getFutureDate());
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'time');

  // Time
  await h.sendText(TEST_WA_ID, '6am');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'duration');

  // Duration
  await h.sendText(TEST_WA_ID, '4');
  msgs = await h.waitForResponse(TEST_WA_ID);
  // Should show emirate selection list
  h.assertContains(msgs, 'emirate');

  // Select Dubai via list
  await h.sendListSelection(TEST_WA_ID, 'emirate_dubai', 'Dubai');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'Google Maps');

  // Skip location URL
  await h.sendText(TEST_WA_ID, 'SKIP');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'seats');

  // Max seats
  await h.sendText(TEST_WA_ID, '10');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'minimum');

  // Threshold
  await h.sendText(TEST_WA_ID, '4');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'price');

  // Price
  await h.sendText(TEST_WA_ID, '250');
  msgs = await h.waitForResponse(TEST_WA_ID);

  // Captain has no vessel_image_url yet, so it should ask for vessel image
  const priceResponse = msgs.map(m => h.getMessageBody(m)).join(' ');
  if (priceResponse.toLowerCase().includes('vessel') || priceResponse.toLowerCase().includes('photo')) {
    // Skip vessel image
    await h.sendText(TEST_WA_ID, 'SKIP');
    msgs = await h.waitForResponse(TEST_WA_ID);
  }

  // Should now show trip summary
  h.assertContains(msgs, 'Trip Summary');
  h.assertContains(msgs, 'YES');

  // Confirm
  await h.sendText(TEST_WA_ID, 'YES');
  msgs = await h.waitForResponse(TEST_WA_ID, { minMessages: 2, timeout: 15000 });
  h.assertContains(msgs, 'Trip created');

  // Extract short ID
  const shortId = h.extractFromMessages(msgs, /\[([a-f0-9]{6})\]/i);
  if (!shortId) throw new Error('Could not extract trip short ID from response');

  // Verify in DB
  const { data: captain } = await h.supabase
    .from('captains')
    .select('id')
    .eq('whatsapp_id', TEST_WA_ID)
    .single();

  const { data: trips } = await h.supabase
    .from('trips')
    .select('*')
    .eq('captain_id', captain!.id)
    .eq('status', 'open');

  if (!trips || trips.length === 0) throw new Error('No trip created in DB');

  const trip = trips.find((t: any) => t.id.substring(0, 6) === shortId);
  if (!trip) throw new Error(`Trip with short ID ${shortId} not found in DB`);
  if (trip.trip_type !== 'fishing') throw new Error(`Trip type is ${trip.trip_type}, expected fishing`);
  if (trip.max_seats !== 10) throw new Error(`Max seats is ${trip.max_seats}, expected 10`);
  if (trip.threshold !== 4) throw new Error(`Threshold is ${trip.threshold}, expected 4`);

  return shortId;
}
