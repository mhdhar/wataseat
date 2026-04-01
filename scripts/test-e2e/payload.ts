import crypto from 'crypto';

const META_APP_SECRET = process.env.META_APP_SECRET!;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || 'TEST_PHONE_ID';

function sign(body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', META_APP_SECRET).update(body).digest('hex');
}

function wrapPayload(from: string, message: any): { body: string; signature: string } {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'TEST_WABA_ID',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '971500000000',
            phone_number_id: PHONE_NUMBER_ID,
          },
          messages: [message],
        },
        field: 'messages',
      }],
    }],
  };
  const body = JSON.stringify(payload);
  return { body, signature: sign(body) };
}

export function buildTextPayload(from: string, text: string) {
  return wrapPayload(from, {
    from,
    id: `wamid.test_in_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    type: 'text',
    text: { body: text },
  });
}

export function buildButtonPayload(from: string, buttonId: string, buttonTitle: string) {
  return wrapPayload(from, {
    from,
    id: `wamid.test_in_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    type: 'interactive',
    interactive: {
      type: 'button_reply',
      button_reply: { id: buttonId, title: buttonTitle },
    },
  });
}

export function buildListPayload(from: string, rowId: string, rowTitle: string) {
  return wrapPayload(from, {
    from,
    id: `wamid.test_in_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    type: 'interactive',
    interactive: {
      type: 'list_reply',
      list_reply: { id: rowId, title: rowTitle },
    },
  });
}
