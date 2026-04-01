import { setGroup, test } from '../runner';
import { BASE_URL, redis, supabase, sendRaw, cleanup, delay } from '../harness';
import { textPayload, sign } from '../payload';

// Use a separate phone number so infra tests don't create captains for the main test WA_ID
const INFRA_WA_ID = '999999999999';

export async function runInfrastructureTests() {
  setGroup('Infrastructure');

  await test('Server health check', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`Health returned ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error(`Health status: ${data.status}`);
    if (data.services?.database !== 'connected') throw new Error('Database not connected');
    if (data.services?.redis !== 'connected') throw new Error('Redis not connected');
  });

  await test('Webhook rejects missing signature', async () => {
    const { body } = textPayload(INFRA_WA_ID, 'test');
    const res = await fetch(`${BASE_URL}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  await test('Webhook rejects wrong signature', async () => {
    const { body } = textPayload(INFRA_WA_ID, 'test');
    const wrongSig = sign(body, 'WRONG_SECRET_KEY_12345');
    const res = await sendRaw(body, wrongSig);
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  await test('Webhook accepts valid signature', async () => {
    const { body, signature } = textPayload(INFRA_WA_ID, 'ping');
    const res = await sendRaw(body, signature);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    // Wait for async processing to complete, then clean up the captain it may have created
    await delay(2000);
    await cleanup(INFRA_WA_ID);
  });

  await test('Redis read/write/delete', async () => {
    const key = 'test:infra:ping';
    await redis.set(key, 'pong', { ex: 10 });
    const val = await redis.get(key);
    if (val !== 'pong') throw new Error(`Redis get returned ${val}`);
    await redis.del(key);
    const gone = await redis.get(key);
    if (gone !== null) throw new Error('Redis key not deleted');
  });

  await test('Supabase connectivity', async () => {
    const { error } = await supabase.from('captains').select('id').limit(1);
    if (error) throw new Error(`Supabase query failed: ${error.message}`);
  });

  await test('Webhook GET verification challenge', async () => {
    const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (!token) throw new Error('WHATSAPP_WEBHOOK_VERIFY_TOKEN not set');
    const res = await fetch(
      `${BASE_URL}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=test_challenge_123`
    );
    const text = await res.text();
    if (text !== 'test_challenge_123') throw new Error(`Expected challenge echo, got: ${text}`);
  });

  await test('Webhook GET rejects wrong verify token', async () => {
    const res = await fetch(
      `${BASE_URL}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=WRONG_TOKEN&hub.challenge=test`
    );
    if (res.status !== 403) throw new Error(`Expected 403, got ${res.status}`);
  });
}
