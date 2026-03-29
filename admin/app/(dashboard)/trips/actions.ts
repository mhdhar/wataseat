'use server';
import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase';
import { sendWhatsAppTemplate } from '@/lib/whatsapp';

export async function adminCancelTrip(tripId: string) {
  const supabase = createServerSupabase();

  const { data: trip } = await supabase
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();

  if (!trip) throw new Error('Trip not found');

  const { data: bookings } = await supabase
    .from('bookings')
    .select('*')
    .eq('trip_id', tripId)
    .in('status', ['authorized', 'confirmed']);

  // Cancel trip
  await supabase
    .from('trips')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: 'Cancelled by admin',
    })
    .eq('id', tripId);

  // Cancel all bookings and notify guests
  if (bookings?.length) {
    for (const booking of bookings) {
      await supabase
        .from('bookings')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: 'Trip cancelled by admin',
        })
        .eq('id', booking.id);

      try {
        await sendWhatsAppTemplate(booking.guest_whatsapp_id, 'trip_cancelled', [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: booking.guest_name || 'there' },
              { type: 'text', text: trip.trip_type },
              { type: 'text', text: new Date(trip.departure_at).toLocaleDateString() },
              { type: 'text', text: trip.threshold.toString() },
            ],
          },
        ]);
      } catch {
        // Notification failure should not block cancellation
      }
    }
  }

  revalidatePath('/trips');
  revalidatePath(`/trips/${tripId}`);
}
