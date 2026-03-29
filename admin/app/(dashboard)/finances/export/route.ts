import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get('from') || '2020-01-01';
  const to = request.nextUrl.searchParams.get('to') || new Date().toISOString();

  const supabase = createServerSupabase();
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, created_at, guest_name, trip_id, total_amount_aed, platform_fee_aed, captain_payout_aed, status, trips(title)')
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false });

  const header = 'Date,Guest,Trip,Amount (AED),Commission (AED),Captain Payout (AED),Status\n';
  const rows = (bookings || []).map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b: any) =>
    `${b.created_at},${(b.guest_name || 'N/A').replace(/,/g, ' ')},${(b.trips?.title || 'N/A').replace(/,/g, ' ')},${b.total_amount_aed},${b.platform_fee_aed || 0},${b.captain_payout_aed || 0},${b.status}`
  ).join('\n');

  return new NextResponse(header + rows, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename=wataseat-finances-${from.slice(0, 10)}-${to.slice(0, 10)}.csv`,
    },
  });
}
