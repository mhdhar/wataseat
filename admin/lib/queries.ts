import { createServerSupabase } from '@/lib/supabase';

export interface DashboardKPIs {
  totalRevenue: number;
  revenueChange: number;
  platformCommission: number;
  activeTrips: number;
  pendingPayouts: number;
  pendingPayoutAmount: number;
}

export async function getDashboardKPIs(): Promise<DashboardKPIs> {
  const supabase = createServerSupabase();

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Current period bookings (last 30 days)
  const { data: currentBookings } = await supabase
    .from('bookings')
    .select('total_amount_aed, platform_fee_aed')
    .in('status', ['confirmed', 'authorized'])
    .gte('created_at', thirtyDaysAgo.toISOString());

  const totalRevenue = (currentBookings ?? []).reduce(
    (sum, b) => sum + Number(b.total_amount_aed ?? 0),
    0
  );
  const platformCommission = (currentBookings ?? []).reduce(
    (sum, b) => sum + Number(b.platform_fee_aed ?? 0),
    0
  );

  // Previous period bookings (30-60 days ago)
  const { data: prevBookings } = await supabase
    .from('bookings')
    .select('total_amount_aed')
    .in('status', ['confirmed', 'authorized'])
    .gte('created_at', sixtyDaysAgo.toISOString())
    .lt('created_at', thirtyDaysAgo.toISOString());

  const prevRevenue = (prevBookings ?? []).reduce(
    (sum, b) => sum + Number(b.total_amount_aed ?? 0),
    0
  );
  const revenueChange =
    prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0;

  // Active trips
  const { count: activeTrips } = await supabase
    .from('trips')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open');

  // Pending payouts
  const { data: pendingPayoutsData } = await supabase
    .from('payouts')
    .select('payout_amount')
    .eq('status', 'pending');

  const pendingPayouts = pendingPayoutsData?.length ?? 0;
  const pendingPayoutAmount = (pendingPayoutsData ?? []).reduce(
    (sum, p) => sum + Number(p.payout_amount ?? 0),
    0
  );

  return {
    totalRevenue,
    revenueChange,
    platformCommission,
    activeTrips: activeTrips ?? 0,
    pendingPayouts,
    pendingPayoutAmount,
  };
}

export interface ActivityItem {
  type: 'booking' | 'trip' | 'captain';
  id: string;
  created_at: string;
  description: string;
}

export async function getRecentActivity(
  limit = 20
): Promise<ActivityItem[]> {
  const supabase = createServerSupabase();

  // Fetch recent bookings, trips, captains in parallel
  const [bookingsRes, tripsRes, captainsRes] = await Promise.all([
    supabase
      .from('bookings')
      .select('id, created_at, guest_name, status, num_seats, total_amount_aed')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('trips')
      .select('id, created_at, title, status')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('captains')
      .select('id, created_at, display_name, onboarding_step')
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  const items: ActivityItem[] = [];

  for (const b of bookingsRes.data ?? []) {
    items.push({
      type: 'booking',
      id: b.id,
      created_at: b.created_at,
      description: `${b.guest_name ?? 'Guest'} booked ${b.num_seats} seat(s) for ${Number(b.total_amount_aed).toFixed(2)} AED — ${b.status}`,
    });
  }

  for (const t of tripsRes.data ?? []) {
    items.push({
      type: 'trip',
      id: t.id,
      created_at: t.created_at,
      description: `Trip "${t.title}" created — ${t.status}`,
    });
  }

  for (const c of captainsRes.data ?? []) {
    items.push({
      type: 'captain',
      id: c.id,
      created_at: c.created_at,
      description: `Captain ${c.display_name} joined — ${c.onboarding_step === 'complete' ? 'onboarded' : `step: ${c.onboarding_step}`}`,
    });
  }

  items.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return items.slice(0, limit);
}

export interface Alerts {
  atRiskTrips: Array<{
    id: string;
    title: string;
    departure_at: string;
    current_bookings: number;
    threshold: number;
  }>;
  stalePayouts: Array<{
    id: string;
    payout_amount: number;
    created_at: string;
  }>;
  stuckCaptains: Array<{
    id: string;
    display_name: string;
    onboarding_step: string;
  }>;
}

export async function getPendingPayouts() {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('payouts')
    .select('*, captains(display_name, iban, bank_name, whatsapp_id), trips(title, trip_type, departure_at)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  return data || [];
}

export async function getPayoutHistory() {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('payouts')
    .select('*, captains(display_name), trips(title)')
    .eq('status', 'completed')
    .order('processed_at', { ascending: false });
  return data || [];
}

export async function getCaptains(search?: string) {
  const supabase = createServerSupabase();
  let query = supabase
    .from('captains')
    .select('*')
    .order('created_at', { ascending: false });

  if (search) {
    query = query.or(`display_name.ilike.%${search}%,whatsapp_id.ilike.%${search}%`);
  }

  const { data } = await query;
  return data || [];
}

export async function getCaptainDetail(id: string) {
  const supabase = createServerSupabase();
  const { data: captain } = await supabase
    .from('captains')
    .select('*')
    .eq('id', id)
    .single();

  const { data: trips } = await supabase
    .from('trips')
    .select('*')
    .eq('captain_id', id)
    .order('departure_at', { ascending: false });

  const { data: payouts } = await supabase
    .from('payouts')
    .select('*, trips(title)')
    .eq('captain_id', id)
    .order('created_at', { ascending: false });

  return { captain, trips: trips || [], payouts: payouts || [] };
}

export async function getAlerts(): Promise<Alerts> {
  const supabase = createServerSupabase();

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const fortyEightHoursAgo = new Date(
    now.getTime() - 48 * 60 * 60 * 1000
  );

  const [atRiskRes, stalePayoutsRes, stuckCaptainsRes] = await Promise.all([
    // At-risk trips: open, departing within 24h
    supabase
      .from('trips')
      .select('id, title, departure_at, current_bookings, threshold')
      .eq('status', 'open')
      .lte('departure_at', in24h.toISOString())
      .gte('departure_at', now.toISOString()),

    // Stale payouts: pending for over 48h
    supabase
      .from('payouts')
      .select('id, payout_amount, created_at')
      .eq('status', 'pending')
      .lt('created_at', fortyEightHoursAgo.toISOString()),

    // Stuck captains: onboarding not complete
    supabase
      .from('captains')
      .select('id, display_name, onboarding_step')
      .neq('onboarding_step', 'complete'),
  ]);

  // Filter at-risk trips where current_bookings < threshold
  const atRiskTrips = (atRiskRes.data ?? []).filter(
    (t) => t.current_bookings < t.threshold
  );

  const stalePayouts = (stalePayoutsRes.data ?? []).map((p) => ({
    ...p,
    payout_amount: Number(p.payout_amount),
  }));

  return {
    atRiskTrips,
    stalePayouts,
    stuckCaptains: stuckCaptainsRes.data ?? [],
  };
}
