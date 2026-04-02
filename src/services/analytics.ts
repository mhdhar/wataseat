import axios from 'axios';
import { logger } from '../utils/logger';

const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID;
const GA4_API_SECRET = process.env.GA4_API_SECRET;
const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

/**
 * Send a server-side event to GA4 via Measurement Protocol.
 * Fire-and-forget — never blocks the caller, never throws.
 */
export function trackEvent(
  eventName: string,
  params: Record<string, string | number | boolean>,
  userId?: string,
  clientId?: string,
): void {
  if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET) return;

  const cid = clientId || userId || 'anonymous';

  axios.post(
    `${GA4_ENDPOINT}?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`,
    {
      client_id: cid,
      user_id: userId || undefined,
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
