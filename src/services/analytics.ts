import { createHash } from 'crypto';
import axios from 'axios';
import { logger } from '../utils/logger';

const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID;
const GA4_API_SECRET = process.env.GA4_API_SECRET;
const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

/** One-way hash to pseudonymize identifiers before sending to GA4. */
function hashId(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').substring(0, 16);
}

/** Returns true if the string looks like a phone number / WhatsApp ID. */
function isPhoneLike(id: string): boolean {
  return /^\+?\d{7,15}$/.test(id.replace(/\s/g, ''));
}

/**
 * Send a server-side event to GA4 via Measurement Protocol.
 * Fire-and-forget — never blocks the caller, never throws.
 * All user identifiers are hashed before transmission.
 */
export function trackEvent(
  eventName: string,
  params: Record<string, string | number | boolean>,
  userId?: string,
  clientId?: string,
): void {
  if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET) return;

  // Pseudonymize any identifier that looks like a phone number
  const safeUserId = userId ? (isPhoneLike(userId) ? hashId(userId) : userId) : undefined;
  const safeClientId = clientId ? (isPhoneLike(clientId) ? hashId(clientId) : clientId) : undefined;
  const cid = safeClientId || safeUserId || 'anonymous';

  axios.post(
    `${GA4_ENDPOINT}?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`,
    {
      client_id: cid,
      user_id: safeUserId || undefined,
      events: [{ name: eventName, params }],
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 5000 },
  ).catch((err) => {
    logger.warn({ err: err.message, event: eventName }, 'GA4 event failed');
  });
}

/**
 * Returns the gtag.js script block for embedding in HTML pages.
 */
export function gtagScript(): string {
  if (!GA4_MEASUREMENT_ID) return '';
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA4_MEASUREMENT_ID}');</script>`;
}
