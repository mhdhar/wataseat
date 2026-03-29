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
