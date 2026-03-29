import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get('from') || '2020-01-01';
  const to = request.nextUrl.searchParams.get('to') || new Date().toISOString();

  const supabase = createServerSupabase();
  const { data: payouts } = await supabase
    .from('payouts')
    .select('*, captains(display_name), trips(title)')
    .eq('status', 'completed')
    .gte('processed_at', from)
    .lte('processed_at', to)
    .order('processed_at', { ascending: false });

  const header = 'Date Processed,Captain,Trip,Gross Amount (AED),Commission (AED),Payout Amount (AED),Bank Reference,WhatsApp Notified\n';
  const rows = (payouts || []).map((p: any) => {
    const captain = p.captains as { display_name: string } | null;
    const trip = p.trips as { title: string } | null;
    return `${p.processed_at || ''},${(captain?.display_name || 'N/A').replace(/,/g, ' ')},${(trip?.title || 'N/A').replace(/,/g, ' ')},${p.gross_amount},${p.commission_amount},${p.payout_amount},${(p.bank_reference || '').replace(/,/g, ' ')},${p.whatsapp_notified ? 'Yes' : 'No'}`;
  }).join('\n');

  return new NextResponse(header + rows, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename=wataseat-payouts-${from.slice(0, 10)}-${to.slice(0, 10)}.csv`,
    },
  });
}
