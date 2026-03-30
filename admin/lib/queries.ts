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
    .not('status', 'in', '("cancelled","refunded")')
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
    .not('status', 'in', '("cancelled","refunded")')
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

export async function getTrips(filters?: { status?: string; search?: string }) {
  const supabase = createServerSupabase();
  let query = supabase
    .from('trips')
    .select('*, captains(display_name), bookings(id, status)')
    .order('departure_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.search) query = query.ilike('title', `%${filters.search}%`);

  const { data } = await query;

  // Compute booking counts from bookings relation
  return (data || []).map((trip) => {
    const bookings = (trip.bookings || []) as { id: string; status: string }[];
    // Paid bookings = authorized + confirmed (real payments)
    const paidBookings = bookings.filter(
      (b) => b.status === 'authorized' || b.status === 'confirmed'
    ).length;
    // Pending = clicked book but haven't paid yet
    const pendingBookings = bookings.filter(
      (b) => b.status === 'pending_payment'
    ).length;
    return {
      ...trip,
      bookings: undefined,
      paid_bookings: paidBookings,
      pending_bookings: pendingBookings,
    };
  });
}

export async function getTripDetail(id: string) {
  const supabase = createServerSupabase();

  const { data: trip } = await supabase
    .from('trips')
    .select('*, captains(display_name, whatsapp_id)')
    .eq('id', id)
    .single();

  const { data: bookings } = await supabase
    .from('bookings')
    .select('*')
    .eq('trip_id', id)
    .order('created_at', { ascending: true });

  const { data: payout } = await supabase
    .from('payouts')
    .select('*')
    .eq('trip_id', id)
    .maybeSingle();

  return { trip, bookings: bookings || [], payout };
}

export async function getBookings(filters?: { status?: string; trip_id?: string }) {
  const supabase = createServerSupabase();
  let query = supabase
    .from('bookings')
    .select('*, trips(title, trip_type)')
    .order('created_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.trip_id) query = query.eq('trip_id', filters.trip_id);

  const { data } = await query;
  return data || [];
}

export async function getAdminSettings() {
  const supabase = createServerSupabase();
  const { data } = await supabase.from('admin_settings').select('*');
  const settings: Record<string, string> = {};
  for (const row of data || []) {
    settings[row.key] = row.value;
  }
  return settings;
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

export interface CalendarTripPayout {
  id: string;
  status: string;
  payout_amount: number;
  gross_amount: number;
  commission_amount: number;
  bank_reference: string | null;
  processed_at: string | null;
}

export interface CalendarTrip {
  id: string;
  title: string;
  trip_type: string;
  departure_at: string;
  duration_hours: number | null;
  status: string;
  current_bookings: number;
  max_seats: number;
  price_per_person_aed: number;
  captain_id: string;
  captain_name: string;
  meeting_point: string | null;
  payout: CalendarTripPayout | null;
  total_revenue: number;
  total_commission: number;
  total_captain_payout: number;
}

export async function getTripsForCalendar(from: string, to: string): Promise<CalendarTrip[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('trips')
    .select('id, title, trip_type, departure_at, duration_hours, status, current_bookings, max_seats, price_per_person_aed, captain_id, meeting_point, captains(display_name), bookings(total_amount_aed, platform_fee_aed, captain_payout_aed, status), payouts(id, status, payout_amount, gross_amount, commission_amount, bank_reference, processed_at)')
    .gte('departure_at', from)
    .lte('departure_at', to)
    .order('departure_at', { ascending: true });

  return (data || []).map((t) => {
    const bookings = (t.bookings || []) as { total_amount_aed: number; platform_fee_aed: number | null; captain_payout_aed: number | null; status: string }[];
    const activeBookings = bookings.filter((b) => b.status !== 'cancelled' && b.status !== 'refunded');
    const totalRevenue = activeBookings.reduce((s, b) => s + Number(b.total_amount_aed), 0);
    const totalCommission = activeBookings.reduce((s, b) => s + Number(b.platform_fee_aed || 0), 0);
    const totalCaptainPayout = activeBookings.reduce((s, b) => s + Number(b.captain_payout_aed || 0), 0);

    const payouts = (t.payouts || []) as CalendarTripPayout[];
    const payout = payouts.length > 0 ? payouts[0] : null;

    return {
      id: t.id,
      title: t.title,
      trip_type: t.trip_type,
      departure_at: t.departure_at,
      duration_hours: t.duration_hours ? Number(t.duration_hours) : null,
      status: t.status,
      current_bookings: t.current_bookings,
      max_seats: t.max_seats,
      price_per_person_aed: Number(t.price_per_person_aed),
      captain_id: t.captain_id,
      captain_name: (t.captains as unknown as { display_name: string } | null)?.display_name || 'Unknown',
      meeting_point: t.meeting_point,
      payout,
      total_revenue: totalRevenue,
      total_commission: totalCommission,
      total_captain_payout: totalCaptainPayout,
    };
  });
}
