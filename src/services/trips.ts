import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';
import { CreateTripInput, Trip } from '../types';

export async function createTrip(data: CreateTripInput): Promise<Trip> {
  const { data: trip, error } = await supabase
    .from('trips')
    .insert(data)
    .select()
    .single();

  if (error) throw new Error(`Failed to create trip: ${error.message}`);
  logger.info({ tripId: trip.id }, 'Trip created');
  return trip;
}

export async function getTripById(tripId: string): Promise<Trip | null> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();

  if (error) return null;
  return data;
}

export async function getTripByShortId(shortId: string, captainId: string): Promise<Trip | null> {
  const { data: trips, error } = await supabase
    .from('trips')
    .select('*')
    .eq('captain_id', captainId);

  if (error || !trips) return null;

  return trips.find((t) => t.id.substring(0, 6) === shortId) || null;
}

export async function getTripsByCaptain(captainId: string): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('captain_id', captainId)
    .in('status', ['open', 'confirmed'])
    .gte('departure_at', new Date().toISOString())
    .order('departure_at', { ascending: true });

  if (error) throw new Error(`Failed to get trips: ${error.message}`);
  return data || [];
}

export async function getOpenTrips(): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('status', 'open');

  if (error) throw new Error(`Failed to get open trips: ${error.message}`);
  return data || [];
}

export async function updateTripBookingCount(tripId: string, delta: number): Promise<Trip> {
  const { data: trip, error: fetchErr } = await supabase
    .from('trips')
    .select('current_bookings')
    .eq('id', tripId)
    .single();

  if (fetchErr || !trip) throw new Error('Trip not found');

  const newCount = trip.current_bookings + delta;
  const { data: updated, error } = await supabase
    .from('trips')
    .update({ current_bookings: Math.max(0, newCount) })
    .eq('id', tripId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update trip count: ${error.message}`);
  return updated;
}
