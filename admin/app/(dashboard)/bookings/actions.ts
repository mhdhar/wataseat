'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase';
import { sendWhatsAppTemplate } from '@/lib/whatsapp';

export async function refundBooking(bookingId: string) {
  const supabase = createServerSupabase();

  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('*, trips(title)')
    .eq('id', bookingId)
    .single();

  if (fetchError || !booking) {
    return { error: 'Booking not found' };
  }

  const { error: updateError } = await supabase
    .from('bookings')
    .update({
      status: 'refunded',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: 'Refunded by admin',
    })
    .eq('id', bookingId);

  if (updateError) {
    return { error: 'Failed to update booking' };
  }

  // Notify guest via WhatsApp
  if (booking.guest_whatsapp_id) {
    const trip = booking.trips as { title: string } | null;
    try {
      await sendWhatsAppTemplate(booking.guest_whatsapp_id, 'booking_refunded', [
        booking.guest_name || 'there',
        trip?.title ?? 'Trip',
      ]);
    } catch {
      // WhatsApp notification failure should not fail the refund action
    }
  }

  revalidatePath('/bookings');
  return { success: true };
}
