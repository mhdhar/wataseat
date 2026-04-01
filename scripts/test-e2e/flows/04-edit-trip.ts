import { TestHarness, TEST_WA_ID } from '../harness';

export async function testEditTrip(h: TestHarness, shortId: string): Promise<void> {
  // Start edit wizard
  await h.sendText(TEST_WA_ID, `/edit ${shortId}`);
  let msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'What would you like to change');
  h.assertContains(msgs, 'Meeting Point');

  // Select field 4 (Meeting Point)
  await h.sendText(TEST_WA_ID, '4');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'meeting point');

  // Enter new value
  await h.sendText(TEST_WA_ID, 'Dubai Marina Dock B');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'Dubai Marina Dock B');
  h.assertContains(msgs, 'YES');

  // Confirm
  await h.sendText(TEST_WA_ID, 'YES');
  msgs = await h.waitForResponse(TEST_WA_ID);
  h.assertContains(msgs, 'updated');

  // Verify in DB
  const { data: captain } = await h.supabase
    .from('captains')
    .select('id')
    .eq('whatsapp_id', TEST_WA_ID)
    .single();

  const { data: trips } = await h.supabase
    .from('trips')
    .select('meeting_point')
    .eq('captain_id', captain!.id)
    .eq('status', 'open');

  const trip = trips?.find((t: any) => t.meeting_point === 'Dubai Marina Dock B');
  if (!trip) throw new Error('Meeting point was not updated in DB');
}
