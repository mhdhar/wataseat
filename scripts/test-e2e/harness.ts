import { Redis } from '@upstash/redis';
import { createClient } from '@supabase/supabase-js';
import { buildTextPayload, buildButtonPayload, buildListPayload } from './payload';

export const TEST_WA_ID = '999000000001';
const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

export interface CapturedMessage {
  messaging_product: string;
  to: string;
  type: string;
  text?: { body: string };
  interactive?: any;
  template?: any;
  image?: any;
  _testMessageId: string;
  _timestamp: number;
}

export class TestHarness {
  redis: Redis;
  supabase: ReturnType<typeof createClient>;
  private messageOffset: number = 0;

  constructor() {
    this.redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }

  async sendText(from: string, text: string): Promise<void> {
    const { body, signature } = buildTextPayload(from, text);
    const res = await fetch(`${BASE_URL}/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`Webhook returned ${res.status}: ${await res.text()}`);
    }
  }

  async sendListSelection(from: string, rowId: string, rowTitle: string): Promise<void> {
    const { body, signature } = buildListPayload(from, rowId, rowTitle);
    const res = await fetch(`${BASE_URL}/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`Webhook returned ${res.status}: ${await res.text()}`);
    }
  }

  async sendButtonTap(from: string, buttonId: string, buttonTitle: string): Promise<void> {
    const { body, signature } = buildButtonPayload(from, buttonId, buttonTitle);
    const res = await fetch(`${BASE_URL}/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`Webhook returned ${res.status}: ${await res.text()}`);
    }
  }

  async waitForResponse(
    to: string,
    opts: { timeout?: number; minMessages?: number } = {}
  ): Promise<CapturedMessage[]> {
    const timeout = opts.timeout || 10000;
    const minMessages = opts.minMessages || 1;
    const start = Date.now();
    const key = `test:outbound:${to}`;

    while (Date.now() - start < timeout) {
      const len = await this.redis.llen(key);
      if (len >= this.messageOffset + minMessages) {
        // Get new messages since last read
        const raw = await this.redis.lrange(key, this.messageOffset, len - 1);
        this.messageOffset = len;
        return raw.map((m: any) => (typeof m === 'string' ? JSON.parse(m) : m) as CapturedMessage);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // Return whatever we have
    const len = await this.redis.llen(key);
    if (len > this.messageOffset) {
      const raw = await this.redis.lrange(key, this.messageOffset, len - 1);
      this.messageOffset = len;
      return raw.map((m: any) => (typeof m === 'string' ? JSON.parse(m) : m) as CapturedMessage);
    }

    return [];
  }

  resetMessageOffset(): void {
    this.messageOffset = 0;
  }

  getMessageBody(msg: CapturedMessage): string {
    if (msg.type === 'text' && msg.text) return msg.text.body;
    if (msg.type === 'interactive' && msg.interactive) {
      return msg.interactive.body?.text || JSON.stringify(msg.interactive);
    }
    if (msg.type === 'template' && msg.template) return `[template:${msg.template.name}]`;
    if (msg.type === 'image' && msg.image) return msg.image.caption || '[image]';
    return JSON.stringify(msg);
  }

  assertContains(messages: CapturedMessage[], substring: string): void {
    const bodies = messages.map(m => this.getMessageBody(m));
    const found = bodies.some(b => b.toLowerCase().includes(substring.toLowerCase()));
    if (!found) {
      throw new Error(
        `Expected response containing "${substring}" but got:\n${bodies.map((b, i) => `  [${i}] ${b.substring(0, 200)}`).join('\n')}`
      );
    }
  }

  assertNotContains(messages: CapturedMessage[], substring: string): void {
    const bodies = messages.map(m => this.getMessageBody(m));
    const found = bodies.some(b => b.toLowerCase().includes(substring.toLowerCase()));
    if (found) {
      throw new Error(`Expected response NOT containing "${substring}" but it was found`);
    }
  }

  extractFromMessages(messages: CapturedMessage[], regex: RegExp): string | null {
    for (const msg of messages) {
      const body = this.getMessageBody(msg);
      const match = body.match(regex);
      if (match) return match[1];
    }
    return null;
  }

  async cleanup(): Promise<void> {
    // Delete test captain and cascade
    const { data: captain } = await this.supabase
      .from('captains')
      .select('id')
      .eq('whatsapp_id', TEST_WA_ID)
      .single();

    if (captain) {
      // Delete in order due to foreign keys
      await this.supabase.from('bookings').delete().eq('guest_whatsapp_id', TEST_WA_ID);

      const { data: trips } = await this.supabase
        .from('trips')
        .select('id')
        .eq('captain_id', captain.id);

      if (trips) {
        for (const trip of trips) {
          await this.supabase.from('bookings').delete().eq('trip_id', trip.id);
          await this.supabase.from('stripe_intents').delete().eq('trip_id', trip.id);
        }
      }

      await this.supabase.from('trips').delete().eq('captain_id', captain.id);
      await this.supabase.from('whatsapp_groups').delete().eq('captain_id', captain.id);
      await this.supabase.from('notification_log').delete().eq('recipient_wa_id', TEST_WA_ID);
      await this.supabase.from('captains').delete().eq('id', captain.id);
    }

    // Also clean up notification_log for test WA ID
    await this.supabase.from('notification_log').delete().eq('recipient_wa_id', TEST_WA_ID);

    // Clean Redis wizard states and test outbound
    await this.redis.del(`trip_wizard:${TEST_WA_ID}`);
    await this.redis.del(`repeat_wizard:${TEST_WA_ID}`);
    await this.redis.del(`edit_wizard:${TEST_WA_ID}`);
    await this.redis.del(`cancel_confirm:${TEST_WA_ID}`);
    await this.redis.del(`photo_upload:${TEST_WA_ID}`);
    await this.redis.del(`test:outbound:${TEST_WA_ID}`);

    this.messageOffset = 0;
  }
}
