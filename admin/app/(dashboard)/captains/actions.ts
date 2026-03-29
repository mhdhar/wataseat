'use server';
import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase';

export async function toggleSuspendCaptain(captainId: string, suspend: boolean) {
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('captains')
    .update({ is_suspended: suspend })
    .eq('id', captainId);

  if (error) {
    return { error: 'Failed to update captain status' };
  }

  revalidatePath(`/captains/${captainId}`);
  revalidatePath('/captains');
  return { success: true };
}

export async function updateCaptainBankDetails(
  captainId: string,
  bankName: string,
  iban: string
) {
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('captains')
    .update({ bank_name: bankName, iban })
    .eq('id', captainId);

  if (error) {
    return { error: 'Failed to update bank details' };
  }

  revalidatePath(`/captains/${captainId}`);
  return { success: true };
}
