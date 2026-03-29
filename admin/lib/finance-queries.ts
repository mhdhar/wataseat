import { createServerSupabase } from './supabase';

export type Granularity = 'daily' | 'weekly' | 'monthly';

export async function getRevenueData(granularity: Granularity, from: string, to: string) {
  const supabase = createServerSupabase();

  const { data: bookings } = await supabase
    .from('bookings')
    .select('created_at, total_amount_aed, platform_fee_aed, captain_payout_aed, status')
    .in('status', ['confirmed', 'authorized'])
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: true });

  if (!bookings?.length) return [];

  // Group by period
  const grouped = new Map<string, { revenue: number; commission: number; payouts: number }>();

  for (const b of bookings) {
    const date = new Date(b.created_at);
    let key: string;
    if (granularity === 'daily') {
      key = date.toISOString().slice(0, 10);
    } else if (granularity === 'weekly') {
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      key = weekStart.toISOString().slice(0, 10);
    } else {
      key = date.toISOString().slice(0, 7);
    }

    const existing = grouped.get(key) || { revenue: 0, commission: 0, payouts: 0 };
    existing.revenue += Number(b.total_amount_aed);
    existing.commission += Number(b.platform_fee_aed || 0);
    existing.payouts += Number(b.captain_payout_aed || 0);
    grouped.set(key, existing);
  }

  return Array.from(grouped.entries()).map(([period, data]) => ({ period, ...data }));
}

export async function getFinancialSummary(from: string, to: string) {
  const supabase = createServerSupabase();

  const { data: bookings } = await supabase
    .from('bookings')
    .select('total_amount_aed, platform_fee_aed, captain_payout_aed')
    .in('status', ['confirmed', 'authorized'])
    .gte('created_at', from)
    .lte('created_at', to);

  const totalRevenue = bookings?.reduce((s, b) => s + Number(b.total_amount_aed), 0) || 0;
  const totalCommission = bookings?.reduce((s, b) => s + Number(b.platform_fee_aed || 0), 0) || 0;
  const totalPayouts = bookings?.reduce((s, b) => s + Number(b.captain_payout_aed || 0), 0) || 0;

  return { totalRevenue, totalCommission, totalPayouts, bookingCount: bookings?.length || 0 };
}
