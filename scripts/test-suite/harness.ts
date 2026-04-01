import { Redis } from '@upstash/redis';
import { createClient } from '@supabase/supabase-js';
import { textPayload, listPayload, buttonPayload, sign } from './payload';

export const WA_ID = '971526208920';
export const GUEST_ID = '971526208921';
export const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3005}`;
export const IS_SILENT = process.env.WATASEAT_TEST_MODE === 'true';

const WAIT_MS = IS_SILENT ? 0 : 3000;
const POLL_INTERVAL = 200;  // was 500
const POLL_TIMEOUT = 5000;  // was 12000

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const offsets = new Map<string, number>();
function getOffset(to: string): number { return offsets.get(to) || 0; }
function setOffset(to: string, n: number) { offsets.set(to, n); }

// ─── Send ─────────────────────────────────────────────────

async function post(body: string, signature: string): Promise<Response> {
  return fetch(`${BASE_URL}/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
    body,
  });
}

export async function sendText(from: string, text: string): Promise<void> {
  const { body, signature } = textPayload(from, text);
  const res = await post(body, signature);
  if (!res.ok) throw new Error(`Webhook ${res.status}: ${await res.text()}`);
}

export async function sendList(from: string, rowId: string, rowTitle: string): Promise<void> {
  const { body, signature } = listPayload(from, rowId, rowTitle);
  const res = await post(body, signature);
  if (!res.ok) throw new Error(`Webhook ${res.status}: ${await res.text()}`);
}

export async function sendButton(from: string, buttonId: string, buttonTitle: string): Promise<void> {
  const { body, signature } = buttonPayload(from, buttonId, buttonTitle);
  const res = await post(body, signature);
  if (!res.ok) throw new Error(`Webhook ${res.status}: ${await res.text()}`);
}

export async function sendRaw(body: string, signature: string): Promise<Response> {
  return post(body, signature);
}

// ─── Response Waiting ─────────────────────────────────────

export interface CapturedMsg {
  to: string; type: string;
  text?: { body: string }; interactive?: any; template?: any; image?: any;
  _testMessageId?: string; _timestamp?: number;
}

function msgBody(m: CapturedMsg): string {
  if (m.type === 'text' && m.text) return m.text.body;
  if (m.type === 'interactive' && m.interactive) return m.interactive.body?.text || JSON.stringify(m.interactive);
  if (m.type === 'template' && m.template) return `[template:${m.template.name}]`;
  if (m.type === 'image' && m.image) return m.image.caption || '[image]';
  return JSON.stringify(m);
}

export async function waitFor(to: string, opts: { min?: number; timeout?: number } = {}): Promise<CapturedMsg[]> {
  if (IS_SILENT) {
    const min = opts.min || 1;
    const timeout = opts.timeout || POLL_TIMEOUT;
    const key = `test:outbound:${to}`;
    const start = Date.now();
    const offset = getOffset(to);

    while (Date.now() - start < timeout) {
      const len = await redis.llen(key);
      if (len >= offset + min) {
        const raw = await redis.lrange(key, offset, len - 1);
        setOffset(to, len);
        return raw.map((r: any) => (typeof r === 'string' ? JSON.parse(r) : r) as CapturedMsg);
      }
      await delay(POLL_INTERVAL);
    }
    const len = await redis.llen(key);
    if (len > offset) {
      const raw = await redis.lrange(key, offset, len - 1);
      setOffset(to, len);
      return raw.map((r: any) => (typeof r === 'string' ? JSON.parse(r) : r) as CapturedMsg);
    }
    return [];
  } else {
    await delay(WAIT_MS);
    return [];
  }
}

// ─── Assertions ───────────────────────────────────────────

// In live mode, assertions are intentionally skipped — we can't inspect WhatsApp message content.
// Live mode validates via DB state checks and the user visually confirms messages on their phone.
export function assertContains(msgs: CapturedMsg[], substr: string): void {
  if (!IS_SILENT) return;
  const bodies = msgs.map(msgBody);
  if (!bodies.some(b => b.toLowerCase().includes(substr.toLowerCase()))) {
    throw new Error(
      `Expected "${substr}" in response but got:\n${bodies.map((b, i) => `    [${i}] ${b.substring(0, 150)}`).join('\n')}`
    );
  }
}

export function extractMatch(msgs: CapturedMsg[], regex: RegExp): string | null {
  for (const m of msgs) {
    const match = msgBody(m).match(regex);
    if (match) return match[1];
  }
  return null;
}

// ─── DB Helpers ───────────────────────────────────────────

export async function getCaptain(waId: string) {
  const { data } = await supabase.from('captains').select('*').eq('whatsapp_id', waId).single();
  return data;
}

export async function getCaptainTrips(captainId: string, status?: string) {
  let q = supabase.from('trips').select('*').eq('captain_id', captainId).order('departure_at');
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return data || [];
}

