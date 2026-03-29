'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase';
import { sendWhatsAppTemplate } from '@/lib/whatsapp';

export async function markPayoutProcessed(payoutId: string, bankReference: string) {
  const supabase = createServerSupabase();

  // 1. Fetch payout with captain and trip data
  const { data: payout, error: fetchError } = await supabase
    .from('payouts')
    .select('*, captains(display_name, whatsapp_id), trips(title)')
    .eq('id', payoutId)
    .single();

  if (fetchError || !payout) {
    return { error: 'Payout not found' };
  }

  // 2. Update payout status
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

  // 3. Send WhatsApp notification to captain
  const captain = payout.captains as { display_name: string; whatsapp_id: string } | null;
  const trip = payout.trips as { title: string } | null;

  if (captain?.whatsapp_id) {
    try {
      await sendWhatsAppTemplate(captain.whatsapp_id, 'payout_processed', [
        captain.display_name,
        trip?.title ?? 'Trip',
        Number(payout.payout_amount).toFixed(2),
        bankReference,
      ]);
    } catch {
      // 4. If WhatsApp fails, mark as not notified but don't fail the action
      await supabase
        .from('payouts')
        .update({ whatsapp_notified: false })
        .eq('id', payoutId);
    }
  }

  // 5. Revalidate
  revalidatePath('/payouts');
  return { success: true };
}
