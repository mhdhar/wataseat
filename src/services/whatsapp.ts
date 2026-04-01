import axios from 'axios';
import { logger } from '../utils/logger';
import { supabase } from '../db/supabase';

const GRAPH_API_URL = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
const AUTH_HEADER = { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` };

// Rate limiting: track last send time to avoid hitting Meta API limits
let lastSendTime = 0;
const MIN_SEND_INTERVAL_MS = 100; // 100ms between messages (~10/sec, well under Meta's 80/sec limit)

async function sendMessage(payload: any): Promise<string | undefined> {
  // Enforce minimum interval between sends
  const now = Date.now();
  const elapsed = now - lastSendTime;
  if (elapsed < MIN_SEND_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_SEND_INTERVAL_MS - elapsed));
  }
  lastSendTime = Date.now();

  try {
    const response = await axios.post(GRAPH_API_URL, payload, {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
    });
    const messageId = response.data?.messages?.[0]?.id;
    logger.info({ to: payload.to, messageId }, 'WhatsApp message sent');
    return messageId;
  } catch (err: any) {
    logger.error(
      { err: err.response?.data || err.message, to: payload.to },
      'Failed to send WhatsApp message'
    );
    throw err;
  }
}

export async function sendTextMessage(to: string, text: string): Promise<string | undefined> {
  const messageId = await sendMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  });

  await logOutbound(to, 'text', messageId);
  return messageId;
}

export async function sendInteractiveMessage(
  to: string,
  options: {
    header?: string;
    body: string;
    footer?: string;
    buttons: Array<{ id: string; title: string }>;
  }
): Promise<string | undefined> {
  const interactive: any = {
    type: 'button',
    body: { text: options.body },
    action: {
      buttons: options.buttons.map((btn) => ({
        type: 'reply',
        reply: { id: btn.id, title: btn.title },
      })),
    },
  };

  if (options.header) {
    interactive.header = { type: 'text', text: options.header };
  }
  if (options.footer) {
    interactive.footer = { text: options.footer };
  }

  const messageId = await sendMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive,
  });

  await logOutbound(to, 'interactive', messageId);
  return messageId;
}

export async function sendListMessage(
  to: string,
  options: {
    header?: string;
    body: string;
    footer?: string;
    buttonText: string;
    sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
  }
): Promise<string | undefined> {
  const interactive: any = {
    type: 'list',
    body: { text: options.body },
    action: {
      button: options.buttonText,
      sections: options.sections,
    },
  };

  if (options.header) {
    interactive.header = { type: 'text', text: options.header };
  }
  if (options.footer) {
    interactive.footer = { text: options.footer };
  }

  const messageId = await sendMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive,
  });

  await logOutbound(to, 'interactive', messageId);
  return messageId;
}

export async function sendTemplateMessage(
  to: string,
  templateName: string,
  components: any[]
): Promise<string | undefined> {
  const messageId = await sendMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components,
    },
  });

  await logOutbound(to, 'template', messageId, templateName);
  return messageId;
}

export async function sendImageMessage(
  to: string,
  imageUrl: string,
  caption?: string
): Promise<string | undefined> {
  const image: any = { link: imageUrl };
  if (caption) image.caption = caption;

  const messageId = await sendMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image,
  });

  await logOutbound(to, 'image', messageId);
  return messageId;
}

async function logOutbound(
  recipientWaId: string,
  messageType: string,
  metaMessageId?: string,
  templateName?: string
): Promise<void> {
  try {
    await supabase.from('notification_log').insert({
      recipient_wa_id: recipientWaId,
      message_type: messageType,
      direction: 'outbound',
      meta_message_id: metaMessageId,
      template_name: templateName,
      status: metaMessageId ? 'sent' : 'failed',
    });
  } catch (err) {
    logger.error({ err }, 'Failed to log outbound notification');
  }
}
