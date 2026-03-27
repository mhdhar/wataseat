import crypto from 'crypto';

export function verifyMetaSignature(
  payload: string | Buffer,
  signature: string,
  secret: string
): boolean {
  const expectedSignature =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
