import { TestHarness, TEST_WA_ID } from '../harness';

export async function testCancelTrip(h: TestHarness, shortId: string): Promise<void> {
  // /cancel command
  await h.sendText(TEST_WA_ID, `/cancel ${shortId}`);
  let msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'Are you sure');
  h.assertContains(msgs, 'YES');

  // Confirm cancellation
  await h.sendText(TEST_WA_ID, 'YES');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'cancelled');

  // Verify in DB
  const { data: captain } = await h.supabase
    .from('captains')
    .select('id')
    .eq('whatsapp_id', TEST_WA_ID)
    .single();

  const { data: trips } = await h.supabase
    .from('trips')
    .select('id, status')
    .eq('captain_id', captain!.id);

  const trip = trips?.find((t: any) => t.id.substring(0, 6) === shortId);
  if (!trip) throw new Error(`Trip ${shortId} not found in DB`);
  if (trip.status !== 'cancelled') throw new Error(`Trip status is ${trip.status}, expected cancelled`);
}
