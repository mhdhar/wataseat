'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase';
import { sendWhatsAppTemplate } from '@/lib/whatsapp';

export async function markPayoutProcessed(payoutId: string, bankReference: string) {
  const supabase = createServerSupabase();

  const { data: payout, error: fetchError } = await supabase
    .from('payouts')
    .select('*, captains(display_name, whatsapp_id), trips(title)')
    .eq('id', payoutId)
    .single();

  if (fetchError || !payout) {
    return { error: 'Payout not found' };
  }

  const { error: updateError } = await supabase
    .from('payouts')
    .update({
      status: 'completed',
      bank_reference: bankReference,
      processed_at: new Date().toISOString(),
      whatsapp_notified: true,
    })
    .eq('id', payoutId);

  if (updateError) {
    return { error: 'Failed to update payout' };
  }

  const captain = payout.captains as { display_name: string; whatsapp_id: string } | null;
  const trip = payout.trips as { title: string } | null;

  if (captain?.whatsapp_id) {
    try {
      await sendWhatsAppTemplate(captain.whatsapp_id, 'payout_processed', [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: captain.display_name || 'Captain' },
            { type: 'text', text: Number(payout.payout_amount).toFixed(2) },
            { type: 'text', text: trip?.title ?? 'Trip' },
            { type: 'text', text: bankReference },
          ],
        },
      ]);
    } catch {
      await supabase
        .from('payouts')
        .update({ whatsapp_notified: false })
        .eq('id', payoutId);
    }
  }

  revalidatePath('/payouts');
  return { success: true };
}
