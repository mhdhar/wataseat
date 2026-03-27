import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { verifyMetaSignature } from '../utils/crypto';
import { handleCommand } from '../handlers/commandHandler';
import { handleButton } from '../handlers/buttonHandler';
import { handleOnboarding } from '../handlers/onboardingHandler';
import { supabase } from '../db/supabase';

const router = Router();

// GET — Meta verification challenge
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    logger.info('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    logger.warn('WhatsApp webhook verification failed');
    res.status(403).send('Forbidden');
  }
});

// POST — Incoming WhatsApp events
router.post('/', async (req: Request, res: Response) => {
  const signature = req.headers['x-hub-signature-256'] as string;
  const rawBody = (req as any).rawBody as Buffer;

  if (!signature || !rawBody) {
    res.status(401).send('Unauthorized');
    return;
  }

  if (!verifyMetaSignature(rawBody, signature, process.env.META_APP_SECRET!)) {
    logger.warn('Invalid Meta webhook signature');
    res.status(401).send('Unauthorized');
    return;
  }

  // Respond immediately — Meta requires response within 5 seconds
  res.status(200).json({ status: 'ok' });

  // Process async
  try {
    await processWebhook(req.body);
  } catch (err) {
    logger.error({ err }, 'Error processing WhatsApp webhook');
  }
});

async function processWebhook(body: any): Promise<void> {
  const entry = body?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  if (!value) return;

  const messages = value.messages;
  if (!messages || messages.length === 0) return; // Delivery receipt, ignore

  for (const message of messages) {
    const from = message.from; // Sender's WhatsApp ID
    const messageId = message.id;
    const timestamp = message.timestamp;

    // Log inbound message
    await logNotification({
      recipient_wa_id: from,
      message_type: message.type,
      direction: 'inbound',
      meta_message_id: messageId,
      status: 'received',
    });

    if (message.type === 'text') {
      // Sanitize: strip HTML tags and control characters
      const rawText = message.text?.body?.trim() || '';
      const text = rawText.replace(/<[^>]*>/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

      if (text.startsWith('/')) {
        // Command message
        await handleCommand(from, text, message);
      } else {
        // Non-command text — could be onboarding or wizard reply
        await handleOnboarding(from, text, message);
      }
    } else if (message.type === 'interactive') {
      const buttonReply = message.interactive?.button_reply;
      if (buttonReply) {
        await handleButton(from, buttonReply.id, buttonReply.title, message);
      }
    }
  }
}

async function logNotification(data: {
  recipient_wa_id: string;
  message_type: string;
  direction: string;
  meta_message_id?: string;
  status: string;
  trip_id?: string;
  booking_id?: string;
  captain_id?: string;
  template_name?: string;
  error_message?: string;
}): Promise<void> {
  try {
    await supabase.from('notification_log').insert(data);
  } catch (err) {
    logger.error({ err }, 'Failed to log notification');
  }
}

export default router;
