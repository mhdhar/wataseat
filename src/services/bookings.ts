import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';
import { Booking, BookingStatus, CreateBookingInput, TripSeatOccupancy } from '../types';

export async function createBooking(data: CreateBookingInput): Promise<Booking> {
  const { data: booking, error } = await supabase
    .from('bookings')
    .insert({
      ...data,
      status: 'pending_payment' as BookingStatus,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create booking: ${error.message}`);
  logger.info({ bookingId: booking.id, tripId: data.trip_id }, 'Booking created');
  return booking;
}

export async function getBookingsByTrip(tripId: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('trip_id', tripId)
    .not('status', 'eq', 'cancelled');

  if (error) throw new Error(`Failed to get bookings: ${error.message}`);
  return data || [];
}

export async function getAuthorizedBookings(tripId: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('trip_id', tripId)
    .eq('status', 'authorized');

  if (error) throw new Error(`Failed to get authorized bookings: ${error.message}`);
  return data || [];
}

export async function updateBookingStatus(
  bookingId: string,
  status: BookingStatus,
  extra?: Record<string, any>
): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({ status, ...extra })
    .eq('id', bookingId);

  if (error) throw new Error(`Failed to update booking: ${error.message}`);
}

export async function hasGuestBooked(tripId: string, guestWaId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('bookings')
    .select('id')
    .eq('trip_id', tripId)
    .eq('guest_whatsapp_id', guestWaId)
    .not('status', 'eq', 'cancelled')
    .limit(1);

  if (error) return false;
  return (data?.length ?? 0) > 0;
}

export async function getBookingById(bookingId: string): Promise<Booking | null> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (error) return null;
  return data;
}

const ZERO_OCCUPANCY: TripSeatOccupancy = {
  reserved_seats: 0,
  authorized_seats: 0,
  confirmed_seats: 0,
  total_occupied_seats: 0,
};

export async function getTripSeatOccupancy(tripId: string): Promise<TripSeatOccupancy> {
  const { data, error } = await supabase
    .from('trip_seat_occupancy')
    .select('reserved_seats, authorized_seats, confirmed_seats, total_occupied_seats')
    .eq('trip_id', tripId)
    .maybeSingle();

  if (error) throw new Error(`Seat occupancy query failed: ${error.message}`);
  return data ?? ZERO_OCCUPANCY;
}
