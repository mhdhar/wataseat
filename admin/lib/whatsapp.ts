export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  templateParams: any[] = []
): Promise<void> {
  const res = await fetch(`${process.env.EXPRESS_BOT_URL}/api/admin/send-whatsapp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Secret': process.env.ADMIN_API_SECRET!,
    },
    body: JSON.stringify({ to, templateName, templateParams }),
  });
  if (!res.ok) {
    throw new Error(`WhatsApp send failed: ${res.status}`);
  }
}

export async function cancelTripViaBot(
  tripId: string,
  reason: string = 'Cancelled by admin'
): Promise<void> {
  const res = await fetch(`${process.env.EXPRESS_BOT_URL}/api/admin/cancel-trip`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Secret': process.env.ADMIN_API_SECRET!,
    },
    body: JSON.stringify({ tripId, reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Cancel trip failed: ${res.status}`);
  }
}