export async function getNotificationCount(waId: string, direction = 'outbound') {
  const { count } = await supabase.from('notification_log')
    .select('*', { count: 'exact', head: true })
    .eq('recipient_wa_id', waId)
    .eq('direction', direction);
  return count || 0;
}

// ─── Cleanup ──────────────────────────────────────────────

export async function cleanup(waId: string) {
  const { data: captain } = await supabase.from('captains').select('id').eq('whatsapp_id', waId).single();
  if (captain) {
    const { data: trips } = await supabase.from('trips').select('id').eq('captain_id', captain.id);
    if (trips) {
      for (const t of trips) {
        await supabase.from('bookings').delete().eq('trip_id', t.id);
        await supabase.from('stripe_intents').delete().eq('trip_id', t.id);
        await supabase.from('payouts').delete().eq('trip_id', t.id);
      }
    }
    await supabase.from('trips').delete().eq('captain_id', captain.id);
    await supabase.from('whatsapp_groups').delete().eq('captain_id', captain.id);
    await supabase.from('captains').delete().eq('id', captain.id);
  }
  await supabase.from('notification_log').delete().eq('recipient_wa_id', waId);
  await supabase.from('bookings').delete().eq('guest_whatsapp_id', waId);

  for (const prefix of ['trip_wizard', 'repeat_wizard', 'edit_wizard', 'cancel_confirm', 'photo_upload']) {
    await redis.del(`${prefix}:${waId}`);
  }
  await redis.del(`test:outbound:${waId}`);
  offsets.delete(waId);
}

// ─── Trip Creation Shortcut ───────────────────────────────

export async function createTripViaWizard(
  from: string,
  opts: { dayOffset: number; time: string; type?: string; emirate?: string; seats?: number; threshold?: number; price?: number }
): Promise<string> {
  await redis.del(`trip_wizard:${from}`);
  await redis.del(`repeat_wizard:${from}`);

  await sendText(from, '/trip');
  await waitFor(from, { min: 1 });
  await delay(300);
  await flushResponses(from);

  const tripType = opts.type || 'fishing';
  const typeMap: Record<string, string> = { fishing: 'Fishing', diving: 'Diving', cruising: 'Cruising' };
  await sendList(from, `type_${tripType}`, typeMap[tripType] || 'Fishing');
  await waitFor(from);

  await sendText(from, futureDate(opts.dayOffset));
  await waitFor(from);

  await sendText(from, opts.time);
  await waitFor(from);

  await sendText(from, '4');
  await waitFor(from);

  const emirate = opts.emirate || 'Dubai';
  const emirateIdMap: Record<string, string> = {
    'Abu Dhabi': 'emirate_abudhabi', 'Dubai': 'emirate_dubai', 'Sharjah': 'emirate_sharjah',
    'Ajman': 'emirate_ajman', 'Fujairah': 'emirate_fujairah',
  };
  await sendList(from, emirateIdMap[emirate] || 'emirate_dubai', emirate);
  await waitFor(from);

  await sendText(from, 'SKIP');
  await waitFor(from);

  await sendText(from, String(opts.seats || 10));
  await waitFor(from);

  await sendText(from, String(opts.threshold || 4));
  await waitFor(from);

  await sendText(from, String(opts.price || 250));
  let msgs = await waitFor(from);

  // Handle vessel image step — in live mode waitFor returns [], so also check DB
  const captainForImage = await getCaptain(from);
  const hasVesselImage = captainForImage?.vessel_image_url;
  const body = msgs.map(msgBody).join(' ').toLowerCase();
  if (body.includes('vessel') || body.includes('photo') || (!hasVesselImage && !IS_SILENT) || (!hasVesselImage && msgs.length === 0)) {
    await sendText(from, 'SKIP');
    msgs = await waitFor(from);
  }

  await sendText(from, 'YES');
  msgs = await waitFor(from, { min: 1, timeout: 8000 });
  await delay(500);
  const more = await waitFor(from, { timeout: 2000 }).catch(() => [] as CapturedMsg[]);
  msgs = [...msgs, ...more];

  const shortId = extractMatch(msgs, /\[([a-f0-9]{6})\]/i);
  if (shortId) return shortId;

  // DB fallback
  const captain = await getCaptain(from);
  if (!captain) throw new Error('Captain not found after trip creation');
  const trips = await getCaptainTrips(captain.id, 'open');
  if (trips.length === 0) throw new Error('No open trips after wizard');
  const sorted = [...trips].sort((a: any, b: any) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return sorted[0].id.substring(0, 6);
}

// ─── Buffer Management ────────────────────────────────────

export async function flushResponses(to: string): Promise<void> {
  if (IS_SILENT) {
    const len = await redis.llen(`test:outbound:${to}`);
    setOffset(to, len);
  }
}

export async function resetOutbound(to: string): Promise<void> {
  await redis.del(`test:outbound:${to}`);
  offsets.delete(to);
}

// ─── Utilities ────────────────────────────────────────────

export function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
