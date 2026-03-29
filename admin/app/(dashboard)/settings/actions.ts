'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase';

export async function updateSettings(formData: FormData) {
  const supabase = createServerSupabase();

  const entries = [
    { key: 'commission_percentage', value: formData.get('commission_percentage') as string },
    { key: 'admin_whatsapp_number', value: formData.get('admin_whatsapp_number') as string },
    { key: 'payout_reminder_hours', value: formData.get('payout_reminder_hours') as string },
  ];

  for (const { key, value } of entries) {
    await supabase
      .from('admin_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() });
  }

  revalidatePath('/settings');
}
