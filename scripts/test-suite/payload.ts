import crypto from 'crypto';

const META_APP_SECRET = process.env.META_APP_SECRET!;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || 'TEST_PHONE_ID';

export function sign(body: string, secret = META_APP_SECRET): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function wrap(from: string, message: any) {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_ID',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '971500000000', phone_number_id: PHONE_NUMBER_ID },
          messages: [message],
        },
        field: 'messages',
      }],
    }],
  };
  const body = JSON.stringify(payload);
  return { body, signature: sign(body) };
}

function msgId(): string {
  return `wamid.t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function textPayload(from: string, text: string) {
  return wrap(from, {
    from, id: msgId(),
    timestamp: Math.floor(Date.now() / 1000).toString(),
    type: 'text', text: { body: text },
  });
}

export function listPayload(from: string, rowId: string, rowTitle: string) {
  return wrap(from, {
    from, id: msgId(),
    timestamp: Math.floor(Date.now() / 1000).toString(),
    type: 'interactive',
    interactive: { type: 'list_reply', list_reply: { id: rowId, title: rowTitle } },
  });
}

export function buttonPayload(from: string, buttonId: string, buttonTitle: string) {
  return wrap(from, {
    from, id: msgId(),
    timestamp: Math.floor(Date.now() / 1000).toString(),
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: buttonId, title: buttonTitle } },
  });
}
