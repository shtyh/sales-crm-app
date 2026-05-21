import { supabase } from './supabase'
import type { Booking, BookingInsert } from './types'

/** List all bookings the current user can see (RLS scopes to own). */
export async function listBookings() {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .order('booking_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as Booking[]
}

/** Insert a new booking and return the inserted row. */
export async function createBooking(input: BookingInsert) {
  const { data, error } = await supabase
    .from('bookings')
    .insert(input)
    .select('*')
    .single()

  if (error) throw error
  return data as Booking
}
