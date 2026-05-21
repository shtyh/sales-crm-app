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

/** Fetch a single booking by id. Returns null if not found / not visible. */
export async function getBooking(id: string) {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data as Booking | null
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

/**
 * Patch one or more fields on an existing booking.
 * Caller passes only the fields they want to change.
 */
export async function updateBooking(id: string, patch: Partial<BookingInsert>) {
  const { data, error } = await supabase
    .from('bookings')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return data as Booking
}

/** Permanently delete a booking. RLS only lets the owner do this. */
export async function deleteBooking(id: string) {
  const { error } = await supabase.from('bookings').delete().eq('id', id)
  if (error) throw error
}
