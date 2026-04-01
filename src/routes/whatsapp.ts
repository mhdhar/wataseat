import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { verifyMetaSignature } from '../utils/crypto';
import { handleCommand } from '../handlers/commandHandler';
import { handleButton } from '../handlers/buttonHandler';
import { handleOnboarding } from '../handlers/onboardingHandler';
import { supabase } from '../db/supabase';
import { sendTextMessage } from '../services/whatsapp';
import { downloadWhatsAppMedia, uploadVesselImage } from '../services/mediaStorage';
import { Redis } from '@upstash/redis';
import { TripWizardState } from '../types';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

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
      const listReply = message.interactive?.list_reply;
      if (buttonReply) {
        await handleButton(from, buttonReply.id, buttonReply.title, message);
      } else if (listReply) {
        // List selection — route to onboarding handler as text (for wizard steps)
        await handleOnboarding(from, listReply.title, message);
      }
    } else if (message.type === 'image') {
      await handleImageMessage(from, message);
    }
  }
}

async function handleImageMessage(from: string, message: any): Promise<void> {
  const mediaId = message.image?.id;
  if (!mediaId) return;

  // Check 1: Trip wizard expecting vessel image
  const wizardRaw = await redis.get<string>(`trip_wizard:${from}`);
  if (wizardRaw) {
    const state: TripWizardState = typeof wizardRaw === 'string' ? JSON.parse(wizardRaw) : wizardRaw as any;
    if (state.step === 'vessel_image') {
      try {
        const { buffer, mimeType } = await downloadWhatsAppMedia(mediaId);
        const publicUrl = await uploadVesselImage(state.captain_id, buffer, mimeType);

        await supabase
          .from('captains')
          .update({ vessel_image_url: publicUrl })
          .eq('id', state.captain_id);

        // Advance wizard to confirm
        state.step = 'confirm';
        await redis.set(`trip_wizard:${from}`, JSON.stringify(state), { ex: 600 });

        await sendTextMessage(from, '📸 Vessel photo saved! It will be shown to guests on the booking page and in the trip share message.');

        // Show trip summary
        const departureAt = `${state.departure_date}T${state.departure_time}:00+04:00`;
        const date = new Date(departureAt);
        const formattedDate = date.toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' });
        const formattedTime = date.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });
        const locationLine = state.location_url
          ? `\n🗺 Location: ${state.location_url} (shared on confirmation)`
          : '\n🗺 Location: Will be shared later';

        await sendTextMessage(
          from,
          `📋 Trip Summary\n\n🚢 Type: ${state.trip_type}\n📅 Date: ${formattedDate}\n⏰ Time: ${formattedTime}\n⏱ Duration: ${state.duration_hours}h\n📍 Meeting: ${state.meeting_point}${locationLine}\n👥 Seats: ${state.max_seats} max, ${state.threshold} minimum\n💰 Price: AED ${state.price_per_person_aed}/person\n📸 Vessel photo: attached\n\nReply YES to confirm and post, or NO to cancel.`
        );
      } catch (err) {
        logger.error({ err, from }, 'Failed to process vessel image in wizard');
        await sendTextMessage(from, 'Failed to process the image. Please try again or type SKIP.');
      }
      return;
    }
  }

  // Check 2: /updatephoto command waiting for image
  const photoUpload = await redis.get<string>(`photo_upload:${from}`);
  if (photoUpload) {
    try {
      const { buffer, mimeType } = await downloadWhatsAppMedia(mediaId);
      const publicUrl = await uploadVesselImage(photoUpload, buffer, mimeType);

      await supabase
        .from('captains')
        .update({ vessel_image_url: publicUrl })
        .eq('id', photoUpload);

      await redis.del(`photo_upload:${from}`);
      await sendTextMessage(from, '✅ Vessel photo updated! It will appear on all your trip booking pages.');
    } catch (err) {
      logger.error({ err, from }, 'Failed to process vessel photo update');
      await sendTextMessage(from, 'Failed to process the image. Please try sending it again.');
    }
    return;
  }

  // No active context expecting an image — ignore silently
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
