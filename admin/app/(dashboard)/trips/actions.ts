'use server';
import { revalidatePath } from 'next/cache';
import { cancelTripViaBot } from '@/lib/whatsapp';

export async function adminDeleteTrip(tripId: string) {
  await cancelTripViaBot(tripId, 'Cancelled by admin');

  revalidatePath('/trips');
  revalidatePath(`/trips/${tripId}`);
}

export async function createAdminBooking(tripId: string): Promise<{ paymentUrl?: string; error?: string }> {
  const res = await fetch(`${process.env.EXPRESS_BOT_URL}/api/admin/create-booking`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Secret': process.env.ADMIN_API_SECRET!,
    },
    body: JSON.stringify({ tripId, guestName: 'Admin Test', numSeats: 1 }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: (body as { error?: string }).error || 'Failed to create booking' };
  }

  const data = await res.json() as { paymentUrl: string };
  revalidatePath('/trips');
  revalidatePath(`/trips/${tripId}`);
  return { paymentUrl: data.paymentUrl };
}
