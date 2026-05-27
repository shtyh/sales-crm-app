import { supabase } from './supabase'
import type {
  AvailableSlot,
  PublicServiceAppointment,
  ServiceAppointment,
  ServiceAppointmentInput,
} from './types'

/**
 * Submit a new appointment via the `submit_appointment` SECURITY DEFINER
 * RPC. The RPC is granted to anon + authenticated so the same call works
 * from /book (anonymous customer) and /service/book (staff form).
 * Returns the row's token, which is the only handle the public side has
 * for reading back the status.
 */
export async function submitAppointment(
  input: ServiceAppointmentInput,
): Promise<string> {
  const { data, error } = await supabase.rpc('submit_appointment', {
    p_customer_name: input.customer_name,
    p_customer_phone: input.customer_phone,
    p_customer_email: input.customer_email,
    p_vehicle_reg: input.vehicle_reg,
    p_vehicle_chassis: input.vehicle_chassis,
    p_vehicle_model: input.vehicle_model,
    p_preferred_date: input.preferred_date,
    p_slot_time: input.slot_time,
    p_service_mileage: input.service_mileage,
    p_complaint: input.complaint ?? null,
    p_phone_block: input.phone_block ?? false,
  })
  if (error) throw error
  return data as string
}

/**
 * Slot picker source. Returns the eight hour-long slots for the given
 * date with their current `taken` count. Empty array on Sundays and
 * past dates — those branches bail out inside the RPC.
 */
export async function getAvailableSlots(
  date: string,
): Promise<AvailableSlot[]> {
  const { data, error } = await supabase.rpc('get_available_slots', {
    p_date: date,
  })
  if (error) throw error
  return (data as AvailableSlot[] | null) ?? []
}

/** Public read-back. Returns null when the token doesn't match. */
export async function getAppointmentByToken(
  token: string,
): Promise<PublicServiceAppointment | null> {
  const { data, error } = await supabase.rpc('get_appointment_by_token', {
    p_token: token,
  })
  if (error) throw error
  const row = (data as PublicServiceAppointment[] | null)?.[0] ?? null
  return row
}

/** Staff queue — every appointment the caller can read (RLS gates).
 *  Workshop roles + super_admin see all rows. */
export async function listAppointments(): Promise<ServiceAppointment[]> {
  const { data, error } = await supabase
    .from('service_appointments')
    .select('*')
    .order('preferred_date', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ServiceAppointment[]
}

/** Confirm / reject / cancel. Workshop SM + SA + super_admin (RLS). */
export async function confirmAppointment(id: string): Promise<void> {
  const { error } = await supabase
    .from('service_appointments')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      rejected_reason: null,
    })
    .eq('id', id)
  if (error) throw error
}

export async function rejectAppointment(
  id: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from('service_appointments')
    .update({
      status: 'rejected',
      confirmed_at: new Date().toISOString(),
      rejected_reason: reason.trim() || 'Slot unavailable',
    })
    .eq('id', id)
  if (error) throw error
}

export async function cancelAppointment(id: string): Promise<void> {
  const { error } = await supabase
    .from('service_appointments')
    .update({
      status: 'cancelled',
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}
