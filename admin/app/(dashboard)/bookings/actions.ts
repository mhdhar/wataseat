'use server';

import { revalidatePath } from 'next/cache';

export async function refundBooking(
  bookingId: string
): Promise<{ success: true; action: string } | { error: string }> {
  try {
    const res = await fetch(
      `${process.env.EXPRESS_BOT_URL}/api/admin/refund-booking`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': process.env.ADMIN_API_SECRET!,
        },
        body: JSON.stringify({ bookingId }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return { error: data.error ?? 'Refund failed' };
    }

    revalidatePath('/bookings');
    return { success: true, action: data.action };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error — could not reach backend';
    return { error: message };
  }
}
